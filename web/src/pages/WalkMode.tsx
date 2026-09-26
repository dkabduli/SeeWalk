import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOCK, tts } from "../api/client";
import type { Hazard, Lang, ListenResult, SceneResult, SystemEvent } from "../api/types";
import { fallbackClip, panFor, pickAlert } from "../alerts/pickAlert";
import { audio } from "../audio/AudioEngine";
import clips from "../audio/clips.json";
import { captureFrame } from "../camera/captureFrame";
import { useWalkLoop } from "../camera/useWalkLoop";
import { createVoiceCommand } from "../camera/voiceCommand";
import { sendToLaptop } from "../debug/laptopLog";
import { strings } from "../i18n/strings";
import "../styles/walk.css";

type ClipTable = Record<string, Record<Lang, string>>;
type Status = "idle" | "walking" | "noConn" | "blocked";

/** What's on the alert panel: the phrase, where it is, and how serious. */
interface Shown {
  text: string;
  direction?: Hazard["direction"];
  level: "urgent" | "warning" | "info" | "system";
}

const ARROW: Record<Hazard["direction"], string> = { left: "←", ahead: "↑", right: "→" };
const levelOf = (h: Hazard): Shown["level"] => (h.urgency === 1 ? "urgent" : h.urgency === 2 ? "warning" : "info");
const log = (kind: string, text: string) =>
  sendToLaptop({ at: new Date().toLocaleTimeString([], { hour12: false }), kind, text });

// The spoken introduction (the voice commands) plays on the first Start on this phone only;
// after that Start just says "Walk mode on". Storage can be unavailable: then it always plays.
const INTRO_KEY = "seewalk.introPlayed";
const introPlayed = () => { try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; } };
const markIntroPlayed = () => { try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ } };

