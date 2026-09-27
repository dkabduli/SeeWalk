import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOCK, tts } from "../api/client";
import type { Hazard, Lang, ListenResult, SceneResult, SystemEvent } from "../api/types";
import { nextIdleLine } from "../alerts/idle";
import { WalkMemory, withAside } from "../alerts/memory";
import { describeAhead, describePath, fallbackClip, noteSpoken, noticeDoors, panFor, pickAlert, streetClip, streetOnly } from "../alerts/pickAlert";
import { audio } from "../audio/AudioEngine";
import clips from "../audio/clips.json";
import { loadVoice, saveVoice, VOICES, type VoiceId } from "../audio/voices";
import { Waveform } from "../audio/Waveform";
import { captureFrame } from "../camera/captureFrame";
import { useWalkLoop } from "../camera/useWalkLoop";
import { createVoiceCommand } from "../camera/voiceCommand";
import { sendToLaptop } from "../debug/laptopLog";
import { startHazardReporter, type HazardReporter } from "../map/hazardReporter";
import { fetchBriefing } from "../map/hazardsApi";
import { createLocationAlerts, type LocationAlerts } from "../map/locationAlerts";
import { askNearby, asksPotholes } from "../map/nearbyReport";
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
  // Siri-style indicator with live bars: "hearing" while the walker asks (bars follow the mic),
  // "thinking" while the answer is prepared, "speaking" while the voice talks (bars follow it).
  // Blind users get the same information as sound (a chime, then a soft pulse if it's slow).
  const [busy, setBusy] = useState<"idle" | "hearing" | "thinking" | "speaking">("idle");
  const hearing = useRef(false);
  const hearingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playing = useRef(false);
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

  // Street alerts light the camera's edge on the side the sound came from, and the last two stay
  // on the panel, faded, for a companion walking alongside (and for the video).
  const [recent, setRecent] = useState<string[]>([]);
  const [glow, setGlow] = useState<{ side: Hazard["direction"]; level: Shown["level"]; id: number } | null>(null);
  const lastAlert = useRef<string | null>(null);
  // Long answers ("read this") show 4 lines and scroll; a fade at the bottom says there's more
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [more, setMore] = useState(false);
  const checkMore = () => {
    const el = textRef.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  };
  const showAlert = useCallback((next: Shown & { direction: Hazard["direction"] }) => {
    const prev = lastAlert.current;
    if (prev && prev !== next.text) {
      setRecent((r) => [prev, ...r.filter((x) => x !== prev && x !== next.text)].slice(0, 2));
    }
    lastAlert.current = next.text;
    setShown(next);
    setGlow((g) => ({ side: next.direction, level: next.level, id: (g?.id ?? 0) + 1 }));
  }, []);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = 0;                    // each new answer starts at the top
    checkMore();
  }, [shown]);
  useEffect(() => {
    if (!glow) return;
    const t = setTimeout(() => setGlow(null), 1700);
    return () => clearTimeout(t);
  }, [glow]);

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
        showAlert({ text: (clips as ClipTable)[instant][lang], direction: h.direction, level: levelOf(h) });
        await audio.playTone(pan, h.urgency === 1 ? 1200 : 1000);
        if (current()) await audio.playClip(lang, instant, pan);
        return;
      }
      showAlert({ text: h.phrase, direction: h.direction, level: levelOf(h) });
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
  }, [lang, voice, showAlert]);

  // Hazard map (Tiger Data): confident, GPS-tagged sidewalk hazards. Fire and forget.
  const reporter = useRef<HazardReporter | null>(null);
  // Location alerts (docs/prd/location-alerts.md): reported hazards (other walkers, pins, Ottawa 311)
  // turned into sound as the walker approaches: "Pothole reported about 40 metres ahead", then
  // "Pothole nearby, on your left. Be careful." The walker never sees the map, so this is the map.
  const places = useRef<LocationAlerts | null>(null);
  const placesTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsNews = useRef<string[]>([]);          // "Location is weak" etc., waiting for a quiet moment

  /** Low priority, like the idle lines: only in automatic mode and when nothing else is being said. */
  const quietNow = () => autoAlertsRef.current && answering.current === 0 && !speaking.current && !audio.busy;

  /** A map line: its own chime (reported, not seen), panned to the hazard's side, then the voice. */
  const sayMapLine = useCallback(async (text: string, pan: number, direction?: Hazard["direction"]) => {
    const id = ++speechId.current;
    speaking.current = true;
    log("say", `${text} (map)`);
    try {
      if (direction) showAlert({ text, direction, level: "info" });
      else setShown({ text, level: "info" });
      await audio.playMapChime(pan);
      if (speechId.current !== id) return;
      const mp3 = await tts(text, lang, voice);
      if (speechId.current === id) await audio.playSpeech(mp3, pan);
    } catch { /* live voice failed: the next reading tries again for anything still due */ } finally {
      if (speechId.current === id) speaking.current = false;
    }
  }, [lang, voice, showAlert]);

  /** Once a second: GPS news, then the one map alert that's due, only when nothing else is talking.
   *  An alert isn't marked said until it's spoken, so a busy moment delays it, never loses it. */
  const placesTickRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    placesTickRef.current = () => {
      const la = places.current;
      if (!la) return;
      for (const e of la.gpsEvents()) gpsNews.current.push(e === "off" ? t.gpsOff : e === "weak" ? t.gpsWeak : t.gpsBack);
      if (!quietNow()) return;
      const news = gpsNews.current.shift();
      if (news) { void sayMapLine(news, 0); return; }
      const a = la.next(lang);
      if (!a) return;
      la.markSaid(a);
      const dir = a.side === "left" || a.side === "right" ? a.side : a.side === "ahead" ? "ahead" : undefined;
      void sayMapLine(a.text, a.pan, dir);
    };
  });

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

  // Every Gemini answer goes to the map, including question photos and voice-only mode
  const onScene = useCallback((r: SceneResult) => {
    reporter.current?.report(r);
    // The camera sees a pothole the map also knows: the walker hears it once, from the camera
    places.current?.cameraSaw(r.hazards.filter((h) => h.confidence >= 0.6).map((h) => h.type));
  }, []);
  const walk = useWalkLoop({ lang, onResult, onSystem, onScene });
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
        const mp3 = await tts(text, lang, voice, 6000); // answers can be long (three potholes and their streets)
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
    setBusy(
      playing.current ? "speaking"
        : answering.current > 0 || checkingVoice.current ? "thinking"
        : hearing.current ? "hearing"
        : "idle",
    );
  const setHearing = (on: boolean) => {
    hearing.current = on;
    if (hearingTimer.current) clearTimeout(hearingTimer.current);
    // A clip ends within 4 s; if the words stopped short of a question, let the bars go
    hearingTimer.current = on ? setTimeout(() => setHearing(false), 4500) : null;
    refreshBusy();
  };
  const refreshBusyRef = useRef(refreshBusy);
  useLayoutEffect(() => { refreshBusyRef.current = refreshBusy; });
  useEffect(() => audio.onPlaying((on) => { playing.current = on; refreshBusyRef.current(); }), []);
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
          if (checking) hearing.current = false; // the question is over; refreshBusy below
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
        () => { audio.playWake(); setHearing(true); }, // name heard: rising chime, bars follow their voice
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
      reporter.current?.stop();
      reporter.current = null;
      if (placesTimer.current) clearInterval(placesTimer.current);
      placesTimer.current = null;
      places.current = null;
      gpsNews.current = [];
      getVoice().stop();
      speechId.current++;                        // cancel any alert still on its way
      audio.stop();
      setShown(null);
      setRecent([]);
      setGlow(null);
      lastAlert.current = null;
      audio.stopWorking();
      setHearing(false);
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
    if (!MOCK) startMapping();                   // location prompt on first use; fake results never go on the map
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
    await sayBriefing();
  }

  /** GPS for the hazard map: report what Gemini sees, and say known hazards the walker gets close to. */
  function startMapping() {
    let la: LocationAlerts | null = null;
    const r = startHazardReporter({
      onFix: (p) => la?.onFix({
        lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp,
        heading: p.coords.heading, speed: p.coords.speed,
      }),
      onError: (code) => { la?.onError(code); log("info", `location error ${code}`); },
    });
    la = createLocationAlerts({ sessionId: r.sessionId });
    reporter.current = r;
    places.current = la;
    placesTimer.current = setInterval(() => placesTickRef.current(), 1000);
  }

  /** After the start clip: what the city and other walkers reported within 300 m (Gemini, from real data). */
  async function sayBriefing() {
    const r = reporter.current;
    if (!r) return;
    for (let i = 0; i < 16 && !r.position(); i++) await new Promise((ok) => setTimeout(ok, 500)); // GPS: up to 8 s
    const here = r.position();
    if (!here || reporter.current !== r) return;
    try {
      const b = await fetchBriefing(here.lat, here.lon, lang, AbortSignal.timeout(6000));
      if (reporter.current !== r || b.count === 0 || !quietNow()) return; // stopped, nothing reported, or busy
      await sayAnswer(b.text, `briefing, ${b.by}`);
    } catch { /* offline or map off: the walk doesn't need it */ }
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

  // Voice cards: the sample starts first thing in the tap (iOS allows media only inside it)
  const SAMPLE = "st_stop_sign_right"; // "Stop sign on your right", in every voice and language
  function playSample(id: VoiceId) {
    audio.previewClip(id, lang, SAMPLE)
      .then(() => log("info", `voice sample ${id} played`))
      .catch((e: Error) => log("info", `voice sample ${id} failed: ${e.name}: ${e.message}`));
  }

  /** Tap a card: choose this voice for the walk, and hear it. */
  function pickVoice(id: VoiceId) {
    playSample(id);
    setVoice(id);
    saveVoice(id);
    audio.setVoice(id);
  }

  // "Potholes near me" on the start screen: where the nearest reported potholes are, before the walk
  const [nearMeText, setNearMeText] = useState("");
  const [nearMeBusy, setNearMeBusy] = useState(false);
  async function potholesNearMe() {
    if (nearMeBusy) return;
    audio.primeMedia();                          // inside the tap: iOS lets the answer play in a moment
    setNearMeBusy(true);
    setNearMeText("");
    try {
      const text = await askNearby(lang, true);
      setNearMeText(text);
      setNearMeBusy(false);                      // found: the label goes back while the answer is spoken
      log("say", `${text} (potholes near me, start screen)`);
      const mp3 = await tts(text, lang, voice, 6000);
      await audio.playMediaMp3(mp3);
    } catch { /* the text stays on screen */ } finally {
      setNearMeBusy(false);
    }
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
    if (c.intent === "around") {
      // "Where's the nearest pothole?" / "what's around me?": the map read aloud, from the walker's
      // GPS position and direction of travel (a fresh reading if the walk hasn't one yet)
      walk.dropLook();
      const la = places.current;
      await answeringQuestion(async () => {
        const text = await askNearby(lang, asksPotholes(c.heard), la?.position() ?? null, la?.direction() ?? null);
        await sayAnswer(text, "around");
      });
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

  const voiceName = VOICES.find((v) => v.id === voice)?.name ?? "River";
  const micLevels = () => voiceRef.current?.levels() ?? [0, 0, 0, 0, 0];

  return (
    <main className={`walk ${walking ? "is-walking" : "is-idle"}`}>
      <header className="bar">
        <span className="brand" aria-label="VisionCompanion">Vision<b>Companion</b></span>
        {MOCK && <span className="mock">MOCK</span>}
        <span className={`status ${status}`} role="status">{t[status]}</span>
        {/* "FR" / "EN" on screen so the bar fits "Camera blocked" on one line; VoiceOver reads the full name */}
        <button className="lang" onClick={switchLang} lang={lang === "en" ? "fr" : "en"} aria-label={t.lang}>{t.langShort}</button>
      </header>
      {walking && <p className="listen-for">{t.listening}</p>}

      <div className="viewfinder">
        <video ref={videoRef} playsInline muted autoPlay aria-hidden="true" />
        {walking && glow && <div key={glow.id} className={`glow ${glow.side} ${glow.level}`} aria-hidden="true" />}
        {walking && busy !== "idle" && (() => {
          const label = busy === "speaking" ? voiceName : busy === "thinking" ? t.thinking : t.listeningNow;
          // Speaking: the voice itself is the news, so VoiceOver shouldn't say "River" over it
          const a11y = busy === "speaking" ? { "aria-hidden": true } : { role: "status", "aria-label": label };
          return (
            <div className={`working ${busy}`} {...a11y}>
              <Waveform mode={busy} levels={busy === "hearing" ? micLevels : audio.levels.bind(audio)} />
              <span>{label}</span>
            </div>
          );
        })()}
      </div>

      {!walking && (
        <div className="setup">
          <p className="tagline">{t.tagline}</p>
          <ol>
            <li>{t.step1}</li>
            <li>{t.step2}</li>
            <li>{t.step3}</li>
          </ol>
          {/* Before leaving the house: the nearest reported potholes, spoken (the map, for someone who can't see it) */}
          <div className="near-me">
            <button className="near-me-btn" onClick={potholesNearMe} disabled={nearMeBusy}>
              <span aria-hidden="true">🗣️</span> {nearMeBusy ? t.findingYou : t.nearMe}
            </button>
            {nearMeText && <p className="near-me-text">{nearMeText}</p>}
          </div>
          <a className="map-link" href="?map">{t.mapLink}</a>
          <div className="phrases">
            <p className="say-then">{t.sayThen}</p>
            <ul>
              <li>{t.cmdAhead}</li>
              <li>{t.cmdHolding}</li>
              <li>{t.cmdPath}</li>
              <li>{t.cmdRead}</li>
              <li>{t.cmdNearest}</li>
            </ul>
          </div>
          <div className="voices">
            <p>{t.voice}</p>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <div key={v.id} className={`voice-card${voice === v.id ? " on" : ""}`}>
                  <button className="pick" aria-pressed={voice === v.id} onClick={() => pickVoice(v.id)}>
                    <b>{v.name}</b>
                    <small>{v.place[lang]}</small>
                  </button>
                </div>
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
          <span className={`text${more ? " more" : ""}`} ref={textRef} onScroll={checkMore}>{shown?.text ?? t.introShort}</span>
          {recent.length > 0 && (shown?.text.length ?? 0) <= 40 && (
            <span className="recent" aria-hidden="true">{recent.join(" · ")}</span>
          )}
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
