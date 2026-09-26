# PRD: Camera + Capture (Abdul)

> Read [the shared contract](README.md) first. You produce the `/analyze` requests, the phone-side events, and the hands-free "What's ahead?" voice command.

## 1. Summary

You own the **eyes and ears** of the app:
- Turn the iPhone's live rear camera into a steady stream of **snapshots** and send each one to `/analyze`
- Hand the results to Jibril's UI and **notice when something breaks** (no connection, camera blocked)
- Let the walker ask **"SeeWalk, what's ahead?" out loud**, without touching or seeing the screen
- Own the shared **TypeScript types and API client** everyone imports

You also handle keys, billing and merging PRs.

```
<video> live feed ──every ~1.5 s──► captureFrame() ──► analyze(image, prevImage, lang) ──► onResult(result) ──► Jibril
                                         │                        │ fails ×2
                                   lens covered ×2                └──────────────► onSystem("no_connection") ──► Jibril
                                         └────────────────────────────────────────► onSystem("camera_blocked")
"What's ahead?" (voice) or tap ──► checkNow() ──► snapshot in flight, or a new one now ──► result to the caller ──► Jibril speaks it
```

**It's snapshots, not video.** The `<video>` element shows the live feed on screen, and we copy one frame at a time to a canvas. Nothing is saved to the camera roll.

## 2. Decisions (agreed Sept 26)

| Question | Decision |
|---|---|
| How the phone is worn | **Portrait, on a chest lanyard.** Snapshots come out 576×768 |
| "What's ahead?" trigger | **Voice command** (your code) + **tap anywhere on the lower half of the screen** (Jibril's UI). Real Siri can't control a web app; that would need a native iOS app |
| "What's ahead?" while the loop runs | **Fastest answer**: if a snapshot is already on its way to Gemini, answer with that one (~0.1–1.3 s); if the loop is waiting, skip the wait and take one now. Still one request at a time |
| Voice trigger phrase | **"SeeWalk, what's ahead?"** (FR: "SeeWalk, qu'y a-t-il devant ?"). The wake word prevents false triggers |
| How we hear it | **Our own mic capture + Gemini**, not Safari's speech recognition. On Abdul's iPhone Safari's recognizer fails instantly with `service-not-allowed` even with Siri and Dictation on. The phone cuts out speech clips and sends them to `POST /listen` (Gemini, ~1.5 s). About 2.5–3 s from the end of the sentence to the answer |
| "What's ahead?" finds nothing | Say **"Nothing detected"** / "Rien de détecté" (never "clear" or "safe"). Jibril plays the `nothing_detected` clip |
| Snapshot interval | **1.5 s** for filming (billing on), 5 s during development |
| Skip blurry / unchanged frames? | **No.** Send every snapshot; keep it simple |
| Night | **Daylight only** (V0 scope). Only a covered lens counts as "camera blocked" |
| Testing | iPhone + Mac with a cable (Safari Web Inspector) |
| Stretch | **COCO-SSD fast layer** |

## 3. Depends on

- **Jibril's `web/` scaffold** (first thing Saturday). Until it lands, prototype in a scratch Vite app.
- **An HTTPS tunnel**: iPhone Safari only allows the camera and microphone on `https://`. You don't have to wait for Siddig to test your own piece: run `brew install cloudflared && cloudflared tunnel --url http://localhost:5173` yourself with `VITE_MOCK_API=1`.
- **Aroha's `/analyze`**: until it's up, use the mock (Step 3).

## 4. Setup

```bash
cd SeeWalk && git checkout Abduls-Work && git pull origin main
cd web && npm install && npm run dev        # after Jibril's scaffold is on main
```

Create `web/.env.local` (Vite keeps it out of git):
```
VITE_FRAME_INTERVAL_MS=5000
VITE_MOCK_API=1
```
- `VITE_FRAME_INTERVAL_MS`: `5000` during development (Gemini free tier), `1500` for filming.
- `VITE_MOCK_API=1` until Aroha's server is up; **delete the line after** (the console warns while it's on, and Jibril shows a "MOCK" badge, so fake results can't end up in the video).

**One-time debugging setup (Mac + cable):**
- iPhone: Settings → Apps → Safari → Advanced → **Web Inspector** on
- Mac: Safari → Settings → Advanced → **Show features for web developers**
- Plug the iPhone in, open the app in iPhone Safari, then Mac Safari → **Develop → [your iPhone] → the page** to see its console

## 5. Step-by-step

### Step 1: `web/src/api/types.ts` (shared types; push this first)

```ts
export type Lang = "en" | "fr";

export type HazardType =
  | "person" | "bike" | "car" | "crosswalk" | "stop_sign" | "pothole" | "uneven_surface"
  | "head_height_obstacle" | "obstacle_in_path" | "construction" | "curb_or_dropoff"
  | "stairs_down" | "other";

export interface Hazard {
  type: HazardType;
  direction: "left" | "ahead" | "right";
  distance: "close" | "near" | "far";
  urgency: 1 | 2 | 3;
  confidence: number;
  approaching: boolean;
  phrase: string;
}

export interface SceneResult {
  hazards: Hazard[];
  unclear: boolean;
}

export type SystemEvent = "no_connection" | "connection_back" | "camera_blocked";

/** POST /listen: what the mic heard, and whether it was "SeeWalk, what's ahead?" */
export interface ListenResult {
  heard: string;
  command: boolean;
}
```

**Push this within the first hour Saturday** so Jibril codes against the same shapes.

### Step 2: `web/src/api/client.ts`

```ts
import type { Lang, ListenResult, SceneResult } from "./types";
import { mockAnalyze } from "./mock";

const BASE = "/api"; // Vite proxies /api → http://localhost:8000
export const MOCK = import.meta.env.VITE_MOCK_API === "1";
if (MOCK) console.warn("SeeWalk: MOCK API ON: results are fake. Remove VITE_MOCK_API before filming.");

export async function analyze(
  image: string,
  prevImage: string | null,
  lang: Lang,
  signal?: AbortSignal,
): Promise<SceneResult> {
  if (MOCK) return mockAnalyze(lang);
  const r = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, prev_image: prevImage, lang }),
    signal,
  });
  if (!r.ok) throw new Error(`analyze ${r.status}`);
  return r.json();
}

/** Live speech. Gives up after 2.5 s so a stale alert is never spoken late. */
export async function tts(text: string, lang: Lang): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${BASE}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    return await r.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

/** Voice command: send a short speech clip (base64 WAV). Never mocked: needs the server. */
export async function listen(audio: string, lang: Lang): Promise<ListenResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`${BASE}/listen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio, lang }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`listen ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}
```

