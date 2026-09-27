import { describe, expect, it } from "vitest";
import { bearing, metresBetween, offset, sideOf, Track, type Fix } from "./geo";

const UOTTAWA = { lat: 45.4231, lon: -75.6831 };

describe("distance and bearing", () => {
  it("metres and compass bearings at Ottawa's latitude", () => {
    const north = offset(UOTTAWA, 100, 0), east = offset(UOTTAWA, 0, 100);
    expect(metresBetween(UOTTAWA, north)).toBeCloseTo(100, 0);
    expect(metresBetween(UOTTAWA, east)).toBeCloseTo(100, 0);
    expect(bearing(UOTTAWA, north)).toBeCloseTo(0, 0);
    expect(bearing(UOTTAWA, east)).toBeCloseTo(90, 0);
    expect(bearing(UOTTAWA, offset(UOTTAWA, -100, 0))).toBeCloseTo(180, 0);
    expect(bearing(UOTTAWA, offset(UOTTAWA, 0, -100))).toBeCloseTo(270, 0);
  });
});

describe("side of the walker", () => {
  it("walking north: ahead, left, right, behind", () => {
    expect(sideOf(0, 10)).toBe("ahead");
    expect(sideOf(0, 350)).toBe("ahead");
    expect(sideOf(0, 270)).toBe("left");
    expect(sideOf(0, 90)).toBe("right");
    expect(sideOf(0, 180)).toBe("behind");
  });
  it("walking west, across the 0/360 line", () => {
    expect(sideOf(270, 280)).toBe("ahead");
    expect(sideOf(270, 180)).toBe("left");
    expect(sideOf(270, 0)).toBe("right");
    expect(sideOf(350, 20)).toBe("ahead");
  });
});

/** A walk north at 1.3 m/s, one fix a second, with GPS error of `jitter` metres (deterministic). */
function walkNorth(seconds: number, jitter = 0, accuracy = 8, heading = false): Fix[] {
  return Array.from({ length: seconds }, (_, i) => {
    const wobble = jitter ? Math.sin(i * 1.7) * jitter : 0;
    const p = offset(UOTTAWA, i * 1.3, wobble);
    return { ...p, accuracy, at: i * 1000, heading: heading ? 0 : null, speed: heading ? 1.3 : null };
  });
}

describe("the walker's track", () => {
  it("direction of travel from movement, even with GPS wobble", () => {
    const t = new Track();
    walkNorth(15, 3).forEach((f) => t.add(f));
    const dir = t.direction(14_000)!;
    expect(Math.min(dir, 360 - dir)).toBeLessThan(25); // roughly north
  });

  it("iOS's own heading when it gives one while walking", () => {
    const t = new Track();
    walkNorth(3, 0, 8, true).forEach((f) => t.add(f));
    expect(t.direction(2000)).toBe(0);
  });

  it("no direction when just started or standing still", () => {
    const t = new Track();
    t.add({ ...UOTTAWA, accuracy: 8, at: 0 });
    expect(t.direction(0)).toBeNull();
    for (let i = 1; i < 20; i++) t.add({ ...offset(UOTTAWA, Math.sin(i) * 2, 0), accuracy: 8, at: i * 1000 });
    expect(t.direction(19_000)).toBeNull(); // 2 m of wobble isn't walking
  });

  it("one jumpy fix is averaged out; bad fixes (worse than ±50 m) are ignored", () => {
    const t = new Track();
    t.add({ ...UOTTAWA, accuracy: 5, at: 0 });
    t.add({ ...UOTTAWA, accuracy: 5, at: 1000 });
    t.add({ ...offset(UOTTAWA, 30, 0), accuracy: 40, at: 2000 }); // a jump, poorly trusted
    t.add({ ...offset(UOTTAWA, 300, 0), accuracy: 200, at: 2500 }); // useless
    const p = t.position(3000)!;
    expect(metresBetween(p, UOTTAWA)).toBeLessThan(2);
    expect(p.accuracy).toBe(5);
  });

  it("no position when every recent fix is too poor, or all are old", () => {
    const t = new Track();
    t.add({ ...UOTTAWA, accuracy: 80, at: 0 });
    expect(t.position(0)).toBeNull();
    t.add({ ...UOTTAWA, accuracy: 8, at: 1000 });
    expect(t.position(1000)).not.toBeNull();
    expect(t.position(7000)).toBeNull(); // 6 s old
  });
});
