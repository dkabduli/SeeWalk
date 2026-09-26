# SeeWalk — Project Spec (V0)

> Hack the Hill III (uOttawa, Sept 25–27, 2026). **Devpost submission deadline: Sunday Sept 27, 10:00 AM EDT** (target 9:30 AM). GitHub repo link required; judges review commit history to confirm work was done during the hackathon — commit early and often.
>
> This document is the full context for planning. Read it all before proposing a plan. Prioritize a working, reliable demo over breadth.

---

## 1. One-liner

**A white cane finds the ground. SeeWalk finds everything else** — people, bikes, cars, and branches at head height — calmly, and only when it matters. And every walk maps broken sidewalks so the city can fix them.

## 2. Problem

- Blind and low-vision people navigate with a white cane, a guide dog, O&M (orientation & mobility) training, and asking strangers.
- **The cane is excellent at ground-level things** (curbs, potholes, poles, steps). It **cannot** detect:
  - head-height obstacles (branches, truck mirrors, protruding signs)
  - moving things (people approaching, cyclists, silent e-scooters, cars backing out of driveways)
  - what's coming up (intersection ahead, crosswalk ahead, stop sign)
  - anything that must be read
- Existing apps (Be My Eyes / Be My AI, Microsoft Seeing AI, Google Lookout, Lumyeye, Apple Magnifier Detection Mode, Harvard's Mobilio research app) mostly do "describe this photo" or general navigation. Many are English-first (Lookout's AI image descriptions are English-only), many over-describe, and AI tools can state wrong things confidently.

## 3. Our angle (differentiation — have this ready for judges)

1. **Complements the cane, doesn't duplicate it** — focus on what the cane misses.
2. **Speaks only when it matters** — hazard-first, minimal words, tones for frequent alerts.
3. **Never guesses** — says "unclear" rather than a confident wrong answer.
4. **Bilingual EN/FR from day one** — built in Canada's bilingual capital.
5. **Hands-free + ears-open design** — runs on a phone today (chest/lanyard mount), intended for a dedicated wearable with Bluetooth to open-ear / bone-conduction headphones (e.g. Shokz).
6. **Civic layer** — detected sidewalk hazards (potholes, broken pavement, blocked paths) are geotagged into a live accessibility map of Ottawa that could feed city 311.

## 4. Users

- **Blind** cane / guide-dog users — want early warning of moving and head-height hazards.
- **Low vision** (the majority of people with sight loss) — may not use a cane; potholes and uneven ground matter more for them.
- **Older adults losing vision** (e.g. macular degeneration) — need extreme simplicity.
- Secondary (curb-cut effect): anyone walking distracted, at night, etc.

## 5. Design principles (non-negotiable)

1. **Speak less.** Every word costs attention. Short phrases. Tones for common alerts.
2. **Hazards first.** Priority order: danger → direction → description.
3. **Never guess.** Low confidence = say nothing, or "unclear" if the user asked.
4. **User stays in control.** Inform, never command. **Never say "safe to cross" or "go."**
5. **No looking at the screen required.** Big controls, works with VoiceOver/TalkBack.
6. **One hand is busy** (cane/dog). Phone is worn, not held.
7. **Fail out loud.** Lost connection, camera blocked, headphones disconnected → announce immediately (fallback to phone speaker / vibration). Silence must never mean "all clear" by accident.
8. **Privacy.** Frames processed and discarded. Never identify people. Hazard photos (if kept) must not show faces.

---

## 6. V0 Scope

### Assumptions for V0
- **Low-traffic environments only**: residential streets, campus paths. **At most 1–2 people and light vehicle traffic in view.** No crowd handling.
- **Daylight, dry weather** for the demo. Night/rain/snow = known limitations.
- **Demo device: a phone** (worn on lanyard / chest strap), audio via Bluetooth headphones (ideally open-ear like Shokz; otherwise one earbud).
- Pitch framing: *"Phone today, dedicated wearable tomorrow."*

### IN (V0)
- Continuous **Walk Mode** (start/stop with one big button)
- **Two-speed detection** (see §7)
- Hazard alerts, prioritized (see §8):
  - person approaching / in path
  - bicycle / scooter / motorcycle
  - car / truck
  - stop sign ahead
  - crosswalk ahead
  - obstacle in path (barrier, sign board, parked bike, snowbank)
  - pothole / uneven pavement
  - head-height obstacle