### Step 3: `web/src/api/mock.ts` (fake backend)

```ts
import type { Lang, SceneResult } from "./types";

const samples: Record<Lang, SceneResult[]> = {
  en: [
    { hazards: [], unclear: false },
    { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Stop sign ahead" }], unclear: false },
    { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Car on your right" }], unclear: false },
    { hazards: [], unclear: true },
  ],
  fr: [
    { hazards: [], unclear: false },
    { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Panneau d'arrêt devant" }], unclear: false },
    { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Voiture à droite" }], unclear: false },
    { hazards: [], unclear: true },
  ],
};
let i = 0;

export async function mockAnalyze(lang: Lang): Promise<SceneResult> {
  await new Promise((r) => setTimeout(r, 1200)); // pretend Gemini takes 1.2 s
  return samples[lang][i++ % samples[lang].length];
}
```

### Step 4: `web/src/camera/captureFrame.ts`

```ts
const frameCanvas = document.createElement("canvas");
const tinyCanvas = document.createElement("canvas");
tinyCanvas.width = tinyCanvas.height = 32;

export interface Frame {
  b64: string;       // JPEG, no "data:" prefix
  brightness: number; // average, 0 (black) – 255 (white)
  contrast: number;   // standard deviation of brightness; near 0 = flat, featureless image
  at: number;         // Date.now() when captured
}

export function captureFrame(video: HTMLVideoElement, maxEdge = 768): Frame | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null; // camera not ready yet

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  frameCanvas.width = Math.round(w * scale);   // portrait phone → 576 × 768
  frameCanvas.height = Math.round(h * scale);
  frameCanvas.getContext("2d")!.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  const b64 = frameCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];

  const tiny = tinyCanvas.getContext("2d", { willReadFrequently: true })!;
  tiny.drawImage(video, 0, 0, 32, 32);
  const px = tiny.getImageData(0, 0, 32, 32).data;
  const lum: number[] = [];
  for (let i = 0; i < px.length; i += 4) lum.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  const brightness = lum.reduce((a, b) => a + b, 0) / lum.length;
  const contrast = Math.sqrt(lum.reduce((a, b) => a + (b - brightness) ** 2, 0) / lum.length);
  return { b64, brightness, contrast, at: Date.now() };
}

/** A finger over the lens isn't black: auto-exposure turns it into a flat, dim, reddish blur.
 *  So "covered" = very dark, OR flat and dim. A bright blank wall stays "not covered".
 *  Measured on Abdul's iPhone (Sept 26): finger = brightness 28–56, contrast 6–10;
 *  normal scenes = contrast 24+; bright blank wall/window = brightness 250+, contrast 1–7. */
export const looksCovered = (f: Frame) => f.brightness < 12 || (f.contrast < 12 && f.brightness < 90);
```

A 768 px JPEG at q0.7 is ~50–70 KB (same as the files in `samples/`), quick to upload on campus Wi-Fi. With the previous frame included, each request uploads ~150 KB, about **6 MB a minute** at a 1.5 s interval; fine on Wi-Fi or a phone hotspot.

### Step 5: `web/src/camera/useCamera.ts`

```ts
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

export function useCamera(onEnded: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onEndedRef = useRef(onEnded);
  useLayoutEffect(() => { onEndedRef.current = onEnded; });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop()); // page-initiated stop never fires "ended"
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop(); // never leak an old stream (e.g. when restarting after the page was hidden)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, // rear camera; iOS gives a portrait stream when held upright
      audio: false,
    });
    streamRef.current = stream;
    stream.getVideoTracks()[0].addEventListener("ended", () => onEndedRef.current());
    const video = videoRef.current;
    if (!video) throw new Error("video element not mounted");
    video.srcObject = stream;
    await video.play();
  }, [stop]);

  /** True while the camera is actually delivering frames. iOS "mutes" the track during
   *  interruptions (a call, Siri, the page being hidden) and unmutes it afterwards. */
  const isLive = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    return !!track && track.readyState === "live" && !track.muted;
  }, []);

  return useMemo(() => ({ videoRef, start, stop, isLive }), [start, stop, isLive]);
}
```

The `<video>` element (Jibril renders it, you pass the ref) **must** have `playsInline muted autoPlay`, or iOS opens it fullscreen or refuses to play.

