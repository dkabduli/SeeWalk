import { describe, expect, it, vi } from "vitest";
import { offset, type LatLon } from "./geo";
import type { NearHazard } from "./hazardsApi";
import { createLocationAlerts, LOAD_RADIUS_M, type MapAlert } from "./locationAlerts";

const START = { lat: 45.4231, lon: -75.6831 }; // uOttawa
const hazard = (at: LatLon, over: Partial<NearHazard> = {}): NearHazard => ({
  id: "h1", source: "walkers", type: "pothole", label_en: "pothole", label_fr: "nid-de-poule",
  address: null, opened: null, walkway: true, metres: 0, ...at, ...over,
});

/** A simulated walk: fixes once a second along `path(t)`, asking for an alert each second (the walker
 *  is free unless `busy`), recording what would be said. */
async function walk(hazards: NearHazard[], seconds: number, path: (t: number) => LatLon,
  opts: { accuracy?: (t: number) => number; busy?: (t: number) => boolean; lang?: "en" | "fr" } = {}) {
  let clock = 0;
  const fetchNear = vi.fn(async () => hazards);
  const la = createLocationAlerts({ sessionId: "s", fetchNear, now: () => clock });
  const said: (MapAlert & { t: number })[] = [];
  const gps: string[] = [];
  for (let t = 0; t < seconds; t++) {
    clock = t * 1000;
    la.onFix({ ...path(t), accuracy: opts.accuracy?.(t) ?? 8, at: clock });
    await Promise.resolve(); await Promise.resolve(); // let the preload land
    gps.push(...la.gpsEvents());
    const a = la.next(opts.lang ?? "en");
    if (a && !opts.busy?.(t)) { la.markSaid(a); said.push({ ...a, t }); }
  }
  return { said, gps, fetchNear, la };
}
const north = (m: number) => offset(START, m, 0);
const walkingNorth = (t: number) => north(t * 1.3);

describe("approaching a reported pothole", () => {
  it("straight at it: a heads-up about 40 m ahead, then 'nearby, be careful', each once", async () => {
    const { said } = await walk([hazard(north(100))], 90, walkingNorth);
    expect(said.map((s) => s.stage)).toEqual(["ahead", "nearby"]);
    expect(said[0].text).toBe("Pothole reported about 40 metres ahead.");
    expect(said[1].text).toBe("Pothole nearby. Be careful.");
    // ~30 s of warning at walking pace, then ~10 s
    expect(said[1].t - said[0].t).toBeGreaterThan(8);
  });

  it("in French", async () => {
    const { said } = await walk([hazard(north(100))], 90, walkingNorth, { lang: "fr" });
    expect(said.map((s) => s.text)).toEqual([
      "Nid-de-poule signalé à environ 40 mètres devant.",
      "Nid-de-poule tout près. Attention.",
    ]);
  });

  it("one well off to the side (60 m) never alerts; one across a narrow street gets only the heads-up", async () => {
    expect((await walk([hazard(offset(START, 100, 60))], 120, walkingNorth)).said).toEqual([]);
    const across = await walk([hazard(offset(START, 100, 25))], 120, walkingNorth);
    expect(across.said.map((s) => s.stage)).toEqual(["ahead"]);
  });

  it("walking away from one behind: nothing", async () => {
    expect((await walk([hazard(offset(START, -30, 0))], 60, walkingNorth)).said).toEqual([]);
  });

  it("standing still 30 m away: no 'ahead' (no direction yet); standing 20 m away: 'nearby'", async () => {
    expect((await walk([hazard(north(30))], 20, () => START)).said).toEqual([]);
    const close = await walk([hazard(north(20))], 20, () => START);
    expect(close.said.map((s) => s.stage)).toEqual(["nearby"]);
  });

  it("nearby says which side once the direction is known", async () => {
    const { said } = await walk([hazard(offset(START, 60, -18))], 70, walkingNorth);
    const near = said.find((s) => s.stage === "nearby")!;
    expect(near.text).toBe("Pothole nearby, on your left. Be careful.");
    expect(near.pan).toBe(-1);
  });

  it("busy (the camera or an answer is talking): offered again, never lost, never twice", async () => {
    const { said } = await walk([hazard(north(100))], 90, walkingNorth, { busy: (t) => t >= 40 && t < 46 });
    expect(said.map((s) => s.stage)).toEqual(["ahead", "nearby"]);
    expect(said[0].t).toBeGreaterThanOrEqual(46);
  });

  it("poor GPS makes the warning come earlier, never later", async () => {
    const good = await walk([hazard(north(100))], 90, walkingNorth);
    const poor = await walk([hazard(north(100))], 90, walkingNorth, { accuracy: () => 30 });
    const t = (r: typeof good, stage: string) => r.said.find((s) => s.stage === stage)!.t;
    expect(t(poor, "nearby")).toBeLessThan(t(good, "nearby"));
  });

  it("potholes out in the road (city reports marked not walkway) aren't announced", async () => {
    expect((await walk([hazard(north(60), { walkway: false })], 60, walkingNorth)).said).toEqual([]);
  });
});

