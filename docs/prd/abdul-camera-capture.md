# PRD: Camera + Capture (Abdul)

> Read [the shared contract](README.md) first. You produce the `/analyze` requests and the phone-side events.

## 1. Summary

You own the **eyes** of the app: turn the iPhone's live rear camera into a steady stream of snapshots, send each one to `/analyze`, hand the results to Jibril's UI, and **notice when something breaks** (no connection, camera blocked).

You also own the shared **TypeScript types and API client** that everyone imports. You also handle keys, billing and merging PRs.

```
<video> live feed ──every ~1.5 s──► captureFrame() ──► analyze(image, prevImage, lang) ──► onResult(result)  → Jibril
                                         │                        │ fails ×2
                                   too dark ×2                    └────────────────────► onSystem("no_connection") → Jibril
                                         └──────────────────────────────────────────────► onSystem("camera_blocked")
```

**It's snapshots, not video.** The `<video>` element shows the live feed on screen, and we copy one frame at a time to a canvas. Nothing is saved to the camera roll.

## 2. Depends on

- **Jibril's `web/` scaffold** (first thing Saturday). Until it lands, prototype in a scratch Vite app or a single HTML file.
- **Siddig's HTTPS tunnel**: iPhone Safari only allows the camera on `https://` (or `localhost`, which the phone can't use).
- **Aroha's `/analyze`**: until it's up, fake it (see Step 3).

## 3. Setup

```bash
cd SeeWalk && git checkout Abduls-Work && git pull origin main
cd web && npm install && npm run dev        # after Jibril's scaffold is on main
```

Create `web/.env.local` (git-ignored by Vite):
```
VITE_FRAME_INTERVAL_MS=5000
```
Use `5000` during development to stay under the Gemini free tier; `1500` for filming.

## 4. Step-by-step

### Step 1: `web/src/api/types.ts` (shared types, everyone imports these)

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

**Push this early** (even before the rest works) so Jibril can code against it.

### Step 2: `web/src/api/client.ts`

```ts
import type { Lang, SceneResult } from "./types";

const BASE = "/api"; // Vite proxies /api → http://localhost:8000

export async function analyze(
  image: string,
  prevImage: string | null,
  lang: Lang,
  signal?: AbortSignal,
): Promise<SceneResult> {
  const r = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, prev_image: prevImage, lang }),
    signal,
  });
  if (!r.ok) throw new Error(`analyze ${r.status}`);
  return r.json();
}

export async function tts(text: string, lang: Lang, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(`${BASE}/tts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, lang }),
    signal,
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  return r.arrayBuffer();
}
```

### Step 3: Fake backend while Aroha builds the real one

Add `web/src/api/mock.ts` and switch with `VITE_MOCK_API=1` in `.env.local`:

```ts
import type { SceneResult } from "./types";

const samples: SceneResult[] = [
  { hazards: [], unclear: false },
  { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Stop sign ahead" }], unclear: false },
  { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Car on your right" }], unclear: false },
];
let i = 0;
export async function mockAnalyze(): Promise<SceneResult> {
  await new Promise((r) => setTimeout(r, 1200)); // pretend Gemini takes 1.2 s
  return samples[i++ % samples.length];
}
```

### Step 4: `web/src/camera/captureFrame.ts`

```ts
const frameCanvas = document.createElement("canvas");
const tinyCanvas = document.createElement("canvas");
tinyCanvas.width = tinyCanvas.height = 32;

export interface Frame {
  b64: string;        // JPEG, no "data:" prefix
  brightness: number; // 0 (black) – 255 (white)
}

export function captureFrame(video: HTMLVideoElement, maxEdge = 768): Frame | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null; // camera not ready yet

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  frameCanvas.width = Math.round(w * scale);
  frameCanvas.height = Math.round(h * scale);
  frameCanvas.getContext("2d")!.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  const b64 = frameCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];

  const tiny = tinyCanvas.getContext("2d", { willReadFrequently: true })!;
  tiny.drawImage(video, 0, 0, 32, 32);
  const px = tiny.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  return { b64, brightness: sum / (px.length / 4) };
}
```

A 768 px JPEG at q0.7 is ~60–100 KB, small enough to upload quickly on campus Wi-Fi.

### Step 5: `web/src/camera/useCamera.ts`

```ts
import { useCallback, useRef } from "react";

export function useCamera(onBlocked: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    streamRef.current = stream;
    stream.getVideoTracks()[0].addEventListener("ended", onBlocked);
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play();
  }, [onBlocked]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  return { videoRef, start, stop };
}
```

The `<video>` element (Jibril renders it, you pass the ref) **must** have `playsInline muted autoPlay`, or iOS opens it fullscreen or refuses to play.

### Step 6: `web/src/camera/useWalkLoop.ts` (the heart of your piece)

```ts
import { useCallback, useRef } from "react";
import { analyze } from "../api/client";
import type { Lang, SceneResult, SystemEvent } from "../api/types";
import { captureFrame } from "./captureFrame";
import { useCamera } from "./useCamera";

