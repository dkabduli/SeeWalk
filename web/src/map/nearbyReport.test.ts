import { describe, expect, it } from "vitest";
import { offset } from "./geo";
import type { NearHazard } from "./hazardsApi";
import { asksPotholes, describeNearby, roughMetres, spokenAddress } from "./nearbyReport";

const HOME = { lat: 45.4231, lon: -75.6831 };
const h = (north: number, east: number, over: Partial<NearHazard> = {}): NearHazard => ({
  id: `${north},${east}`, source: "ottawa_311", type: "pothole", label_en: "pothole", label_fr: "nid-de-poule",
  address: null, opened: null, walkway: true, metres: 0, ...offset(HOME, north, east), ...over,
});

describe("where are the nearest potholes", () => {
  it("before leaving the house (no direction): nearest three, distance and address, no side", () => {
    const text = describeNearby([
      h(0, 400, { address: "90 Laurier Ave E" }), h(60, 0, { address: "109 Osgoode St" }),
      h(-150, 0), h(0, -900), h(0, 1300),
    ], HOME, null, "en", true);
    expect(text).toBe(
      "4 potholes reported within 1 kilometre. Nearest: about 60 metres, at 109 Osgoode Street. " +
      "Next: about 150 metres. Then: about 400 metres, at 90 Laurier Avenue East.",
    );
  });

  it("on a walk (heading north): which side", () => {
    const text = describeNearby([h(60, 0), h(-150, 0), h(0, -300)], HOME, 0, "en", true);
    expect(text).toBe(
      "3 potholes reported within 1 kilometre. Nearest: about 60 metres ahead. " +
      "Next: about 150 metres behind you. Then: about 300 metres on your left.",
    );
  });

  it("road potholes count when asked about potholes, and say so", () => {
    expect(describeNearby([h(80, 0, { walkway: false, address: "1 Colonel By Dr" })], HOME, null, "en", true))
      .toBe("1 pothole reported within 1 kilometre. Nearest: about 80 metres, in the road, at 1 Colonel By Drive.");
  });

  it("asked generally: sidewalk problems only, each named", () => {
    const text = describeNearby([
      h(40, 0, { type: "uneven_surface", label_en: "lifted or sunken sidewalk panel", label_fr: "dalle soulevée" }),
      h(20, 0, { walkway: false }),
    ], HOME, null, "en", false);
    expect(text).toBe("1 reported problem within 1 kilometre. Nearest: lifted or sunken sidewalk panel, about 40 metres.");
  });

  it("nothing nearby: says so, never 'clear' or 'safe'", () => {
    expect(describeNearby([h(0, 1500)], HOME, null, "en", true)).toBe("No potholes reported within 1 kilometre.");
    expect(describeNearby([], HOME, null, "en", false)).toBe("Nothing reported within 1 kilometre.");
    expect(describeNearby([], HOME, null, "fr", true)).toBe("Aucun nid-de-poule signalé à moins d'un kilomètre.");
  });

  it("in French", () => {
    expect(describeNearby([h(60, 0, { address: "109 Osgoode St" })], HOME, 0, "fr", true))
      .toBe("1 nid-de-poule signalé à moins d'un kilomètre. Le plus proche: à environ 60 mètres devant, au 109 Osgoode Street.");
  });
});

describe("the city's duplicate reports", () => {
  it("several reports at one spot are one place (said once); the count is of places", () => {
    const text = describeNearby([
      h(200, 0, { id: "a", address: "235 Nicholas St", walkway: false }),
      h(0, 206, { id: "b", address: "191 Colonel By Dr", walkway: false }),
      h(4, 208, { id: "c", address: "191 Colonel By Dr", walkway: false }),
      h(0, -300, { id: "d" }), h(10, -310, { id: "e" }), // no address, 14 m apart
    ], HOME, null, "en", true);
    expect(text).toBe(
      "3 potholes reported within 1 kilometre. Nearest: about 200 metres, in the road, at 235 Nicholas Street. " +
      "Next: about 200 metres, in the road, at 191 Colonel By Drive. Then: about 300 metres.",
    );
  });
});

describe("spoken details", () => {
  it("distances as people say them", () => {
    expect([roughMetres(4), roughMetres(63), roughMetres(149), roughMetres(372)]).toEqual([10, 60, 150, 350]);
  });
  it("street abbreviations spelled out", () => {
    expect(spokenAddress("75 Laurier Ave E")).toBe("75 Laurier Avenue East");
    expect(spokenAddress("1 Colonel By Dr")).toBe("1 Colonel By Drive");
    expect(spokenAddress("Somerset St W")).toBe("Somerset Street West");
    expect(spokenAddress("Stewart St")).toBe("Stewart Street");
  });
  it("potholes asked about, in either language", () => {
    expect(asksPotholes("VisionCompanion, where's the nearest pothole?")).toBe(true);
    expect(asksPotholes("SeeWalk, où est le nid-de-poule le plus proche ?")).toBe(true);
    expect(asksPotholes("VisionCompanion, what's around me?")).toBe(false);
  });
});
