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

  // Generic windows (things that aren't street hazards, e.g. an obstacle the walker asked about)
  it("urgent hazards may repeat after 5 s", () => {
    expect(mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 1 })))).not.toBeNull();
    vi.setSystemTime(4000);
    expect(mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 1 })))).toBeNull();
    vi.setSystemTime(5100);
    expect(mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 1 })))).not.toBeNull();
  });

  it("warnings wait 8 s, information (crosswalk, stop sign) 45 s", () => {
    mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 2 })));
    mod.pickAlert(scene(hz({ urgency: 3 })));
    vi.setSystemTime(7000);
    expect(mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 2 })))).toBeNull();
    vi.setSystemTime(8100);
    expect(mod.pickAlert(scene(hz({ type: "obstacle_in_path", urgency: 2 })))).not.toBeNull();
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
  // Replays of the testers' walk (lab log, Sept 26, 18:19-18:21)
  const at = (sec: number) => vi.setSystemTime(sec * 1000);
  const say = (h: Partial<Hazard>) => mod.pickAlert(scene(hz(h))) !== null;

  it("one curb at a corner: said once, then once more only when it's close (was 4 times in 20 s)", () => {
    const curb = { type: "curb_or_dropoff" as const, urgency: 2 as const };
    at(0);  expect(say({ ...curb, distance: "near", direction: "ahead" })).toBe(true);
    at(3);  expect(say({ ...curb, distance: "near", direction: "right" })).toBe(false); // same curb, new angle
    at(10); expect(say({ ...curb, distance: "close", direction: "ahead", urgency: 1 })).toBe(true); // last warning
    at(19); expect(say({ ...curb, distance: "near", direction: "ahead" })).toBe(false);
    at(20); expect(say({ ...curb, distance: "close", direction: "left", urgency: 1 })).toBe(false);
  });

  it("one work zone passed on the left, ahead and right: said once (was 7 times in under 2 minutes)", () => {
    const cones = { type: "construction" as const, urgency: 2 as const };
    const log: [number, Partial<Hazard>][] = [
      [0, { direction: "ahead", distance: "near" }], [2, { direction: "ahead", distance: "close", urgency: 1 }],
      [8, { direction: "right", distance: "near" }], [14, { direction: "right", distance: "near" }],
      [21, { direction: "ahead", distance: "near" }], [26, { direction: "right", distance: "near" }],
    ];
    const said = log.filter(([t, h]) => { at(t); return say({ ...cones, ...h }); }).map(([t]) => t);
    expect(said).toEqual([0, 2]); // first sight, then the close-up
  });

  it("the same curb 30 s later is said again (a new corner, or still standing there)", () => {
    const curb = { type: "curb_or_dropoff" as const, urgency: 2 as const, distance: "near" as const };
    at(0);  expect(say(curb)).toBe(true);
    at(29); expect(say(curb)).toBe(false);
    at(31); expect(say(curb)).toBe(true);
  });

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
    vi.setSystemTime(31_000);                                // another one, further down the street
    expect(mod.pickAlert(pothole("near"))).not.toBeNull();
    vi.setSystemTime(33_000);
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
    expect(mod.streetClip(hz({ type: "pillar" }))).toBe("st_pillar_ahead");
    expect(mod.streetClip(hz({ type: "chair", phrase: "Chair ahead" }))).toBeNull();
    expect(mod.streetClip(hz({ type: "person" }))).toBeNull();
  });
});

describe("streetOnly", () => {
  it("keeps street hazards, including a pillar, and drops people, chairs, poles and other objects", () => {
    const r = mod.streetOnly(scene(
      hz({ type: "person", urgency: 2 }), hz({ type: "car" }), hz({ type: "obstacle_in_path", urgency: 2 }),
      hz({ type: "chair", urgency: 2, phrase: "Chair ahead" }), hz({ type: "pole", urgency: 2, phrase: "Pole ahead" }),
      hz({ type: "other" }), hz({ type: "pothole", urgency: 1 }), hz({ type: "stop_sign" }),
      hz({ type: "pillar", urgency: 2, phrase: "Pillar ahead" }), hz({ type: "curb_or_dropoff" }),
    ));
    expect(r.hazards.map((h) => h.type)).toEqual(["pothole", "stop_sign", "pillar", "curb_or_dropoff"]);
  });

  it("keeps a door only when it is ahead", () => {
    const r = mod.streetOnly(scene(
      hz({ type: "door", direction: "left", phrase: "Door on your left" }),
      hz({ type: "door_open", phrase: "Open door ahead" }),
    ));
    expect(r.hazards.map((h) => h.type)).toEqual(["door_open"]);
  });
});