export default function WalkMode() {
  const [lang, setLang] = useState<Lang>("en");
  const [walking, setWalking] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  // Automatic announcements (Gemini hazards + the fast layer's people/bikes/cars) are OFF by default
  // for now: in testing they flooded the screen. With them off, SeeWalk only speaks when asked
  // ("SeeWalk, …"), plus the safety messages (no connection, camera blocked).
  const [autoAlerts, setAutoAlerts] = useState(false);
  const autoAlertsRef = useRef(autoAlerts);
  useLayoutEffect(() => { autoAlertsRef.current = autoAlerts; });
  const t = strings[lang];

  // Only one alert at a time. Each alert gets an id; if a newer one starts (urgent, or the
  // walker asked), the older one stops at its next step instead of talking over it.
  const speechId = useRef(0);
  const speaking = useRef(false);
  // Set while a spoken question is being checked (checkingVoice) or answered (answering count)
  const checkingVoice = useRef(false);
  const answering = useRef(0);

  const speak = useCallback(async (h: Hazard, asked = false) => {
    const interrupt = h.urgency === 1 || asked;
    if (!interrupt && (speaking.current || audio.busy)) return; // don't talk over ourselves
    const id = ++speechId.current;
    const current = () => speechId.current === id;
    speaking.current = true;
    audio.stop();
    log("say", `${h.phrase} (${h.type}/${h.direction}/${h.distance} u${h.urgency}${asked ? ", asked" : ""})`);
    try {
      const pan = panFor(h);
      setShown({ text: h.phrase, direction: h.direction, level: levelOf(h) });
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
    if (!autoAlertsRef.current) return;          // voice-only mode: stay quiet unless asked
    if (answering.current > 0) return;           // never talk over an answer
    const h = pickAlert(r);
    if (h) speak(h);
  }, [speak]);

  const onSystem = useCallback(async (e: SystemEvent) => {
    log("system", e);
    setStatus(e === "no_connection" ? "noConn" : e === "camera_blocked" ? "blocked" : "walking");
    setShown(e === "connection_back" ? null : { text: strings[lang][e === "no_connection" ? "noConn" : "blocked"], level: "system" });
    audio.stop();
    await audio.playTone(0, 440, 250);
    await audio.playClip(lang, e);
  }, [lang]);

  const walk = useWalkLoop({ lang, onResult, onSystem });
  const { videoRef } = walk;
  const walkRef = useRef(walk);
  useLayoutEffect(() => { walkRef.current = walk; });

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

  /** Say a free-form answer (from Gemini) in River's live voice; "Sorry, I can't tell" if empty. */
  const sayAnswer = useCallback(async (text: string, kind: string) => {
    const id = ++speechId.current;
    log("say", `${text || "(no answer)"} (${kind}, asked)`);
    if (text) {
      setShown({ text, level: "info" });
      try {
        const mp3 = await tts(text, lang);
        if (speechId.current === id) await audio.playSpeech(mp3, 0);
        return;
      } catch { /* live voice failed: fall through */ }
    }
    if (speechId.current !== id) return;
    setShown({ text: lang === "fr" ? "Désolé, je ne peux pas le dire" : "Sorry, I can't tell", level: "info" });
    await audio.playClip(lang, "not_sure");
  }, [lang]);

  // While a question is being checked or answered, everything else waits: no background
  // snapshots to Gemini, no automatic alerts, no new listening. Then it all resumes.
  const updatePause = () => walkRef.current?.setPaused(checkingVoice.current || answering.current > 0);
  async function answeringQuestion(work: () => Promise<void>) {
    answering.current++;
    speechId.current++;                          // cancel anything SeeWalk was in the middle of saying
    audio.stop();
    voiceRef.current?.hold(true);
    updatePause();
    try {
      await work();
    } finally {
      answering.current--;
      if (answering.current === 0) voiceRef.current?.hold(false);
      updatePause();
    }
  }

  // Voice commands ("SeeWalk, …"): one Gemini call with the speech clip + the current frame.
  // The mic is ignored while SeeWalk is making sound, so it never hears its own voice.
  const onVoiceRef = useRef<(c: ListenResult) => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof createVoiceCommand> | null>(null);
  const getVoice = () => {
    if (!voiceRef.current) {
      const voice = createVoiceCommand(
        (c) => onVoiceRef.current(c),
        (msg) => log("voice", msg),
        () => { const v = videoRef.current; return v ? captureFrame(v)?.b64 ?? null : null; },
        (checking) => { checkingVoice.current = checking; updatePause(); },
      );
      audio.onSounding = (on) => voice.setSpeaking(on);
      voiceRef.current = voice;
    }
    return voiceRef.current;
  };

  async function toggle() {
    if (walking) {
      log("info", "stopped");
      fastGen.current++;
      fastStop.current?.();
      fastStop.current = null;
      walk.stop();
      getVoice().stop();
      speechId.current++;                        // cancel any alert still on its way
      audio.stop();
      setShown(null);
      setWalking(false);
      setStatus("idle");
      await audio.playClip(lang, "walk_stopped");
      return;
    }
    // iOS only allows audio and the mic to start *inside* the tap: do these before any await
    const unlocking = audio.unlock();
    getVoice().start(lang);                      // mic permission prompt on first use
    walk.start();                                // runs until Stop, don't await; camera prompt on first use
    if (autoAlerts) void startFast(++fastGen.current);
    log("info", `started (${lang}${MOCK ? ", MOCK" : ""})`);
    setWalking(true);
    setStatus("walking");
    await unlocking;
    await audio.preload(lang);                   // ~1 s; the first snapshot takes longer anyway
    if (introPlayed()) {
      await audio.playClip(lang, "walk_started");
    } else {
      markIntroPlayed();
      setShown({ text: t.introShort, level: "info" });
      log("say", "intro");
      await audio.playClip(lang, "intro");       // the voice commands, first Start only
    }
  }

  async function whatsAhead() {
    if (!walking) return;
    log("ask", "What's ahead? (tap)");
    await answeringQuestion(async () => {
      const answer = await walk.checkNow();      // the snapshot in flight, or a new one now
      if (!answer.ok) {
        if (answer.reason === "stopped") return;
        setShown({ text: strings[lang][answer.reason === "no_connection" ? "noConn" : "blocked"], level: "system" });
        await audio.playClip(lang, answer.reason); // "No connection…" or "Camera blocked"
        return;
      }
      const r = answer.result;
      if (r.unclear) {
        setShown({ text: lang === "fr" ? "Incertain" : "Unclear", level: "info" });
        await audio.playClip(lang, "unclear");
        return;
      }
      // Describe the scene ("Laptop and a cup on a table"), not hazard labels ("Person ahead")
      const summary = r.summary?.trim();
      if (summary) return sayAnswer(summary, "whats_ahead");
      const h = pickAlert(r, { ignoreRepeat: true });
      if (h) return sayAnswer(h.phrase, "whats_ahead");
      // Never answer a question with silence, but never promise "safe" or "clear" either
      setShown({ text: lang === "fr" ? "Rien de détecté" : "Nothing detected", level: "info" });
      log("say", "Nothing detected (asked)");
      await audio.playClip(lang, "nothing_detected");
    });
  }

  async function onVoice(c: ListenResult) {
    if (!walking) return;
    log("ask", `voice: ${c.intent}`);
    await answeringQuestion(async () => {
      if (c.intent === "cross") {
        // Never tells anyone it's safe to cross (spec). Fixed, pre-made answer.
        setShown({ text: t.crossRefusal, level: "system" });
        log("say", "cross refusal");
        await audio.playClip(lang, "cross_refusal");
        return;
      }
      // whats_ahead / holding / path / read: Gemini answered from the frame taken as you finished
      // speaking ("A table with a laptop and a cup, a chair on your left")
      await sayAnswer(c.answer, c.intent);
    });
  }
  useLayoutEffect(() => { onVoiceRef.current = onVoice; });

  function toggleAutoAlerts() {
    const next = !autoAlerts;
    setAutoAlerts(next);
    log("info", `auto alerts ${next ? "on" : "off"}`);
    if (!walking) return;
    if (next) {
      void startFast(++fastGen.current);
    } else {
      fastGen.current++;
      fastStop.current?.();
      fastStop.current = null;
    }
  }

  async function switchLang() {
    const next = lang === "en" ? "fr" : "en";
    setLang(next);
    if (walking) {
      getVoice().start(next);                    // listen in the new language
      await audio.preload(next);
    }
  }

  return (
    <main className={`walk ${walking ? "is-walking" : "is-idle"}`}>
      <header className="bar">
        <span className="brand" aria-label="SeeWalk">See<b>Walk</b></span>
        {MOCK && <span className="mock">MOCK</span>}
        <span className={`status ${status}`} role="status">{t[status]}</span>
        <button className="lang" onClick={switchLang} lang={lang === "en" ? "fr" : "en"}>{t.lang}</button>
      </header>

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {!walking && (
          <div className="setup">
            <p className="tagline">{t.tagline}</p>
            <ol>
              <li>{t.step1}</li>
              <li>{t.step2}</li>
              <li>{t.step3}</li>
            </ol>
            <div className="phrases">
              <p>{t.youCanSay}</p>
              <ul>
                <li>{t.cmdAhead}</li>
                <li>{t.cmdHolding}</li>
                <li>{t.cmdPath}</li>
                <li>{t.cmdRead}</li>
              </ul>
            </div>
            <div className="setting">
              <span>{t.autoLabel}</span>
              <button className={`auto${autoAlerts ? " on" : ""}`} onClick={toggleAutoAlerts} aria-pressed={autoAlerts}>
                {autoAlerts ? t.autoOn : t.autoOff}
              </button>
            </div>
          </div>
        )}
      </div>

      {walking && (
        <section className={`alert ${shown?.level ?? "none"}${(shown?.text.length ?? 0) > 40 ? " long" : ""}`} aria-live="polite">
          <span className="arrow" aria-hidden="true">{shown?.direction ? ARROW[shown.direction] : shown ? "•" : ""}</span>
          <span className="text">{shown?.text ?? t.listening}</span>
        </section>
      )}

      {walking ? (
        <div className="controls">
          <button className="ahead" onClick={whatsAhead}>{t.ahead}</button>
          <button className="stop" onClick={toggle}>{t.stop}</button>
        </div>
      ) : (
        <button className="start" onClick={toggle}>{t.start}</button>
      )}
    </main>
  );
}
