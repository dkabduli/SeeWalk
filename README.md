# VisionCompanion

**A white cane finds the ground. VisionCompanion finds everything else.** People, bikes, cars, potholes and branches at head height are announced calmly, and only when it matters.

VisionCompanion runs on a phone worn on a lanyard or chest strap. It watches the path ahead with the rear camera, uses **Gemini** to understand the scene, and speaks short alerts in an **ElevenLabs** voice (English or French) through open-ear Bluetooth headphones.

> Built by team **Goobers** (Abdul, Aroha, Jibril, Siddig) for Hack the Hill III (uOttawa, Sept 25–27, 2026). Original product spec: [`SEEWALK_SPEC.md`](SEEWALK_SPEC.md). Where the two differ, **this README is the current plan**.

---

## At a glance

```mermaid
flowchart LR
    A["📷 Camera<br/><small>phone takes a photo</small>"] -- photo --> B["Gemini<br/><small>sees the hazards</small>"]
    B -- hazards --> C["VisionCompanion<br/><small>picks what matters</small>"]
    C -- what to say --> D["ElevenLabs<br/><small>turns it into a voice</small>"]
    D -- voice --> E["🎧 Headphones<br/><small>walker hears it</small>"]
```

### How the pieces talk (Gemini, ElevenLabs, Tiger Data)

