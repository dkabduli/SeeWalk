# PRD: Phone UI + Audio (Jibril)

> Read [the shared contract](README.md) first. You consume `SceneResult` and system events, and call `/tts`.

## 1. Summary

You own **everything the walker touches and hears**:
- The **`web/` scaffold** everyone builds inside (**first thing Saturday**, everyone is waiting on it)
- The **Walk Mode screen**: Start/Stop, EN/FR, big captions, and **"What's ahead?" as the whole lower half of the screen** (easy to hit without looking), plus Abdul's voice command ("SeeWalk, what's ahead?") wired in
- The **audio engine**: a tone in the correct ear, then River's voice
- The **alert filter**: out of everything Gemini reports, decide what (if anything) to say

This is also what judges *see* in the video, so the captions and screen should look clean on camera.

```
onResult(SceneResult) ─► pickAlert() ─► null? stay quiet
                                     └► Hazard ─► caption ─► playTone(pan) ─► tts(phrase) ─► playSpeech(mp3, pan)
                                                                                  └ fails ─► playClip(fallback key)
onSystem(event) ───────────────────────────────► low tone ─► playClip(event)
```

## 2. Depends on

- **Abdul's** `web/src/api/types.ts`, `client.ts` and `useWalkLoop` (he pushes the types early)
- **Aroha's** `/tts` for River's live voice. Until it's up, use the **bundled clips**, which are already committed
- You can build **all of it** with fake results before anyone else is done

## 3. Step-by-step

### Step 1: Scaffold `web/` (push within ~30 min)

```bash
cd SeeWalk && git checkout Jibrls-Work && git pull origin main
npm create vite@latest web -- --template react-ts
```
If it says `web/` isn't empty (it already contains `public/audio/` and `src/audio/clips.json`), choose **"Ignore files and continue"**. **Do not delete those files**: they're the ElevenLabs clips.

```bash
cd web && npm install
```

`web/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // reachable from the tunnel / other devices
    allowedHosts: true,  // allow the *.trycloudflare.com hostname
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  // Same settings for `npm run preview` (the production build we film with)
  preview: {
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
```

Create the folders so everyone knows where things go:
```bash
mkdir -p src/{api,camera,alerts,audio,i18n,pages}
```

Run it (`npm run dev`), confirm the page loads at <http://localhost:5173>, then:
```bash
git add -A && git commit -m "Scaffold web app (Vite + React + TS) with /api proxy" && git push
```
Open a PR into `main` and tell Abdul to merge it **right away**.

### Step 2: `web/src/i18n/strings.ts`

```ts
import type { Lang } from "../api/types";

export const strings: Record<Lang, Record<string, string>> = {
  en: {
    start: "Start walk", stop: "Stop", ahead: "What's ahead?", lang: "Français",
    walking: "Walking", idle: "Ready", noConn: "No connection", blocked: "Camera blocked",
    tagline: "A white cane finds the ground. SeeWalk finds everything else.",
    step1: "Hang the phone on your chest, rear camera facing forward.",
    step2: "Put on open-ear or bone-conduction headphones.",
    step3: "Tap Start. Ask by saying “SeeWalk”, then your question, or tap What's ahead?",
    listening: "Listening for “SeeWalk, …”",
    quiet: "Nothing to report",
    youCanSay: "You can say",
    autoLabel: "Automatic alerts (people, obstacles)",
    autoOn: "On",
    autoOff: "Off",
    cmdAhead: "“SeeWalk, what's ahead?”",
    cmdHolding: "“SeeWalk, what am I holding?”",
    cmdPath: "“SeeWalk, what's blocking my path?”",
    cmdRead: "“SeeWalk, read this.”",
    introShort: "Say “SeeWalk”, then your question",
    crossRefusal: "I can't tell when it's safe to cross. Listen for traffic.",
  },
  fr: {
    start: "Commencer", stop: "Arrêter", ahead: "Qu'y a-t-il devant ?", lang: "English",
    walking: "En marche", idle: "Prêt", noConn: "Pas de connexion", blocked: "Caméra bloquée",
    tagline: "La canne blanche trouve le sol. SeeWalk trouve tout le reste.",
    step1: "Portez le téléphone sur la poitrine, caméra arrière vers l'avant.",
    step2: "Mettez des écouteurs ouverts ou à conduction osseuse.",
    step3: "Touchez Commencer. Pour demander, dites « SeeWalk », puis votre question, ou touchez Qu'y a-t-il devant ?",
    listening: "À l'écoute de « SeeWalk, … »",
    quiet: "Rien à signaler",
    youCanSay: "Vous pouvez dire",
    autoLabel: "Alertes automatiques (personnes, obstacles)",
    autoOn: "Oui",
    autoOff: "Non",
    cmdAhead: "« SeeWalk, qu'y a-t-il devant ? »",
    cmdHolding: "« SeeWalk, qu'est-ce que je tiens ? »",
    cmdPath: "« SeeWalk, qu'est-ce qui bloque mon chemin ? »",
    cmdRead: "« SeeWalk, lis ceci. »",
    introShort: "Dites « SeeWalk », puis votre question",
    crossRefusal: "Je ne peux pas dire quand traverser. Écoutez la circulation.",
  },
};
```

