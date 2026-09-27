import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOCK, tts } from "../api/client";
import type { Hazard, Lang, ListenResult, SceneResult, SystemEvent } from "../api/types";
import { nextIdleLine } from "../alerts/idle";
import { WalkMemory, withAside } from "../alerts/memory";
import { describeAhead, describePath, fallbackClip, noteSpoken, noticeDoors, panFor, pickAlert, streetClip, streetOnly } from "../alerts/pickAlert";
import { audio } from "../audio/AudioEngine";
import clips from "../audio/clips.json";
import { loadVoice, saveVoice, VOICES, type VoiceId } from "../audio/voices";
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

// On-device person/bike/car warnings (the fast layer): off, street alerts only.
const PEOPLE_ALERTS = false;

// The spoken introduction (the voice commands) plays on the first Start on this phone only;
// after that Start just says "Walk mode on". Storage can be unavailable: then it always plays.
const INTRO_KEY = "visioncompanion.introPlayed";
const introPlayed = () => { try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; } };
const markIntroPlayed = () => { try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* private mode */ } };

export default function WalkMode() {
  const [lang, setLang] = useState<Lang>("en");
  const [voice, setVoice] = useState<VoiceId>(loadVoice);
  const [walking, setWalking] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  // Street alerts: holes, edges, steps, doors and pillars in the corridor, signs, work zones.
  // A chair or a thin pole stays quiet until the walker asks.
  const [autoAlerts, setAutoAlerts] = useState(true);
  // Siri-style indicator: "listening" while a spoken clip is checked, "thinking" while an answer
  // is prepared. Blind users get the same information as sound (a chirp, then a soft pulse).
  const [busy, setBusy] = useState<"idle" | "listening" | "thinking">("idle");
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
  const memory = useRef(new WalkMemory());
  const quietSince = useRef(Date.now());
  const lastIdleAt = useRef(0);
  const lastIdleLine = useRef("");
  const sayIdleRef = useRef<(text: string) => void>(() => {});
  const langRef = useRef(lang);

  const speak = useCallback(async (h: Hazard, asked = false) => {
    const interrupt = h.urgency === 1 || asked;
    if (!interrupt && (speaking.current || audio.busy)) return; // don't talk over ourselves
    const id = ++speechId.current;
    const current = () => speechId.current === id;
    speaking.current = true;
    audio.stop();
    log("say", `${h.phrase} (${h.type}/${h.direction}/${h.distance} u${h.urgency}${asked ? ", asked" : ""})`);
    memory.current.add(h.phrase);
    quietSince.current = Date.now();
    lastIdleLine.current = "";
    try {
      const pan = panFor(h);
      // Street alerts play a pre-recorded clip ("Stop sign on your right"): instant, no ~0.4 s wait
      // for the live voice. Answers to questions use Gemini's own words.
      const instant = !asked ? streetClip(h) : null;
      if (instant && audio.hasClip(lang, instant)) {
        setShown({ text: (clips as ClipTable)[instant][lang], direction: h.direction, level: levelOf(h) });
        await audio.playTone(pan, h.urgency === 1 ? 1200 : 1000);
        if (current()) await audio.playClip(lang, instant, pan);
        return;
      }
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
        const mp3 = await tts(h.phrase, lang, voice);   // gives up after 2.5 s: never speak a stale alert
        if (!current()) return;
        await audio.playSpeech(mp3, pan);
      } catch {
        if (current() && key) await audio.playClip(lang, key, pan);
      }
    } finally {
      if (current()) speaking.current = false;
    }
  }, [lang, voice]);

  const onResult = useCallback((r: SceneResult) => {
    memory.current.remember(r);
    if (!autoAlertsRef.current) return;          // voice-only mode: stay quiet unless asked
    if (answering.current > 0) return;           // never talk over an answer
    const scene = noticeDoors(r);
    const h = pickAlert(streetOnly(scene));
    if (h) {
      speak(h);
      return;
    }
    if (answering.current > 0 || speaking.current || audio.busy) return;
    const line = nextIdleLine(Date.now(), quietSince.current, lastIdleAt.current, lastIdleLine.current, scene.summary ?? "", langRef.current);
    if (!line) return;
    lastIdleAt.current = Date.now();
    lastIdleLine.current = line;
    sayIdleRef.current(line);
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

  // Fast layer (Abdul): on-device person/bike/car warnings into the same onResult. Switched off
  // with street alerts (it only announces people and vehicles); flip PEOPLE_ALERTS to bring it back.
  // The model is downloaded as soon as this screen opens (it took ~19 s cold).
  const onResultRef = useRef(onResult);
  useLayoutEffect(() => { langRef.current = lang; onResultRef.current = onResult; });
  const fastStop = useRef<(() => void) | null>(null);
  const fastGen = useRef(0);
  useEffect(() => {
    if (!PEOPLE_ALERTS) return;
    void import("../detection/fastLayer").then((m) => m.preloadFastLayer()).catch(() => {});
  }, []);
  async function startFast(gen: number) {
    if (!PEOPLE_ALERTS) return;
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

  /** Say a free-form answer in the walker's chosen voice; "Sorry, I can't tell" if empty. */
  const sayAnswer = useCallback(async (text: string, kind: string) => {
    const id = ++speechId.current;
    log("say", `${text || "(no answer)"} (${kind}, asked)`);
    if (text) {
      setShown({ text, level: "info" });
      try {
        const mp3 = await tts(text, lang, voice);
        if (speechId.current === id) await audio.playSpeech(mp3, 0);
        return;
      } catch { /* live voice failed: fall through */ }
    }
    if (speechId.current !== id) return;
    setShown({ text: lang === "fr" ? "Désolé, je ne peux pas le dire" : "Sorry, I can't tell", level: "info" });
    await audio.playClip(lang, "not_sure");
  }, [lang, voice]);
  sayIdleRef.current = (text) => { void sayAnswer(text, "idle"); };

  // While a question is being checked or answered, everything else waits: no background
  // snapshots to Gemini, no automatic alerts, no new listening. Then it all resumes.
  const updatePause = () => walkRef.current?.setPaused(checkingVoice.current || answering.current > 0);
  const refreshBusy = () =>
    setBusy(answering.current > 0 ? "thinking" : checkingVoice.current ? "listening" : "idle");
  async function answeringQuestion(work: () => Promise<void>) {
    answering.current++;
    speechId.current++;                          // cancel anything SeeWalk was in the middle of saying
    audio.stop();
    voiceRef.current?.hold(true);
    updatePause();
    refreshBusy();
    audio.startWorking();                        // soft pulse until the answer starts playing
    try {
      await work();
    } finally {
      answering.current--;
      if (answering.current === 0) {
        voiceRef.current?.hold(false);
        audio.stopWorking();
      }
      updatePause();
      refreshBusy();
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
        (checking) => {
          checkingVoice.current = checking;
          updatePause();
          if (checking) {
            audio.playDone();                     // question finished: falling chime, then the answer
            audio.startWorking();                 // alert only if this wait runs past 3 seconds
            walkRef.current?.primeLook();         // the photo starts now, while the words are still being heard
          } else if (answering.current === 0) {
            audio.stopWorking();
          }
          refreshBusy();
        },
        () => walkRef.current?.releaseLook(),    // not a command: speak that photo as a normal alert
        () => audio.playWake(),                  // name heard: louder rising chime, they keep talking
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
      audio.stopWorking();
      setBusy("idle");
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
    quietSince.current = Date.now();
    lastIdleAt.current = 0;
    lastIdleLine.current = "";
    log("info", `started (${lang}${MOCK ? ", MOCK" : ""})`);
    setWalking(true);
    setStatus("walking");
    audio.setVoice(voice);
    await unlocking;
    await audio.preload(lang, (k) => !k.startsWith("st_")); // start, intro, system messages first
    void audio.preload(lang);                    // then the street clips, while the intro plays
    if (introPlayed()) {
      await audio.playClip(lang, "walk_started");
    } else {
      markIntroPlayed();
      setShown({ text: t.introShort, level: "info" });
      log("say", "intro");
      await audio.playClip(lang, "intro");       // the voice commands, first Start only
    }
  }

  /** Tap and "SeeWalk, what's ahead / what's blocking my path?" share this look, so they can't disagree
   *  with a street alert from the same photo. */
  async function answerFromScene(kind: "whats_ahead" | "path") {
    await answeringQuestion(async () => {
      const answer = await walk.takeLook();      // the photo started when speech began, or a new one now
      if (!answer.ok) {
        if (answer.reason === "stopped") return;
        setShown({ text: strings[lang][answer.reason === "no_connection" ? "noConn" : "blocked"], level: "system" });
        await audio.playClip(lang, answer.reason); // "No connection…" or "Camera blocked"
        return;
      }
      const r = noticeDoors(answer.result);
      memory.current.remember(r);
      if (r.unclear) {
        setShown({ text: lang === "fr" ? "Incertain" : "Unclear", level: "info" });
        await audio.playClip(lang, "unclear");
        return;
      }
      const lead = kind === "path" ? describePath(r) : describeAhead(r);
      const text = kind === "path" ? lead : withAside(lead, memory.current.aside(lead, lang));
      noteSpoken(r, text); // street hazards named in the answer don't play again a second later
      if (text) return sayAnswer(text, kind);
      if (kind === "path") {
        return sayAnswer(lang === "fr" ? "Rien de détecté sur votre chemin" : "Nothing detected in your path", kind);
      }
      // Never answer a question with silence, but never promise "safe" or "clear" either
      setShown({ text: lang === "fr" ? "Rien de détecté" : "Nothing detected", level: "info" });
      log("say", "Nothing detected (asked)");
      await audio.playClip(lang, "nothing_detected");
    });
  }

  async function pickVoice(id: VoiceId) {
    setVoice(id);
    saveVoice(id);
    audio.setVoice(id);
    await audio.unlock();
    // One street line, so the walker hears this voice before the walk. The clip if we have it
    // (the same recording the alerts use); otherwise a live reading in this voice.
    const sample = "st_door_ahead";
    await audio.preload(lang, (k) => k === sample);
    if (audio.hasClip(lang, sample)) {
      await audio.playClip(lang, sample);
      return;
    }
    try {
      const mp3 = await tts(lang === "fr" ? "Porte devant" : "Door ahead", lang, id, 6000);
      await audio.playSpeech(mp3, 0);
    } catch { /* the walk still uses this voice */ }
  }

  async function whatsAhead() {
    if (!walking) return;
    log("ask", "What's ahead? (tap)");
    await answerFromScene("whats_ahead");
  }

  async function onVoice(c: ListenResult) {
    if (!walking) return;
    log("ask", `voice: ${c.intent}`);
    if (c.intent === "where") {
      walk.dropLook();                           // the last 30 seconds already have it; no second photo
      const text = memory.current.where(c.heard, lang);
      await answeringQuestion(async () => { await sayAnswer(text, "where"); });
      return;
    }
    if (c.intent === "whats_ahead" || c.intent === "path") {
      await answerFromScene(c.intent);
      return;
    }
    walk.dropLook();                             // holding / read / cross: don't speak the extra photo over the answer
    await answeringQuestion(async () => {
      if (c.intent === "cross") {
        // Never tells anyone it's safe to cross (spec). Fixed, pre-made answer.
        setShown({ text: t.crossRefusal, level: "system" });
        log("say", "cross refusal");
        await audio.playClip(lang, "cross_refusal");
        return;
      }
      // holding / read: Gemini answered from the frame taken as you finished speaking
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
    memory.current = new WalkMemory();           // its notes are in the old language
    if (walking) {
      getVoice().start(next);                    // listen in the new language
      await audio.preload(next);
    }
  }

  return (
    <main className={`walk ${walking ? "is-walking" : "is-idle"}`}>
      <header className="bar">
        <span className="brand" aria-label="VisionCompanion">Vision<b>Companion</b></span>
        {MOCK && <span className="mock">MOCK</span>}
        <span className={`status ${status}`} role="status">{t[status]}</span>
        <button className="lang" onClick={switchLang} lang={lang === "en" ? "fr" : "en"}>{t.lang}</button>
      </header>
      {walking && <p className="listen-for">{t.listening}</p>}

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {walking && busy !== "idle" && (
          <div className={`working ${busy}`} role="status" aria-label={busy === "thinking" ? t.thinking : t.listeningNow}>
            <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <span>{busy === "thinking" ? t.thinking : t.listeningNow}</span>
          </div>
        )}
      </div>

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
          <div className="voices">
            <p>{t.voice}</p>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  className={voice === v.id ? "on" : ""}
                  aria-pressed={voice === v.id}
                  onClick={() => pickVoice(v.id)}
                >
                  <b>{v.name}</b>
                  <small>{v.place[lang]}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <span>{t.autoLabel}</span>
            <button className={`auto${autoAlerts ? " on" : ""}`} onClick={toggleAutoAlerts} aria-pressed={autoAlerts}>
              {autoAlerts ? t.autoOn : t.autoOff}
            </button>
          </div>
        </div>
      )}

      {walking && (
        <section
          className={`alert ${shown?.level ?? "none"}${(shown?.text.length ?? 0) > 40 ? " long" : ""}${shown?.direction ? "" : " no-arrow"}`}
          aria-live="polite"
        >
          {shown?.direction && <span className="arrow" aria-hidden="true">{ARROW[shown.direction]}</span>}
          <span className="text">{shown?.text ?? t.introShort}</span>
        </section>
      )}

      {walking ? (
        <div className="controls">
          <button className="ahead" onClick={whatsAhead}>{t.ahead}</button>
          <button className="stop" onClick={toggle}>{t.stop}</button>
        </div>
      ) : (
        <div className="start-bar">
          <button className="start" onClick={toggle}>{t.start}</button>
        </div>
      )}
    </main>
  );
}
