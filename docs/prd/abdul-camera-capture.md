# PRD: Camera + Capture (Abdul)

> Read [the shared contract](README.md) first. You produce the `/analyze` requests, the phone-side events, and the hands-free "What's ahead?" voice command.

## 1. Summary

You own the **eyes and ears** of the app:
- Turn the iPhone's live rear camera into a steady stream of **snapshots** and send each one to `/analyze`
- Hand the results to Jibril's UI and **notice when something breaks** (no connection, camera blocked)
- Let the walker ask **"What's ahead?" out loud**, without touching or seeing the screen
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
| Voice trigger phrase | **"What's ahead?"** (FR: "Qu'y a-t-il devant ?"), no wake word |
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
```

**Push this within the first hour Saturday** so Jibril codes against the same shapes.

### Step 2: `web/src/api/client.ts`

```ts
import type { Lang, SceneResult } from "./types";
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
 *  Tune both numbers on the real iPhone (log them while covering/uncovering the lens). */
export const looksCovered = (f: Frame) => f.brightness < 12 || (f.contrast < 8 && f.brightness < 90);
```

A 768 px JPEG at q0.7 is ~50–70 KB (same as the files in `samples/`), quick to upload on campus Wi-Fi. With the previous frame included, each request uploads ~150 KB, about **6 MB a minute** at a 1.5 s interval; fine on Wi-Fi or a phone hotspot.

### Step 5: `web/src/camera/useCamera.ts`

```ts
import { useCallback, useMemo, useRef } from "react";

export function useCamera(onEnded: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onEndedRef = useRef(onEnded); onEndedRef.current = onEnded;

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
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  // refs so the running loop always sees the latest props
  const langRef = useRef(lang); langRef.current = lang;
  const onResultRef = useRef(onResult); onResultRef.current = onResult;
  const onSystemRef = useRef(onSystem); onSystemRef.current = onSystem;

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

### Step 7: `web/src/camera/voiceCommand.ts` ("What's ahead?" out loud)

Uses Safari's built-in speech recognition (the same engine as iPhone dictation).

```ts
import type { Lang } from "../api/types";

// Each trigger lists words that must ALL appear. SeeWalk's own phrases (spoken by Gemini's
// "phrase" field, which can be free-form) leak out of open-ear headphones, so the triggers use
// question words our alerts never contain: "what" in English, "qu'y a" / "qu'est-ce" / "quoi" in French.
const TRIGGERS: Record<Lang, string[][]> = {
  en: [["what", "ahead"], ["what", "front"]],
  fr: [["qu'y a", "devant"], ["qu'est-ce", "devant"], ["quoi", "devant"]],
};

export function createVoiceCommand(onCommand: () => void) {
  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  let rec: any = null;
  let active = false;
  let lastFired = 0;

  function start(lang: Lang): boolean {
    if (!Recognition) return false;
    stop();
    active = true;
    rec = new Recognition();
    rec.lang = lang === "fr" ? "fr-CA" : "en-CA";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript.toLowerCase().replace(/[’`]/g, "'");
      const hit = TRIGGERS[lang].some((words) => words.every((w) => text.includes(w)));
      if (hit && Date.now() - lastFired > 3000) { // one question → one answer
        lastFired = Date.now();
        onCommand();
      }
    };
    // iOS stops listening after silence or after we play audio: restart it
    rec.onend = () => {
      if (active) setTimeout(() => { try { rec?.start(); } catch { /* already running */ } }, 300);
    };
    rec.onerror = (e: any) => {
      console.warn("voice command:", e.error);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") active = false; // mic refused: give up
    };
    rec.start();
    return true;
  }

  function stop() {
    active = false;
    rec?.abort();
    rec = null;
  }

  return { supported: !!Recognition, start, stop };
}
```

**Call `voice.start(lang)` at the very top of the Start tap, before any `await`.** Safari only allows the mic (and audio) to start inside the tap itself; after an `await` it may refuse with `not-allowed`.

How Jibril wires it (in `WalkMode`):
```ts
const voice = useMemo(() => createVoiceCommand(() => whatsAheadRef.current()), []);
// FIRST lines of the Start tap, before any await:  const unlocking = audio.unlock(); voice.start(lang);
// on Stop:                                          voice.stop();
// on language switch while walking:                 voice.start(next);
```

**This is the riskiest piece. Test it on the iPhone early (Saturday morning), before building on it.** Check:
1. The first `start()` shows a microphone permission prompt; allow it. Siri & Dictation must be enabled on the iPhone.
2. Say "What's ahead?" → `onCommand` fires (log it).
3. **With the Bluetooth headphones connected**, check that SeeWalk's voice still sounds normal. When a web page uses the mic, iOS may switch Bluetooth headphones into "call mode" (lower-quality audio), or route the mic through the headset.
4. It keeps working after SeeWalk speaks, and after ~1 minute of silence.

If 3 or 4 fails badly, **ship tap-anywhere only** and tell Jibril to hide the voice feature. Tap-anywhere plus VoiceOver is how blind users already operate their phones.

### Step 8: Test on the iPhone
1. Siddig's tunnel is running → open the `https://….trycloudflare.com` URL in **Safari** on the iPhone.
2. Tap Start → allow camera (and microphone for the voice command). The rear camera should be live, **portrait**.
3. In the Mac's Web Inspector console you should see a `SceneResult` each interval (add a `console.log` in `onResult` while testing).
4. **Airplane mode** → after 2 snapshots → `no_connection`. Off again → `connection_back`.
5. Cover the lens with a finger → `camera_blocked`. **Log `brightness` and `contrast` while you do it** and adjust `looksCovered` so a finger triggers it but a plain wall, sky or road doesn't.
6. Say "What's ahead?" and tap the lower half of the screen → an answer within ~1.5 s, even mid-interval.
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
| `createVoiceCommand(cb)` | `.start(lang)`, `.stop()`, `.supported` |
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
| Voice command never fires | Siri & Dictation off, mic permission denied, or recognition stopped: check `onerror` in the console |
| Headphone audio goes muffled when the mic is on | iOS "call mode". Turn the voice command off; tap-anywhere still works |
| "Camera blocked" at dusk | Out of scope (daylight only). Film before ~6:45 PM |
| Phone gets hot | Expected with camera + network + mic; take breaks between takes |
| Phone spins on the lanyard and films your chest | Use a lanyard case with two attachment points, or tape it to a strap; `looksCovered` catches some of it |
| Screen locks mid-walk | Safari freezes the page: no snapshots and **no voice** (nothing can warn the walker). Wake lock prevents most of it; for filming also set Settings → Display → Auto-Lock → Never |
| Two Start taps in a row | Handled by the generation check; if you ever see two requests in flight, that's the bug |

