import { describe, expect, it } from "vitest";
import { FastTracker, type Detection } from "./tracker";

const W = 720, H = 960; // portrait camera frame
/** A box centred at fraction cx of the width, height h (fraction of the frame), aspect 0.4 (a person). */
const box = (cx: number, h: number): Detection["box"] => {
  const bh = h * H, bw = bh * 0.4;
  return [cx * W - bw / 2, H - bh - 20, bw, bh];
};
const person = (cx: number, h: number, score = 0.8): Detection => ({ type: "person", box: box(cx, h), score });

describe("FastTracker", () => {
  it("stays quiet about a far person who isn't moving", () => {
    const tr = new FastTracker();
    for (let t = 0; t <= 2000; t += 250) expect(tr.update([person(0.5, 0.2)], W, H, t, "en")).toEqual([]);
  });

  it("warns when a person walks toward the walker (box grows), with direction", () => {
    const tr = new FastTracker();
    let last: ReturnType<FastTracker["update"]> = [];
    for (let i = 0; i <= 8; i++) last = tr.update([person(0.15, 0.2 + i * 0.04)], W, H, i * 250, "en");
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ type: "person", direction: "left", approaching: true, phrase: "Person on your left" });
  });

  it("an approaching person who is close is urgent", () => {
    const tr = new FastTracker();
    let last: ReturnType<FastTracker["update"]> = [];
    for (let i = 0; i <= 8; i++) last = tr.update([person(0.5, 0.35 + i * 0.05)], W, H, i * 250, "en");
    expect(last[0]).toMatchObject({ distance: "close", approaching: true, urgency: 1, phrase: "Person ahead" });
  });

  it("a close person standing still is a (non-urgent) warning", () => {
    const tr = new FastTracker();
    const out = tr.update([person(0.85, 0.7)], W, H, 0, "fr");
    expect(out[0]).toMatchObject({ distance: "close", approaching: false, urgency: 2, direction: "right", phrase: "Personne à droite" });
  });

  it("someone walking away (box shrinks) is not approaching", () => {
    const tr = new FastTracker();
    let last: ReturnType<FastTracker["update"]> = [];
    for (let i = 0; i <= 8; i++) last = tr.update([person(0.5, 0.5 - i * 0.03)], W, H, i * 250, "en");
    expect(last).toEqual([]);
  });

  it("keeps following one person as they cross from left to right", () => {
    const tr = new FastTracker();
    let last: ReturnType<FastTracker["update"]> = [];
    // crosses the frame while getting bigger: one track the whole way, so 'approaching' holds
    for (let i = 0; i <= 8; i++) last = tr.update([person(0.2 + i * 0.07, 0.25 + i * 0.03)], W, H, i * 250, "en");
    expect(last[0]).toMatchObject({ approaching: true, direction: "right" });
  });

  it("tells two people apart", () => {
    const tr = new FastTracker();
    let last: ReturnType<FastTracker["update"]> = [];
    for (let i = 0; i <= 8; i++) {
      last = tr.update([person(0.15, 0.2 + i * 0.04), person(0.85, 0.25)], W, H, i * 250, "en");
    }
    expect(last).toHaveLength(1); // only the one coming toward the walker
    expect(last[0].direction).toBe("left");
  });

  it("forgets objects not seen for over a second (no stale 'approaching')", () => {
    const tr = new FastTracker();
    tr.update([person(0.5, 0.2)], W, H, 0, "en");
    tr.update([], W, H, 1500, "en");                       // gone
    expect(tr.update([person(0.5, 0.4)], W, H, 1750, "en")).toEqual([]); // new track, no history yet
  });

  it("never mixes up types: a bike where a person was starts its own history", () => {
    const tr = new FastTracker();
    for (let t = 0; t <= 500; t += 250) tr.update([person(0.5, 0.3)], W, H, t, "en");
    // a bike appears in the same spot, bigger: it must not inherit the person's size history
    const out = tr.update([{ type: "bike", box: box(0.5, 0.4), score: 0.9 }], W, H, 750, "en");
    expect(out).toEqual([]);
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