![How VisionCompanion works: the phone sends snapshots to the server, Gemini returns hazards, the phone plays River's pre-recorded ElevenLabs clip; questions go through Gemini and ElevenLabs Flash live; Tiger Data hazard map planned](docs/img/how-it-works.svg)

Regenerate after changing the flow: `python3 docs/img/make_how_it_works.py`. **Tiger Data is not set up yet** (planned hazard map, shown greyed out).

### 3D model

[![VisionCompanion signal path in 3D: Camera → Gemini → VisionCompanion → ElevenLabs → Headphones](docs/img/signal-path-3d.png)](https://raw.githack.com/dkabduli/VisionCompanion/main/docs/signal-path-3d.html)

**[🦯 Open the 3D model →](https://raw.githack.com/dkabduli/VisionCompanion/main/docs/signal-path-3d.html)**

Drag to turn, scroll to zoom. Source: [`docs/signal-path-3d.html`](docs/signal-path-3d.html).

---

## What we're building for the demo

**Goal: it works and it looks great in a ~2-minute video.** Everything below serves that.

- **In:** live camera → Gemini → short spoken alerts in River's voice, left/right tones, EN/FR, "What's ahead?" button, on-screen captions, fails out loud.
- **Stretch (only if the core is solid):** on-device COCO-SSD fast layer, "Ask" voice questions, Tiger Data hazard map, Vultr deploy.
- **Out:** crowds, night/rain, turn-by-turn navigation, face recognition (never).

---

## How it works: the data flow

**In plain English:** the phone shows a **live camera feed** (like the camera app), but nobody presses a shutter. Every ~1.5 s the app quietly grabs **one still snapshot** from that live feed and sends it to our server, together with the previous snapshot. The server asks **Gemini** "what matters in this picture, and is anything coming closer?" and gets back a short structured answer (e.g. *pothole, ahead, 0.9 confidence, "Pothole ahead"*). The phone decides whether it's worth saying, then the server has **ElevenLabs** turn the phrase into River's voice, and the phone plays it in the walker's ears. Then it grabs the next snapshot. So it's **a stream of snapshots, one at a time**, not a video stream and not photos saved to the camera roll.

```
 PHONE (iPhone Safari, worn on chest)                     SERVER (FastAPI)
┌───────────────────────────────────────┐              ┌───────────────────────────────────────┐
│ 1. CAPTURE                            │              │                                       │
│    rear camera → canvas → 768px JPEG  │  2. POST     │ 3. GEMINI 3.5 Flash-Lite              │
│    every ~0.8 s, up to 2 at a time    ├──/analyze───►│    thinking_level = "minimal"         │
│                                       │ {image,lang} │    structured JSON (SceneResult)      │
│                                       │              │                                       │
│ 5. DECIDE (alert filter)              │◄────JSON─────┤ 4. SceneResult {hazards[], unclear}   │
│    confidence ≥ 0.6                   │              │                                       │
│    same thing not repeated within 5 s │              │                                       │
│    most urgent hazard wins            │              │                                       │
│                 │                     │              │                                       │
│ 6. SPEAK                              │   POST /tts  │ 7. ELEVENLABS Flash v2.5 (River)      │
│    tone panned L / C / R, then ───────┼─{text,lang}─►│    streaming, cached by (text, lang)  │
│    play the phrase ◄──────────────────┼──audio/mpeg──┤                                       │
│    (bundled clip if the network fails)│              │                                       │
│                 │                     │              └───────────────────────────────────────┘
│ 8. Bluetooth → open-ear headphones    │
└───────────────────────────────────────┘
```

1. **Capture.** The phone's rear camera streams into a hidden `<video>`. Every ~1.5 s a frame is drawn to a canvas, resized to 768 px, JPEG q0.7, base64. Only **one request is in flight** at a time (5 s timeout).
2. **Send.** `POST /analyze` with `{ image, prev_image, lang }`: the current snapshot plus the one before it. API keys never leave the server.
3. **See (Gemini multimodal vision).** The server sends the prompt and **both images in one request** to **Gemini 3.5 Flash-Lite** through the **Interactions API**, with `thinking_level: "minimal"` and a JSON schema. Gemini returns structured hazards, and comparing the two frames tells it whether something is `approaching`. Two frames cost no extra time (measured ~1.35 s for one or two).
4. **Return.** The validated `SceneResult` goes back to the phone.
5. **Decide.** The phone keeps it simple: drop anything under 0.6 confidence ("never guess"), don't repeat the same hazard + direction within 5 s, and speak only the most urgent one.
6. **Speak.** A short tone panned left/center/right plays first, then the phone sends the hazard's `phrase` to `POST /tts`.
7. **Voice (ElevenLabs).** The server calls **ElevenLabs Flash v2.5** in River's voice and returns the mp3 (cached, so repeated phrases are instant). If the network is down, the phone plays the matching **bundled clip** from `web/public/audio/` instead.
8. **Hear.** Bluetooth to open-ear headphones, so the walker still hears traffic.

### Measured latency (Sept 26, laptop on home Wi-Fi, free tier)

| Step | Time |
|---|---|
| Gemini 3.5 Flash-Lite, minimal thinking (one frame) | **1.16–1.31 s** |
| ElevenLabs Flash v2.5, first audio byte | **0.18–0.27 s** |
| Bluetooth | ~0.2 s |
| **Camera → walker hears it** | **≈ 1.5–1.8 s** |

Alternatives we measured and rejected:

| Option | Result | Why not |
|---|---|---|
| Gemini 3.8 Flash | 3.9–37.7 s per frame | Far too slow (lowest thinking level is "low") |
| Gemini 3.8 Live, speaking for itself | ~1.1 s to first audio | Replaces ElevenLabs/River; answers ran ~4 s long; harder to control what it says |
| Gemini 3.8 Live → transcript → ElevenLabs | ~1.3–1.5 s | Same speed as Flash-Lite, but needs a WebSocket relay; Live can't return text directly |

### Why Gemini multimodal vision fits

Gemini takes **text and images in the same request**, which we use three ways:
1. **Understanding the scene**, not just labelling objects: "crosswalk ahead", "branch at head height", "curb", things a basic object detector can't name.
2. **Two frames at once** (previous + current) so it can tell what's **approaching**, with no extra latency.
3. **Structured output**: it answers in our JSON schema, in English or French, so the phone never parses free text.

Measured options: 1 frame ~1.3 s · 2 frames ~1.35 s · + bounding boxes ~1.6 s (a stretch goal: compute left/right from the box in code).

### Gemini call (`server/gemini.py`, simplified; full version in [Aroha's PRD](docs/prd/aroha-ai-backend.md))

```python
interaction = client.interactions.create(
    model="gemini-3.5-flash-lite",
    input=[
        {"type": "text", "text": SYSTEM_PROMPT},
        {"type": "image", "data": image_b64, "mime_type": "image/jpeg"},
    ],
    generation_config={"thinking_level": "minimal"},
    response_format={
        "type": "text",
        "mime_type": "application/json",
        "schema": SceneResult.model_json_schema(),
    },
)
result = SceneResult.model_validate_json(interaction.output_text)
```

### System prompt (starting point, tune with real photos)

> You assist a blind pedestrian walking on a quiet street. The camera is chest-height, facing forward. Report ONLY things that matter for walking safely in the next ~10 metres: people or bikes coming toward the walker, cars in or entering the path, drop-offs, stairs, curbs, potholes, uneven pavement, obstacles in the path, head-height obstacles (branches, signs, mirrors), crosswalks, stop signs, construction. Ignore anything off the path, buildings, sky. Never guess: if it isn't clearly visible, leave it out. If the image is too blurry or dark, set unclear=true. Never say anything is safe to cross. Write each `phrase` in {English|French}, at most 4 words, hazard then direction (e.g. "Person ahead, left").

---

## Data contracts

### `SceneResult` (Gemini → server → phone)

```jsonc
{
  "hazards": [
    {
      "type": "person | bike | car | crosswalk | stop_sign | pothole | uneven_surface | head_height_obstacle | obstacle_in_path | construction | curb_or_dropoff | stairs_down | other",
      "direction": "left | ahead | right",
      "distance": "close | near | far",
      "urgency": 1,               // 1 = urgent, 2 = warning, 3 = info
      "confidence": 0.82,         // 0–1
      "approaching": false,       // moved toward the walker between the two frames
      "phrase": "Pothole ahead"   // ≤ 4 words, in the requested language, spoken by ElevenLabs
    }
  ],
  "unclear": false                // image too blurry/dark to judge
}
```

### Endpoints

| Method | Path | Request | Response |
|---|---|---|---|
| `POST` | `/analyze` | `{ "image": "<base64 jpeg>", "prev_image": "<base64 jpeg> \| null", "lang": "en" \| "fr" }` | `SceneResult`; `503` if Gemini fails or takes > 4 s |
| `POST` | `/tts` | `{ "text": "Pothole ahead", "lang": "en" \| "fr" }` | `audio/mpeg` |
| `GET` | `/health` | | `{ "ok": true }` |

### Offline fallback clips

If `/tts` fails, the phone plays a bundled clip chosen by `type` (+ `direction` for person/bike/car). Keys and EN/FR text are in [`web/src/audio/clips.json`](web/src/audio/clips.json); the mp3s are in `web/public/audio/{en,fr}/`. System clips: `walk_started`, `walk_stopped`, `no_connection`, `connection_back`, `camera_blocked`, `unclear`, `nothing_detected`.

### Fail out loud

Silence must never mean "all clear" by accident.

| Condition | What the walker hears |
|---|---|
| 2 failed `/analyze` calls in a row | low tone + "No connection, I can't see right now" (repeats every 20 s; "Connection back" on recovery) |
| Camera stops or lens covered | low tone + "Camera blocked" |
| `unclear: true` while walking | nothing |
| `unclear: true` after asking **"What's ahead?"** | "Unclear" |
| Nothing found after asking **"What's ahead?"** | "Nothing detected" (never "clear" or "safe") |

---

## Tools breakdown

| Tool | What we use it for | Where in the code | Status |
|---|---|---|---|
| **Gemini 3.5 Flash-Lite** (Interactions API, `google-genai` SDK) | Looks at each frame and returns hazards as JSON | `server/gemini.py` | ✅ key works, 1.2 s measured |
| **ElevenLabs Flash v2.5** | Speaks each alert live in River's voice (EN/FR) | `server/tts.py` | ✅ key works, 0.2 s measured |
| **ElevenLabs Multilingual v2** | Pre-made offline/system clips | `server/scripts/generate_clips.py` → `web/public/audio/` | ✅ 48 clips generated |
| **FastAPI** (Python 3.12) | Backend: holds the keys, `/analyze`, `/tts`, `/listen`, `/health` | `server/main.py` | ✅ built, eval'd on 15 samples |
| **React + Vite + TypeScript** | The phone web app | `web/` | ⬜ scaffold Saturday AM |
| **getUserMedia + Canvas** | Camera feed and frame capture on the iPhone | `web/src/camera/` | ⬜ |
| **Web Audio API** | Panned tones + playing speech | `web/src/audio/` | ⬜ |
| **cloudflared / ngrok** | HTTPS tunnel so the iPhone can use the camera during dev | — | ⬜ |
| **Vultr + Caddy** | Hosting with automatic HTTPS | — | stretch |
| **GoDaddy Registry domain** | Public URL for the demo | — | stretch |
| **TensorFlow.js + COCO-SSD** | On-device fast layer for people/bikes/cars (~25–30 ms per check) | `web/src/detection/` | ✅ built, preloaded |
| **Tiger Data** + **Leaflet** | Hazard map (civic layer) | `server/db.py`, `web/src/pages/Map.tsx` | stretch |
| **GitHub** | Repo, one branch per person, PRs into `main` | — | ✅ |

---

## Who's doing what

Each person has a **PRD in [`docs/prd/`](docs/prd/)** that walks them through their piece step by step, with starter code, a "done when" checklist and gotchas. **Start with the [shared contract](docs/prd/README.md)**: it's what makes the four pieces fit together.

```
 Abdul (camera)            Aroha (backend)                  Jibril (UI + audio)             Siddig (tunnel + video)
 snapshot every 1.5 s ──► /analyze → Gemini → JSON ──────► pickAlert → tone → /tts ──────► 🎧 ──► 🎥 filmed + Devpost
                          /tts → ElevenLabs (River) ◄─────┘
```

| Person | Role | Owns | PRD |
|---|---|---|---|
| **Aroha** | AI + backend | `server/` | [aroha-ai-backend.md](docs/prd/aroha-ai-backend.md) |
| **Abdul** | Camera + capture | `web/src/api/`, `web/src/camera/` | [abdul-camera-capture.md](docs/prd/abdul-camera-capture.md) |
| **Jibril** | Phone UI + audio | `web/` scaffold, `pages/`, `audio/`, `alerts/`, `i18n/` | [jibril-ui-audio.md](docs/prd/jibril-ui-audio.md) |
| **Siddig** | Tunnel, video, Devpost | tunnel, `docs/shot-list.md`, deploy | [siddig-deploy-video.md](docs/prd/siddig-deploy-video.md) |

**Saturday morning order:** Jibril pushes the `web/` scaffold first (~30 min) → Abdul merges it right away. Aroha starts the backend immediately (no dependencies). Abdul pushes `web/src/api/types.ts` early so everyone codes against the same shapes. Siddig gets the HTTPS tunnel running so everyone can test on iPhones.

### Aroha: AI + backend
Snapshot in → Gemini → hazards out (`/analyze`); phrase in → ElevenLabs → River's voice out (`/tts`).
- [ ] `schemas.py`, `gemini.py` (two-frame multimodal call), `tts.py` (cached), `main.py` (FastAPI)
- [ ] `eval_samples.py` on the team's photos → tune the prompt until nothing is invented and median ≤ 1.5 s
- [ ] French phrases correct; Gemini failures return `503`, never crash

### Abdul: camera + capture
Turn the live iPhone camera into a steady stream of snapshots and report when things break.
- [ ] `types.ts` + `client.ts` pushed early; a mock API for testing without the backend
- [ ] `captureFrame` (768 px JPEG + brightness), `useCamera` (portrait, lanyard), `useWalkLoop` (one request in flight, 5 s timeout, previous frame included, `checkNow()` for "What's ahead?")
- [ ] Hands-free **"VisionCompanion, what's ahead?" voice command** (our own mic capture → `POST /listen` → Gemini); tested with Bluetooth headphones
- [x] Stretch: COCO-SSD fast layer (on-device person/bike/car, ~25–30 ms/check, approach tracking)
- [ ] `no_connection` / `connection_back` / `camera_blocked` events; screen stays awake
- [ ] Also: share keys privately, **enable Gemini billing before filming**, merge PRs

### Jibril: phone UI + audio
Everything the walker touches and hears.
- [ ] **`web/` scaffold first**, with the `/api` proxy (keep `web/public/audio/` and `clips.json`)
- [ ] `AudioEngine` (unlock on tap, panned tones, live speech, clip fallback), `pickAlert` (≥ 0.6, 5 s no-repeat, most urgent), `WalkMode` screen with big captions, EN/FR, and the **whole lower half of the screen as "What's ahead?"**
- [ ] System sounds for connection/camera events; VoiceOver pass

### Siddig: tunnel, video, Devpost
Get the app on everyone's iPhone, then turn it into a great 2-minute video.
- [ ] `cloudflared` HTTPS tunnel Saturday morning
- [ ] [`docs/demo-script.md`](docs/demo-script.md) (video + live demo), gear, **film Sat 4:30–6:45 PM before sunset**, edit ~2 min
- [ ] Devpost with all 4 names, **submitted by 9:30 AM Sunday**
- [ ] Stretch: Vultr + GoDaddy domain with Caddy HTTPS

### Everyone
- [ ] Get the keys from Abdul (privately), run `server/scripts/check_connections.py` → ✅✅
- [ ] 3–4 chest-height photos each (curbs, crosswalks, stop signs, stairs, potholes, branches) → send to Aroha for `samples/`
- [ ] `git pull origin main` before starting; work on your branch; PR into `main` when something works; commit often (judges read the history)

---

## Phases

| Phase | When | Goal | Done when |
|---|---|---|---|
| **0. Setup** | Fri night | Keys, voice, clips, repo | ✅ Gemini + ElevenLabs connected, River picked, 48 clips, branches made |
| **1. Foundations** | Sat 9 AM – 12 PM | Backend works; `web/` scaffolded; camera on iPhone; tunnel up | `curl /analyze` returns hazards for a street photo; iPhone shows the live camera over HTTPS |
| **2. End to end** | Sat 12 – 3 PM | Phone → Gemini → ElevenLabs → ears | Point the iPhone at a stop sign and hear **"Stop sign ahead"** in River's voice |
| **3. Demo-ready** | Sat 3 – 4:30 PM | Tones, captions, EN/FR, "What's ahead?", fail out loud, prompt tuned | A full walk around one block sounds calm and correct |
| **4. Film** | Sat 4:30 – 6:45 PM (sunset ~7 PM) | Billing on, record the field walk (several takes) | Clean footage of every scene on the shot list |
| **5. Polish + stretch** | Sat 7 PM – Sun 1 AM | Edit video, stretch goals only if the core is solid. **1 AM feature freeze**. Backup reshoot Sun 7–8 AM | No known demo bugs; rough cut of the video |
| **6. Submit** | Sun 7 – 9:30 AM | Final video cut, Devpost, add teammates, link GitHub | **Submitted by 9:30 AM** |

---

## Setup (server)

Needs **Python 3.10+** (older SDK versions that support 3.9 don't have the Interactions API).

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then fill in the keys (see below)
.venv/bin/python scripts/check_connections.py
```

**Keys (free tier for now):**
- **Gemini:** create **your own** free key at [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys) so each of us has a separate rate limit. Billing gets enabled on one demo key before filming.
- **ElevenLabs:** use the shared team key (ask Abdul; send it privately, never commit it).
- Set `VITE_FRAME_INTERVAL_MS` to **5000–6000** during development to stay under free-tier limits.

`server/.env` is git-ignored. Variables:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_THINKING_LEVEL` | `minimal` |
| `ELEVENLABS_API_KEY` | from ElevenLabs → Developers → API keys |
| `ELEVENLABS_VOICE_ID` | `SAz9YHcvj6GT2YYXdXww` (River: one voice for EN + FR) |
| `ELEVENLABS_TTS_MODEL` | `eleven_flash_v2_5` |
| `DATABASE_URL` | Tiger Data connection string (stretch) |
| `ALLOWED_ORIGINS` | e.g. `http://localhost:5173` |

## Repo layout

```
seewalk/
├── server/                      # FastAPI
│   ├── main.py                  # /analyze, /tts, /health
│   ├── gemini.py                # Gemini Flash-Lite call + prompt
│   ├── tts.py                   # ElevenLabs Flash + cache
│   ├── schemas.py               # SceneResult, Hazard, request models
│   ├── config.py                # env vars
│   └── scripts/
│       ├── check_connections.py # ping Gemini, ElevenLabs, Tiger Data
│       ├── phrases.py           # EN/FR fallback phrase table
│       ├── generate_clips.py    # build web/public/audio/{en,fr}
│       └── eval_samples.py      # run samples/*.jpg through Gemini
├── web/                         # React + Vite + TS
│   ├── public/audio/{en,fr}/    # bundled ElevenLabs clips (offline fallback)
│   └── src/
│       ├── camera/              # camera + frame capture (Abdul)
│       ├── api/                 # analyze(), tts()
│       ├── alerts/              # filter: confidence, no-repeat, urgency (Jibril)
│       ├── audio/               # tones, speech playback, clips.json (Jibril)
│       ├── i18n/                # EN/FR strings
│       └── pages/WalkMode.tsx   # main screen (Jibril)
├── samples/                     # street photos for testing
├── docs/                        # 3D model, images, PRDs (docs/prd/)
└── SEEWALK_SPEC.md              # original spec
```

## Design principles

1. **Speak less.** Four words max; tones for direction.
2. **Hazards first.** Danger → direction → description.
3. **Never guess.** Low confidence means silence, or "Unclear" when asked.
4. **Inform, never command.** Never say "safe to cross" or "go."
5. **No screen needed.** Large labelled buttons; works with VoiceOver.
6. **Fail out loud.**
7. **Privacy.** Frames are processed and discarded; people are never identified.