Why `mute` isn't treated as "blocked" straight away: iOS mutes the track briefly on every interruption and when you switch apps, then unmutes it. Announcing on every mute would say "Camera blocked" each time the walker comes back to Safari. Instead the loop counts **2 snapshots in a row** where the camera isn't live (Step 6).

### Step 6: `web/src/camera/useWalkLoop.ts` (the heart of your piece)

```ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { analyze } from "../api/client";
import type { Lang, SceneResult, SystemEvent } from "../api/types";
import { captureFrame, looksCovered } from "./captureFrame";
import { useCamera } from "./useCamera";

// `|| 1500` (not `?? 1500`) so an empty VITE_FRAME_INTERVAL_MS= can't become 0 and hammer Gemini
const INTERVAL_MS = Math.max(500, Number(import.meta.env.VITE_FRAME_INTERVAL_MS) || 1500);
const TIMEOUT_MS = 5000;
const NO_CONN_REPEAT_MS = 20000;
const PREV_MAX_AGE_MS = 4000; // older than this, the "previous frame" can't show motion honestly

/** What "What's ahead?" gets back. */
export type CheckResult =
  | { ok: true; result: SceneResult }
  | { ok: false; reason: "no_connection" | "camera_blocked" | "stopped" };

interface Options {
  lang: Lang;
  onResult: (result: SceneResult) => void;
  onSystem: (event: SystemEvent) => void;
}

export function useWalkLoop({ lang, onResult, onSystem }: Options) {
  // refs so the running loop always sees the latest props (updated after each render)
  const langRef = useRef(lang);
  const onResultRef = useRef(onResult);
  const onSystemRef = useRef(onSystem);
  useLayoutEffect(() => {
    langRef.current = lang;
    onResultRef.current = onResult;
    onSystemRef.current = onSystem;
  });

  const camera = useCamera(useCallback(() => onSystemRef.current("camera_blocked"), []));
  const generation = useRef(0); // bumps on every start/stop, so an old loop can never keep running
  const running = useRef(false);
  const prevFrame = useRef<{ b64: string; at: number } | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const cutWaitShort = useRef<(() => void) | null>(null);
  const askers = useRef<((r: CheckResult) => void)[]>([]);
  const resetFailures = useRef(false);

  const keepAwake = useCallback(async () => {
    try { wakeLock.current = await navigator.wakeLock?.request("screen"); } catch { /* refused: fine */ }
  }, []);

  // iOS drops the wake lock (and sometimes the camera) when the page is hidden. When the walker
  // comes back to Safari, take both back, and forget failures that happened while frozen.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !running.current) return;
      resetFailures.current = true;
      await keepAwake();
      if (!camera.isLive()) {
        try { await camera.start(); } catch { onSystemRef.current("camera_blocked"); }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [camera, keepAwake]);

  /** "What's ahead?": answer with the snapshot in flight, or take one right away. */
  const checkNow = useCallback(
    () =>
      new Promise<CheckResult>((resolve) => {
        if (!running.current) return resolve({ ok: false, reason: "stopped" });
        askers.current.push(resolve);
        cutWaitShort.current?.();
      }),
    [],
  );

  const start = useCallback(async () => {
    const gen = ++generation.current;
    const alive = () => running.current && generation.current === gen;
    running.current = true;
    prevFrame.current = null;

    try {
      await camera.start();
    } catch {
      // Permission denied or no camera. Never fail silently.
      if (generation.current === gen) {
        running.current = false;
        onSystemRef.current("camera_blocked");
      }
      return;
    }
    if (!alive()) { camera.stop(); return; } // Stop was tapped during the permission prompt
    await keepAwake();

    let fails = 0;
    let lastNoConn = 0;
    let blockedCount = 0;

    while (alive()) {
      const roundStart = performance.now();
      if (resetFailures.current) { fails = 0; resetFailures.current = false; }
      const video = camera.videoRef.current;
      const frame = video && camera.isLive() ? captureFrame(video) : null;
      const blocked = !camera.isLive() || (frame !== null && looksCovered(frame));
      blockedCount = blocked ? blockedCount + 1 : 0;
      if (blockedCount === 2) onSystemRef.current("camera_blocked");

      if (frame && !blocked) {
        const prev = prevFrame.current && frame.at - prevFrame.current.at < PREV_MAX_AGE_MS
          ? prevFrame.current.b64
          : null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        let answer: CheckResult;
        try {
          const result = await analyze(frame.b64, prev, langRef.current, ctrl.signal);
          if (!alive()) break; // stopped while we were waiting: drop it
          if (fails >= 2) onSystemRef.current("connection_back");
          fails = 0;
          answer = { ok: true, result };
          // Anyone who asked while this was in flight gets THIS result (fastest answer) and
          // speaks it themselves, so the loop doesn't speak it too
          if (askers.current.length === 0) onResultRef.current(result);
        } catch {
          if (!alive()) break;
          fails += 1;
          answer = { ok: false, reason: "no_connection" };
          const now = Date.now();
          if (fails === 2 || (fails > 2 && now - lastNoConn > NO_CONN_REPEAT_MS)) {
            onSystemRef.current("no_connection");
            lastNoConn = now;
          }
        } finally {
          clearTimeout(timer);
        }
        prevFrame.current = { b64: frame.b64, at: frame.at };
        askers.current.splice(0).forEach((resolve) => resolve(answer));
      } else if (blocked) {
        askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "camera_blocked" }));
      }
      // (no frame yet because the camera is still warming up: askers wait for the next round)

      // Wait out the interval, unless "What's ahead?" cuts it short
      const wait = INTERVAL_MS - (performance.now() - roundStart);
      if (wait > 0 && askers.current.length === 0 && alive()) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, wait);
          cutWaitShort.current = () => { clearTimeout(t); resolve(); };
        });
      } else if (askers.current.length > 0 && !frame && !blocked) {
        await new Promise((r) => setTimeout(r, 200)); // camera warming up: don't spin
      }
      cutWaitShort.current = null;
    }
    if (generation.current === gen) {
      askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "stopped" }));
    }
  }, [camera, keepAwake]);

  const stop = useCallback(() => {
    running.current = false;
    generation.current++;
    cutWaitShort.current?.();
    askers.current.splice(0).forEach((resolve) => resolve({ ok: false, reason: "stopped" }));
    camera.stop();
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, [camera]);

  return useMemo(
    () => ({ videoRef: camera.videoRef, start, stop, checkNow }),
    [camera.videoRef, start, stop, checkNow],
  );
}
```

