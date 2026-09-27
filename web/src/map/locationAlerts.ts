import type { Lang } from "../api/types";
import { bearing, MAX_ACCURACY_M, metresBetween, sideOf, Track, type Fix, type LatLon, type Side } from "./geo";
import { fetchNear as fetchNearApi, type NearHazard } from "./hazardsApi";

/** Reported hazards turned into sound as the walker approaches them (docs/prd/location-alerts.md).
 *  The walker never sees the map: this says what's reported, how far, and on which side relative to
 *  the way they're walking. Everything is decided on the phone from a list loaded at Start. */

export const AHEAD_M = 40;          // heads-up: "reported about 40 metres ahead"
export const NEARBY_M = 15;         // "nearby, be careful"
export const CAMERA_LINK_M = 20;    // the camera saw it too: don't repeat it from the map
export const CAMERA_LINK_MS = 10_000;
export const LOAD_RADIUS_M = 1500;  // everything within 1.5 km, loaded once at Start…
export const RELOAD_MOVE_M = 750;   // …again after moving this far from where it was loaded
export const RELOAD_MS = 5 * 60_000; // …or every 5 minutes (new pins and sightings)
export const WEAK_AFTER_MS = 20_000; // no good fix for this long → "Location is weak"

export type Stage = "ahead" | "nearby";
export type GpsEvent = "off" | "weak" | "back";

export interface MapAlert {
  hazard: NearHazard;
  stage: Stage;
  metres: number;      // rounded to 10 m (0 when nearby)
  side: Side | null;   // relative to the direction of travel; null when that isn't known
  text: string;        // what to say
  pan: number;         // -1 left, 0 centre, 1 right
}

interface Deps {
  sessionId: string;
  fetchNear?: typeof fetchNearApi;
  now?: () => number;
}

const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const SIDE_WORDS: Record<Lang, Record<Side, string>> = {
  en: { ahead: "ahead", left: "on your left", right: "on your right", behind: "behind you" },
  fr: { ahead: "devant", left: "à gauche", right: "à droite", behind: "derrière vous" },
};

export function alertText(h: NearHazard, stage: Stage, metres: number, side: Side | null, lang: Lang): string {
  const label = lang === "fr" ? h.label_fr : h.label_en;
  if (stage === "ahead") {
    return lang === "fr"
      ? `${cap(label)} signalé à environ ${metres} mètres devant.`
      : `${cap(label)} reported about ${metres} metres ahead.`;
  }
  const where = side && side !== "ahead" ? `, ${SIDE_WORDS[lang][side]}` : "";
  return lang === "fr" ? `${cap(label)} tout près${where}. Attention.` : `${cap(label)} nearby${where}. Be careful.`;
}

/** Map types the camera also reports (Gemini's hazard types), for linking the two. */
const CAMERA_TYPES = new Set(["pothole", "uneven_surface", "curb_or_dropoff", "obstacle_in_path", "construction"]);

