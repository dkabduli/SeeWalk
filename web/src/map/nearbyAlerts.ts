import { fetchNear as fetchNearApi, type NearHazard } from "./hazardsApi";

/** Say a known hazard when the walker is this close (m). GPS alone gives no facing, so: "nearby". */
export const ANNOUNCE_M = 25;
/** Ask the server for hazards within this radius (m)… */
export const FETCH_RADIUS_M = 60;
/** …again after this long (ms), or sooner once the walker has moved this far (m). */
export const REFETCH_MS = 10_000;
export const REFETCH_MOVE_M = 30;
/** How often to compare the walker's position with the known hazards (ms). */
export const TICK_MS = 2000;

interface LatLon { lat: number; lon: number }

/** Metres between two points (equirectangular: plenty accurate at street scale, like the server). */
export function metresBetween(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return 111_320 * Math.hypot(b.lat - a.lat, x);
}

interface Deps {
  /** Latest usable GPS fix (from the hazard reporter's watch), or null. */
  position: () => LatLon | null;
  sessionId: string;
  /** Nearest unsaid hazard, at most one per tick. Return false if it couldn't be said now (busy):
   *  it's offered again next tick. Anything else counts as said, once per walk. */
  onNear: (h: NearHazard) => boolean | void;
  fetchNear?: typeof fetchNearApi;
  now?: () => number;
}

/** "Reported nearby: lifted sidewalk panel": open city reports and other walkers' sightings. */
export function startNearbyAlerts({ position, sessionId, onNear, fetchNear = fetchNearApi, now = Date.now }: Deps) {
  const said = new Set<string>();
  let known: NearHazard[] = [];
  let fetchedAt = -Infinity;
  let fetchedWhere: LatLon | null = null;
  let loading = false;
  let stopped = false;

  const tick = () => {
    const here = position();
    if (!here || stopped) return;
    const stale = now() - fetchedAt >= REFETCH_MS || !fetchedWhere || metresBetween(here, fetchedWhere) >= REFETCH_MOVE_M;
    if (stale && !loading) {
      loading = true;
      fetchedAt = now();
      fetchedWhere = here;
      fetchNear(here.lat, here.lon, sessionId, FETCH_RADIUS_M)
        .then((list) => { known = list; })
        .catch(() => { /* offline or map off: the walk carries on without it */ })
        .finally(() => { loading = false; });
    }
    const next = known
      .filter((h) => !said.has(h.id))
      .map((h) => ({ h, d: metresBetween(here, h) }))
      .filter(({ d }) => d <= ANNOUNCE_M)
      .sort((a, b) => a.d - b.d)[0];
    if (next && onNear(next.h) !== false) said.add(next.h.id);
  };

  const timer = setInterval(tick, TICK_MS);
  tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