### Step 3: `web/src/audio/AudioEngine.ts`

```ts
import clips from "./clips.json";
import type { Lang } from "../api/types";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private current: AudioBufferSourceNode | null = null;
  private sounding = 0;

  /** Called with true when SeeWalk starts making sound and false when it stops, so the voice
   *  command can stop listening meanwhile (the mic otherwise hears SeeWalk's own voice). */
  onSounding: ((on: boolean) => void) | null = null;

  private soundStarted() {
    if (this.sounding++ === 0) this.onSounding?.(true);
  }
  private soundEnded() {
    if (this.sounding > 0 && --this.sounding === 0) this.onSounding?.(false);
  }

  /** Call inside the Start button's tap handler. iOS blocks audio until a user gesture. */
  async unlock() {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
  }

  /** Decode every bundled clip for a language so fallbacks play instantly. */
  async preload(lang: Lang) {
    // allSettled: one missing clip must not break Start
    await Promise.allSettled(
      Object.keys(clips).map(async (key) => {
        const id = `${lang}/${key}`;
        if (this.buffers.has(id)) return;
        const res = await fetch(`/audio/${lang}/${key}.mp3`);
        this.buffers.set(id, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  /** iOS suspends ("interrupts") the audio context after a call, Siri, or switching apps.
   *  Try to resume before every sound; if it stays suspended, the next tap resumes it. */
  private ensureRunning() {
    if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {});
  }

  hasClip(lang: Lang, key: string) {
    return this.buffers.has(`${lang}/${key}`);
  }

  get busy() {
    return this.current !== null;
  }

  stop() {
    try { this.current?.stop(); } catch { /* already stopped */ }
    this.current = null;
  }

  /** Short beep placed in the left (-1), centre (0) or right (+1) ear. */
  playTone(pan: number, freq = 1000, ms = 120): Promise<void> {
    this.ensureRunning();
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { frequency: freq, type: "sine" });
    const gain = new GainNode(ctx, { gain: 0.0001 });
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(new StereoPannerNode(ctx, { pan })).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    this.soundStarted();
    return new Promise((r) => setTimeout(() => { this.soundEnded(); r(); }, ms + 40));
  }

  async playSpeech(mp3: ArrayBuffer, pan = 0) {
    return this.playBuffer(await this.ctx!.decodeAudioData(mp3), pan);
  }

  playClip(lang: Lang, key: string, pan = 0) {
    const buf = this.buffers.get(`${lang}/${key}`);
    return buf ? this.playBuffer(buf, pan) : Promise.resolve();
  }

  private playBuffer(buffer: AudioBuffer, pan: number): Promise<void> {
    this.stop();
    this.ensureRunning();
    const ctx = this.ctx!;
    const src = new AudioBufferSourceNode(ctx, { buffer });
    src.connect(new StereoPannerNode(ctx, { pan })).connect(ctx.destination);
    this.current = src;
    this.soundStarted();
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = null;
        this.soundEnded();
        resolve();
      };
      src.start();
    });
  }
}

export const audio = new AudioEngine();
```

If TypeScript complains about importing JSON, add `"resolveJsonModule": true` to `tsconfig.app.json`.

**Tone guide:** keep tones mid/high (900–1200 Hz), since bone-conduction headphones are weak on bass. Urgent = 1200 Hz played twice; normal = 1000 Hz once; system problem = low 440 Hz.

### Step 4: `web/src/alerts/pickAlert.ts` (what to say)

```ts
import type { Hazard, SceneResult } from "../api/types";

const MIN_CONFIDENCE = 0.6;
// How long before the same hazard + direction may be said again, by urgency. Information
// (crosswalks, stop signs) repeats much less: standing at a corner it was said every ~5 s.
const REPEAT_MS: Record<Hazard["urgency"], number> = { 1: 5000, 2: 8000, 3: 20000 };
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const lastSpoken = new Map<string, number>();

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  const candidates = result.hazards.filter(
    (h) =>
      h.confidence >= MIN_CONFIDENCE &&
      (ignoreRepeat || now - (lastSpoken.get(`${h.type}:${h.direction}`) ?? -Infinity) >= REPEAT_MS[h.urgency]),
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.urgency - b.urgency ||
      Number(b.approaching) - Number(a.approaching) ||
      DISTANCE_RANK[a.distance] - DISTANCE_RANK[b.distance],
  );
  const pick = candidates[0];
  lastSpoken.set(`${pick.type}:${pick.direction}`, now);
  return pick;
}

/** Bundled clip to use if live speech fails. */
export function fallbackClip(h: Hazard): string | null {
  if (h.type === "person" || h.type === "bike" || h.type === "car") return `${h.type}_${h.direction}`;
  const map: Partial<Record<Hazard["type"], string>> = {
    stop_sign: "stop_sign", crosswalk: "crosswalk", head_height_obstacle: "head_height",
    obstacle_in_path: "obstacle_path", construction: "construction", pothole: "pothole",
    uneven_surface: "uneven", stairs_down: "stairs_down", curb_or_dropoff: "curb",
  };
  return map[h.type] ?? null;
}

export const panFor = (h: Hazard) => (h.direction === "left" ? -1 : h.direction === "right" ? 1 : 0);
```