export function createLocationAlerts({ sessionId, fetchNear = fetchNearApi, now = Date.now }: Deps) {
  const track = new Track();
  let known: NearHazard[] = [];
  let loadedAt = -Infinity;
  let loadedWhere: LatLon | null = null;
  let loading = false;
  const said = new Set<string>(); // `${id}:${stage}`
  // GPS status, told to the walker once per change
  const startedAt = now();
  let lastGood = -Infinity;
  let state: "starting" | "ok" | "weak" | "off" = "starting";
  const events: GpsEvent[] = [];

  function maybeLoad(here: LatLon, t: number) {
    const stale = !loadedWhere || t - loadedAt >= RELOAD_MS || metresBetween(here, loadedWhere) >= RELOAD_MOVE_M;
    if (!stale || loading) return;
    loading = true;
    loadedAt = t;
    loadedWhere = here;
    fetchNear(here.lat, here.lon, sessionId, LOAD_RADIUS_M)
      .then((list) => { known = list.filter((h) => h.walkway !== false); })
      .catch(() => { /* offline or map off: the walk carries on; retried at the next reload */ loadedWhere = null; })
      .finally(() => { loading = false; });
  }

  /** Where each known hazard is, for someone here, walking in `dir`. */
  function placed(t: number) {
    const here = track.position(t);
    if (!here) return null;
    const dir = track.direction(t);
    return known.map((h) => {
      const d = metresBetween(here, h);
      return {
        h, d,
        eff: Math.max(0, d - here.accuracy),     // "it could be this close": warn early, never late
        side: dir == null ? null : sideOf(dir, bearing(here, h)),
      };
    });
  }

  return {
    /** Every GPS reading (watchPosition). */
    onFix(fix: Fix) {
      track.add(fix);
      if (fix.accuracy <= MAX_ACCURACY_M) {
        lastGood = fix.at;
        if (state === "weak") events.push("back");
        state = "ok";
      }
      const here = track.position(fix.at);
      if (here) maybeLoad(here, fix.at);
    },

    /** Location permission denied or unavailable. */
    onError(code: number) {
      if (code === 1 /* PERMISSION_DENIED */ || code === 2 /* POSITION_UNAVAILABLE */) {
        if (state !== "off") events.push("off");
        state = "off";
      }
    },

    /** GPS status changes to tell the walker (each once): off, weak, back. */
    gpsEvents(): GpsEvent[] {
      const t = now();
      const since = Math.max(lastGood, startedAt);
      if ((state === "ok" || state === "starting") && t - since >= WEAK_AFTER_MS) {
        events.push("weak");
        state = "weak";
      }
      return events.splice(0);
    },

    /** The one map alert worth saying now, or null. "Nearby" before "ahead", nearest first.
     *  Not marked said until markSaid(): if the walker is busy, it's offered again next time. */
    next(lang: Lang): MapAlert | null {
      const t = now();
      const here = track.position(t);
      if (!here) return null;
      const all = placed(t) ?? [];
      const due: { h: NearHazard; stage: Stage; eff: number; side: Side | null }[] = [];
      for (const { h, eff, side } of all) {
        if (eff <= NEARBY_M && !said.has(`${h.id}:nearby`)) due.push({ h, stage: "nearby", eff, side });
        else if (eff <= AHEAD_M && side === "ahead" && !said.has(`${h.id}:ahead`) && !said.has(`${h.id}:nearby`)) {
          due.push({ h, stage: "ahead", eff, side });
        }
      }
      due.sort((a, b) => Number(a.stage !== "nearby") - Number(b.stage !== "nearby") || a.eff - b.eff);
      const pick = due[0];
      if (!pick) return null;
      const metres = pick.stage === "nearby" ? 0 : round10(pick.eff);
      return {
        hazard: pick.h, stage: pick.stage, metres, side: pick.side,
        text: alertText(pick.h, pick.stage, metres, pick.side, lang),
        pan: pick.side === "left" ? -1 : pick.side === "right" ? 1 : 0,
      };
    },

    markSaid(a: MapAlert) {
      said.add(`${a.hazard.id}:${a.stage}`);
      if (a.stage === "nearby") said.add(`${a.hazard.id}:ahead`); // too late for a heads-up
    },

    /** The camera just reported these hazard types: a known one of the same type within 20 m is the
     *  same thing, and the walker already heard it from the camera. */
    cameraSaw(types: string[]) {
      const t = now();
      const seen = new Set(types.filter((x) => CAMERA_TYPES.has(x)));
      if (!seen.size) return;
      for (const p of placed(t) ?? []) {
        if (seen.has(p.h.type) && p.eff <= CAMERA_LINK_M) {
          said.add(`${p.h.id}:ahead`);
          said.add(`${p.h.id}:nearby`);
        }
      }
    },

    /** Direction of travel (degrees), or null when not known yet. */
    direction(): number | null {
      return track.direction(now());
    },

    /** Latest steadied position (for saving sightings), or null. */
    position(): LatLon | null {
      const p = track.position(now());
      return p ? { lat: p.lat, lon: p.lon } : null;
    },

    /** For the screen and tests. */
    known: () => known,
  };
}

export type LocationAlerts = ReturnType<typeof createLocationAlerts>;