describe("pillar, chair, pole", () => {
  const pillar = (distance: Hazard["distance"]) =>
    scene(hz({ type: "pillar", urgency: distance === "close" ? 1 : 2, distance, phrase: "Pillar ahead" }));

  it("a pillar is said only when a second look still shows it, then not again up close", () => {
    expect(mod.pickAlert(pillar("near"))).toBeNull();
    expect(mod.pickAlert(pillar("near"))?.phrase).toBe("Pillar ahead");
    vi.setSystemTime(3000);
    expect(mod.pickAlert(pillar("close"))).toBeNull();
    vi.setSystemTime(8000);
    expect(mod.pickAlert(pillar("near"))).toBeNull();
    vi.setSystemTime(21_000);
    expect(mod.pickAlert(pillar("near"))).toBeNull();
    vi.setSystemTime(22_000);
    expect(mod.pickAlert(pillar("near"))).not.toBeNull();
  });

  it("a single pillar look, or one after a gap, stays quiet", () => {
    expect(mod.pickAlert(pillar("near"))).toBeNull();
    vi.setSystemTime(5000);
    expect(mod.pickAlert(pillar("near"))).toBeNull();
    vi.setSystemTime(6000);
    expect(mod.pickAlert(pillar("near"))).not.toBeNull();
  });

  it("a doubtful pillar is not announced", () => {
    const weak = scene(hz({ type: "pillar", confidence: 0.7, phrase: "Pillar ahead" }));
    expect(mod.pickAlert(weak)).toBeNull();
    expect(mod.pickAlert(weak)).toBeNull();
  });

  it("stairs are said once, then once when close, and a direction change is not a new stair", () => {
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 2, direction: "right", phrase: "Stairs on your right" })))?.phrase).toBe("Stairs on your right");
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 2, direction: "ahead", phrase: "Stairs ahead" })))).toBeNull();
    vi.setSystemTime(3000);
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 1, distance: "close", phrase: "Stairs ahead" })))).not.toBeNull();
    vi.setSystemTime(8000);
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 1, distance: "close", phrase: "Stairs ahead" })))).toBeNull();
    vi.setSystemTime(23000);
    expect(mod.pickAlert(scene(hz({ type: "stairs_down", urgency: 2, phrase: "Stairs ahead" })))).not.toBeNull();
  });

  it("a drop-off is not announced in the same breath as stairs", () => {
    const pick = mod.pickAlert(scene(
      hz({ type: "stairs_down", urgency: 1, phrase: "Stairs ahead" }),
      hz({ type: "curb_or_dropoff", urgency: 1, direction: "right", phrase: "Drop-off on your right" }),
    ));
    expect(pick?.type).toBe("stairs_down");
    vi.setSystemTime(2000);
    expect(mod.pickAlert(scene(hz({ type: "curb_or_dropoff", urgency: 1, phrase: "Drop-off ahead" })))).toBeNull();
  });

  it("a closed door that opens within 8 s is door opening, and a side door stays quiet", () => {
    const closed = scene(hz({ type: "door", urgency: 2, phrase: "Door ahead" }));
    expect(mod.pickAlert(mod.streetOnly(mod.noticeDoors(closed)))?.type).toBe("door");
    vi.setSystemTime(3000);
    const open = scene(hz({ type: "door_open", urgency: 2, phrase: "Open door ahead" }));
    const swing = mod.noticeDoors(open);
    expect(swing.hazards[0].type).toBe("door_opening");
    expect(mod.pickAlert(mod.streetOnly(swing))?.type).toBe("door_opening");
    vi.setSystemTime(4000);
    const side = mod.streetOnly(mod.noticeDoors(scene(hz({ type: "door", direction: "left", phrase: "Door on your left" }))));
    expect(mod.pickAlert(side)).toBeNull();
  });

  it("a door is said once, not again while you are still walking through it", () => {
    const door = (distance: Hazard["distance"]) =>
      scene(hz({ type: "door", urgency: distance === "close" ? 1 : 2, distance, phrase: "Door ahead" }));
    expect(mod.pickAlert(mod.streetOnly(mod.noticeDoors(door("near"))))?.type).toBe("door");
    vi.setSystemTime(3000);
    expect(mod.pickAlert(mod.streetOnly(mod.noticeDoors(door("close"))))).toBeNull();
    vi.setSystemTime(25000);
    expect(mod.pickAlert(mod.streetOnly(mod.noticeDoors(door("close"))))).toBeNull();
    vi.setSystemTime(26000);
    mod.noticeDoors(scene());
    vi.setSystemTime(31000);
    mod.noticeDoors(scene());
    expect(mod.pickAlert(mod.streetOnly(mod.noticeDoors(door("near"))))).not.toBeNull();
  });

  it("elevator doors said as a door become an elevator, and a side one stays quiet", () => {
    const seen = mod.noticeDoors({
      hazards: [hz({ type: "door", urgency: 2, phrase: "Door ahead" })],
      unclear: false,
      summary: "Elevator call buttons",
    });
    expect(seen.hazards[0].type).toBe("elevator");
    expect(mod.pickAlert(mod.streetOnly(seen))?.phrase).toBe("Elevator ahead");
    const side = mod.streetOnly(scene(hz({ type: "elevator", direction: "left", phrase: "Elevator on your left" })));
    expect(side.hazards).toEqual([]);
  });

  it("a pillar to the side is not a street alert", () => {
    const side = mod.streetOnly(scene(hz({ type: "pillar", urgency: 2, direction: "left", phrase: "Pillar on your left" })));
    expect(mod.pickAlert(side)).toBeNull();
    expect(mod.pickAlert(side)).toBeNull();
  });

  it("a chair or a thin pole is never a street alert", () => {
    expect(mod.pickAlert(mod.streetOnly(scene(hz({ type: "chair", urgency: 1, distance: "close", phrase: "Chair ahead" }))))).toBeNull();
    expect(mod.pickAlert(mod.streetOnly(scene(hz({ type: "pole", urgency: 1, distance: "close", phrase: "Pole ahead" }))))).toBeNull();
  });
});

