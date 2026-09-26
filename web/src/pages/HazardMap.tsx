import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/hazard-map.css";
import { fetchHazards, fetchHotspots, MAP_TYPES, type Hotspot, type MapHazard, type MapType } from "../map/hazardsApi";

/** Hazard map (…/?map): sidewalk problems SeeWalk walkers passed, from Tiger Data. */

const TYPE_INFO: Record<MapType, { label: string; color: string }> = {
  pothole:          { label: "Pothole",         color: "#d7263d" },
  uneven_surface:   { label: "Uneven pavement", color: "#f18f01" },
  obstacle_in_path: { label: "Obstacle",        color: "#7b2cbf" },
  construction:     { label: "Construction",    color: "#c99700" },
  curb_or_dropoff:  { label: "Curb / drop-off", color: "#1b6ec2" },
};
const RANGES = [{ days: 1, label: "Today" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }];
const HOME: L.LatLngTuple = [45.4231, -75.6831]; // uOttawa
const REFRESH_MS = 15_000;

type Status = "loading" | "ready" | "map_off" | "error";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function HazardMap() {
  const [days, setDays] = useState(7);
  const [hidden, setHidden] = useState<Set<MapType>>(new Set());
  const [hazards, setHazards] = useState<MapHazard[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  // The Leaflet map lives outside React: create it once.
  useEffect(() => {
    const m = L.map(mapEl.current!, { zoomControl: false }).setView(HOME, 16);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Load, then refresh every 15 s so pins from a live walk appear on their own.
  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      Promise.all([fetchHazards(days, ctrl.signal), fetchHotspots(days, ctrl.signal)])
        .then(([h, s]) => { setHazards(h); setHotspots(s); setStatus("ready"); })
        .catch((e: Error) => { if (!ctrl.signal.aborted) setStatus(e.message === "map_off" ? "map_off" : "error"); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [days]);

  const shown = useMemo(() => hazards.filter((h) => !hidden.has(h.type)), [hazards, hidden]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(MAP_TYPES.map((t) => [t, 0])) as Record<MapType, number>;
    for (const h of hazards) c[h.type]++;
    return c;
  }, [hazards]);

  // Redraw pins; zoom to them the first time there are any.
  useEffect(() => {
    const layer = pins.current;
    if (!layer || !map.current) return;
    layer.clearLayers();
    for (const h of shown) {
      const { label, color } = TYPE_INFO[h.type];
      L.circleMarker([h.lat, h.lon], { radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.9 })
        .bindPopup(
          `<b>${label}</b><br>${Math.round(h.confidence * 100)}% sure · ${ago(h.time)}` +
          `<br><small>seen by ${h.source === "fast_layer" ? "on-device detector" : "Gemini"}</small>`,
        )
        .addTo(layer);
    }
    if (!fitted.current && shown.length) {
      map.current.fitBounds(L.latLngBounds(shown.map((h) => [h.lat, h.lon])), { padding: [60, 60], maxZoom: 17 });
      fitted.current = true;
    }
  }, [shown]);

  const toggle = (t: MapType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(t)) next.add(t);
      return next;
    });

  const message =
    status === "loading" ? "Loading hazards…" :
    status === "map_off" ? "Hazard map is off: the server has no DATABASE_URL." :
    status === "error" ? "Can't reach the server. Retrying…" :
    hazards.length === 0 ? "No hazards reported in this period yet. Take a walk!" : null;

  return (
    <main className="hmap">
      <div ref={mapEl} className="hmap-map" role="application" aria-label="Map of reported sidewalk hazards" />

      <header className="hmap-card hmap-top">
        <div className="hmap-title">
          <h1>Hazard map</h1>
          <p>Sidewalk problems SeeWalk walkers passed · stored in Tiger Data</p>
        </div>
        <div className="hmap-range" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.days} aria-pressed={days === r.days} onClick={() => { setDays(r.days); fitted.current = false; }}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="hmap-legend" role="group" aria-label="Show hazard types">
          {MAP_TYPES.map((t) => (
            <button key={t} aria-pressed={!hidden.has(t)} onClick={() => toggle(t)}>
              <span className="dot" style={{ background: TYPE_INFO[t].color }} />
              {TYPE_INFO[t].label} <span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>
        {message && <p className="hmap-msg" role="status">{message}</p>}
      </header>

      {hotspots.length > 0 && (
        <section className="hmap-card hmap-hot" aria-label="Most-reported spots">
          <h2>Most-reported spots</h2>
          <ol>
            {hotspots.map((s) => (
              <li key={`${s.lat},${s.lon}`}>
                <button onClick={() => map.current?.flyTo([s.lat, s.lon], 18)}>
                  <span className="dot" style={{ background: TYPE_INFO[s.top_type]?.color }} />
                  <span className="what">{TYPE_INFO[s.top_type]?.label ?? s.top_type}</span>
                  <span className="meta">
                    {s.walks} {s.walks === 1 ? "walk" : "walks"} · {s.reports} {s.reports === 1 ? "report" : "reports"} · {ago(s.last_seen)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
