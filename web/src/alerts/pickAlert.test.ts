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

  it("warnings wait 8 s, information (crosswalk, stop sign) 45 s", () => {
    mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })));
    mod.pickAlert(scene(hz({ urgency: 3 })));
    vi.setSystemTime(7000);
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })))).toBeNull();
    vi.setSystemTime(8100);
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 2 })))).not.toBeNull();
    vi.setSystemTime(44000);
    expect(mod.pickAlert(scene(hz({ urgency: 3 })))).toBeNull();
    vi.setSystemTime(45100);
    expect(mod.pickAlert(scene(hz({ urgency: 3 })))).not.toBeNull();
  });

  it("a hazard (not information) in a new direction is new", () => {
    mod.pickAlert(scene(hz({ type: "person", direction: "left", urgency: 2 })));
    expect(mod.pickAlert(scene(hz({ type: "person", direction: "right", urgency: 2 })))).not.toBeNull();
  });

  it("'What's ahead?' (ignoreRepeat) answers even if just said, without muting it later", () => {
    mod.pickAlert(scene(hz({})));
    expect(mod.pickAlert(scene(hz({})), { ignoreRepeat: true })).not.toBeNull();
    vi.setSystemTime(45100);
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

describe("when to say it", () => {
  const pothole = (distance: Hazard["distance"]) => scene(hz({ type: "pothole", urgency: distance === "close" ? 1 : 2, distance }));

  it("things you can trip on: at first sighting, then once more when close", () => {
    expect(mod.pickAlert(pothole("near"))).not.toBeNull();  // "Pothole ahead", ~5 m away
    vi.setSystemTime(1000);
    expect(mod.pickAlert(pothole("near"))).toBeNull();      // still there: quiet
    vi.setSystemTime(3000);
    expect(mod.pickAlert(pothole("close"))).not.toBeNull(); // under 2 m: last warning
    vi.setSystemTime(4000);
    expect(mod.pickAlert(pothole("close"))).toBeNull();     // said once, not every snapshot
  });

  it("first seen already close: said once, not twice", () => {
    expect(mod.pickAlert(pothole("close"))).not.toBeNull();
    vi.setSystemTime(1000);
    expect(mod.pickAlert(pothole("close"))).toBeNull();
  });

  it("a new pothole later gets its own close-up warning", () => {
    mod.pickAlert(pothole("near"));
    vi.setSystemTime(1000);
    mod.pickAlert(pothole("close"));
    vi.setSystemTime(20_000);                                // another one, further down the street
    expect(mod.pickAlert(pothole("near"))).not.toBeNull();
    vi.setSystemTime(22_000);
    expect(mod.pickAlert(pothole("close"))).not.toBeNull();
  });

  it("a stop sign 20 ft away (near) or further (far) is said at first sighting, and only once", () => {
    expect(mod.pickAlert(scene(hz({ distance: "far" })))).not.toBeNull();
    vi.setSystemTime(3000);
    expect(mod.pickAlert(scene(hz({ distance: "near", direction: "right" })))).toBeNull();
    vi.setSystemTime(6000);
    expect(mod.pickAlert(scene(hz({ distance: "close", direction: "right" })))).toBeNull(); // no close-up repeat
  });

  it("street clips are per direction; other things have none", () => {
    expect(mod.streetClip(hz({ direction: "right" }))).toBe("st_stop_sign_right");
    expect(mod.streetClip(hz({ type: "door" }))).toBe("st_door_ahead");
    expect(mod.streetClip(hz({ type: "person" }))).toBeNull();
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
