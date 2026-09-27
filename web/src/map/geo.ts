/** Where the walker is and which way they're going, from the phone's GPS (docs/prd/location-alerts.md).
 *  The walker never sees a map, so this is what turns "a pothole at 45.42, -75.68" into
 *  "about 40 metres ahead, on your right". Pure functions + a small track, all unit-tested. */

export interface LatLon { lat: number; lon: number }

/** One GPS reading: position, its own accuracy (m), when (ms), and iOS's heading/speed when it has them. */
export interface Fix extends LatLon {
  accuracy: number;
  at: number;
  heading?: number | null; // degrees clockwise from north, only while moving
  speed?: number | null;   // m/s
}

export type Side = "ahead" | "left" | "right" | "behind";

const M_PER_DEG = 111_320;
/** Fixes worse than this can't place the walker on the right stretch of sidewalk: ignored. */
export const MAX_ACCURACY_M = 50;
const SMOOTH_MS = 5000;     // average the fixes from the last 5 s
const KEEP_MS = 30_000;     // remember 30 s of track for the direction of travel
const MIN_MOVE_M = 8;       // direction from at least 8 m of movement
const HEADING_SPEED = 0.5;  // trust iOS's heading above this speed (m/s)

/** Metres between two points (equirectangular: plenty accurate at street scale, like the server). */
export function metresBetween(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return M_PER_DEG * Math.hypot(b.lat - a.lat, x);
}

/** Compass bearing from a to b, degrees clockwise from north (0-360). */
export function bearing(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const deg = (Math.atan2(x, b.lat - a.lat) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Which side something is on for someone walking in direction `travel`:
 *  within ±45° ahead, 45-135° left or right, beyond that behind. */
export function sideOf(travel: number, to: number): Side {
  const rel = ((to - travel + 540) % 360) - 180; // -180..180, negative = left
  if (Math.abs(rel) <= 45) return "ahead";
  if (Math.abs(rel) > 135) return "behind";
  return rel < 0 ? "left" : "right";
}

/** The walker's recent GPS track: a steadied position and the direction they're walking. */
export class Track {
  private fixes: Fix[] = [];

  add(fix: Fix) {
    this.fixes.push(fix);
    const keep = fix.at - KEEP_MS;
    while (this.fixes.length && this.fixes[0].at < keep) this.fixes.shift();
  }

  clear() { this.fixes = []; }

  /** Accuracy-weighted average of the good fixes from the last 5 s, so one jumpy fix can't trigger an
   *  alert. Its accuracy is the best of those fixes (we don't claim more than the phone did). */
  position(now: number): (LatLon & { accuracy: number }) | null {
    const recent = this.fixes.filter((f) => now - f.at <= SMOOTH_MS && f.accuracy <= MAX_ACCURACY_M);
    if (!recent.length) return null;
    let w = 0, lat = 0, lon = 0;
    for (const f of recent) {
      const k = 1 / Math.max(1, f.accuracy) ** 2;
      w += k; lat += f.lat * k; lon += f.lon * k;
    }
    return { lat: lat / w, lon: lon / w, accuracy: Math.min(...recent.map((f) => f.accuracy)) };
  }

  /** Direction of travel (degrees), or null when it isn't known (just started, standing still).
   *  iOS's own heading while walking; otherwise the bearing of the last ≥ 8 m of movement. */
  direction(now: number): number | null {
    const last = this.fixes[this.fixes.length - 1];
    if (!last || now - last.at > SMOOTH_MS) return null;
    if (last.heading != null && !Number.isNaN(last.heading) && (last.speed ?? 0) >= HEADING_SPEED) return last.heading;
    const here = this.position(now);
    if (!here) return null;
    for (const f of this.fixes) { // oldest first: the longest stretch gives the steadiest direction
      if (f.accuracy > MAX_ACCURACY_M) continue;
      if (metresBetween(f, here) >= Math.max(MIN_MOVE_M, f.accuracy)) return bearing(f, here);
    }
    return null;
  }
}

/** Move a point by metres north and east (for tests and simulated walks). */
export function offset(p: LatLon, north: number, east: number): LatLon {
  return {
    lat: p.lat + north / M_PER_DEG,
    lon: p.lon + east / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)),
  };
}
