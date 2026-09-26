import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { tts } from "../api/client";
import type { Hazard, Lang, SceneResult, SystemEvent } from "../api/types";
import { audio } from "../audio/AudioEngine";
import { fallbackClip, panFor, pickAlert } from "../alerts/pickAlert";
import { useWalkLoop } from "../camera/useWalkLoop";
import { createVoiceCommand } from "../camera/voiceCommand";
import { strings } from "../i18n/strings";
import { MOCK } from "../api/client";
import clips from "../audio/clips.json";
import "../styles/walk.css";

type ClipTable = Record<string, Record<Lang, string>>;

export default function WalkMode() {
  const [lang, setLang] = useState<Lang>("en");
  const [walking, setWalking] = useState(false);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<"idle" | "walking" | "noConn" | "blocked">("idle");
  const t = strings[lang];

  // Only one alert at a time. Each alert gets an id; if a newer one starts (urgent, or the
  // walker asked), the older one stops at its next step instead of talking over it.
  const speechId = useRef(0);
  const speaking = useRef(false);

  const speak = useCallback(async (h: Hazard, asked = false) => {
    const interrupt = h.urgency === 1 || asked;
    if (!interrupt && (speaking.current || audio.busy)) return; // don't talk over ourselves
    const id = ++speechId.current;
    const current = () => speechId.current === id;
    speaking.current = true;
    audio.stop();
    try {
      const pan = panFor(h);
      setCaption(h.phrase);
      await audio.playTone(pan, h.urgency === 1 ? 1200 : 1000);
      if (!current()) return;
      const key = fallbackClip(h);
      // Exact match with a bundled clip (always true for the fast layer): play it instantly
      if (key && audio.hasClip(lang, key) && (clips as ClipTable)[key]?.[lang] === h.phrase) {
        await audio.playClip(lang, key, pan);
        return;
      }
      try {
        const mp3 = await tts(h.phrase, lang);   // gives up after 2.5 s: never speak a stale alert
        if (!current()) return;
        await audio.playSpeech(mp3, pan);
      } catch {
        if (current() && key) await audio.playClip(lang, key, pan);
      }
    } finally {
      if (current()) speaking.current = false;
    }
  }, [lang]);

  const onResult = useCallback((r: SceneResult) => {
    const h = pickAlert(r);
    if (h) speak(h);
  }, [speak]);

  const onSystem = useCallback(async (e: SystemEvent) => {
    setStatus(e === "no_connection" ? "noConn" : e === "camera_blocked" ? "blocked" : "walking");
    setCaption(e === "connection_back" ? "" : strings[lang][e === "no_connection" ? "noConn" : "blocked"]);
    audio.stop();
    await audio.playTone(0, 440, 250);
    await audio.playClip(lang, e);
  }, [lang]);

  const walk = useWalkLoop({ lang, onResult, onSystem });
  const { videoRef } = walk;

  // Fast layer (Abdul): on-device person/bike/car warnings into the same onResult.
  // The model is downloaded as soon as this screen opens (it took ~19 s cold).
  const langRef = useRef(lang);
  const onResultRef = useRef(onResult);
  useLayoutEffect(() => { langRef.current = lang; onResultRef.current = onResult; });
  const fastStop = useRef<(() => void) | null>(null);
  const fastGen = useRef(0);
  useEffect(() => {
    void import("../detection/fastLayer").then((m) => m.preloadFastLayer()).catch(() => {});
  }, []);
  async function startFast(gen: number) {
    const video = videoRef.current;
    for (let i = 0; i < 100 && video && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
    if (!video || fastGen.current !== gen) return;
    try {
      const { startFastLayer } = await import("../detection/fastLayer");
      const stop = await startFastLayer(video, () => langRef.current, (r) => onResultRef.current(r));
      if (fastGen.current !== gen) { stop(); return; } // Stop was tapped while the model loaded
      fastStop.current = stop;
    } catch (e) {
      console.warn("fast layer unavailable", e); // optional: Gemini still works without it
    }
  }

  // Voice command "What's ahead?" (Abdul's code). The ref keeps the latest whatsAhead.
  const whatsAheadRef = useRef<() => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof createVoiceCommand> | null>(null);
  const getVoice = () => (voiceRef.current ??= createVoiceCommand(() => whatsAheadRef.current()));

  async function toggle() {
    if (walking) {
      fastGen.current++;
      fastStop.current?.();
      fastStop.current = null;
      walk.stop();
      getVoice().stop();
      speechId.current++;                        // cancel any alert still on its way
      audio.stop();
      setCaption("");
      setWalking(false);
      setStatus("idle");
      await audio.playClip(lang, "walk_stopped");
      return;
    }
    // iOS only allows audio and the mic to start *inside* the tap: do these before any await
    const unlocking = audio.unlock();
    getVoice().start(lang);                      // mic permission prompt on first use
    walk.start();                                // runs until Stop, don't await; camera prompt on first use
    void startFast(++fastGen.current);
    setWalking(true);
    setStatus("walking");
    await unlocking;
    await audio.preload(lang);                   // ~1 s; the first snapshot takes longer anyway
    await audio.playClip(lang, "walk_started");
  }

  async function whatsAhead() {
    if (!walking) return;
    const answer = await walk.checkNow();        // the snapshot in flight, or a new one now
    audio.stop();                                // they asked: this answer comes first
    if (!answer.ok) {
      if (answer.reason === "stopped") return;
      speechId.current++;                        // cancel any alert still on its way
      setCaption(strings[lang][answer.reason === "no_connection" ? "noConn" : "blocked"]);
      await audio.playClip(lang, answer.reason); // "No connection…" or "Camera blocked"
      return;
    }
    const r = answer.result;
    if (r.unclear) {
      speechId.current++;
      setCaption(lang === "fr" ? "Incertain" : "Unclear");
      await audio.playClip(lang, "unclear");
      return;
    }
    const h = pickAlert(r, { ignoreRepeat: true });
    if (h) {
      await speak(h, true);
    } else {
      speechId.current++;
      // They asked, so never answer with silence, but never promise "safe" or "clear" either
      setCaption(lang === "fr" ? "Rien de détecté" : "Nothing detected");
      await audio.playClip(lang, "nothing_detected");
    }
  }
  useLayoutEffect(() => { whatsAheadRef.current = whatsAhead; });

  async function switchLang() {
    const next = lang === "en" ? "fr" : "en";
    setLang(next);
    if (walking) {
      getVoice().start(next);                    // listen in the new language
      await audio.preload(next);
    }
  }

  return (
    <main className="walk">
      <header>
        <h1>SeeWalk</h1>
        {MOCK && <span className="mock-badge">MOCK DATA</span>}
        <span className={`status ${status}`} role="status">{t[status]}</span>
      </header>
      <video ref={videoRef} playsInline muted autoPlay className="preview" aria-hidden="true" />
      <p className="caption" aria-live="polite">{caption}</p>
      <div className="row">
        <button className={`primary${walking ? " on" : ""}`} onClick={toggle}>{walking ? t.stop : t.start}</button>
        <button className="lang" onClick={switchLang} lang={lang === "en" ? "fr" : "en"}>{t.lang}</button>
      </div>
      {/* The whole lower half of the screen: tap anywhere to ask */}
      <button className="ahead-zone" onClick={whatsAhead} disabled={!walking}>{t.ahead}</button>
    </main>
  );
}
