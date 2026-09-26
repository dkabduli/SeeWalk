# SeeWalk PRDs

One PRD per person. Each one walks you through your piece step by step, with code you can start from and a clear "done when" list. **Read this page first**: it's the contract that makes the four pieces fit together.

| Person | Role | PRD |
|---|---|---|
| **Aroha** | AI + backend | [aroha-ai-backend.md](aroha-ai-backend.md) |
| **Abdul** | Camera + capture | [abdul-camera-capture.md](abdul-camera-capture.md) |
| **Jibril** | Phone UI + audio | [jibril-ui-audio.md](jibril-ui-audio.md) |
| **Siddig** | Tunnel, deploy, video, Devpost | [siddig-deploy-video.md](siddig-deploy-video.md) |

---

## The product in one paragraph

SeeWalk is a phone web app for blind and low-vision walkers. The phone hangs on the chest, shows a live rear-camera feed, and every ~1.5 s grabs a snapshot. The server sends that snapshot (plus the previous one, so Gemini can tell what's approaching) to **Gemini 3.5 Flash-Lite**, which returns hazards as JSON. The phone picks the one worth saying, plays a tone in the left/right ear, and plays the hazard's short phrase in **ElevenLabs'** River voice. Camera to ears: about 1.5–2 s. For the hackathon, the deliverable is **a working app filmed in a ~2 minute video**.

```
 Abdul                    Aroha                                   Jibril                              Siddig
 ┌──────────────┐  POST   ┌────────────────────────────┐   JSON   ┌───────────────────────────┐        ┌──────────┐
 │ live camera  │/analyze │ FastAPI → Gemini Flash-Lite├─────────►│ pickAlert → tone → /tts ──┼─► 🎧 ─►│ 🎥 video │
 │ snapshot loop├────────►│                            │          │ caption on screen         │        │ Devpost  │
 └──────────────┘         │ /tts → ElevenLabs (River) ◄├──────────┤                           │        └──────────┘
                          └────────────────────────────┘   mp3    └───────────────────────────┘
```

---

## Shared contract (don't change without telling the team)

### `POST /analyze`

Request:
```json
{ "image": "<base64 JPEG, no data: prefix>", "prev_image": "<base64 JPEG or null>", "lang": "en" }
```

Response `200` (`SceneResult`):
```json
{
  "hazards": [
    {
      "type": "person",
      "direction": "left",
      "distance": "near",
      "urgency": 2,
      "confidence": 0.86,
      "approaching": true,
      "phrase": "Person ahead, left"
    }
  ],
  "unclear": false
}
```

| Field | Values |
|---|---|
| `type` | `person` `bike` `car` `crosswalk` `stop_sign` `pothole` `uneven_surface` `head_height_obstacle` `obstacle_in_path` `construction` `curb_or_dropoff` `stairs_down` `other` |
| `direction` | `left` `ahead` `right` |
| `distance` | `close` `near` `far` |
| `urgency` | `1` urgent (interrupts), `2` warning, `3` info |
| `confidence` | `0`–`1`. The phone ignores anything under `0.6` |
| `approaching` | `true` if it moved toward the walker between `prev_image` and `image` |
| `phrase` | ≤ 4 words, in `lang`, hazard then direction. This is exactly what gets spoken |
| `unclear` | `true` if the snapshot is too blurry/dark to judge |

Errors: `503` means Gemini failed or timed out. The phone skips that snapshot and counts it as a failure.

### `POST /tts`

Request: `{ "text": "Person ahead, left", "lang": "en" }` → Response `200` `audio/mpeg` (River's voice). `503` if ElevenLabs failed; the phone falls back to a bundled clip.

### `GET /health` → `{ "ok": true }`

### Phone-side events (Abdul → Jibril)

| Event | When |
|---|---|
| `no_connection` | 2 failed `/analyze` calls in a row (repeat every 20 s while down) |
| `connection_back` | first success after `no_connection` |
| `camera_blocked` | camera track stopped, or 2 very dark snapshots in a row |

### Bundled clips (offline fallback, already generated)

`web/public/audio/{en,fr}/{key}.mp3`, list in `web/src/audio/clips.json`:

| Hazard `type` | Clip key |
|---|---|
| `person` / `bike` / `car` | `person_left` `person_ahead` `person_right` (same pattern for `bike_…`, `car_…`) |
| `stop_sign` | `stop_sign` |
| `crosswalk` | `crosswalk` |
| `head_height_obstacle` | `head_height` |
| `obstacle_in_path` | `obstacle_path` |
| `construction` | `construction` |
| `pothole` | `pothole` |
| `uneven_surface` | `uneven` |
| `stairs_down` | `stairs_down` |
| `curb_or_dropoff` | `curb` |
| `other` | none (only live TTS) |
| system | `walk_started` `walk_stopped` `no_connection` `connection_back` `camera_blocked` `unclear` `nothing_detected` |

### A fake result for building without the backend

```json
{"hazards":[{"type":"car","direction":"right","distance":"near","urgency":1,"confidence":0.91,"approaching":true,"phrase":"Car on your right"}],"unclear":false}
```

---

## Folder ownership

| Folder | Owner |
|---|---|
| `server/` | Aroha |
| `web/src/api/`, `web/src/camera/` | Abdul |
| `web/` scaffold, `web/src/pages/`, `web/src/audio/`, `web/src/alerts/`, `web/src/i18n/` | Jibril |
| `docs/shot-list.md`, deploy config, Devpost | Siddig |

Need to change someone else's file? Message them first.

## Git workflow

```bash
git checkout <YourName>s-Work        # Abduls-Work, Arohas-Work, Siddigs-Work, Jibrls-Work
git pull origin main                 # get everyone's latest before you start
# ...work...
git add -A && git commit -m "Camera: snapshot loop with 5 s timeout"
git push
```

When something works, open a pull request into `main` on GitHub and ping Abdul. **Commit small and often.** Judges read the commit history to confirm we built this during the hackathon.

Never commit `server/.env` or any API key (`.gitignore` already blocks `.env`).

## Timeline

| When | Milestone |
|---|---|
| Sat 9:00 | Jibril pushes the `web/` scaffold (~30 min). Aroha starts the backend. Siddig starts the tunnel |
| Sat 12:00 | `/analyze` returns hazards for a real photo; iPhone shows the live camera over HTTPS |
| **Sat 3:00** | **End to end: point the iPhone at a stop sign → hear "Stop sign ahead" in River's voice** |
| Sat 4:30 | Demo-ready: captions, EN/FR, "What's ahead?", fail out loud |
| Sat 4:30–6:45 | **Film** (sunset ~7 PM) |
| Sun 1:00 AM | Feature freeze |
| **Sun 9:30 AM** | **Devpost submitted** |
