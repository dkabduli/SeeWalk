import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOCK } from "../api/client";
import type { Lang, SceneResult, SystemEvent } from "../api/types";
import { captureFrame, looksCovered } from "../camera/captureFrame";
import { createVoiceCommand } from "../camera/voiceCommand";
import { useWalkLoop } from "../camera/useWalkLoop";
import "../styles/camera-lab.css";

/** Camera lab: a debug page for Abdul's piece (camera, snapshot loop, events, voice command).
 *  Not the real UI (that's Jibril's WalkMode); it shows everything the loop does so it can be
 *  tested on the iPhone before the rest exists. */

interface LogLine { at: string; kind: "result" | "fast" | "system" | "ask" | "voice" | "info"; text: string }

const time = () => new Date().toLocaleTimeString([], { hour12: false });

/** Mirror the log to web/lab-log.jsonl on the laptop (dev server / preview). Lines that can't be
 *  sent (phone offline, e.g. the airplane-mode test) are kept and sent when the connection is back. */
const unsent: string[] = [];
let sending = false;
async function flushToLaptop() {
  if (sending) return;
  sending = true;
  try {
    while (unsent.length) {
      const r = await fetch("/__lablog", { method: "POST", body: unsent[0] });
      if (!r.ok) break;
      unsent.shift();
    }
  } catch { /* offline: try again later */ }
  sending = false;
}
let retryTimer: ReturnType<typeof setInterval> | null = null;
function sendToLaptop(line: { at: string; kind: string; text: string }) {
  unsent.push(JSON.stringify(line));
  if (unsent.length > 2000) unsent.shift();
  retryTimer ??= setInterval(() => void flushToLaptop(), 2000); // only once the lab is used
  void flushToLaptop();
}

function describe(r: SceneResult) {
  if (r.unclear) return "unclear";
  if (r.hazards.length === 0) return "nothing";
  return r.hazards
    .map((h) => `${h.type}/${h.direction}/${h.distance} u${h.urgency} ${Math.round(h.confidence * 100)}%${h.approaching ? " ↗" : ""} "${h.phrase}"`)
    .join(" · ");
}

