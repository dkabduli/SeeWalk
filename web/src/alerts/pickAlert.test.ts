import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hazard, SceneResult } from "../api/types";

const hz = (p: Partial<Hazard>): Hazard => ({
  type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.9, approaching: false,
  phrase: "Stop sign ahead", ...p,
});
const scene = (...hazards: Hazard[]): SceneResult => ({ hazards, unclear: false });

// pickAlert keeps module-level "last spoken" memory, so load a fresh copy per test
let mod: typeof import("./pickAlert");
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  mod = await import("./pickAlert");
});
afterEach(() => vi.useRealTimers());

describe("pickAlert", () => {
  it("never speaks below 0.6 confidence", () => {
    expect(mod.pickAlert(scene(hz({ confidence: 0.59 })))).toBeNull();
    expect(mod.pickAlert(scene(hz({ confidence: 0.6 })))).not.toBeNull();
  });

  it("most urgent first, then approaching, then closest", () => {
    const pick = mod.pickAlert(scene(
      hz({ type: "crosswalk", urgency: 3, phrase: "Crosswalk ahead" }),
      hz({ type: "person", urgency: 2, approaching: false, distance: "close", direction: "left", phrase: "Person on your left" }),
      hz({ type: "bike", urgency: 2, approaching: true, distance: "far", direction: "right", phrase: "Bike on your right" }),
    ));
    expect(pick?.type).toBe("bike");
  });

  it("urgent hazards may repeat after 5 s", () => {
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 1 })))).not.toBeNull();
    vi.setSystemTime(4000);
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 1 })))).toBeNull();
    vi.setSystemTime(5100);
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 1 })))).not.toBeNull();
  });

  it("warnings wait 8 s, information (crosswalk, stop sign) 20 s", () => {
    mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })));
    mod.pickAlert(scene(hz({ urgency: 3 })));
    vi.setSystemTime(7000);
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })))).toBeNull();
    vi.setSystemTime(8100);
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })))).not.toBeNull();
    vi.setSystemTime(19000);
    expect(mod.pickAlert(scene(hz({ urgency: 3 })))).toBeNull();
    vi.setSystemTime(20100);
    expect(mod.pickAlert(scene(hz({ urgency: 3 })))).not.toBeNull();
  });

  it("a hazard (not information) in a new direction is new", () => {
    mod.pickAlert(scene(hz({ type: "person", direction: "left", urgency: 2 })));
    expect(mod.pickAlert(scene(hz({ type: "person", direction: "right", urgency: 2 })))).not.toBeNull();
  });

  it("'What's ahead?' (ignoreRepeat) answers even if just said, without muting it later", () => {
    mod.pickAlert(scene(hz({})));
    expect(mod.pickAlert(scene(hz({})), { ignoreRepeat: true })).not.toBeNull();
    vi.setSystemTime(20100);
    expect(mod.pickAlert(scene(hz({})))).not.toBeNull(); // not pushed a minute into the future
  });

  it("fallback clips: people/bikes/cars by direction, others by type, 'other' has none", () => {
    expect(mod.fallbackClip(hz({ type: "bike", direction: "left" }))).toBe("bike_left");
    expect(mod.fallbackClip(hz({ type: "pothole" }))).toBe("pothole");
    expect(mod.fallbackClip(hz({ type: "curb_or_dropoff" }))).toBe("curb");
    expect(mod.fallbackClip(hz({ type: "other" }))).toBeNull();
  });

  it("pans left / centre / right", () => {
    expect([mod.panFor(hz({ direction: "left" })), mod.panFor(hz({})), mod.panFor(hz({ direction: "right" }))]).toEqual([-1, 0, 1]);
  });

  it("information isn't repeated just because its direction changed while walking past", () => {
    expect(mod.pickAlert(scene(hz({ direction: "ahead" })))).not.toBeNull();
    vi.setSystemTime(3000);
    expect(mod.pickAlert(scene(hz({ direction: "right", phrase: "Stop sign on your right" })))).toBeNull();
  });
});

describe("streetOnly", () => {
  it("keeps street hazards and drops people, vehicles and objects", () => {
    const r = mod.streetOnly(scene(
      hz({ type: "person", urgency: 2 }), hz({ type: "car" }), hz({ type: "obstacle_in_path", urgency: 2 }),
      hz({ type: "other" }), hz({ type: "pothole", urgency: 1 }), hz({ type: "stop_sign" }), hz({ type: "curb_or_dropoff" }),
    ));
    expect(r.hazards.map((h) => h.type)).toEqual(["pothole", "stop_sign", "curb_or_dropoff"]);
  });
});
