import type { Hazard, SceneResult } from "../api/types";

const MIN_CONFIDENCE = 0.6;
const AHEAD_WORDS = 12;
// When the same thing may be said again, by urgency. Signs, crosswalks and traffic lights are said
// once (standing at a corner they were repeated every few seconds); keyed by type only, so walking
// past a stop sign ("ahead", then "on your right") doesn't count as a new one.
const REPEAT_MS: Record<Hazard["urgency"], number> = { 1: 5000, 2: 8000, 3: 45000 };
// A colonnade, a hallway of doors, or the same staircase would otherwise be named on every frame.
// The close warning (under 2 m) still gets through.
const SLOW_REPEAT_MS = 20_000;
const DOOR_WINDOW_MS = 8000;
// A drop-off a few seconds after stairs is the same edge. The walk logged one at 9 s.
const CURB_AFTER_STAIRS_MS = 15_000;
// After a door or elevator is said, stay quiet while it is still in front of you.
// A new one can be said once it has been gone for this long.
const PASSAGE_GAP_MS = 4000;
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const INFO: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>(["stop_sign", "crosswalk", "traffic_light"]);
const DOORS: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>(["door", "door_open", "door_opening"]);
const PASSAGES: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([...DOORS, "elevator"]);
// A pillar is easy to invent (a wall, a door frame). It is said only ahead, only twice in a row, and only once.
const PILLAR_MIN = 0.8;
const PILLAR_GAP_MS = 4000;
const STAIRS: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>(["stairs_down", "steps_up"]);
const SLOW: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([...PASSAGES, ...STAIRS, "pillar"]);
// Things on the ground and work zones. In the testers' walk, "Curb ahead" played 4 times in 20 s
// and "Construction" 7 times in under 2 minutes as it moved between left, ahead and right. Now each
// is one thing whatever its direction, said again after 30 s, plus the one close-up warning.
const GROUND: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([
  "pothole", "uneven_surface", "curb_or_dropoff", "construction", "head_height_obstacle",
]);
const GROUND_REPEAT_MS = 30_000;
// Direction change is the same object: a sign, the same stairs, one doorway, one row of columns, one curb.
const BY_TYPE: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([...INFO, ...PASSAGES, ...STAIRS, ...GROUND, "pillar"]);
const NOT_SCENE: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>(["person", "bike", "car"]);
const FILLER = new Set(["ahead", "left", "right", "your", "on", "devant", "gauche", "droite"]);
const lastSpoken = new Map<string, { at: number; closeSaid: boolean }>();
let lastClosedDoorAt = -1;
let pillarLooks = 0;
let pillarLookAt = -1;
const repeatKey = (h: Hazard) => (BY_TYPE.has(h.type) ? h.type : `${h.type}:${h.direction}`);
const repeatAfter = (h: Hazard) =>
  GROUND.has(h.type) ? GROUND_REPEAT_MS : SLOW.has(h.type) ? SLOW_REPEAT_MS : REPEAT_MS[h.urgency];

/** Street alerts: what's announced without being asked. A wide pillar in the corridor is included.
 *  A chair or a thin pole is not: those are spoken only when the walker asks.
 *  A door speaks only when it is straight ahead. Side doors stay for "what's ahead". */
export const STREET_TYPES: ReadonlySet<Hazard["type"]> = new Set<Hazard["type"]>([
  "pothole", "uneven_surface", "curb_or_dropoff", "stairs_down", "steps_up", "construction",
  "head_height_obstacle", "door", "door_open", "door_opening", "elevator", "pillar", "stop_sign", "crosswalk", "traffic_light",
]);
export const streetOnly = (r: SceneResult): SceneResult => ({
  ...r,
  hazards: r.hazards.filter((h) => STREET_TYPES.has(h.type) && (!PASSAGES.has(h.type) || h.direction === "ahead") && (h.type !== "pillar" || h.direction === "ahead")),
});

let passageHeld = false;
let passageGoneAt = -1;

function aheadPassage(hazards: Hazard[]): Hazard | undefined {
  return hazards.find((h) => PASSAGES.has(h.type) && h.direction === "ahead" && h.confidence >= MIN_CONFIDENCE);
}