## 9. Stretch: COCO-SSD fast layer (only after "Done when" is all ✅)

Gemini takes ~1.5 s. A bike covers ~8 m in that time. COCO-SSD runs **on the phone** and spots people, bikes and cars in ~0.1–0.2 s.

1. Install:
   ```bash
   cd web && npm install @tensorflow/tfjs @tensorflow-models/coco-ssd
   ```
2. `web/src/detection/fastLayer.ts`:
   ```ts
   import "@tensorflow/tfjs";
   import * as cocoSsd from "@tensorflow-models/coco-ssd";
   import clips from "../audio/clips.json";
   import type { Hazard, Lang, SceneResult } from "../api/types";

   const CLASS_TO_TYPE: Record<string, "person" | "bike" | "car"> = {
     person: "person", bicycle: "bike", motorcycle: "bike", car: "car", truck: "car", bus: "car",
   };

   export async function startFastLayer(
     video: HTMLVideoElement,
     getLang: () => Lang,
     onResult: (r: SceneResult) => void,
   ) {
     const model = await cocoSsd.load({ base: "lite_mobilenet_v2" }); // small, fast
     const lastArea = new Map<string, number>();
     let running = true;

     async function tick() {
       if (!running) return;
       const preds = await model.detect(video, 5, 0.6);
       const hazards: Hazard[] = [];
       for (const p of preds) {
         const type = CLASS_TO_TYPE[p.class];
         if (!type) continue;
         const [x, , w, h] = p.bbox;
         const cx = (x + w / 2) / video.videoWidth;
         const direction = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "ahead";
         const heightRatio = h / video.videoHeight;
         const distance = heightRatio > 0.6 ? "close" : heightRatio > 0.3 ? "near" : "far";
         const key = `${type}_${direction}`;
         const area = w * h;
         const approaching = area > (lastArea.get(key) ?? Infinity) * 1.15; // grew >15% since last tick
         lastArea.set(key, area);
         if (!approaching && distance !== "close") continue; // only what's coming at you or right there
         hazards.push({
           type, direction, distance, approaching,
           urgency: distance === "close" && approaching ? 1 : 2,
           confidence: p.score,
           phrase: (clips as Record<string, Record<Lang, string>>)[key][getLang()],
         });
       }
       if (hazards.length) onResult({ hazards, unclear: false });
       setTimeout(tick, 250); // ~4 checks per second
     }
     tick();
     return () => { running = false; };
   }
   ```
3. Start it after the camera starts (same `video` element), stop it on Stop (call the function `startFastLayer` resolves to), and feed Jibril's `onResult`. His `pickAlert` already dedupes and ranks it alongside Gemini's results, and because these phrases **exactly match the bundled clips**, his `speak` plays the clip instantly instead of calling `/tts`.
4. Test on the iPhone: first load downloads the model (a few MB), then watch for heat and battery drain. If it's too slow, raise the tick to 500 ms.

For the video: a teammate walking quickly toward the camera shows off the fast layer ("Person ahead" before Gemini would have answered).