Rules baked in:
- **One request in flight**, 5 s timeout; the next snapshot waits for the previous answer.
- **Stop → Start quickly can't create two loops**: each start gets a generation number, and an old loop exits as soon as it notices it's stale (it also never fires events after Stop).
- **Stop during the camera permission prompt** turns the camera off as soon as the prompt closes (otherwise the camera would stay on after Stop).
- **Camera permission denied → `camera_blocked`**, not a silent failure.
- **Camera blocked = 2 snapshots in a row** where the track isn't live (iOS interruption) or the frame looks covered. Blocked snapshots aren't sent to Gemini.
- **Returning to Safari forgets failures from while the page was frozen**, so it doesn't falsely say "No connection".
- **Hook return values are memoized**, so Jibril's `useCallback`s don't re-run every render.
- `prevFrame` is sent so Gemini can see what's **approaching**, but only if it's < 4 s old (after an outage an old frame would fake "motion").
- **"What's ahead?" gets the fastest honest answer**: the snapshot already in flight if there is one (taken ≤ ~1.3 s before the question), otherwise a new one right away. It also says *why* when there's no result (`no_connection` / `camera_blocked` / `stopped`), so Jibril can say "No connection" instead of a misleading "Unclear".
- A "What's ahead?" result goes **only to the caller**, so it isn't spoken twice.
- Coming back to Safari re-takes the wake lock and restarts the camera if iOS stopped it.

### Step 7: `web/src/camera/voiceCommand.ts` ("SeeWalk, what's ahead?" out loud)

Safari's built-in speech recognition (`webkitSpeechRecognition`) was the first plan, but on Abdul's iPhone it fails instantly with `service-not-allowed`, with Siri, Dictation and Screen Time all correct. So we listen ourselves:

1. `getUserMedia({ audio })`: the same permission system as the camera.
2. `SpeechClipper` watches the loudness and cuts out **only the moments someone is speaking** (with 0.4 s of lead-in, ended by 0.7 s of quiet, max 4 s). Silence and short bangs are never sent.
3. Each clip → 16 kHz WAV → `POST /listen` → **Gemini transcribes it and decides** if it was "SeeWalk, what's ahead?" (EN or FR). One clip at a time; 3 s debounce.
4. Same interface as before (`createVoiceCommand(onCommand, onDebug?)` → `start(lang)`, `stop()`, `supported`), so Jibril's wiring doesn't change.

Verified: unit tests (clip cutting, WAV format, the whole flow with a fake mic); real speech through this exact code to the real server: "SeeWalk, what's ahead?" → command in 1.8 s, unrelated talk → ignored.

