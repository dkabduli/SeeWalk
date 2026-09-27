import type { SceneResult } from "../api/types";
import { isMapType, sendReport, type HazardReport, type MapType } from "./hazardsApi";

/** Same bar as the server: only confident sightings go on the city's map. */
export const REPORT_MIN_CONFIDENCE = 0.7;
/** GPS fixes worse than this (m) or older than this (ms) would put the pin on the wrong block. */
export const MAX_ACCURACY_M = 35;
export const MAX_FIX_AGE_MS = 10_000;
/** Don't resend the same type more often than this; the server also dedupes by distance. */
export const RESEND_MS = 10_000;

export interface HazardReporter {
  /** Feed every SceneResult from the walk loop (and the fast layer). Never throws, never waits. */
  report(result: SceneResult, source?: HazardReport["source"]): void;
  /** Latest usable GPS fix (good enough to pin a hazard), or null. Shared with nearby alerts. */
  position(): { lat: number; lon: number } | null;
  /** Random per walk: the server leaves this walk's own sightings out of "reported nearby". */
  readonly sessionId: string;
  stop(): void;
}

interface Deps {
  geolocation?: Geolocation;
  /** Every GPS reading and error, for the location alerts (docs/prd/location-alerts.md). */
  onFix?: (p: GeolocationPosition) => void;
  onError?: (code: number) => void;
  send?: (r: HazardReport) => unknown;
  now?: () => number;
}

/** Call inside the Start tap (iOS asks for location permission then). One session id per walk. */
export function startHazardReporter({
  geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined,
  send = sendReport,
  now = Date.now,
  onFix,
  onError,
}: Deps = {}): HazardReporter {
  const sessionId = crypto.randomUUID();
  let fix: GeolocationPosition | null = null;
  const lastSent = new Map<MapType, number>();

  // Location is optional: if it's denied or unavailable, the walk works and nothing is reported.
  const watchId = geolocation?.watchPosition(
    (p) => { fix = p; onFix?.(p); },
    (e) => { fix = null; onError?.(e.code); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
  );

  const usable = (t: number) =>
    fix && fix.coords.accuracy <= MAX_ACCURACY_M && t - fix.timestamp <= MAX_FIX_AGE_MS ? fix : null;

  return {
    sessionId,
    position() {
      const f = usable(now());
      return f ? { lat: f.coords.latitude, lon: f.coords.longitude } : null;
    },
    report(result, source = "gemini") {
      const t = now();
      const here = usable(t);
      if (!here) return;
      for (const h of result.hazards) {
        if (!isMapType(h.type) || h.confidence < REPORT_MIN_CONFIDENCE) continue;
        if (t - (lastSent.get(h.type) ?? -Infinity) < RESEND_MS) continue;
        lastSent.set(h.type, t);
        send({
          session_id: sessionId,
          lat: here.coords.latitude,
          lon: here.coords.longitude,
          type: h.type,
          confidence: h.confidence,
          source,
        });
      }
    },
    stop() {
      if (watchId !== undefined) geolocation?.clearWatch(watchId);
      fix = null;
    },
  };
}