describe("questions use the same look", () => {
  it("what's ahead leads with the hazard, then the rest of the scene", () => {
    const text = mod.describeAhead({
      hazards: [hz({ type: "pothole", urgency: 2, phrase: "Pothole ahead" })],
      unclear: false,
      summary: "Chairs along the wall",
    });
    expect(text.startsWith("Pothole ahead")).toBe(true);
    expect(text).toContain("Chairs along the wall");
  });

  it("what's ahead does not repeat a hazard the summary already restates", () => {
    const text = mod.describeAhead({
      hazards: [hz({ type: "pothole", urgency: 2, phrase: "Pothole ahead" })],
      unclear: false,
      summary: "Pothole on the path",
    });
    expect(text).toBe("Pothole ahead");
  });

  it("what's ahead names an elevator instead of calling it a door", () => {
    const text = mod.describeAhead(mod.noticeDoors({
      hazards: [hz({ type: "door", urgency: 2, phrase: "Door ahead" })],
      unclear: false,
      summary: "Elevator at the end of the hall",
    }));
    expect(text.startsWith("Elevator ahead")).toBe(true);
  });

  it("what's ahead keeps the scene when the only hazard is a person", () => {
    const text = mod.describeAhead({
      hazards: [hz({ type: "person", urgency: 2, phrase: "Person ahead" })],
      unclear: false,
      summary: "Fountain and red couches",
    });
    expect(text).toBe("Fountain and red couches");
    expect(text).not.toContain("Person");
  });

  it("what's ahead with no hazard is the scene summary", () => {
    expect(mod.describeAhead({ hazards: [], unclear: false, summary: "Laptop on a table" })).toBe("Laptop on a table");
  });

  it("what's in the way names a chair and a pole, and skips a stop sign", () => {
    const text = mod.describePath(scene(
      hz({ type: "stop_sign", phrase: "Stop sign ahead" }),
      hz({ type: "chair", urgency: 2, phrase: "Chair ahead" }),
      hz({ type: "pole", urgency: 2, direction: "right", phrase: "Pole on your right" }),
    ));
    expect(text).toContain("Chair ahead");
    expect(text).toContain("Pole on your right");
    expect(text).not.toContain("Stop sign");
  });

  it("what's in the way is empty when the only thing ahead is a sign", () => {
    expect(mod.describePath(scene(hz({ phrase: "Stop sign ahead" })))).toBe("");
  });

  it("a sign the question did not mention is still announced", () => {
    const r = scene(
      hz({ type: "stop_sign", phrase: "Stop sign ahead" }),
      hz({ type: "chair", urgency: 2, phrase: "Chair ahead" }),
    );
    mod.noteSpoken(r, mod.describePath(r));
    expect(mod.pickAlert(scene(hz({ phrase: "Stop sign ahead" })))).not.toBeNull();
  });

  it("answering counts as saying the street hazard, and the close warning still comes", () => {
    mod.noteSpoken(scene(hz({ type: "pothole", urgency: 2, distance: "near", phrase: "Pothole ahead" })), "Pothole ahead");
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 2, distance: "near", phrase: "Pothole ahead" })))).toBeNull();
    vi.setSystemTime(3000);
    expect(mod.pickAlert(scene(hz({ type: "pothole", urgency: 1, distance: "close", phrase: "Pothole ahead" })))).not.toBeNull();
  });
});