```ts
import { listen } from "../api/client";
import type { Lang } from "../api/types";

// "SeeWalk, what's ahead?" without Safari's speech recognition (iOS answers `service-not-allowed`
// on some iPhones). We capture the mic ourselves, cut out the moments someone is speaking, and
// send each clip to POST /listen, where Gemini decides whether it was the command (~1.5 s).
// Silence is never sent.

const TARGET_RATE = 16000;   // what we send: 16 kHz mono WAV (~32 KB per second)
const PRE_ROLL_S = 0.4;      // keep a little audio from before the speech started ("See…")
const MAX_CLIP_S = 4;        // longest clip we send
const END_SILENCE_S = 0.7;   // this much quiet ends a clip
const MIN_SPEECH_S = 0.35;   // shorter bursts (a cough, a door) are ignored

/** Splits a live mic signal into speech clips using its loudness (voice activity detection).
 *  Pure logic, so it's unit-tested without a microphone. */
export class SpeechClipper {
  private floor = 0.005; // running estimate of background noise
  private pre: Float32Array[] = [];
  private preLen = 0;
  private rec: Float32Array[] | null = null;
  private recLen = 0;
  private loudLen = 0;
  private quietLen = 0;
  private readonly rate: number;
  private readonly onClip: (clip: Float32Array) => void;

  constructor(rate: number, onClip: (clip: Float32Array) => void) {
    this.rate = rate;
    this.onClip = onClip;
  }

  /** Throw away anything recorded so far (e.g. SeeWalk itself was talking). */
  reset() {
    this.pre = [];
    this.preLen = 0;
    this.rec = null;
    this.recLen = 0;
    this.loudLen = 0;
    this.quietLen = 0;
  }

  push(buf: Float32Array) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(this.floor * 3, 0.01);

    if (!this.rec) {
      if (!loud) this.floor = this.floor * 0.95 + rms * 0.05;
      this.pre.push(buf);
      this.preLen += buf.length;
      while (this.pre.length > 1 && this.preLen - this.pre[0].length >= PRE_ROLL_S * this.rate) {
        this.preLen -= this.pre.shift()!.length;
      }
      if (loud) {
        this.rec = this.pre;
        this.recLen = this.preLen;
        this.pre = [];
        this.preLen = 0;
        this.loudLen = buf.length;
        this.quietLen = 0;
      }
      return;
    }

    this.rec.push(buf);
    this.recLen += buf.length;
    if (loud) {
      this.loudLen += buf.length;
      this.quietLen = 0;
    } else {
      this.quietLen += buf.length;
    }
    if (this.quietLen >= END_SILENCE_S * this.rate || this.recLen >= MAX_CLIP_S * this.rate) {
      const enough = this.loudLen >= MIN_SPEECH_S * this.rate;
      const clip = concat(this.rec, this.recLen);
      this.rec = null;
      this.recLen = 0;
      this.loudLen = 0;
      this.quietLen = 0;
      if (enough) this.onClip(clip);
    }
  }
}

function concat(parts: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/** Average-and-drop resampling (e.g. the iPhone's 48 kHz → 16 kHz). Good enough for speech. */
export function downsample(input: Float32Array, inRate: number, outRate = TARGET_RATE): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** 16-bit PCM mono WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);      // fmt chunk size
  v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, 1, true);       // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true);       // block align
  v.setUint16(34, 16, true);      // bits per sample
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface Session { active: boolean; stop: () => void }

/** onDebug (optional): reports what was heard, errors and state, for testing on the phone. */
export function createVoiceCommand(onCommand: () => void, onDebug?: (msg: string) => void) {
  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  let session: Session | null = null;
  let lastFired = 0;
  // While SeeWalk is speaking (and a moment after, for echo), the mic is ignored: in the iPhone
  // test ~30 of ~200 clips were SeeWalk hearing itself ("Nothing detected. Stop lying ahead.").
  const ECHO_TAIL_MS = 400;
  let speaking = false;
  let quietSince = 0;
  let clipperRef: SpeechClipper | null = null;

  /** Tell the listener when SeeWalk is making sound (AudioEngine.onSounding). */
  function setSpeaking(on: boolean) {
    speaking = on;
    if (on) clipperRef?.reset();
    else quietSince = Date.now();
  }

  /** Call inside a tap: iOS only lets the audio context start from a user gesture. */
  function start(lang: Lang): boolean {
    if (!supported) return false;
    stop();
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const s: Session = { active: true, stop: () => { s.active = false; void ctx.close().catch(() => {}); } };
    session = s;
    void run(s, ctx, lang);
    return true;
  }

  async function run(s: Session, ctx: AudioContext, lang: Lang) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      onDebug?.(`error: microphone ${(e as Error).name}`);
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const cleanup = () => {
      proc.onaudioprocess = null;
      source.disconnect();
      proc.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };
    if (!s.active) { cleanup(); return; } // stopped while the permission prompt was open
    s.stop = () => { s.active = false; cleanup(); };

    let checking = false; // one clip at a time
    const clipper = new SpeechClipper(ctx.sampleRate, (clip) => {
      if (checking) { onDebug?.("speech ignored (still checking the last one)"); return; }
      checking = true;
      const seconds = (clip.length / ctx.sampleRate).toFixed(1);
      onDebug?.(`speech ${seconds} s → checking`);
      listen(toBase64(encodeWav(downsample(clip, ctx.sampleRate), TARGET_RATE)), lang)
        .then((r) => {
          if (!s.active) return;
          onDebug?.(`heard "${r.heard}"${r.command ? " → trigger" : ""}`);
          if (r.command && Date.now() - lastFired > 3000) { // one question → one answer
            lastFired = Date.now();
            onCommand();
          }
        })
        .catch((e: Error) => onDebug?.(`error: ${e.message}`))
        .finally(() => { checking = false; });
    });

    clipperRef = clipper;
    proc.onaudioprocess = (e) => {
      if (!s.active) return;
      if (speaking || Date.now() - quietSince < ECHO_TAIL_MS) { clipper.reset(); return; }
      clipper.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(proc);
    proc.connect(ctx.destination); // Safari only runs the processor when it's connected; it outputs silence
    await ctx.resume().catch(() => {});
    onDebug?.(`listening (${ctx.state}, ${ctx.sampleRate} Hz)`);
  }

  function stop() {
    session?.stop();
    session = null;
  }

  return { supported, start, stop, setSpeaking };
}
```

**Call `voice.start(lang)` at the very top of the Start tap, before any `await`.** Safari only allows the mic (and audio) to start inside the tap itself; after an `await` it may refuse with `not-allowed`.

How Jibril wires it (in `WalkMode`):
```ts
const voiceRef = useRef<ReturnType<typeof createVoiceCommand> | null>(null);
const getVoice = () => (voiceRef.current ??= createVoiceCommand(() => whatsAheadRef.current()));
// FIRST lines of the Start tap, before any await:  const unlocking = audio.unlock(); getVoice().start(lang);
// on Stop:                                          getVoice().stop();
// on language switch while walking:                 getVoice().start(next);
```

