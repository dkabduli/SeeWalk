import type { HazardType, Lang } from "../api/types";

const BASE = "/api"; // same proxy as api/client.ts

/** Hazards that stay put and are worth fixing: the only ones the map stores (server/hazards.py). */
export const MAP_TYPES = ["pothole", "uneven_surface", "obstacle_in_path", "construction", "curb_or_dropoff"] as const;
export type MapType = (typeof MAP_TYPES)[number];
export const isMapType = (t: HazardType): t is MapType => (MAP_TYPES as readonly string[]).includes(t);

export interface HazardReport {
  session_id: string;
  lat: number;
  lon: number;
  type: MapType;
  confidence: number;
  source: "gemini" | "fast_layer" | "test" | "pinned";
}

export interface MapHazard {
  id: string;
  time: string;
  lat: number;
  lon: number;
  type: MapType;
  confidence: number;
  source: string;
}

export interface Hotspot {
  lat: number;
  lon: number;
  reports: number;
  walks: number;
  top_type: MapType;
  last_seen: string;
}

/** 503 means one of two things: no DATABASE_URL ("map_off"), or the database didn't answer ("db_down"). */
async function failure(r: Response, what: string): Promise<Error> {
  if (r.status !== 503) return new Error(`${what} ${r.status}`);
  const detail = await r.json().then((d: { detail?: string }) => d.detail ?? "", () => "");
  return new Error(detail.includes("not set") ? "map_off" : "db_down");
}

/** Fire and forget: the walk never waits on the map. keepalive lets it finish if the page closes. */
export function sendReport(report: HazardReport): Promise<void> {
  return fetch(`${BASE}/hazards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).then(() => {}, () => {});
}

/** Save and wait for the answer (the map page's test pin; the walk uses sendReport). */
export async function saveReport(report: HazardReport): Promise<{ saved: boolean; reason: string }> {
  const r = await fetch(`${BASE}/hazards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!r.ok) throw await failure(r, "hazards");
  return r.json();
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { signal });
  if (!r.ok) throw await failure(r, "hazards");
  return r.json();
}

export const fetchHazards = (days: number, signal?: AbortSignal) =>
  getJson<{ hazards: MapHazard[] }>(`/hazards?days=${days}`, signal).then((d) => d.hazards);

export const fetchHotspots = (days: number, signal?: AbortSignal) =>
  getJson<{ hotspots: Hotspot[] }>(`/hazards/hotspots?days=${days}&limit=5`, signal).then((d) => d.hotspots);

// ---------- Known hazards from open data (Ottawa 311) and other walkers ----------

/** Map types plus the city-only one: a crossing whose walk, audible or push-button signal is broken. */
export type KnownType = MapType | "crossing_signal";

export interface CityReport {
  id: string;
  source: string; // "ottawa_311"
  type: KnownType;
  label_en: string;
  label_fr: string;
  address: string | null;
  lat: number;
  lon: number;
  opened: string | null;
  /** false = out in the road (map and briefing only, never a walk alert) */
  walkway: boolean;
}

/** A known hazard around the walker, nearest first ("walkers" = other walks' sightings). */
export interface NearHazard extends CityReport {
  metres: number;
}

export interface Bbox { south: number; west: number; north: number; east: number }

export const fetchCityReports = (b: Bbox, signal?: AbortSignal) =>
  getJson<{ reports: CityReport[] }>(
    `/hazards/city?south=${b.south}&west=${b.west}&north=${b.north}&east=${b.east}`, signal,
  ).then((d) => d.reports);

export const fetchNear = (lat: number, lon: number, sessionId: string, radius = 60, signal?: AbortSignal) =>
  getJson<{ near: NearHazard[] }>(
    `/hazards/near?lat=${lat}&lon=${lon}&radius=${radius}&session_id=${encodeURIComponent(sessionId)}`, signal,
  ).then((d) => d.near);

/** One or two sentences about reported problems within 300 m, written by Gemini from real reports. */
export async function fetchBriefing(lat: number, lon: number, lang: Lang, signal?: AbortSignal) {
  const r = await fetch(`${BASE}/hazards/briefing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat, lon, lang }),
    signal,
  });
  if (!r.ok) throw await failure(r, "briefing");
  return r.json() as Promise<{ text: string; count: number; by: "gemini" | "plain" }>;
}
