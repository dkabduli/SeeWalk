import type { HazardType } from "../api/types";

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
  source: "gemini" | "fast_layer";
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

/** Fire and forget: the walk never waits on the map. keepalive lets it finish if the page closes. */
export function sendReport(report: HazardReport): Promise<void> {
  return fetch(`${BASE}/hazards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
    keepalive: true,
  }).then(() => {}, () => {});
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { signal });
  if (!r.ok) throw new Error(r.status === 503 ? "map_off" : `hazards ${r.status}`);
  return r.json();
}

export const fetchHazards = (days: number, signal?: AbortSignal) =>
  getJson<{ hazards: MapHazard[] }>(`/hazards?days=${days}`, signal).then((d) => d.hazards);

export const fetchHotspots = (days: number, signal?: AbortSignal) =>
  getJson<{ hotspots: Hotspot[] }>(`/hazards/hotspots?days=${days}&limit=5`, signal).then((d) => d.hotspots);
