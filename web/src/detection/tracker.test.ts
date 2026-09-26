import { describe, expect, it } from "vitest";
import type { Hazard } from "../api/types";
import { FastTracker, type Detection } from "./tracker";

const W = 720, H = 960; // portrait camera frame
/** A box centred at fraction cx of the width, height h (fraction of the frame), aspect 0.4 (a person). */
const box = (cx: number, h: number): Detection["box"] => {
  const bh = h * H, bw = bh * 0.4;
  return [cx * W - bw / 2, H - bh - 20, bw, bh];
};
const person = (cx: number, h: number, score = 0.8): Detection => ({ type: "person", box: box(cx, h), score });

/** Runs a sequence of frames (250 ms apart) and returns every hazard reported. */
function run(tr: FastTracker, frames: Detection[][], lang: "en" | "fr" = "en"): Hazard[] {
  return frames.flatMap((dets, i) => tr.update(dets, W, H, i * 250, lang));
}
const steps = (n: number, f: (i: number) => Detection[]) => Array.from({ length: n }, (_, i) => f(i));

describe("FastTracker", () => {
  it("stays quiet about a far person who isn't moving", () => {
    expect(run(new FastTracker(), steps(9, () => [person(0.5, 0.2)]))).toEqual([]);
  });

  it("ignores far people even if their box jitters bigger (busy sidewalk)", () => {
    // 0.10 → 0.28 of the frame: grows a lot, but always 'far'
    expect(run(new FastTracker(), steps(9, (i) => [person(0.5, 0.1 + i * 0.02)]))).toEqual([]);
  });

  it("warns once when a person walks toward the walker, with direction", () => {
    const out = run(new FastTracker(), steps(9, (i) => [person(0.15, 0.3 + i * 0.03)]));
    expect(out).toHaveLength(1); // not repeated every check
    expect(out[0]).toMatchObject({ type: "person", direction: "left", approaching: true, urgency: 2, phrase: "Person on your left" });
  });

  it("escalates to urgent once when they get close and keep coming", () => {
    const out = run(new FastTracker(), steps(12, (i) => [person(0.5, 0.3 + i * 0.05)]));
    expect(out.map((h) => h.urgency)).toEqual([2, 1]); // warning, then urgent, nothing else
    expect(out[1]).toMatchObject({ distance: "close", approaching: true, phrase: "Person ahead" });
  });

  it("a close person standing still is said once (non-urgent)", () => {
    const out = run(new FastTracker(), steps(9, () => [person(0.85, 0.7)]), "fr");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ distance: "close", approaching: false, urgency: 2, direction: "right", phrase: "Personne à droite" });
  });

  it("someone walking away (box shrinks) is not approaching", () => {
    expect(run(new FastTracker(), steps(9, (i) => [person(0.5, 0.55 - i * 0.02)]))).toEqual([]);
  });

  it("one person crossing left → right is announced once, not once per direction", () => {
    const out = run(new FastTracker(), steps(9, (i) => [person(0.2 + i * 0.07, 0.35 + i * 0.02)]));
    expect(out).toHaveLength(1);
    expect(out[0].approaching).toBe(true);
  });

  it("tells two people apart: only the one coming toward the walker", () => {
    const out = run(new FastTracker(), steps(9, (i) => [person(0.15, 0.3 + i * 0.03), person(0.85, 0.35)]));
    expect(out).toHaveLength(1);
    expect(out[0].direction).toBe("left");
  });

  it("a new person is a new announcement", () => {
    const tr = new FastTracker();
    const first = run(tr, steps(9, (i) => [person(0.5, 0.3 + i * 0.03)]));
    tr.update([], W, H, 4000, "en"); // they leave; forgotten after 1 s
    const second = [5000, 5250, 5500, 5750, 6000].flatMap((t, i) => tr.update([person(0.5, 0.3 + i * 0.04)], W, H, t, "en"));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("never mixes up types: a bike where a person was starts its own history", () => {
    const tr = new FastTracker();
    for (let t = 0; t <= 500; t += 250) tr.update([person(0.5, 0.35)], W, H, t, "en");
    const out = tr.update([{ type: "bike", box: box(0.5, 0.45), score: 0.9 }], W, H, 750, "en");
    expect(out).toEqual([]); // new object, no history yet: not approaching, not close
  });

  it("bikes and cars use their own phrases", () => {
    const tr = new FastTracker();
    const out = tr.update(
      [{ type: "bike", box: box(0.5, 0.7), score: 0.9 }, { type: "car", box: [10, 100, 300, 700], score: 0.9 }],
      W, H, 0, "en",
    );
    expect(out.map((h) => h.phrase).sort()).toEqual(["Bike ahead", "Car on your left"]);
  });
});