/** Elevator doors mislabeled as a door, when the scene already names the elevator. */
function liftElevator(result: SceneResult): SceneResult {
  const summary = result.summary ?? "";
  if (!/elevator|ascenseur/i.test(summary)) return result;
  const phrase = /ascenseur/i.test(summary) ? "Ascenseur devant" : "Elevator ahead";
  return {
    ...result,
    hazards: result.hazards.map((h) =>
      (h.type === "door" || h.type === "door_open") && h.direction === "ahead" ? { ...h, type: "elevator", phrase } : h,
    ),
  };
}

/** A closed door ahead, then an open one within 8 s, is the door swinging. The clip says "Door opening".
 *  A door or elevator already announced stays quiet until it has left the frame. */
export function noticeDoors(result: SceneResult, now = Date.now()): SceneResult {
  const lifted = liftElevator(result);
  const ahead = aheadPassage(lifted.hazards);
  let next = lifted;
  if (ahead) {
    const swung = ahead.type === "door_open" && lastClosedDoorAt >= 0 && now - lastClosedDoorAt <= DOOR_WINDOW_MS;
    lastClosedDoorAt = ahead.type === "door" ? now : -1;
    if (swung) {
      const french = /porte|devant|ouverte/i.test(ahead.phrase);
      next = {
        ...lifted,
        hazards: lifted.hazards.map((h) =>
          h === ahead ? { ...h, type: "door_opening", phrase: french ? "Porte qui s'ouvre devant" : "Door opening ahead" } : h,
        ),
      };
    }
  } else {
    lastClosedDoorAt = -1;
  }
  const still = aheadPassage(next.hazards);
  if (!still) {
    if (passageHeld && passageGoneAt < 0) passageGoneAt = now;
    if (passageHeld && passageGoneAt >= 0 && now - passageGoneAt >= PASSAGE_GAP_MS) {
      passageHeld = false;
      passageGoneAt = -1;
    }
    return next;
  }
  passageGoneAt = -1;
  if (!passageHeld || still.type === "door_opening") return next;
  return {
    ...next,
    hazards: next.hazards.filter((h) => !(PASSAGES.has(h.type) && h.direction === "ahead")),
  };
}

function byImportance(a: Hazard, b: Hazard): number {
  return (
    a.urgency - b.urgency ||
    Number(b.approaching) - Number(a.approaching) ||
    DISTANCE_RANK[a.distance] - DISTANCE_RANK[b.distance]
  );
}

