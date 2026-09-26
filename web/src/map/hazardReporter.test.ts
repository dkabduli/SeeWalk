import { describe, expect, it, vi } from "vitest";
import type { Hazard } from "../api/types";
import type { HazardReport } from "./hazardsApi";
import { startHazardReporter } from "./hazardReporter";

const hazard = (over: Partial<Hazard> = {}): Hazard => ({
  type: "pothole", direction: "ahead", distance: "near", urgency: 2,
  confidence: 0.9, approaching: false, phrase: "Pothole ahead", ...over,
});
const scene = (...hazards: Hazard[]) => ({ hazards, unclear: false });

function setup({ accuracy = 8, fixAt = 1000 } = {}) {
  let clock = fixAt;
  const sent: HazardReport[] = [];
  let onFix: PositionCallback = () => {};
  const geolocation = {
    watchPosition: vi.fn((ok: PositionCallback) => { onFix = ok; return 7; }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const reporter = startHazardReporter({ geolocation, send: (r) => sent.push(r), now: () => clock });
  const giveFix = (lat = 45.4231, lon = -75.6831) =>
    onFix({ coords: { latitude: lat, longitude: lon, accuracy }, timestamp: clock } as GeolocationPosition);
  return { reporter, sent, geolocation, giveFix, tick: (ms: number) => { clock += ms; } };
}

describe("hazard reporter", () => {
  it("sends a confident pothole with the GPS fix and a per-walk session id", () => {
    const { reporter, sent, giveFix } = setup();
    giveFix();
    reporter.report(scene(hazard()));
    expect(sent).toEqual([expect.objectContaining({
      lat: 45.4231, lon: -75.6831, type: "pothole", confidence: 0.9, source: "gemini",
    })]);
    expect(sent[0].session_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends nothing without a location (denied, not yet fixed)", () => {
    const { reporter, sent } = setup();
    reporter.report(scene(hazard()));
    expect(sent).toHaveLength(0);
  });

  it("skips vague or stale GPS fixes", () => {
    const vague = setup({ accuracy: 60 });
    vague.giveFix();
    vague.reporter.report(scene(hazard()));
    expect(vague.sent).toHaveLength(0);

    const stale = setup();
    stale.giveFix();
    stale.tick(11_000);
    stale.reporter.report(scene(hazard()));
    expect(stale.sent).toHaveLength(0);
  });

  it("only reports lasting sidewalk hazards, and only confident ones", () => {
    const { reporter, sent, giveFix } = setup();
    giveFix();
    reporter.report(scene(
      hazard({ type: "person" }), hazard({ type: "car" }), hazard({ type: "stop_sign" }),
      hazard({ type: "construction", confidence: 0.69 }),
      hazard({ type: "curb_or_dropoff", confidence: 0.7 }),
    ));
    expect(sent.map((r) => r.type)).toEqual(["curb_or_dropoff"]);
  });

  it("doesn't resend the same type every snapshot, but does after 10 s", () => {
    const { reporter, sent, giveFix, tick } = setup();
    giveFix();
    reporter.report(scene(hazard()));
    tick(1500); giveFix();
    reporter.report(scene(hazard(), hazard({ type: "construction" })));
    expect(sent.map((r) => r.type)).toEqual(["pothole", "construction"]);
    tick(9000); giveFix();
    reporter.report(scene(hazard()));
    expect(sent.map((r) => r.type)).toEqual(["pothole", "construction", "pothole"]);
  });

  it("stop() ends the GPS watch and reports nothing more", () => {
    const { reporter, sent, geolocation, giveFix } = setup();
    giveFix();
    reporter.stop();
    reporter.report(scene(hazard()));
    expect(geolocation.clearWatch).toHaveBeenCalledWith(7);
    expect(sent).toHaveLength(0);
  });

  it("works (silently) on a device with no geolocation at all", () => {
    const sent: HazardReport[] = [];
    const r = startHazardReporter({ geolocation: undefined, send: (x) => sent.push(x) });
    expect(() => { r.report(scene(hazard())); r.stop(); }).not.toThrow();
    expect(sent).toHaveLength(0);
  });
});
