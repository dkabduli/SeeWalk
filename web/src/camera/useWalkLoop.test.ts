import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneResult, SystemEvent } from "../api/types";

// ---------- fakes ----------

/** A request to "Gemini" that the test resolves or rejects by hand. */
interface Pending {
  image: string;
  prev: string | null;
  resolve: (r: SceneResult) => void;
  reject: (e: Error) => void;
}
const calls: Pending[] = [];
let inFlight = 0;
let maxInFlight = 0;

vi.mock("../api/client", () => ({
  analyze: vi.fn(
    (image: string, prev: string | null) =>
      new Promise<SceneResult>((resolve, reject) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push({
          image, prev,
          resolve: (r) => { inFlight--; resolve(r); },
          reject: (e) => { inFlight--; reject(e); },
        });
      }),
  ),
}));

const cam = {
  live: true,
  startImpl: (): Promise<void> => Promise.resolve(),
  start: vi.fn(() => cam.startImpl()),
  stop: vi.fn(),
  videoRef: { current: {} as HTMLVideoElement },
};
vi.mock("./useCamera", () => ({
  useCamera: () => ({
    videoRef: cam.videoRef,
    start: cam.start,
    stop: cam.stop,
    isLive: () => cam.live,
  }),
}));

let frameN = 0;
let nextFrame: { brightness: number; contrast: number } = { brightness: 120, contrast: 40 };
vi.mock("./captureFrame", async (importOriginal) => {
  const real = await importOriginal<typeof import("./captureFrame")>();
  return {
    ...real, // keep the real looksCovered
    captureFrame: () => ({ b64: `frame${++frameN}`, ...nextFrame, at: Date.now() }),
  };
});

import { useWalkLoop } from "./useWalkLoop";

const RESULT: SceneResult = {
  hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.9, approaching: false, phrase: "Stop sign ahead" }],
  unclear: false,
};

function setup() {
  const onResult = vi.fn<(r: SceneResult) => void>();
  const onSystem = vi.fn<(e: SystemEvent) => void>();
  const hook = renderHook(() => useWalkLoop({ lang: "en", onResult, onSystem }));
  return { walk: () => hook.result.current, onResult, onSystem };
}

/** Let promises settle and advance fake time. */
const tick = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  frameN = 0;
  nextFrame = { brightness: 120, contrast: 40 };
  cam.live = true;
  cam.startImpl = () => Promise.resolve();
  cam.start.mockClear();
  cam.stop.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------- tests ----------