export default function CameraLab() {
  const [lang, setLang] = useState<Lang>("en");
  const [walking, setWalking] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [meter, setMeter] = useState<{ b: number; c: number; covered: boolean } | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const lastResultAt = useRef<number | null>(null);

  const add = useCallback((kind: LogLine["kind"], text: string) => {
    const line = { at: time(), kind, text };
    setLog((l) => [line, ...l].slice(0, 80));
    sendToLaptop(line);
  }, []);

  const onResult = useCallback((r: SceneResult) => {
    const now = performance.now();
    const gap = lastResultAt.current ? ` (+${((now - lastResultAt.current) / 1000).toFixed(1)} s)` : "";
    lastResultAt.current = now;
    add("result", describe(r) + gap);
  }, [add]);

  const onSystem = useCallback((e: SystemEvent) => add("system", e), [add]);

  const walk = useWalkLoop({ lang, onResult, onSystem });
  const { videoRef } = walk;

  const ask = useCallback(async (source: string) => {
    const t0 = performance.now();
    add("ask", `What's ahead? (${source})`);
    const a = await walk.checkNow();
    const ms = Math.round(performance.now() - t0);
    add("ask", a.ok ? `→ ${describe(a.result)} in ${ms} ms` : `→ ${a.reason} in ${ms} ms`);
  }, [add, walk]);

  const askRef = useRef(ask);
  useLayoutEffect(() => { askRef.current = ask; });
  // Created on first use (inside a tap), so no ref is read during render
  const voiceRef = useRef<ReturnType<typeof createVoiceCommand> | null>(null);
  const getVoice = () =>
    (voiceRef.current ??= createVoiceCommand(
      () => { void askRef.current("voice"); },
      (msg) => add("voice", msg),
    ));

  // Fast layer (COCO-SSD on the phone). Loaded on demand so other pages don't download TensorFlow.
  const [fastInfo, setFastInfo] = useState("off");
  const fastStop = useRef<(() => void) | null>(null);
  const fastGen = useRef(0);
  const langRef = useRef(lang);
  useLayoutEffect(() => { langRef.current = lang; });
  const lastFast = useRef({ text: "", at: 0 });
  const fastPerf = useRef({ sum: 0, n: 0, since: 0 });

  // Start downloading the fast-layer model as soon as the lab opens (it took ~19 s cold)
  useEffect(() => {
    void import("../detection/fastLayer").then((m) => m.preloadFastLayer()).catch(() => {});
  }, []);

  const startFast = async (gen: number) => {
    setFastInfo("loading model…");
    fastPerf.current = { sum: 0, n: 0, since: performance.now() };
    const video = videoRef.current;
    for (let i = 0; i < 100 && video && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
    if (!video || fastGen.current !== gen) return;
    try {
      const { startFastLayer } = await import("../detection/fastLayer");
      const stop = await startFastLayer(
        video,
        () => langRef.current,
        (r) => {
          const text = describe(r);
          const now = performance.now();
          if (text !== lastFast.current.text || now - lastFast.current.at > 1500) { // don't flood the log
            lastFast.current = { text, at: now };
            add("fast", text);
          }
        },
        (st) => {
          setFastInfo(`${st.lastDetectMs || "…"} ms/check, waited ${(st.loadMs / 1000).toFixed(1)} s for model`);
          // Also log speed to the laptop: first check, then an average every ~10 s
          if (!st.lastDetectMs) return;
          const perf = fastPerf.current;
          perf.sum += st.lastDetectMs;
          perf.n += 1;
          const now = performance.now();
          if (perf.n === 1 || now - perf.since > 10000) {
            add("info", `fast: ${Math.round(perf.sum / perf.n)} ms/check (${perf.n} checks), waited ${(st.loadMs / 1000).toFixed(1)} s for model`);
            fastPerf.current = { sum: 0, n: 0, since: now };
          }
        },
      );
      if (fastGen.current !== gen) { stop(); return; } // stopped while the model was loading
      fastStop.current = stop;
      add("info", "fast layer running");
    } catch (e) {
      setFastInfo("failed");
      add("info", `fast layer failed: ${(e as Error).message}`);
    }
  };

  function toggle() {
    if (walking) {
      fastGen.current++;
      fastStop.current?.();
      fastStop.current = null;
      setFastInfo("off");
      walk.stop();
      getVoice().stop();
      setVoiceOn(false);
      setWalking(false);
      setMeter(null);
      add("info", "stopped");
      return;
    }
    // Same order as the real app: mic and camera start inside the tap, before any await
    if (getVoice().supported) setVoiceOn(getVoice().start(lang));
    else add("voice", "speech recognition not supported in this browser");
    void walk.start();
    void startFast(++fastGen.current);
    lastResultAt.current = null;
    setWalking(true);
    add("info", `started (${lang}, interval ${import.meta.env.VITE_FRAME_INTERVAL_MS || 1500} ms${MOCK ? ", MOCK" : ""})`);
  }

  function switchLang() {
    const next = lang === "en" ? "fr" : "en";
    setLang(next);
    if (walking && voiceOn) getVoice().start(next);
    add("info", `language → ${next}`);
  }

  // Lens meter: brightness/contrast twice a second, to tune looksCovered on the real phone
  useEffect(() => {
    if (!walking) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      const f = v ? captureFrame(v, 64) : null;
      if (f) {
        const m = { b: Math.round(f.brightness), c: Math.round(f.contrast), covered: looksCovered(f) };
        setMeter(m);
        sendToLaptop({ at: time(), kind: "meter", text: `brightness ${m.b} contrast ${m.c}${m.covered ? " COVERED" : ""}` });
      }
    }, 500);
    return () => clearInterval(id);
  }, [walking, videoRef]);

  return (
    <main className="lab">
      <header>
        <h1>Camera lab</h1>
        {MOCK && <span className="badge">MOCK DATA</span>}
      </header>

      <video ref={videoRef} playsInline muted autoPlay className="preview" />

      <div className="row">
        <button className="primary" onClick={toggle}>{walking ? "Stop" : "Start walk"}</button>
        <button onClick={switchLang}>{lang === "en" ? "Français" : "English"}</button>
      </div>

      <p className="meter">
        {meter
          ? <>lens: brightness <b>{meter.b}</b> · contrast <b>{meter.c}</b> · {meter.covered ? <b className="bad">COVERED</b> : "ok"}</>
          : "lens meter starts with the walk"}
        {" · "}voice: {voiceOn ? "listening" : "off"}
        {" · "}fast: {fastInfo}
      </p>

      <ol className="log" aria-live="polite">
        {log.map((l, i) => (
          <li key={i} className={l.kind}><span>{l.at}</span> {l.text}</li>
        ))}
      </ol>

      <button className="ahead-zone" onClick={() => void ask("tap")} disabled={!walking}>
        What's ahead?
      </button>
    </main>
  );
}