**Needs `POST /listen` on the server** (`server/listen.py`, included by `server/main.py`; run `cd server && .venv/bin/uvicorn main:app --port 8000`). **Test it on the iPhone before building on it.** Check:
1. The first `start()` shows a microphone permission prompt; allow it.
2. Say "SeeWalk, what's ahead?" → the log shows `speech … → checking`, then `heard "…" → trigger`.
3. **With the Bluetooth headphones connected**, check that SeeWalk's voice still sounds normal. When a web page uses the mic, iOS may switch Bluetooth headphones into "call mode" (lower-quality audio), or route the mic through the headset.
4. It keeps working after SeeWalk speaks, and after ~1 minute of silence.

If 3 or 4 fails badly, **ship tap-anywhere only** and tell Jibril to hide the voice feature. Tap-anywhere plus VoiceOver is how blind users already operate their phones.

### Step 8: Test on the iPhone
1. Siddig's tunnel is running → open the `https://….trycloudflare.com` URL in **Safari** on the iPhone.
2. Tap Start → allow camera (and microphone for the voice command). The rear camera should be live, **portrait**.
3. In the Mac's Web Inspector console you should see a `SceneResult` each interval (add a `console.log` in `onResult` while testing).
4. **Airplane mode** → after 2 snapshots → `no_connection`. Off again → `connection_back`.
5. Cover the lens with a finger → `camera_blocked`. **Log `brightness` and `contrast` while you do it** and adjust `looksCovered` so a finger triggers it but a plain wall, sky or road doesn't.
6. Say "SeeWalk, what's ahead?" and tap the lower half of the screen → an answer within ~1.5 s, even mid-interval.
7. Tap Stop then Start quickly several times → the console shows only one request at a time.
8. Deny camera permission once (Settings → Safari → Camera → Deny) → tapping Start says "Camera blocked" instead of doing nothing.
9. Press the side button (screen off), wait 5 s, unlock → SeeWalk resumes on its own (camera + snapshots).
10. Hang the phone on the lanyard and walk: check the snapshots aren't mostly sky, ground, or your own chest when the phone spins (see gotchas).

### Step 9: Team duties
- [ ] Send the ElevenLabs key privately to the team (group DM, not public channels)
- [ ] **Before filming (Sat ~4 PM): enable billing** on the demo Gemini key (Google Cloud $300 trial or an MLH credit code), then set `VITE_FRAME_INTERVAL_MS=1500`
- [ ] Review PRs into `main`: check the contract wasn't changed silently, then merge
- [ ] Watch that nobody commits `.env` or keys

## 6. What Jibril gets from you

| From | Use |
|---|---|
| `useWalkLoop({ lang, onResult, onSystem })` | the loop |
| `.videoRef` | on `<video playsInline muted autoPlay>` |
| `.start()` / `.stop()` | Start / Stop taps. `start()` runs until Stop, so **don't `await` it**. It reports its own failures via `onSystem` |
| `.checkNow()` | "What's ahead?": resolves with `{ ok: true, result }` or `{ ok: false, reason: "no_connection" \| "camera_blocked" \| "stopped" }` |
| `createVoiceCommand(cb)` | `.start(lang)`, `.stop()`, `.supported`; create it lazily in a handler (see the wiring above) |
| `analyze()`, `tts()`, types | from `web/src/api/` |

## 7. Done when

- [ ] `types.ts` + `client.ts` + `mock.ts` pushed early Saturday
- [ ] iPhone Safari over HTTPS shows the live rear camera in portrait
- [ ] A `SceneResult` arrives every interval, never two requests at once
- [ ] Airplane mode → `no_connection` → back online → `connection_back`
- [ ] Covered lens → `camera_blocked`; normal daylight, a blank wall or sky never triggers it
- [ ] Camera permission denied → `camera_blocked` (never a silent Start)
- [ ] Rapid Stop/Start never creates two loops; nothing fires after Stop; Stop during the permission prompt leaves the camera off
- [ ] Switching apps and coming back doesn't say "Camera blocked" or "No connection"
- [ ] `VITE_MOCK_API` removed before filming
- [ ] Screen off → back on → SeeWalk resumes by itself
- [ ] "What's ahead?" (voice **and** tap) answers within ~1.5 s without doubling requests
- [ ] Voice command tested with Bluetooth headphones; either works or is switched off
- [ ] Screen stays awake while walking
- [ ] PR merged into `main`

## 8. Gotchas

