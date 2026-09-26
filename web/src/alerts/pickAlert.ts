import type { Hazard, SceneResult } from "../api/types";

const MIN_CONFIDENCE = 0.6;
// How long before the same hazard + direction may be said again, by urgency. Information
// (crosswalks, stop signs) repeats much less: standing at a corner it was said every ~5 s.
const REPEAT_MS: Record<Hazard["urgency"], number> = { 1: 5000, 2: 8000, 3: 20000 };
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const lastSpoken = new Map<string, number>();
// Information is keyed by type only: walking past a stop sign turns "ahead" into "on your right",
// and that shouldn't count as a new thing to announce.
const repeatKey = (h: Hazard) => (h.urgency === 3 ? h.type : `${h.type}:${h.direction}`);

/** Street alerts: what's announced without being asked. No people, chairs or other objects,
 *  only the things a cane user can't find in time (holes, edges, signs, work zones). */
export const STREET_TYPES: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([
  "pothole", "uneven_surface", "curb_or_dropoff", "stairs_down", "construction",
  "head_height_obstacle", "stop_sign", "crosswalk", "traffic_light",
]);
export const streetOnly = (r: SceneResult): SceneResult => ({ ...r, hazards: r.hazards.filter((h) => STREET_TYPES.has(h.type)) });

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  const candidates = result.hazards.filter(
    (h) =>
      h.confidence >= MIN_CONFIDENCE &&
      (ignoreRepeat || now - (lastSpoken.get(repeatKey(h)) ?? -Infinity) >= REPEAT_MS[h.urgency]),
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.urgency - b.urgency ||
      Number(b.approaching) - Number(a.approaching) ||
      DISTANCE_RANK[a.distance] - DISTANCE_RANK[b.distance],
  );
  const pick = candidates[0];
  lastSpoken.set(repeatKey(pick), now);
  return pick;
}

/** Bundled clip to use if live speech fails. */
export function fallbackClip(h: Hazard): string | null {
  if (h.type === "person" || h.type === "bike" || h.type === "car") return `${h.type}_${h.direction}`;
  const map: Partial<Record<Hazard["type"], string>> = {
    stop_sign: "stop_sign", crosswalk: "crosswalk", head_height_obstacle: "head_height",
    obstacle_in_path: "obstacle_path", construction: "construction", pothole: "pothole",
    uneven_surface: "uneven", stairs_down: "stairs_down", curb_or_dropoff: "curb", traffic_light: "traffic_light",
  };
  return map[h.type] ?? null;
}

export const panFor = (h: Hazard) => (h.direction === "left" ? -1 : h.direction === "right" ? 1 : 0);
