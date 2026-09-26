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
"What's ahead?" (voice) or tap ──► checkNow() ──► next snapshot immediately ──► result to the caller ──► Jibril speaks it
```

**It's snapshots, not video.** The `<video>` element shows the live feed on screen, and we copy one frame at a time to a canvas. Nothing is saved to the camera roll.

## 2. Decisions (agreed Sept 26)

| Question | Decision |
|---|---|
| How the phone is worn | **Portrait, on a chest lanyard.** Snapshots come out 576×768 |
| "What's ahead?" trigger | **Voice command** (your code) + **tap anywhere on the lower half of the screen** (Jibril's UI). Real Siri can't control a web app; that would need a native iOS app |
| "What's ahead?" while the loop runs | **Jump the queue**: skip the wait and take the next snapshot now. Still one request at a time |
| Skip blurry / unchanged frames? | **No.** Send every snapshot; keep it simple |
| Night | **Daylight only** (V0 scope). Only a covered lens counts as "camera blocked" |
| Testing | iPhone + Mac with a cable (Safari Web Inspector) |
| Stretch | **COCO-SSD fast layer** |

## 3. Depends on

- **Jibril's `web/` scaffold** (first thing Saturday). Until it lands, prototype in a scratch Vite app.
- **Siddig's HTTPS tunnel**: iPhone Safari only allows the camera and microphone on `https://`.
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
- `VITE_MOCK_API=1` until Aroha's server is up; delete the line after.

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
const MOCK = import.meta.env.VITE_MOCK_API === "1";

export async function analyze(
  image: string,
  prevImage: string | null,
  lang: Lang,
  signal?: AbortSignal,
): Promise<SceneResult> {
  if (MOCK) return mockAnalyze();
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

### Step 3: `web/src/api/mock.ts` (fake backend)

```ts
import type { SceneResult } from "./types";

const samples: SceneResult[] = [
  { hazards: [], unclear: false },
  { hazards: [{ type: "stop_sign", direction: "ahead", distance: "near", urgency: 3, confidence: 0.93, approaching: false, phrase: "Stop sign ahead" }], unclear: false },
  { hazards: [{ type: "car", direction: "right", distance: "near", urgency: 1, confidence: 0.91, approaching: true, phrase: "Car on your right" }], unclear: false },
  { hazards: [], unclear: true },
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
  frameCanvas.width = Math.round(w * scale);   // portrait phone → 576 × 768
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

A 768 px JPEG at q0.7 is ~50–70 KB (same as the files in `samples/`), quick to upload on campus Wi-Fi. `samples/` holds real examples of what Gemini will receive.

### Step 5: `web/src/camera/useCamera.ts`

```ts
import { useCallback, useRef } from "react";

export function useCamera(onBlocked: () => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }, // rear camera; iOS gives a portrait stream when held upright
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
const COVERED = 12;            // average brightness below this = lens covered (daylight scope)
const NO_CONN_REPEAT_MS = 20000;

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
  const cutWaitShort = useRef<(() => void) | null>(null);
  const askers = useRef<((r: SceneResult | null) => void)[]>([]);

  /** "What's ahead?": take the next snapshot right away and resolve with its result. */
  const checkNow = useCallback(
    () =>
      new Promise<SceneResult | null>((resolve) => {
        if (!running.current) return resolve(null);
        askers.current.push(resolve);
        cutWaitShort.current?.();
      }),
    [],
  );

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
      const asked = askers.current.splice(0); // people waiting on THIS snapshot
      let result: SceneResult | null = null;
      const frame = captureFrame(camera.videoRef.current!);

      if (frame) {
        darkCount = frame.brightness < COVERED ? darkCount + 1 : 0;
        if (darkCount === 2) onSystemRef.current("camera_blocked");

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          result = await analyze(frame.b64, prevFrame.current, langRef.current, ctrl.signal);
          if (fails >= 2) onSystemRef.current("connection_back");
          fails = 0;
          // If someone asked "What's ahead?", they get this result and speak it themselves
          if (running.current && asked.length === 0) onResultRef.current(result);
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
      asked.forEach((resolve) => resolve(result));

      // Wait out the interval, unless "What's ahead?" cuts it short
      const wait = INTERVAL_MS - (performance.now() - roundStart);
      if (wait > 0 && askers.current.length === 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, wait);
          cutWaitShort.current = () => { clearTimeout(t); resolve(); };
        });
      }
      cutWaitShort.current = null;
    }
    askers.current.splice(0).forEach((resolve) => resolve(null));
  }, [camera]);

  const stop = useCallback(() => {
    running.current = false;
    cutWaitShort.current?.();
    camera.stop();
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, [camera]);

  return { videoRef: camera.videoRef, start, stop, checkNow };
}
```

Rules baked in:
- **One request in flight**, 5 s timeout; the next snapshot waits for the previous answer.
- `prevFrame` is sent so Gemini can see what's **approaching**.
- **"What's ahead?" jumps the queue**: if a request is in flight, it answers with the very next one; if the loop is waiting, it stops waiting.
- A "What's ahead?" result goes **only to the caller** (who speaks it even if it's a repeat, or says "Unclear"), so it isn't spoken twice.

### Step 7: `web/src/camera/voiceCommand.ts` ("What's ahead?" out loud)

Uses Safari's built-in speech recognition (the same engine as iPhone dictation). Jibril calls `voice.start(lang)` inside the Start tap and `voice.stop()` on Stop.

```ts
import type { Lang } from "../api/types";