| Problem | Fix |
|---|---|
| Camera prompt never appears | Page isn't HTTPS. Use the tunnel URL, not the laptop IP |
| Black video on iPhone | Missing `playsInline` / `muted`, or `video.play()` wasn't called after setting `srcObject` |
| Front camera instead of rear | `facingMode: { ideal: "environment" }` (not `"user"`) |
| `videoWidth` is 0 | Camera not ready yet; `captureFrame` returns `null` and the loop just waits |
| Everything is slow / 503s | Free-tier limits; use `VITE_FRAME_INTERVAL_MS=5000` until billing is on |
| Hear "No connection" while Wi-Fi is fine | The server returns 503 when Gemini **rate-limits** (free tier) too. Check Aroha's server log; slow the interval or turn billing on |
| Voice replies play quietly from the earpiece (no headphones) | iOS routes audio to the earpiece while the mic is active. Test with and without headphones; if it's bad, turn the voice command off |
| Voice command never fires | Check the lab log: no `speech …` lines = mic too quiet or permission denied; `error: listen 503` = server/Gemini problem (start `uvicorn main:app` / check the server log); `heard "…"` without trigger = Gemini didn't hear the wake word. Set `SEEWALK_SAVE_AUDIO=/tmp/last.wav` on the server to listen to the last clip |
| Why not Safari's speech recognition? | On Abdul's iPhone it returns `service-not-allowed` instantly, even with Siri and Dictation on |
| Headphone audio goes muffled when the mic is on | iOS "call mode". Turn the voice command off; tap-anywhere still works |
| "Camera blocked" at dusk | Out of scope (daylight only). Film before ~6:45 PM |
| Phone gets hot | Expected with camera + network + mic; take breaks between takes |
| Phone spins on the lanyard and films your chest | Use a lanyard case with two attachment points, or tape it to a strap; `looksCovered` catches some of it |
| Screen locks mid-walk | Safari freezes the page: no snapshots and **no voice** (nothing can warn the walker). Wake lock prevents most of it; for filming also set Settings → Display → Auto-Lock → Never |
| Two Start taps in a row | Handled by the generation check; if you ever see two requests in flight, that's the bug |

## 9. Stretch: COCO-SSD fast layer ✅ built

Gemini takes ~1.5 s. A bike covers ~8 m in that time. COCO-SSD runs **on the phone** and spots people, bikes and cars in ~25–30 ms per check (4 checks a second).

**Verified:** 11 tracker tests (mutation-checked); on Abdul's iPhone a teammate walking toward the phone from the left, right and straight on was caught with the right direction, approaching, and urgent when close (90–99 % confidence); headless Chrome with a fake camera feed of a bike getting closer → "Bike ahead ↗" (approaching), urgency 1 once close, 24–31 ms per check. The model took ~19 s to load cold, so **it's preloaded when the screen opens**; with preloading, Start waited 0.0 s and the first warning came ~1.5 s after Start.