const INTERVAL_MS = Number(import.meta.env.VITE_FRAME_INTERVAL_MS ?? 1500);
const TIMEOUT_MS = 5000;
const DARK = 12;             // average brightness below this = lens covered
const NO_CONN_REPEAT_MS = 20000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const running = useRef(false);
  const prevFrame = useRef<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const analyzeOnce = useCallback(async (): Promise<SceneResult | null> => {
    const frame = captureFrame(camera.videoRef.current!);
    if (!frame) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const result = await analyze(frame.b64, prevFrame.current, langRef.current, ctrl.signal);
      prevFrame.current = frame.b64;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }, [camera.videoRef]);

  const start = useCallback(async () => {
    await camera.start();
    running.current = true;
    prevFrame.current = null;
    try { wakeLock.current = await navigator.wakeLock?.request("screen"); } catch { /* not allowed, fine */ }

    let fails = 0;
    let lastNoConn = 0;
    let darkCount = 0;

    while (running.current) {
      const roundStart = performance.now();
      const frame = captureFrame(camera.videoRef.current!);

      if (frame) {
        darkCount = frame.brightness < DARK ? darkCount + 1 : 0;
        if (darkCount === 2) onSystemRef.current("camera_blocked");

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          const result = await analyze(frame.b64, prevFrame.current, langRef.current, ctrl.signal);
          if (fails >= 2) onSystemRef.current("connection_back");
          fails = 0;
          if (running.current) onResultRef.current(result);
        } catch {
          fails += 1;
          const now = Date.now();
          if (fails === 2 || (fails > 2 && now - lastNoConn > NO_CONN_REPEAT_MS)) {
            onSystemRef.current("no_connection");
            lastNoConn = now;
          }
        } finally {
          clearTimeout(timer);
        }
        prevFrame.current = frame.b64;
      }

      const wait = INTERVAL_MS - (performance.now() - roundStart);
      if (wait > 0) await sleep(wait);
    }
  }, [camera]);

  const stop = useCallback(() => {
    running.current = false;
    camera.stop();
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, [camera]);

  return { videoRef: camera.videoRef, start, stop, analyzeOnce };
}
```

What Jibril gets from you:
- `videoRef`: put on the `<video playsInline muted autoPlay>`
- `start()`: call **inside** the Start button's tap handler (after unlocking audio)
- `stop()`: Stop button
- `analyzeOnce()`: for the "What's ahead?" button
- `onResult` / `onSystem`: callbacks Jibril passes in

Key rules baked in: **one request in flight**, 5 s timeout, the next snapshot waits for the previous answer, and `prevFrame` is sent so Gemini can see motion.

### Step 7: Test on an iPhone
1. Siddig's tunnel is running → open the `https://….trycloudflare.com` URL in **Safari** on the iPhone.
2. Tap Start → allow camera. The rear camera should be live.
3. Connect the iPhone to your Mac with a cable → Mac Safari → **Develop → [your iPhone] → the page** → Console. You should see a `SceneResult` logged each interval (add a `console.log` in `onResult` while testing).
4. **Airplane mode** on the iPhone → after 2 snapshots → `no_connection`. Off again → `connection_back`.
5. Cover the lens with a finger → `camera_blocked`.

(Enable the Develop menu: Mac Safari → Settings → Advanced → "Show features for web developers". On the iPhone: Settings → Safari → Advanced → Web Inspector on.)

### Step 8: Team duties
- [ ] Send the ElevenLabs key privately to the team (group DM, not public channels)
- [ ] **Before filming (Sat ~4 PM): enable billing** on the demo Gemini key (Google Cloud $300 trial or an MLH credit code), then set `VITE_FRAME_INTERVAL_MS=1500`
- [ ] Review PRs into `main`: check the contract wasn't changed silently, then merge
- [ ] Watch that nobody commits `.env` or keys

## 5. Done when

- [ ] `types.ts` + `client.ts` pushed early; Jibril and Aroha use the same shapes
- [ ] iPhone Safari over HTTPS shows the live rear camera
- [ ] A `SceneResult` arrives every interval, never two requests at once
- [ ] Airplane mode → `no_connection` → back online → `connection_back`
- [ ] Covered lens → `camera_blocked`
- [ ] Screen stays awake while walking
- [ ] PR merged into `main`

## 6. Gotchas

| Problem | Fix |
|---|---|
| Camera prompt never appears | Page isn't HTTPS. Use the tunnel URL, not the laptop IP |
| Black video on iPhone | Missing `playsInline` / `muted`, or `video.play()` wasn't called after setting `srcObject` |
| Front camera instead of rear | `facingMode: { ideal: "environment" }` (not `"user"`) |
| `videoWidth` is 0 | Camera not ready yet; `captureFrame` returns `null` and the loop just waits |
| Everything is slow / 503s | Free-tier limits; use `VITE_FRAME_INTERVAL_MS=5000` until billing is on |
| Phone gets hot | Expected with camera + network; lower resolution to `width: { ideal: 960 }` if needed |

## 7. Stretch
- **COCO-SSD fast layer** (`web/src/detection/`): TensorFlow.js on-device detection of person/bike/car ~5×/s, feeding Jibril's `pickAlert` directly for ~0.2 s warnings.
- **"Ask" button**: hold to record a question with `MediaRecorder`, send with the current snapshot to an `/ask` endpoint (needs Aroha).
