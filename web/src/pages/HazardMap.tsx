import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/hazard-map.css";
import {
  fetchBriefing, fetchCityReports, fetchHazards, fetchHotspots, MAP_TYPES, saveReport,
  type CityReport, type Hotspot, type KnownType, type MapHazard, type MapType,
} from "../map/hazardsApi";
import { metresBetween } from "../map/geo";

/** Hazard map (…/?map): sidewalk problems SeeWalk walkers passed, plus the City of Ottawa's open 311
 *  reports (not fixed yet), all from Tiger Data. */

const TYPE_INFO: Record<KnownType, { label: string; color: string }> = {
  pothole:          { label: "Pothole",         color: "#d7263d" },
  uneven_surface:   { label: "Uneven pavement", color: "#f18f01" },
  obstacle_in_path: { label: "Obstacle",        color: "#7b2cbf" },
  construction:     { label: "Construction",    color: "#c99700" },
  curb_or_dropoff:  { label: "Curb / drop-off", color: "#1b6ec2" },
  crossing_signal:  { label: "Crossing signal", color: "#0a8f7f" },
};
const KNOWN_TYPES = [...MAP_TYPES, "crossing_signal"] as const;
/** City reports load for the visible area only, so not below this zoom (a whole city is too much). */
const CITY_MIN_ZOOM = 13;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
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
  const [hidden, setHidden] = useState<Set<KnownType>>(new Set());
  const [showWalkers, setShowWalkers] = useState(true);
  const [showCity, setShowCity] = useState(true);
  const [city, setCity] = useState<CityReport[]>([]);
  const [cityNote, setCityNote] = useState("");
  const [brief, setBrief] = useState("");
  const [hazards, setHazards] = useState<MapHazard[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [reload, setReload] = useState(0);
  const [pinNote, setPinNote] = useState("");
  const [pinType, setPinType] = useState<MapType>("pothole");
  // Where this phone is (live), for "you are here" and pinning a hazard where you stand
  const [here, setHere] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const me = useRef<L.LayerGroup | null>(null);
  const followed = useRef(false);

  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const cityPins = useRef<L.LayerGroup | null>(null);
  const [view, setView] = useState(0); // bumps when the map stops moving
  const fitted = useRef(false);

  // The Leaflet map lives outside React: create it once.
  useEffect(() => {
    const m = L.map(mapEl.current!, { zoomControl: false }).setView(HOME, 16);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    cityPins.current = L.layerGroup().addTo(m); // under the walkers' pins
    pins.current = L.layerGroup().addTo(m);
    me.current = L.layerGroup().addTo(m);       // "you are here" on top
    m.on("moveend", () => setView((n) => n + 1));
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
  }, [days, reload]);

  // You are here: follow the phone's GPS while this page is open (fly to it the first time)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setHere({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => setHere(null),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  useEffect(() => {
    const layer = me.current;
    if (!layer || !map.current) return;
    layer.clearLayers();
    if (!here) return;
    L.circle([here.lat, here.lon], { radius: here.accuracy, color: "#2f80ed", weight: 1, fillColor: "#2f80ed", fillOpacity: 0.12 }).addTo(layer);
    L.circleMarker([here.lat, here.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#2f80ed", fillOpacity: 1 })
      .bindPopup(`You are here (±${Math.round(here.accuracy)} m)`).addTo(layer);
    if (!followed.current) { map.current.flyTo([here.lat, here.lon], 18); followed.current = true; }
  }, [here]);

  // Pin a real hazard where you're standing (e.g. beside a pothole, for the demo). Saved as "pinned":
  // walkers hear it on approach ("Pothole reported about 40 metres ahead"). No location (laptop):
  // the pin goes in the middle of the map instead.
  async function savePin(lat: number, lon: number, where: string) {
    try {
      const r = await saveReport({
        session_id: `pin-${crypto.randomUUID()}`, lat, lon, type: pinType, confidence: 1, source: "pinned",
      });
      setPinNote(r.saved ? `${TYPE_INFO[pinType].label} pinned (${where}). Walkers will hear it.` : `Not saved: ${r.reason}.`);
      map.current?.flyTo([lat, lon], 18);
      setReload((n) => n + 1);
    } catch (e) {
      setPinNote((e as Error).message === "map_off" ? "The server has no database." : "Couldn't reach the server.");
    }
  }

  function pinHere() {
    const atCentre = (why: string) => {
      const c = map.current?.getCenter();
      if (c) void savePin(c.lat, c.lng, `${why}: middle of the map`);
      else setPinNote(why);
    };
    if (here && here.accuracy <= 50) return void savePin(here.lat, here.lon, `±${Math.round(here.accuracy)} m`);
    if (!navigator.geolocation) return atCentre("No location");
    setPinNote("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => void savePin(p.coords.latitude, p.coords.longitude, `±${Math.round(p.coords.accuracy)} m`),
      (e) => atCentre(e.code === e.PERMISSION_DENIED ? "Location denied" : "No location"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // City 311 reports in the visible area (a little beyond it, so small pans don't reload)
  useEffect(() => {
    const m = map.current;
    if (!m || !showCity) return;
    if (m.getZoom() < CITY_MIN_ZOOM) { setCity([]); setCityNote("Zoom in to see the city's reports."); return; }
    const b = m.getBounds().pad(0.25);
    const ctrl = new AbortController();
    fetchCityReports({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, ctrl.signal)
      .then((r) => { setCity(r); setCityNote(""); })
      .catch((e: Error) => { if (!ctrl.signal.aborted) setCityNote(e.message === "map_off" ? "" : "Couldn't load the city's reports."); });
    return () => ctrl.abort();
  }, [view, showCity, reload]);

  const shown = useMemo(() => (showWalkers ? hazards.filter((h) => !hidden.has(h.type)) : []), [hazards, hidden, showWalkers]);
  const cityShown = useMemo(() => (showCity ? city.filter((r) => !hidden.has(r.type)) : []), [city, hidden, showCity]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(KNOWN_TYPES.map((t) => [t, 0])) as Record<KnownType, number>;
    if (showWalkers) for (const h of hazards) c[h.type]++;
    if (showCity) for (const r of city) c[r.type]++;
    return c;
  }, [hazards, city, showWalkers, showCity]);

  // City reports: hollow rings, so walkers' sightings (filled) stand out on top
  useEffect(() => {
    const layer = cityPins.current;
    if (!layer) return;
    layer.clearLayers();
    for (const r of cityShown) {
      const { label, color } = TYPE_INFO[r.type];
      L.circleMarker([r.lat, r.lon], { radius: 7, color, weight: 3, fillColor: "#fff", fillOpacity: 0.85 })
        .bindPopup(
          `<b>${esc(label)}</b>: ${esc(r.label_en)}` +
          (r.address ? `<br>${esc(r.address)}` : "") +
          `<br><small>Ottawa 311, open${r.opened ? ` since ${esc(r.opened)}` : ""}` +
          `${r.walkway ? "" : " · in the road: not a walk alert"}</small>`,
        )
        .addTo(layer);
    }
  }, [cityShown]);

  async function briefHere() {
    const c = map.current?.getCenter();
    if (!c) return;
    setBrief("Asking Gemini about the middle of the map…");
    try {
      const b = await fetchBriefing(c.lat, c.lng, "en");
      setBrief(b.text + (b.by === "gemini" ? " (Gemini, from the reports)" : ""));
    } catch (e) {
      setBrief((e as Error).message === "map_off" ? "The server has no database." : "Couldn't reach the server.");
    }
  }

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
          `<br><small>${
            h.source === "pinned" ? "pinned by hand at the spot · walkers hear it"
            : h.source === "test" ? "test pin · not announced to walkers"
            : `seen by ${h.source === "fast_layer" ? "on-device detector" : "Gemini"} · walkers hear it`}</small>`,
        )
        .addTo(layer);
    }
    if (!fitted.current && shown.length) {
      map.current.fitBounds(L.latLngBounds(shown.map((h) => [h.lat, h.lon])), { padding: [60, 60], maxZoom: 17 });
      fitted.current = true;
    }
  }, [shown]);

  const toggle = (t: KnownType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(t)) next.add(t);
      return next;
    });

  // The nearest reported hazard to this phone (what a walker here would hear about first)
  const nearest = useMemo(() => {
    if (!here) return null;
    const all = [
      ...hazards.filter((h) => h.source !== "test").map((h) => ({ label: TYPE_INFO[h.type].label, lat: h.lat, lon: h.lon })),
      ...city.filter((r) => r.walkway).map((r) => ({ label: r.label_en, lat: r.lat, lon: r.lon })),
    ].map((h) => ({ ...h, d: metresBetween(here, h) })).sort((a, b) => a.d - b.d);
    return all[0] ?? null;
  }, [here, hazards, city]);

  const message =
    status === "loading" ? "Loading hazards…" :
    status === "map_off" ? "Hazard map is off: the server has no DATABASE_URL." :
    status === "error" ? "Can't reach the server. Retrying…" :
    hazards.length === 0 && city.length === 0 ? "Nothing reported here in this period yet. Take a walk!" : null;

  return (
    <main className="hmap">
      <div ref={mapEl} className="hmap-map" role="application" aria-label="Map of reported sidewalk hazards" />

      <header className="hmap-card hmap-top">
        <div className="hmap-title">
          <h1>Hazard map</h1>
          <p>Sidewalk problems walkers passed + open City of Ottawa 311 reports · stored in Tiger Data</p>
          <a className="hmap-back" href="./">← Walk</a>
        </div>
        <div className="hmap-range" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.days} aria-pressed={days === r.days} onClick={() => { setDays(r.days); fitted.current = false; }}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="hmap-legend" role="group" aria-label="Show sources">
          <button aria-pressed={showWalkers} onClick={() => setShowWalkers((v) => !v)}>
            <span className="dot solid" /> Walkers <span className="n">{hazards.length}</span>
          </button>
          <button aria-pressed={showCity} onClick={() => setShowCity((v) => !v)}>
            <span className="dot ring" /> City 311 (open) <span className="n">{city.length}</span>
          </button>
        </div>
        <div className="hmap-legend" role="group" aria-label="Show hazard types">
          {KNOWN_TYPES.map((t) => (
            <button key={t} aria-pressed={!hidden.has(t)} onClick={() => toggle(t)}>
              <span className="dot" style={{ background: TYPE_INFO[t].color }} />
              {TYPE_INFO[t].label} <span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>
        {message && <p className="hmap-msg" role="status">{message}</p>}
        {showCity && cityNote && <p className="hmap-note" role="status">{cityNote}</p>}
        <p className="hmap-here" role="status">
          {here
            ? <>📍 You are here (±{Math.round(here.accuracy)} m){nearest ? <> · nearest reported: <b>{nearest.label.toLowerCase()}</b>, {Math.round(nearest.d)} m</> : null}</>
            : "Finding your location…"}
        </p>
        <div className="hmap-test">
          <select value={pinType} onChange={(e) => setPinType(e.target.value as MapType)} aria-label="Hazard to pin">
            {MAP_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
          </select>
          <button onClick={pinHere}>📍 Pin a hazard here</button>
          {pinNote && <span role="status">{pinNote}</span>}
        </div>
        <div className="hmap-test">
          <button onClick={briefHere}>🗣️ Area briefing</button>
        </div>
        {brief && <p className="hmap-brief" aria-live="polite">{brief}</p>}
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