### How it works
1. `FastTracker` (pure logic, `web/src/detection/tracker.ts`) follows each person/bike/car between checks by box overlap, per type.
2. **Approaching** = its box grew ≥ 20 % over ~0.6 s. **Close** = box taller than 60 % of the frame.
3. It only reports things that are **near or close AND (approaching or close)**, with urgency 1 if approaching and close, and a direction from the box centre (thirds). **Far objects are ignored**: on the iPhone, distant passers-by's small boxes jittered and looked like "approaching".
4. **Each object is announced once**, and again only if it escalates to urgent. On the iPhone, one person walking past was announced as ahead, then left, then right.
5. Phrases are **exactly the bundled clip text** ("Bike on your left"), so Jibril's `speak()` plays the clip instantly instead of calling `/tts`.
6. `fastLayer.ts` loads TensorFlow.js + COCO-SSD (`lite_mobilenet_v2`) with a dynamic import (a separate ~276 KB gzipped download, so other pages don't pay for it), runs every 250 ms on the camera video, skips while the page is hidden, and survives a failed detection.

### Wiring (Jibril's WalkMode)
```ts
// when the walk screen opens (downloads the model in the background):
useEffect(() => { void import("../detection/fastLayer").then((m) => m.preloadFastLayer()); }, []);
// after walk.start(), once the video is playing:
const { startFastLayer } = await import("../detection/fastLayer");
const stopFast = await startFastLayer(videoRef.current!, () => langRef.current, onResult);
// on Stop: stopFast();
```
Its results go into the **same `onResult`** as Gemini's; `pickAlert` dedupes and ranks them together.

### `web/src/detection/tracker.ts`

```ts
import clips from "../audio/clips.json";
import type { Hazard, Lang } from "../api/types";

// Pure logic for the fast layer: turns COCO-SSD boxes into hazards. No TensorFlow here,
// so every rule is unit-tested without a camera or a model.

export type FastType = "person" | "bike" | "car";

/** COCO-SSD class → our hazard type. Everything else (chairs, dogs, ...) is Gemini's job. */
export const CLASS_TO_TYPE: Record<string, FastType> = {
  person: "person",
  bicycle: "bike",
  motorcycle: "bike",
  car: "car",
  truck: "car",
  bus: "car",
};

export interface Detection {
  type: FastType;
  box: [number, number, number, number]; // x, y, width, height in video pixels
  score: number;
}

interface Track {
  id: number;
  type: FastType;
  box: Detection["box"];
  seen: { t: number; area: number }[]; // recent sizes, to tell if it's getting closer
  lastSeen: number;
  announced: 0 | 1 | 2; // most urgent level already reported for this object (0 = not yet)
}

const MATCH_IOU = 0.25;        // same object if the boxes overlap this much between checks
const FORGET_MS = 1000;        // drop objects not seen for this long
const APPROACH_WINDOW_MS = 600; // compare size now vs ~0.6 s ago
const APPROACH_GROWTH = 1.2;    // 20 % bigger in that time = coming toward the walker
const CLOSE_HEIGHT = 0.6;       // box taller than 60 % of the frame = close
const NEAR_HEIGHT = 0.3;

function iou(a: Detection["box"], b: Detection["box"]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** Follows each person/bike/car from one check to the next and reports the ones that matter. */
export class FastTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /** One detection pass → hazards worth announcing (approaching or close). */
  update(dets: Detection[], frameW: number, frameH: number, t: number, lang: Lang): Hazard[] {
    const unmatched = new Set(this.tracks);
    const hazards: Hazard[] = [];

    for (const d of [...dets].sort((a, b) => b.score - a.score)) {
      let best: Track | null = null;
      let bestIou = MATCH_IOU;
      for (const tr of unmatched) {
        if (tr.type !== d.type) continue;
        const o = iou(tr.box, d.box);
        if (o > bestIou) { best = tr; bestIou = o; }
      }
      const area = d.box[2] * d.box[3];
      let track: Track;
      if (best) {
        unmatched.delete(best);
        track = best;
        track.box = d.box;
        track.lastSeen = t;
        track.seen.push({ t, area });
        track.seen = track.seen.filter((s) => t - s.t <= APPROACH_WINDOW_MS * 2);
      } else {
        track = { id: this.nextId++, type: d.type, box: d.box, seen: [{ t, area }], lastSeen: t, announced: 0 };
        this.tracks.push(track);
      }

      const past = track.seen.find((s) => t - s.t >= APPROACH_WINDOW_MS);
      const approaching = !!past && area >= past.area * APPROACH_GROWTH;
      const heightRatio = d.box[3] / frameH;
      const distance = heightRatio > CLOSE_HEIGHT ? "close" : heightRatio > NEAR_HEIGHT ? "near" : "far";
      // Far objects are Gemini's job: tiny boxes jitter, which looks like "growing" (iPhone test:
      // distant passers-by were flagged as approaching). Otherwise: only what's coming at you,
      // or right there.
      if (distance === "far" || (!approaching && distance !== "close")) continue;
      const urgency: 1 | 2 = approaching && distance === "close" ? 1 : 2;
      // Say each object once, and again only if it becomes urgent (iPhone test: one person
      // walking past was announced as ahead, then left, then right).
      if (track.announced !== 0 && urgency >= track.announced) continue;
      track.announced = urgency;

      const cx = (d.box[0] + d.box[2] / 2) / frameW;
      const direction = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "ahead";
      const key = `${d.type}_${direction}`;
      hazards.push({
        type: d.type,
        direction,
        distance,
        approaching,
        urgency,
        confidence: d.score,
        // Exactly the bundled clip's text, so Jibril's speak() plays the clip instantly (no /tts)
        phrase: (clips as Record<string, Record<Lang, string>>)[key][lang],
      });
    }

    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= FORGET_MS);
    return hazards;
  }

  reset() {
    this.tracks = [];
  }
}
```

### `web/src/detection/fastLayer.ts`

```ts
import "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { Lang, SceneResult } from "../api/types";
import { CLASS_TO_TYPE, FastTracker, type Detection } from "./tracker";

// Fast layer: COCO-SSD on the phone spots people, bikes and cars ~4 times a second (~0.1–0.3 s),
// long before Gemini's ~1.5 s answer. Results go into the same onResult as Gemini's.
// Load with a dynamic import so TensorFlow.js (~1 MB) is only downloaded when it's used:
//   const { startFastLayer } = await import("../detection/fastLayer");

const TICK_MS = 250;

// The model download + GPU warm-up took ~19 s on first load in testing, so start it early:
// call preloadFastLayer() when the walk screen opens, and Start finds the model ready.
let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;
export function preloadFastLayer(): Promise<cocoSsd.ObjectDetection> {
  if (!modelPromise) {
    const t0 = performance.now();
    modelPromise = cocoSsd.load({ base: "lite_mobilenet_v2" }).then((m) => {
      console.info(`fast layer: model ready in ${Math.round(performance.now() - t0)} ms`);
      return m;
    });
    modelPromise.catch(() => { modelPromise = null; }); // allow a retry after a failed download
  }
  return modelPromise;
}

export interface FastLayerStats {
  loadMs: number;       // how long Start waited for the model (0 if it was preloaded)
  lastDetectMs: number; // time for the latest detection pass
}

/** Starts detecting on the (already playing) camera video. Resolves to a stop function. */
export async function startFastLayer(
  video: HTMLVideoElement,
  getLang: () => Lang,
  onResult: (r: SceneResult) => void,
  onStats?: (s: FastLayerStats) => void,
): Promise<() => void> {
  const t0 = performance.now();
  const model = await preloadFastLayer();
  // loadMs = how long Start actually waited (0 if preloaded in time)
  const stats: FastLayerStats = { loadMs: Math.round(performance.now() - t0), lastDetectMs: 0 };
  const tracker = new FastTracker();
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (!running) return;
    if (video.videoWidth && video.readyState >= 2 && !document.hidden) {
      try {
        const t = performance.now();
        const preds = await model.detect(video, 6, 0.5);
        stats.lastDetectMs = Math.round(performance.now() - t);
        onStats?.(stats);
        const dets: Detection[] = [];
        for (const p of preds) {
          const type = CLASS_TO_TYPE[p.class];
          if (type) dets.push({ type, box: p.bbox, score: p.score });
        }
        const hazards = tracker.update(dets, video.videoWidth, video.videoHeight, t, getLang());
        if (running && hazards.length) onResult({ hazards, unclear: false });
      } catch (e) {
        console.warn("fast layer: detection failed, will retry", e); // one bad frame must not stop it
      }
    }
    if (running) timer = setTimeout(tick, TICK_MS);
  }
  onStats?.(stats);
  void tick();

  return () => {
    running = false;
    clearTimeout(timer);
    tracker.reset(); // keep the model loaded for the next Start
  };
}
```

For the video: a teammate walking quickly toward the camera shows off the fast layer ("Person ahead" before Gemini would have answered).