function confident(result: SceneResult): Hazard[] {
  return result.hazards.filter((h) => h.confidence >= MIN_CONFIDENCE && h.phrase.trim()).sort(byImportance);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Summary repeats a hazard we are already saying ("pothole" inside "Pothole on the path"). */
function repeats(summary: string, phrase: string): boolean {
  const scene = summary.toLowerCase();
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .some((w) => w.length > 3 && !FILLER.has(w) && scene.includes(w));
}

/** Join short phrases until the sentence would pass `cap` words. */
function joinPhrases(phrases: string[], cap: number, limit: number): string[] {
  const parts: string[] = [];
  for (const phrase of phrases) {
    if (parts.length >= limit) break;
    const next = [...parts, phrase].join(", ");
    if (wordCount(next) > cap) break;
    parts.push(phrase);
  }
  return parts;
}

/** What's ahead: a physical hazard first, then the rest of the scene. A person does not replace the scene. */
export function describeAhead(result: SceneResult): string {
  const all = confident(result);
  const physical = all.filter((h) => !NOT_SCENE.has(h.type));
  const summary = result.summary?.trim() ?? "";
  const lead = physical.length > 0 ? physical : summary ? [] : all;
  const parts = joinPhrases(lead.map((h) => h.phrase.trim()), AHEAD_WORDS, 2);
  if (summary && !parts.some((p) => repeats(summary, p))) {
    const next = [...parts, summary].join(", ");
    if (wordCount(next) <= AHEAD_WORDS) parts.push(summary);
  }
  if (parts.length === 0) return joinPhrases(all.map((h) => h.phrase.trim()), AHEAD_WORDS, 2).join(", ");
  return parts.join(", ");
}

/** What's in my way: corridor objects only, including a chair or a thin pole. Signs are not blocking.
 *  Empty when nothing in the corridor qualifies. */
export function describePath(result: SceneResult): string {
  const blocking = confident(result).filter((h) => !INFO.has(h.type));
  return joinPhrases(blocking.map((h) => h.phrase.trim()), AHEAD_WORDS, 3).join(", ");
}

/** An answer just named these. Count the street hazards whose phrase is in `spoken`, so the clip
 *  doesn't repeat a second later. A sign the question didn't mention can still be announced.
 *  A later close warning still plays if this look was not already under 2 m. */
export function noteSpoken(result: SceneResult, spoken: string, now = Date.now()) {
  if (!spoken) return;
  for (const h of confident(result)) {
    if (!STREET_TYPES.has(h.type) || !spoken.includes(h.phrase.trim())) continue;
    const prev = lastSpoken.get(repeatKey(h));
    lastSpoken.set(repeatKey(h), { at: now, closeSaid: h.distance === "close" || !!prev?.closeSaid });
    if (PASSAGES.has(h.type) && h.direction === "ahead") passageHeld = true;
  }
}

/** Say it at first sighting (up to ~10-15 m away), then, for things you can trip on or walk
 *  into, once more when it's close (under 2 m): the last warning before reaching it. */
function due(h: Hazard, now: number): boolean {
  const last = lastSpoken.get(repeatKey(h));
  if (!last) return true;
  if (now - last.at >= repeatAfter(h)) return !passageHeld || !PASSAGES.has(h.type);
  // Doors, elevators, and pillars are said once. A close-up is not a second alert.
  if (PASSAGES.has(h.type) || h.type === "pillar") return false;
  return h.distance === "close" && !last.closeSaid && !INFO.has(h.type);
}

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
function stairsRecent(result: SceneResult, now: number): boolean {
  if (result.hazards.some((h) => STAIRS.has(h.type) && h.confidence >= MIN_CONFIDENCE)) return true;
  for (const type of STAIRS) {
    const last = lastSpoken.get(type);
    if (last && now - last.at < CURB_AFTER_STAIRS_MS) return true;
  }
  return false;
}

/** A pillar ahead on two looks in a row. One look, a side column, or a gap, stays quiet. */
function pillarHolds(hazards: Hazard[], now: number): boolean {
  const ahead = hazards.some((h) => h.type === "pillar" && h.direction === "ahead" && h.confidence >= PILLAR_MIN);
  if (!ahead) {
    pillarLooks = 0;
    pillarLookAt = -1;
    return false;
  }
  if (pillarLookAt >= 0 && now - pillarLookAt > PILLAR_GAP_MS) pillarLooks = 0;
  pillarLooks += 1;
  pillarLookAt = now;
  return pillarLooks >= 2;
}

export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  let hazards = stairsRecent(result, now) ? result.hazards.filter((h) => h.type !== "curb_or_dropoff") : result.hazards;
  if (!pillarHolds(hazards, now)) hazards = hazards.filter((h) => h.type !== "pillar");
  const candidates = hazards.filter((h) => h.confidence >= MIN_CONFIDENCE && (ignoreRepeat || due(h, now)));
  if (candidates.length === 0) return null;
  candidates.sort(byImportance);
  const pick = candidates[0];
  const last = lastSpoken.get(repeatKey(pick));
  // A fresh sighting (not the close-up repeat) starts over, so a later close-up is warned again
  const fresh = !last || now - last.at >= repeatAfter(pick);
  lastSpoken.set(repeatKey(pick), { at: now, closeSaid: pick.distance === "close" || (!fresh && !!last?.closeSaid) });
  if (PASSAGES.has(pick.type) && pick.direction === "ahead") passageHeld = true;
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
    uneven_surface: "uneven", stairs_down: "stairs_down", curb_or_dropoff: "curb", traffic_light: "traffic_light",     door: "st_door_ahead",
    door_open: "st_door_open_ahead",
    door_opening: "st_door_opening_ahead",
    elevator: "st_elevator_ahead",
    pillar: "st_pillar_ahead",
  };
  return map[h.type] ?? null;
}

export const panFor = (h: Hazard) => (h.direction === "left" ? -1 : h.direction === "right" ? 1 : 0);
