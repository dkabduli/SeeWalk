import type { Hazard, SceneResult } from "../api/types";

const MIN_CONFIDENCE = 0.6;
// When the same thing may be said again, by urgency. Signs, crosswalks and traffic lights are said
// once (standing at a corner they were repeated every few seconds); keyed by type only, so walking
// past a stop sign ("ahead", then "on your right") doesn't count as a new one.
const REPEAT_MS: Record<Hazard["urgency"], number> = { 1: 5000, 2: 8000, 3: 45000 };
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const INFO: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>(["stop_sign", "crosswalk", "traffic_light"]);
const lastSpoken = new Map<string, { at: number; closeSaid: boolean }>();
const repeatKey = (h: Hazard) => (INFO.has(h.type) ? h.type : `${h.type}:${h.direction}`);

/** Street alerts: what's announced without being asked. No people, chairs or other objects,
 *  only the things a cane user can't find in time (holes, edges, doors, signs, work zones). */
export const STREET_TYPES: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([
  "pothole", "uneven_surface", "curb_or_dropoff", "stairs_down", "steps_up", "construction",
  "head_height_obstacle", "door", "stop_sign", "crosswalk", "traffic_light",
]);
export const streetOnly = (r: SceneResult): SceneResult => ({ ...r, hazards: r.hazards.filter((h) => STREET_TYPES.has(h.type)) });

/** Say it at first sighting (up to ~10-15 m away), then, for things you can trip on or walk
 *  into, once more when it's close (under 2 m): the last warning before reaching it. */
function due(h: Hazard, now: number): boolean {
  const last = lastSpoken.get(repeatKey(h));
  if (!last) return true;
  if (now - last.at >= REPEAT_MS[h.urgency]) return true;
  return h.distance === "close" && !last.closeSaid && !INFO.has(h.type);
}

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  const candidates = result.hazards.filter((h) => h.confidence >= MIN_CONFIDENCE && (ignoreRepeat || due(h, now)));
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.urgency - b.urgency ||
      Number(b.approaching) - Number(a.approaching) ||
      DISTANCE_RANK[a.distance] - DISTANCE_RANK[b.distance],
  );
  const pick = candidates[0];
  const last = lastSpoken.get(repeatKey(pick));
  // A fresh sighting (not the close-up repeat) starts over, so a later close-up is warned again
  const fresh = !last || now - last.at >= REPEAT_MS[pick.urgency];
  lastSpoken.set(repeatKey(pick), { at: now, closeSaid: pick.distance === "close" || (!fresh && !!last?.closeSaid) });
  return pick;
}

/** The instant street clip for this hazard and direction ("Stop sign on your right"), if there is one. */
export const streetClip = (h: Hazard): string | null => (STREET_TYPES.has(h.type) ? `st_${h.type}_${h.direction}` : null);

/** Bundled clip to use if live speech fails. */
export function fallbackClip(h: Hazard): string | null {
  if (h.type === "person" || h.type === "bike" || h.type === "car") return `${h.type}_${h.direction}`;
  const map: Partial<Record<Hazard["type"], string>> = {
    stop_sign: "stop_sign", crosswalk: "crosswalk", head_height_obstacle: "head_height",
    obstacle_in_path: "obstacle_path", construction: "construction", pothole: "pothole",
    uneven_surface: "uneven", stairs_down: "stairs_down", curb_or_dropoff: "curb", traffic_light: "traffic_light", door: "st_door_ahead",
  };
  return map[h.type] ?? null;
}

export const panFor = (h: Hazard) => (h.direction === "left" ? -1 : h.direction === "right" ? 1 : 0);