describe("useWalkLoop", () => {
  it("a new snapshot every 0.8 s, at most 2 at Gemini at once, never a previous frame", async () => {
    const { walk, onResult } = setup();
    act(() => { void walk().start(); });
    await tick();
    expect(calls).toHaveLength(1);
    await tick(799);
    expect(calls).toHaveLength(1);
    await tick(1);
    expect(calls).toHaveLength(2);    // didn't wait for the first answer
    await tick(3000);
    expect(calls).toHaveLength(2);    // full: 2 in flight, so no third
    calls[0].resolve(RESULT);
    await tick(100);
    expect(onResult).toHaveBeenCalledWith(RESULT);
    expect(calls).toHaveLength(3);    // room again: next one goes right away
    expect(maxInFlight).toBe(2);
    expect(calls.every((c) => c.prev === null)).toBe(true);
  });

  it("an older answer arriving after a newer one is dropped", async () => {
    const { walk, onResult } = setup();
    act(() => { void walk().start(); });
    await tick(800);
    const newer = { ...RESULT, summary: "newer" };
    calls[1].resolve(newer);
    await tick();
    calls[0].resolve(RESULT);          // slow answer about an older snapshot
    await tick();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(newer);
  });

  it("never runs two loops after rapid Stop/Start, and drops results after Stop", async () => {
    const { walk, onResult } = setup();
    act(() => { void walk().start(); });
    await tick();
    act(() => walk().stop());
    act(() => { void walk().start(); });
    await tick();
    act(() => walk().stop());
    act(() => { void walk().start(); });
    await tick();

    calls[0].resolve(RESULT);          // answers for the stopped loops arrive late
    calls[1].resolve(RESULT);
    await tick(10_000);
    // Only the live loop keeps going, at most 2 requests at a time
    const live = calls.slice(2);
    expect(live.length).toBeGreaterThan(0);
    expect(inFlight).toBeLessThanOrEqual(2);
    expect(onResult).not.toHaveBeenCalled(); // stale answers were dropped
  });

  it("a double-tap on Start (no Stop in between) still runs only one loop", async () => {
    const { walk, onResult } = setup();
    act(() => { void walk().start(); void walk().start(); });
    await tick();
    for (let i = 0; i < 6; i++) {
      calls[calls.length - 1].resolve(RESULT);
      await tick(1500);
    }
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(onResult.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("paused (answering a question): no background snapshots, then resumes", async () => {
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].resolve(RESULT);
    await tick();
    act(() => walk().setPaused(true));
    await tick(6000);
    expect(calls).toHaveLength(1);            // nothing sent while paused
    act(() => walk().setPaused(false));
    await tick(600);
    expect(calls).toHaveLength(2);            // back to normal
  });

  it("What's ahead? still works while paused", async () => {
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].resolve(RESULT);
    await tick();
    act(() => walk().setPaused(true));
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    await tick(300);
    expect(calls).toHaveLength(2);
    calls[1].resolve(RESULT);
    await tick();
    expect(answer).toEqual({ ok: true, result: RESULT });
    await tick(5000);
    expect(calls).toHaveLength(2);            // and it stays paused afterwards
  });

  it("says no_connection after 2 failures in a row, then connection_back", async () => {
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].reject(new Error("503"));
    await tick(1500);
    expect(onSystem).not.toHaveBeenCalledWith("no_connection");
    calls[1].reject(new Error("503"));
    await tick();
    expect(onSystem).toHaveBeenCalledWith("no_connection");
    expect(onSystem).toHaveBeenCalledTimes(1);

    await tick(1500);
    calls[2].resolve(RESULT);
    await tick();
    expect(onSystem).toHaveBeenLastCalledWith("connection_back");
  });

  it("repeats no_connection only every 20 s while down", async () => {
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    for (let i = 0; i < 10; i++) {    // 10 failures, 1.5 s apart = 15 s
      await tick(i === 0 ? 0 : 1500);
      calls[i].reject(new Error("offline"));
      await tick();
    }
    expect(onSystem.mock.calls.filter(([e]) => e === "no_connection")).toHaveLength(1);
    for (let i = 10; i < 16; i++) {   // past the 20 s mark
      await tick(1500);
      calls[i].reject(new Error("offline"));
      await tick();
    }
    expect(onSystem.mock.calls.filter(([e]) => e === "no_connection")).toHaveLength(2);
  });

  it("What's ahead? during a request gets THAT result, and the loop doesn't speak it too", async () => {
    const { walk, onResult } = setup();
    act(() => { void walk().start(); });
    await tick();
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    calls[0].resolve(RESULT);
    await tick();
    expect(answer).toEqual({ ok: true, result: RESULT });
    expect(onResult).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1); // no extra request
  });

  it("What's ahead? while waiting takes a snapshot right away", async () => {
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].resolve(RESULT);
    await tick(100);                   // loop is now waiting ~1.4 s
    expect(calls).toHaveLength(1);
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    await tick();
    expect(calls).toHaveLength(2);    // didn't wait for the interval
    calls[1].resolve(RESULT);
    await tick();
    expect(answer).toEqual({ ok: true, result: RESULT });
  });

  it("What's ahead? reports no_connection when the request fails", async () => {
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    calls[0].reject(new Error("offline"));
    await tick();
    expect(answer).toEqual({ ok: false, reason: "no_connection" });
  });

  it("What's ahead? when not walking says stopped", async () => {
    const { walk } = setup();
    let answer: unknown;
    await act(async () => { answer = await walk().checkNow(); });
    expect(answer).toEqual({ ok: false, reason: "stopped" });
  });

  it("Stop resolves pending What's ahead? with stopped", async () => {
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    act(() => walk().stop());
    await tick();
    expect(answer).toEqual({ ok: false, reason: "stopped" });
  });

  it("camera permission denied → camera_blocked, not silence", async () => {
    cam.startImpl = () => Promise.reject(new Error("NotAllowedError"));
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick(5000);
    expect(onSystem).toHaveBeenCalledWith("camera_blocked");
    expect(calls).toHaveLength(0);
    let answer: unknown;
    await act(async () => { answer = await walk().checkNow(); });
    expect(answer).toEqual({ ok: false, reason: "stopped" });
  });

  it("Stop during the permission prompt turns the camera off when the prompt closes", async () => {
    let grant!: () => void;
    cam.startImpl = () => new Promise<void>((r) => { grant = r; });
    const { walk } = setup();
    act(() => { void walk().start(); });
    await tick();
    act(() => walk().stop());
    const stopsBefore = cam.stop.mock.calls.length;
    grant();                            // user taps "Allow" after already tapping Stop
    await tick(5000);
    expect(cam.stop.mock.calls.length).toBeGreaterThan(stopsBefore);
    expect(calls).toHaveLength(0);
  });

  it("covered lens: camera_blocked after 2 snapshots, and covered frames aren't sent", async () => {
    nextFrame = { brightness: 40, contrast: 3 }; // flat, dim: a finger over the lens
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick();
    expect(onSystem).not.toHaveBeenCalled();
    await tick(1500);
    expect(onSystem).toHaveBeenCalledWith("camera_blocked");
    expect(onSystem).toHaveBeenCalledTimes(1);
    await tick(1500);
    expect(onSystem).toHaveBeenCalledTimes(1); // said once, not every snapshot
    expect(calls).toHaveLength(0);

    nextFrame = { brightness: 120, contrast: 40 }; // finger removed
    await tick(800);
    expect(calls).toHaveLength(1);
  });

  it("a bright blank wall is not 'covered'", async () => {
    nextFrame = { brightness: 200, contrast: 3 };
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick(4000);
    expect(onSystem).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);            // sent to Gemini (2 in flight, never answered)
  });

  it("camera not live (iOS interruption) twice → camera_blocked; What's ahead? says so", async () => {
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].resolve(RESULT);
    cam.live = false;
    await tick(1500);
    let answer: unknown;
    act(() => { void walk().checkNow().then((a) => { answer = a; }); });
    await tick();
    expect(onSystem).toHaveBeenCalledWith("camera_blocked");
    expect(answer).toEqual({ ok: false, reason: "camera_blocked" });
  });

  it("coming back to Safari forgets failures from while the page was frozen", async () => {
    const { walk, onSystem } = setup();
    act(() => { void walk().start(); });
    await tick();
    calls[0].reject(new Error("frozen"));  // fails while the page was hidden
    await tick();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(1500);
    calls[1].reject(new Error("one blip"));
    await tick();
    expect(onSystem).not.toHaveBeenCalledWith("no_connection"); // counter was reset
  });
});
