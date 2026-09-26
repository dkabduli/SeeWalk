import type { Hazard, SceneResult } from "../api/types";

const MIN_CONFIDENCE = 0.6;
const REPEAT_MS = 5000;
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const lastSpoken = new Map<string, number>();

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  const candidates = result.hazards.filter(
    (h) =>
      h.confidence >= MIN_CONFIDENCE &&
      (ignoreRepeat || now - (lastSpoken.get(`${h.type}:${h.direction}`) ?? -Infinity) >= REPEAT_MS),
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.urgency - b.urgency ||
      Number(b.approaching) - Number(a.approaching) ||
      DISTANCE_RANK[a.distance] - DISTANCE_RANK[b.distance],
  );
  const pick = candidates[0];
  lastSpoken.set(`${pick.type}:${pick.direction}`, now);
  return pick;
}

/** Bundled clip to use if live speech fails. */
export function fallbackClip(h: Hazard): string | null {
  if (h.type === "person" || h.type === "bike" || h.type === "car") return `${h.type}_${h.direction}`;
  const map: Partial<Record<Hazard["type"], string>> = {
    stop_sign: "stop_sign", crosswalk: "crosswalk", head_height_obstacle: "head_height",
    obstacle_in_path: "obstacle_path", construction: "construction", pothole: "pothole",
    uneven_surface: "uneven", stairs_down: "stairs_down", curb_or_dropoff: "curb",
  };
  return map[h.type] ?? null;
}

export const panFor = (h: Hazard) => (h.direction === "left" ? -1 : h.direction === "right" ? 1 : 0);