Quick sanity test: call `pickAlert` twice with the same fake result within 5 s. The second call should return `null`; with `{ ignoreRepeat: true }` it returns the hazard again **without** muting it for later.

### Step 5: `web/src/pages/WalkMode.tsx` (the screen)

```tsx
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
```

`App.tsx` renders `<WalkMode />` by default (Aroha's capture page is at `?capture`, the camera lab at `?lab`). **Built Sept 26 by Abdul from this PRD in Jibril's theme** (`web/src/styles/walk.css`), including the fast layer (Step 9) and voice command; verified in a browser: "Walk mode on", tones panned to the correct ear, clips, the fast layer, "What's ahead?", "Walk mode off".

### Step 6: Styling for sunlight + camera

Built in `web/src/styles/walk.css`. Colours come from the white cane: near-black `#0f1113`, white, and the red tip `#e0362c` (urgent, Stop); amber `#f3b21b` = warning, steel `#7d8ea3` = info. Flat and high-contrast, system font, no gradients or decorative motion (the earlier gradient/serif look read as generic).
- **Setup screen:** tagline + 3 wearing steps (EN/FR), one big white **Start walk** button
- **Walking:** status dot, **the camera fills most of the screen**, **alert panel** with a direction arrow (← ↑ →) and an urgency colour bar (long "read this" answers switch to smaller text and scroll inside the panel), a small white **What's ahead?** and a red outlined **Stop** side by side
- **Automatic alerts are OFF by default** (setting on the setup screen): in testing the fast layer + Gemini hazards flooded the screen, so for now SeeWalk only speaks when asked ("SeeWalk, …") plus the safety messages. Turn it on to bring back automatic warnings
- Caption text is 26–36 px bold: that's what viewers read in the video

### Step 7: Build without the backend
1. Hard-code a result: call `onResult(fakeResult)` from a temporary "Test" button, using the fake JSON from the [shared contract](README.md).
2. While `/tts` isn't up, the `catch` path plays the bundled clip, so you'll hear River from the clips.
3. With headphones on: `direction: "right"` → tone + voice in the **right** ear.

### Step 8: VoiceOver pass (iPhone: Settings → Accessibility → VoiceOver)
- Swipe through the screen: Start is first, every button reads a clear label, the caption is announced when it changes
- Double-tap Start works; no custom gestures anywhere

### Step 9: Plug in Abdul's fast layer (instant person/bike/car warnings)

Built and tested. See [Abdul's PRD §9](abdul-camera-capture.md#9-stretch-coco-ssd-fast-layer--built) for the 3 lines: `preloadFastLayer()` when WalkMode mounts, `startFastLayer(video, () => lang, onResult)` after `walk.start()`, and call the returned stop function on Stop. Its phrases match the bundled clips exactly, so your `speak()` plays them instantly.

## 4. Done when

- [ ] `web/` scaffold merged into `main` Saturday morning
- [ ] Tap Start → "Walk mode on"; camera preview visible
- [ ] Fake `car / right` result → tone in the right ear + "Car on your right" + caption
- [ ] Real results from Abdul's loop + Aroha's `/tts` → River speaks live phrases
- [ ] Same hazard isn't repeated within 5 s; urgent interrupts
- [ ] FR toggle → French voice, French captions and labels
- [ ] `no_connection` / `camera_blocked` → low tone + clip + status line
- [ ] "What's ahead?" (tap the lower half, or say it) answers within ~2 s: the top hazard, "Nothing detected" if there's none, "Unclear" on a covered lens
- [ ] Voice command started/stopped with the walk and switched with the language (if Abdul's testing says it's unreliable with Bluetooth, hide it and keep tap-anywhere)
- [ ] VoiceOver pass done; PR merged

## 5. Gotchas

| Problem | Fix |
|---|---|
| No sound on iPhone | `audio.unlock()` must run inside the tap handler, before any `await` that isn't audio. Also check the silent switch |
| Sound in both ears | Headphones must be stereo; test with regular earbuds first. `StereoPannerNode` needs iOS 14.1+ |
| `decodeAudioData` fails | The response wasn't an mp3 (probably a 503 JSON). Check `r.ok` in `tts()` |
| Silence after a phone call / Siri / switching apps | iOS suspends the audio context; `ensureRunning()` resumes it before each sound. If it stays silent, a tap resumes it |
| An old alert plays late, after a newer one | That's what `speechId` prevents; `tts()` also gives up after 2.5 s |
| Talking over itself | Only urgency 1 may interrupt; others skip while `audio.busy` |
| Clips 404 | They live in `web/public/audio/{en,fr}/`. Don't move or delete that folder |

## 6. Stretch
- Double beep for urgency 1 (play the tone twice)
- Speech rate: `AudioBufferSourceNode.playbackRate` 1.0–1.5 slider in settings (screen-reader users often listen fast)
- Haptics: `navigator.vibrate` doesn't work on iOS, so skip it