// The walker's question must contain BOTH words, so SeeWalk's own phrases leaking out of
// open-ear headphones ("Pothole ahead") never trigger it: none of them contain "what".
const TRIGGERS: Record<Lang, [string, string][]> = {
  en: [["what", "ahead"], ["what", "front"]],
  fr: [["qu", "devant"]], // "Qu'y a-t-il devant ?", "Qu'est-ce qu'il y a devant ?"
};

export function createVoiceCommand(onCommand: () => void) {
  const Recognition =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  let rec: any = null;
  let active = false;

  function start(lang: Lang): boolean {
    if (!Recognition) return false;
    stop();
    active = true;
    rec = new Recognition();
    rec.lang = lang === "fr" ? "fr-CA" : "en-CA";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript.toLowerCase();
      if (TRIGGERS[lang].some(([a, b]) => text.includes(a) && text.includes(b))) onCommand();
    };
    // iOS stops listening after silence or after we play audio: restart it
    rec.onend = () => {
      if (active) setTimeout(() => { try { rec?.start(); } catch { /* already running */ } }, 300);
    };
    rec.onerror = (e: any) => console.warn("voice command:", e.error);
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

How Jibril wires it (in `WalkMode`):
```ts
const voice = useMemo(() => createVoiceCommand(() => whatsAheadRef.current()), []);
// in the Start tap, after audio.unlock():  voice.start(lang);
// on Stop:                                 voice.stop();
// on language switch while walking:        voice.start(next);
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
5. Cover the lens with a finger → `camera_blocked`.
6. Say "What's ahead?" and tap the lower half of the screen → an answer within ~2 s, even mid-interval.
7. Hang the phone on the lanyard and walk: check the snapshots aren't mostly sky or ground (tilt the mount if needed).

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
| `.start()` / `.stop()` | Start / Stop taps (call `start()` **after** unlocking audio, inside the tap) |
| `.checkNow()` | "What's ahead?": resolves with the next `SceneResult`, or `null` if it failed |
| `createVoiceCommand(cb)` | `.start(lang)`, `.stop()`, `.supported` |
| `analyze()`, `tts()`, types | from `web/src/api/` |

## 7. Done when

- [ ] `types.ts` + `client.ts` + `mock.ts` pushed early Saturday
- [ ] iPhone Safari over HTTPS shows the live rear camera in portrait
- [ ] A `SceneResult` arrives every interval, never two requests at once
- [ ] Airplane mode → `no_connection` → back online → `connection_back`
- [ ] Covered lens → `camera_blocked`; normal daylight never triggers it
- [ ] "What's ahead?" (voice **and** tap) answers within ~2 s without doubling requests
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
| Voice command never fires | Siri & Dictation off, mic permission denied, or recognition stopped: check `onerror` in the console |
| Headphone audio goes muffled when the mic is on | iOS "call mode". Turn the voice command off; tap-anywhere still works |
| "Camera blocked" at dusk | Out of scope (daylight only). Film before ~6:45 PM |
| Phone gets hot | Expected with camera + network + mic; take breaks between takes |

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
3. Start it after the camera starts (same `video` element) and feed Jibril's `onResult`. His `pickAlert` already dedupes and ranks it alongside Gemini's results.
4. Test on the iPhone: first load downloads the model (a few MB), then watch for heat and battery drain. If it's too slow, raise the tick to 500 ms.

For the video: a teammate walking quickly toward the camera shows off the fast layer ("Person ahead" before Gemini would have answered).
