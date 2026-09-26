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

interface LogLine { at: string; kind: "result" | "system" | "ask" | "voice" | "info"; text: string }

const time = () => new Date().toLocaleTimeString([], { hour12: false });

/** Dev server only: mirror the log to web/lab-log.jsonl on the laptop. */
function sendToLaptop(line: { at: string; kind: string; text: string }) {
  if (!import.meta.env.DEV) return;
  fetch("/__lablog", { method: "POST", body: JSON.stringify(line), keepalive: true }).catch(() => {});
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
    (voiceRef.current ??= createVoiceCommand(() => { void askRef.current("voice"); }));

  function toggle() {
    if (walking) {
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
