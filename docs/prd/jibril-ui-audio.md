# PRD: Phone UI + Audio (Jibril)

> Read [the shared contract](README.md) first. You consume `SceneResult` and system events, and call `/tts`.

## 1. Summary

You own **everything the walker touches and hears**:
- The **`web/` scaffold** everyone builds inside (**first thing Saturday**, everyone is waiting on it)
- The **Walk Mode screen**: Start/Stop, EN/FR, big captions, and **"What's ahead?" as the whole lower half of the screen** (easy to hit without looking), plus Abdul's voice command wired in
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
  en: { start: "Start walk", stop: "Stop walk", ahead: "What's ahead?", lang: "Français",
        walking: "Walking", idle: "Tap Start walk", noConn: "No connection", blocked: "Camera blocked" },
  fr: { start: "Commencer", stop: "Arrêter", ahead: "Qu'y a-t-il devant ?", lang: "English",
        walking: "En marche", idle: "Touchez Commencer", noConn: "Pas de connexion", blocked: "Caméra bloquée" },
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

  /** Call inside the Start button's tap handler. iOS blocks audio until a user gesture. */
  async unlock() {
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
  }

  /** Decode every bundled clip for a language so fallbacks play instantly. */
  async preload(lang: Lang) {
    await Promise.all(
      Object.keys(clips).map(async (key) => {
        const id = `${lang}/${key}`;
        if (this.buffers.has(id)) return;
        const res = await fetch(`/audio/${lang}/${key}.mp3`);
        this.buffers.set(id, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      }),
    );
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
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = new OscillatorNode(ctx, { frequency: freq, type: "sine" });
    const gain = new GainNode(ctx, { gain: 0.0001 });
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(new StereoPannerNode(ctx, { pan })).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    return new Promise((r) => setTimeout(r, ms + 40));
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
    const ctx = this.ctx!;
    const src = new AudioBufferSourceNode(ctx, { buffer });
    src.connect(new StereoPannerNode(ctx, { pan })).connect(ctx.destination);
    this.current = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.current === src) this.current = null;
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
const REPEAT_MS = 5000;
const DISTANCE_RANK = { close: 0, near: 1, far: 2 } as const;
const lastSpoken = new Map<string, number>();

/** Returns the one hazard worth saying now, or null to stay quiet.
 *  ignoreRepeat: the walker asked "What's ahead?", so say it even if we just said it. */
export function pickAlert(result: SceneResult, { ignoreRepeat = false } = {}): Hazard | null {
  const now = Date.now();
  const candidates = result.hazards.filter(
    (h) =>
      h.confidence >= MIN_CONFIDENCE &&
      (ignoreRepeat || now - (lastSpoken.get(`${h.type}:${h.direction}`) ?? 0) >= REPEAT_MS),
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
import { useCallback, useMemo, useRef, useState } from "react";
import { tts } from "../api/client";
import type { Hazard, Lang, SceneResult, SystemEvent } from "../api/types";
import { audio } from "../audio/AudioEngine";
import { fallbackClip, panFor, pickAlert } from "../alerts/pickAlert";
import { useWalkLoop } from "../camera/useWalkLoop";
import { createVoiceCommand } from "../camera/voiceCommand";
import { strings } from "../i18n/strings";

export default function WalkMode() {
  const [lang, setLang] = useState<Lang>("en");
  const [walking, setWalking] = useState(false);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<"idle" | "walking" | "noConn" | "blocked">("idle");
  const t = strings[lang];

  const speak = useCallback(async (h: Hazard, asked = false) => {
    if (h.urgency === 1 || asked) audio.stop(); // urgent, or the walker asked: interrupt
    else if (audio.busy) return;                // otherwise don't talk over ourselves
    const pan = panFor(h);
    setCaption(h.phrase);
    await audio.playTone(pan, h.urgency === 1 ? 1200 : 1000);
    try {
      await audio.playSpeech(await tts(h.phrase, lang), pan);
    } catch {
      const key = fallbackClip(h);
      if (key) await audio.playClip(lang, key, pan);
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

  // Voice command "What's ahead?" (Abdul's code). The ref keeps the latest whatsAhead.
  const whatsAheadRef = useRef<() => void>(() => {});
  const voice = useMemo(() => createVoiceCommand(() => whatsAheadRef.current()), []);

  async function toggle() {
    if (walking) {
      walk.stop();
      voice.stop();
      setWalking(false);
      setStatus("idle");
      await audio.playClip(lang, "walk_stopped");
      return;
    }
    // iOS only allows audio and the mic to start *inside* the tap: do these before any await
    const unlocking = audio.unlock();
    voice.start(lang);                           // mic permission prompt on first use
    walk.start();                                // runs until Stop, don't await; camera prompt on first use
    setWalking(true);
    setStatus("walking");
    await unlocking;
    await audio.preload(lang);                   // ~1 s; the first snapshot takes longer anyway
    await audio.playClip(lang, "walk_started");
  }

  async function whatsAhead() {
    if (!walking) return;
    const answer = await walk.checkNow();        // jumps the queue
    audio.stop();                                // they asked: this answer comes first
    if (!answer.ok) {
      if (answer.reason === "stopped") return;
      setCaption(strings[lang][answer.reason === "no_connection" ? "noConn" : "blocked"]);
      await audio.playClip(lang, answer.reason); // "No connection…" or "Camera blocked"
      return;
    }
    const r = answer.result;
    if (r.unclear) {
      setCaption(lang === "fr" ? "Incertain" : "Unclear");
      await audio.playClip(lang, "unclear");
      return;
    }
    const h = pickAlert(r, { ignoreRepeat: true });
    if (h) {
      await speak(h, true);
    } else {
      // They asked, so never answer with silence, but never promise "safe" or "clear" either
      setCaption(lang === "fr" ? "Rien de détecté" : "Nothing detected");
      await audio.playClip(lang, "nothing_detected");
    }
  }
  whatsAheadRef.current = whatsAhead;

  async function switchLang() {
    const next = lang === "en" ? "fr" : "en";
    setLang(next);
    if (walking) {
      voice.start(next);                         // listen in the new language
      await audio.preload(next);
    }
  }

  return (
    <main className="walk">
      <video ref={walk.videoRef} playsInline muted autoPlay className="preview" aria-hidden="true" />
      <p className="status" role="status">{t[status]}</p>
      <p className="caption" aria-live="polite">{caption}</p>
      <div className="row">
        <button className="primary" onClick={toggle}>{walking ? t.stop : t.start}</button>
        <button onClick={switchLang} lang={lang === "en" ? "fr" : "en"}>{t.lang}</button>
      </div>
      {/* The whole lower half of the screen: tap anywhere to ask */}
      <button className="ahead-zone" onClick={whatsAhead} disabled={!walking}>{t.ahead}</button>
    </main>
  );
}
```

Render it from `App.tsx` (`export default function App() { return <WalkMode />; }`).

### Step 6: Styling for sunlight + camera

In `index.css` (replace Vite's default):
- Black background, white text, one strong accent (e.g. yellow `#FFD400`) for the Start button
- `.primary`: full width, **≥ 120 px tall**, 28 px+ bold text
- `.caption`: 36–44 px bold, centred. **This is what viewers read in the video**
- `.preview`: the live camera, top ~35% of the screen, `object-fit: cover`. It looks great on camera
- `.ahead-zone`: **the entire lower half of the screen**, one big button reading "What's ahead?". Walkers can hit it without looking; with VoiceOver it's one clearly labelled button
- The phone hangs **portrait** on a lanyard, so design for portrait only
- All buttons ≥ 56 px tall, clear focus outline

### Step 7: Build without the backend
1. Hard-code a result: call `onResult(fakeResult)` from a temporary "Test" button, using the fake JSON from the [shared contract](README.md).
2. While `/tts` isn't up, the `catch` path plays the bundled clip, so you'll hear River from the clips.
3. With headphones on: `direction: "right"` → tone + voice in the **right** ear.

### Step 8: VoiceOver pass (iPhone: Settings → Accessibility → VoiceOver)
- Swipe through the screen: Start is first, every button reads a clear label, the caption is announced when it changes
- Double-tap Start works; no custom gestures anywhere

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
| Talking over itself | Only urgency 1 may interrupt; others skip while `audio.busy` |
| Clips 404 | They live in `web/public/audio/{en,fr}/`. Don't move or delete that folder |

## 6. Stretch
- Double beep for urgency 1 (play the tone twice)
- Speech rate: `AudioBufferSourceNode.playbackRate` 1.0–1.5 slider in settings (screen-reader users often listen fast)
- Haptics: `navigator.vibrate` doesn't work on iOS, so skip it