describe("GPS status, told once", () => {
  it("weak GPS (worse than ±50 m for 20 s): 'weak', no alerts, then 'back'", async () => {
    const { said, gps } = await walk([hazard(north(20))], 45, () => START, { accuracy: (t) => (t < 30 ? 80 : 8) });
    expect(gps).toEqual(["weak", "back"]);
    expect(said.every((s) => s.t >= 30)).toBe(true);
  });

  it("location denied: 'off' once", () => {
    const la = createLocationAlerts({ sessionId: "s", fetchNear: vi.fn(async () => []), now: () => 0 });
    la.onError(1);
    la.onError(1);
    expect(la.gpsEvents()).toEqual(["off"]);
    expect(la.gpsEvents()).toEqual([]);
  });
});

describe("loading and the camera", () => {
  it("loads everything within 1.5 km once, then again only after moving 750 m", async () => {
    const { fetchNear } = await walk([], 30, walkingNorth);
    expect(fetchNear).toHaveBeenCalledTimes(1);
    expect((fetchNear.mock.calls[0] as unknown[])[3]).toBe(LOAD_RADIUS_M);
    const far = await walk([], 12, (t) => north(t * 100)); // a bus ride: 100 m a second
    expect(far.fetchNear).toHaveBeenCalledTimes(2);
  });

  it("the camera saw the pothole: the map doesn't repeat it", async () => {
    let clock = 0;
    const la = createLocationAlerts({ sessionId: "s", fetchNear: vi.fn(async () => [hazard(north(12))]), now: () => clock });
    la.onFix({ ...START, accuracy: 5, at: 0 });
    await Promise.resolve(); await Promise.resolve();
    la.cameraSaw(["pothole"]);
    expect(la.next("en")).toBeNull();
  });
});

describe("what's around me", () => {
  async function around(hazards: NearHazard[], lang: "en" | "fr" = "en") {
    const { la } = await walk(hazards, 12, walkingNorth, { busy: () => true });
    return la.around(lang);
  }
  it("nearest first, with distance and side", async () => {
    const text = await around([
      hazard(offset(START, 60, 20), { id: "a" }),
      hazard(offset(START, -90, 0), { id: "b", type: "uneven_surface", label_en: "uneven pavement", label_fr: "chaussée inégale" }),
    ]);
    expect(text).toBe("Reported within 200 metres: pothole, about 40 metres ahead; uneven pavement, about 90 metres behind you.");
  });
  it("nothing reported: says so, never 'clear'", async () => {
    expect(await around([])).toBe("Nothing reported within 200 metres.");
    expect(await around([], "fr")).toBe("Rien de signalé à moins de 200 mètres.");
  });
});
