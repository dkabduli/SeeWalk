import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NearHazard } from "./hazardsApi";
import { metresBetween, REFETCH_MS, startNearbyAlerts, TICK_MS } from "./nearbyAlerts";

const HERE = { lat: 45.4231, lon: -75.6831 };
/** A point `m` metres north of HERE. */
const north = (m: number) => ({ lat: HERE.lat + m / 111_320, lon: HERE.lon });

const hazard = (id: string, m: number): NearHazard => ({
  id, source: "ottawa_311", type: "uneven_surface", label_en: "lifted or sunken sidewalk panel",
  label_fr: "dalle de trottoir soulevée ou affaissée", address: "75 Laurier Ave E", opened: "2026-09-20", walkway: true,
  metres: m, ...north(m),
});

function setup(list: NearHazard[], at: () => { lat: number; lon: number } | null = () => HERE) {
  const onNear = vi.fn<(h: NearHazard) => void>();
  const fetchNear = vi.fn(() => Promise.resolve(list));
  const alerts = startNearbyAlerts({ position: at, sessionId: "walk-1", onNear, fetchNear, now: Date.now });
  return { onNear, fetchNear, alerts };
}
const tick = (ms = TICK_MS) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("nearby alerts", () => {
  it("metresBetween matches street distances", () => {
    expect(metresBetween(HERE, north(25))).toBeCloseTo(25, 0);
  });

  it("says a hazard within 25 m once, not one at 40 m", async () => {
    const { onNear, fetchNear, alerts } = setup([hazard("311:1", 15), hazard("311:2", 40)]);
    await tick();
    expect(fetchNear).toHaveBeenCalledWith(HERE.lat, HERE.lon, "walk-1", 60);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(onNear.mock.calls[0][0].id).toBe("311:1");
    await tick(30_000);
    expect(onNear).toHaveBeenCalledTimes(1); // never twice in one walk
    alerts.stop();
  });

  it("two close ones: nearest first, the other on the next tick", async () => {
    const { onNear, alerts } = setup([hazard("far", 20), hazard("near", 5)]);
    await tick();
    expect(onNear.mock.calls.map(([h]) => h.id)).toEqual(["near"]);
    await tick();
    expect(onNear.mock.calls.map(([h]) => h.id)).toEqual(["near", "far"]);
    alerts.stop();
  });

  it("busy (returns false): offered again on the next tick", async () => {
    const onNear = vi.fn<(h: NearHazard) => boolean>().mockReturnValueOnce(false).mockReturnValue(true);
    const alerts = startNearbyAlerts({
      position: () => HERE, sessionId: "w", onNear, fetchNear: () => Promise.resolve([hazard("311:1", 5)]),
    });
    await tick();
    await tick();
    await tick();
    expect(onNear).toHaveBeenCalledTimes(2); // refused once, said once, then never again
    alerts.stop();
  });

  it("asks the server every 10 s standing still, sooner after moving 30 m", async () => {
    let at = HERE;
    const { fetchNear, alerts } = setup([], () => at);
    await tick();
    expect(fetchNear).toHaveBeenCalledTimes(1);
    await tick(REFETCH_MS - TICK_MS * 2);
    expect(fetchNear).toHaveBeenCalledTimes(1);
    at = north(35);
    await tick();
    expect(fetchNear).toHaveBeenCalledTimes(2);
    alerts.stop();
  });

  it("no GPS: no requests, no alerts", async () => {
    const { onNear, fetchNear, alerts } = setup([hazard("311:1", 5)], () => null);
    await tick(20_000);
    expect(fetchNear).not.toHaveBeenCalled();
    expect(onNear).not.toHaveBeenCalled();
    alerts.stop();
  });

  it("server down: the walk carries on silently", async () => {
    const onNear = vi.fn();
    const alerts = startNearbyAlerts({
      position: () => HERE, sessionId: "w", onNear, fetchNear: () => Promise.reject(new Error("map_off")),
    });
    await tick(20_000);
    expect(onNear).not.toHaveBeenCalled();
    alerts.stop();
  });

  it("nothing after stop", async () => {
    const { onNear, fetchNear, alerts } = setup([hazard("311:1", 5)]);
    alerts.stop();
    await tick(20_000);
    expect(fetchNear).toHaveBeenCalledTimes(1); // the first look happened at start
    expect(onNear).not.toHaveBeenCalled();
  });
});