- **Directional tones** (stereo left/right panning) + **short spoken phrases**
- **Pre-generated ElevenLabs voice clips** for common phrases, EN + FR
- Language toggle EN / FR
- "Fail out loud" status alerts
- **Hazard map** (civic layer): sidewalk hazards saved with GPS + time to Tiger Data, shown on a map page — *build after core alerts work*

### OUT (later versions)
- Crowds / busy downtown sidewalks
- Pedestrian signal (walk/don't-walk) reading — include only as "information" and only if it tests reliable; otherwise cut
- Bus / transit features (route reading, arrival data) — planned V1
- Turn-by-turn navigation
- Face recognition — **never**
- User accounts (Auth0) — optional stretch for an admin/city view of the map
- Dedicated hardware device

---

## 7. Architecture — "two speeds"

```
Phone (worn on lanyard / chest)                     Cloud (Vultr)
┌──────────────────────────────────┐             ┌────────────────────────┐
│ Rear camera (getUserMedia)        │  1 frame    │ Backend (FastAPI)      │
│  ├─ FAST: COCO-SSD in browser ────┼─ every ───► │  ├─ Gemini 3.8 Flash   │
│  │   person/bike/car/moto/truck/  │  2–3 sec    │  │   (structured JSON) │
│  │   stop sign/traffic light      │             │  ├─ ElevenLabs (live   │
│  │   → instant tones + clips      │ ◄─ hazards ─│  │   TTS, rare cases)  │
│  ├─ SLOW: Gemini results          │             │  └─ Tiger Data         │
│  │   crosswalk/pothole/head-height│             │      (hazard reports)  │
│  ├─ Alert manager (priority,      │             └────────────────────────┘
│  │   cooldown, dedupe)            │
│  ├─ Web Audio (tones, L/R pan)    │
│  └─ Pre-made ElevenLabs clips     │
│         │ Bluetooth               │
│         ▼                         │
│  Open-ear headphones (Shokz)      │
└──────────────────────────────────┘
```

**Why two speeds:** a cyclist at 20 km/h covers ~10 m during a 2-second cloud round trip. Fast-moving hazards must be caught on-device. Gemini handles things COCO-SSD doesn't know (crosswalks, potholes, head-height branches, construction, reading signs) and context (is that person actually in my path?).

### 7.1 Fast layer (on-device)
- **TensorFlow.js + COCO-SSD** (start here; minimal setup).
- Relevant COCO classes: `person`, `bicycle`, `car`, `motorcycle`, `truck`, `bus`, `stop sign`, `traffic light`.
- Upgrade path if too slow/inaccurate: **YOLO nano via ONNX Runtime Web**.
- Target: ≥ 5 detections/sec on a mid-range phone.
- Per detection derive:
  - **direction** from bbox center x: left third = "left", middle = "ahead", right third = "right" (optionally clock positions: 10 / 12 / 2 o'clock)
  - **rough distance** from bbox height relative to frame: "close" / "near" / "far" (no exact metres — single camera can't measure depth well)
  - **approaching?** bbox area growing across consecutive frames (simple tracking by class + IoU)

### 7.2 Slow layer (Gemini)
- Model: **Gemini 3.8 Flash** via the **Interactions API** (Python or JS SDK; `client.interactions.create(...)`). Fallback for speed: Gemini 3.5 Flash-Lite. Gemini 3.1 Pro only for offline prompt testing.
- Send 1 frame every 2–3 s, resized to ~768px long edge, JPEG q≈0.7.
- Use **structured output** (Pydantic / JSON schema). Verify exact parameter names against the current Gemini structured-output docs.
- Test prompts in **Google AI Studio** first.

Suggested schema:
```
SceneResult {
  hazards: [
    {
      type: "crosswalk" | "stop_sign" | "pothole" | "uneven_surface" | "head_height_obstacle"
          | "obstacle_in_path" | "construction" | "curb_or_dropoff" | "stairs_down" | "other",
      direction: "left" | "ahead" | "right",
      distance: "close" | "near" | "far",
      urgency: 1 | 2 | 3,          // 1 = urgent
      confidence: number,          // 0–1
      short_label: string          // ≤ 5 words, for rare/"other" cases
    }
  ],
  unclear: boolean                 // image too blurry/dark to judge
}
```

Suggested system instruction (tune in AI Studio):
> You assist a blind pedestrian walking on a quiet street. The camera is chest-height, facing forward. Report ONLY things relevant to walking safely in the next ~10 metres: drop-offs, stairs, curbs, potholes, uneven pavement, obstacles in the walking path, head-height obstacles (branches, signs, mirrors), crosswalks, stop signs, construction. Ignore anything off the walking path, parked cars not in the path, buildings, sky. Do not report people or vehicles (handled elsewhere) unless they are an obstacle not moving. Never guess: if not clearly visible, omit it. If the image is too blurry or dark, set unclear=true. Never describe anything as safe to cross.

### 7.3 Alert manager (client-side, the heart of the UX)
- Merges fast + slow results into one priority queue.
- **Priority tiers:**
  - **Tier 1 (interrupts anything):** vehicle/bike/scooter approaching into path; drop-off / stairs down; head-height obstacle close
  - **Tier 2 (short warning):** person approaching in path; obstacle in path; pothole / uneven surface
  - **Tier 3 (only when nothing else is playing):** crosswalk ahead; stop sign ahead
- **Cooldown / dedupe:** don't repeat the same type + direction within ~5–8 s; don't re-announce a tracked object already announced.
- **Low-traffic assumption:** OK to announce each approaching person individually (no crowd filtering in V0).
- **Confidence threshold** for Gemini hazards (e.g. ≥ 0.6, tune in testing).
- **Tone first, words second** for urgent alerts (tones play instantly; Bluetooth adds a few hundred ms).

---

## 8. Audio design

- **Web Audio API** for tones, **StereoPannerNode** for left/right placement (Shokz support stereo).
- Tone vocabulary (keep small, learnable):
  - urgent: sharp double beep, panned to direction
  - approaching obstacle/person: soft pulse that speeds up as it gets closer (parking-sensor style)
  - informational (crosswalk / stop sign): gentle single chime
  - system problem (no connection, camera blocked): distinct low tone + spoken message
- Choose **mid-to-high frequencies** (bone conduction is weak on bass). Test on actual headphones.
- **Pre-generate** common phrases with ElevenLabs (quality model, e.g. Multilingual v2) as audio files bundled with the app → instant playback, no network:

| Key | English | Français |
|---|---|---|
| person_ahead | Person ahead | Personne devant |
| person_left / right | Person on your left / right | Personne à gauche / à droite |
| bike_left / ahead / right | Bike on your left / ahead / on your right | Vélo à gauche / devant / à droite |
| car_left / ahead / right | Car on your left / ahead / on your right | Voiture à gauche / devant / à droite |
| stop_sign | Stop sign ahead | Panneau d'arrêt devant |
| crosswalk | Crosswalk ahead | Passage pour piétons devant |
| head_height | Obstacle at head height | Obstacle à hauteur de tête |
| obstacle_path | Obstacle in your path | Obstacle sur votre chemin |
| pothole | Pothole ahead | Nid-de-poule devant |
| uneven | Uneven ground ahead | Sol inégal devant |
| stairs_down | Stairs going down | Escalier qui descend |
| curb | Curb ahead | Bordure devant |
| unclear | Unclear | Incertain |
| no_connection | No connection, I can't see right now | Pas de connexion, je ne vois rien pour l'instant |
| camera_blocked | Camera blocked | Caméra bloquée |
| walk_started / stopped | Walk mode on / off | Mode marche activé / désactivé |

- **Live ElevenLabs TTS** (low-latency model, e.g. Flash v2.5 — check current model list) only for rare `other` hazards with a `short_label`.
- Let user set speech speed (screen-reader users often listen fast).
- Future: duck/interrupt other audio (music/podcasts).

---

## 9. Civic layer — Hazard Map

- When Gemini reports `pothole`, `uneven_surface`, `obstacle_in_path`, `construction`, or `curb_or_dropoff` with high confidence, save a report: time, lat/lon (browser Geolocation API), type, confidence, session id. Optional photo only if no faces (V0: skip photos, simplest).
- Dedupe: don't save the same type within ~15 m of a report from the last few minutes of the same session.
- **Tiger Data** (managed PostgreSQL for time-series):

```sql
CREATE TABLE hazard_reports (
  time        TIMESTAMPTZ NOT NULL,
  id          UUID DEFAULT gen_random_uuid(),
  session_id  TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  hazard_type TEXT NOT NULL,
  confidence  REAL,
  source      TEXT DEFAULT 'gemini'
);
SELECT create_hypertable('hazard_reports', 'time');
-- Optional: continuous aggregate of daily counts per hazard type / rounded grid cell
```
(Verify hypertable syntax against current Tiger Data docs.)

- **Map page**: Leaflet + OpenStreetMap tiles (free, no key). Pins colour-coded by type, filter by date range. Simple stats: "most-reported streets this week."

---

## 10. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind, PWA |
| On-device detection | TensorFlow.js + COCO-SSD (upgrade: YOLO nano + ONNX Runtime Web) |
| Audio | Web Audio API + bundled ElevenLabs clips |
| Backend | Python + FastAPI (alt: Node + Express if team prefers one language) |
| Vision AI | Gemini 3.8 Flash, Interactions API, structured output |
| Voice AI | ElevenLabs (pre-generated clips + live TTS for rare cases) |
| Database | Tiger Data (PostgreSQL + hypertables) |
| Map | Leaflet + OpenStreetMap |
| Hosting | Vultr VM, Caddy (auto HTTPS); frontend on Vultr or Vercel/Netlify |
| Domain | GoDaddy Registry free domain (HTTPS needed for camera access) |
| Local phone testing | ngrok or Cloudflare Tunnel (HTTPS) |
| Debugging | Chrome remote debugging (Android), Safari Web Inspector (iOS) |

### Sponsor prize targets
- ✅ Best Use of Gemini API
- ✅ Best Use of ElevenLabs
- ✅ Best Use of Tiger Data
- ✅ Best Use of Vultr
- ✅ Best Domain Name from GoDaddy Registry
- ✅ Best UI/UX
- ⚠️ Auth0 only if we add a login-protected city/admin map view (stretch)
- ❌ Presage, Solana — no natural fit; don't force

### Environment variables
```
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID_EN=
ELEVENLABS_VOICE_ID_FR=
DATABASE_URL=            # Tiger Data connection string
ALLOWED_ORIGINS=
```
All AI API keys live on the backend only — never shipped to the phone.

---

## 11. Suggested repo structure

```
seewalk/
├── web/                     # React + Vite PWA
│   ├── src/
│   │   ├── camera/          # getUserMedia, frame capture/resize
│   │   ├── detection/       # COCO-SSD wrapper, tracking, direction/distance
│   │   ├── alerts/          # alert manager: priority, cooldown, dedupe
│   │   ├── audio/           # tones, panning, clip playback
│   │   ├── api/             # backend client
│   │   ├── pages/           # WalkMode, Map, Settings
│   │   └── i18n/            # EN/FR strings
│   └── public/audio/{en,fr}/  # pre-generated ElevenLabs clips
├── server/                  # FastAPI
│   ├── main.py              # routes
│   ├── gemini.py            # scene analysis, schema
│   ├── tts.py               # ElevenLabs live TTS
│   ├── db.py                # Tiger Data
│   └── scripts/generate_clips.py  # one-off: generate phrase clips EN/FR
├── db/schema.sql
└── README.md
```

### Backend endpoints
- `POST /analyze` — body: `{ image (base64 jpeg), lang }` → `SceneResult`
- `POST /hazards` — save a hazard report
- `GET /hazards?since=&bbox=` — hazards for the map
- `POST /tts` — `{ text, lang }` → audio stream (rare/live cases)
- `GET /health`

---

## 12. Timeline (now → Sunday 9:30 AM)

| When | Milestone |
|---|---|
| **Fri night** | Sign up for everything (Gemini key + credits, ElevenLabs MLH code, Tiger Data, Vultr + gift code, GoDaddy domain, GitHub repo). **Go/no-go test:** 10+ street photos through Gemini 3.8 Flash in AI Studio with the prompt above. Scaffold repo, deploy hello-world over HTTPS. Commit. |
| **Sat morning** | M1: camera + COCO-SSD running on a real phone, direction/distance, tones panned L/R. |
| **Sat midday** | M2: Gemini loop working end-to-end (frame → backend → structured hazards → client). |
| **Sat afternoon** | M3: alert manager (tiers, cooldown), pre-generated EN/FR clips, fail-out-loud states. **Accessibility test with VoiceOver/TalkBack on.** Contact users (uOttawa Access Service, CNIB, r/Blind) for 1–2 quotes. |
| **Sat evening** | M4: hazard reports → Tiger Data → Leaflet map. **Record the field walk** on a quiet campus path. |
| **Sat night** | M5: UI polish, bug fixes, test with Bluetooth / open-ear headphones. |
| **Sun 1:00 AM** | **Feature freeze.** Bugs only. |
| **Sun 7–9:30 AM** | Demo video (~2 min), Devpost write-up, add teammates, link GitHub. **Submit by 9:30.** |

## 13. Team split (4 people; adjust)

| Role | Owns |
|---|---|
| Vision | camera, COCO-SSD, tracking, direction/distance |
| AI/Backend | FastAPI, Gemini prompt + schema, /analyze, deployment of server |
| Audio/UI | alert manager, tones, clips, EN/FR, accessible UI |
| Data/Deploy/Pitch | Tiger Data, map page, Vultr, domain, Devpost, video, field recording |

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Gemini too slow for live use | On-device layer handles fast hazards; resize frames; short outputs; Flash-Lite fallback |
| Gemini hallucinates hazards | Confidence threshold; "never guess" prompt; require repeat across 2 frames for non-urgent hazards |
| Alert fatigue | Tiers, cooldowns, tones instead of words, low-traffic scope |
| Bluetooth audio latency | Tones first for urgent alerts; pre-generated clips |
| Bone conduction quiet / weak bass | Mid-high frequency tones; test on real headphones |
| Camera requires HTTPS | Deploy early with domain + Caddy; ngrok for local testing |
| iOS Safari: audio needs user gesture | "Start walk" button tap unlocks audio context |
| VoiceOver/TalkBack intercept custom gestures | Use large standard labelled buttons, no custom gestures |
| Distance estimation from one camera | Coarse buckets only (close/near/far) |
| Network drop outdoors | Fast layer still works offline; announce "no connection" |
| Phone heat / battery | Throttle detection FPS; note as limitation |
| Crosswalk liability | Never say "safe to cross"; info only; cane/dog + traffic listening stays primary |
| "Lookout / Be My Eyes already does this" | See §3 differentiation |
| API rate limits on free tier | Gemini only every 2–3 s; skip frames when nothing changes |
| Scope creep | V0 scope frozen (§6). Everything else = stretch |

## 15. Demo plan

1. **Hook (15 s):** "A white cane finds the ground. What about the bike coming at you, or the branch at head height?"
2. **Recorded field walk (45 s):** teammate wearing phone on lanyard + open-ear headphones on a quiet campus path — person approaching, bike passing, stop sign, crosswalk, pothole. Show captions of what SeeWalk said.
3. **Live (45 s):** judge wears the headphones; teammate walks toward the phone from the left → tone in left ear + "Person on your left." Printed stop sign. Chair in path.
4. **Honesty moment:** point at something blurry → "Unclear."
5. **Civic map (20 s):** hazards collected during Saturday's walk pinned on the campus map.
6. **Vision (15 s):** "Phone today, wearable tomorrow. Bilingual. Next: transit."

Avoid blindfold "simulations" (many blind advocates dislike them). Backup: recorded video if Wi-Fi fails.

## 16. Future versions
- **V1 — Transit:** read OC Transpo route numbers, cross-check with live GTFS data ("this is / isn't your bus"), "your stop is next."
- **V2 — Busy environments:** crowd filtering, collision-course prediction.
- **V3 — Wearable:** chest/glasses camera running detection on-device, Bluetooth to open-ear headphones, phone optional.
- Pedestrian signal reading (info only), building memory, 311 integration for the hazard map.

## 17. Open questions for planning
- Team size and language preference (Python vs all-Node backend)?
- iPhone vs Android as primary demo phone?
- Does anyone have open-ear/bone-conduction headphones?
- Domain name?
- Include Auth0 admin map view or skip?
