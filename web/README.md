# SeeWalk web app

The phone app (React + Vite + TypeScript). Owners: `src/api/` + `src/camera/` Abdul ([PRD](../docs/prd/abdul-camera-capture.md), code identical to the PRD); `src/pages/`, `src/audio/`, `src/alerts/`, `src/i18n/` Jibril ([PRD](../docs/prd/jibril-ui-audio.md)).

**`App.tsx` shows Aroha's page. The camera debug page (`pages/CameraLab.tsx`) opens at `…/?lab`.** It shows the live camera, every `SceneResult` with the time since the last one, system events (`no_connection`, `camera_blocked`, …), a **lens meter** (brightness/contrast, for tuning "lens covered"), the voice command (needs the server: `cd server && .venv/bin/uvicorn listen_app:app --port 8000`), and a big **What's ahead?** zone, and the **COCO-SSD fast layer** (pink lines; model preloads when the page opens).

## Run

```bash
cd web
npm install
npm test                 # 50 behaviour tests (loop, voice command, covered-lens check, fast-layer tracker)
npm run build            # type-check + production build
npx oxlint               # lint
npm run dev              # http://localhost:5173
```

Settings in `web/.env.local` (git-ignored):
```
VITE_MOCK_API=1            # fake results, no server needed (delete to use Aroha's /analyze on :8000)
VITE_FRAME_INTERVAL_MS=5000
```

## On the iPhone

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5173
```
Open the `https://….trycloudflare.com` URL in **Safari**, tap **Start walk**, allow camera + microphone. For console logs, plug into the Mac → Safari → Develop → [iPhone] → the page.

## What was verified (Sept 26, before any phone test)

- `npm test`: 32 tests covering one-request-at-a-time, the interval, Stop/Start and double-tap races, Stop during the permission prompt, permission denied, `no_connection` / `connection_back` and its 20 s repeat, "What's ahead?" (answer from the in-flight snapshot, jump the wait, failure reasons, no double speaking), covered lens vs bright wall, iOS interruptions, returning to Safari, stale previous frames, voice triggers in EN/FR including SeeWalk's own phrases never self-triggering. Each guard was checked by deliberately breaking it and confirming a test fails.
- Headless Chrome with a fake camera: steady 1.5 s results, "What's ahead?" answered in ~0.4 s from the in-flight snapshot, French phrases after switching, nothing after Stop; with no server, `no_connection` after 2 tries and "What's ahead?" reports `no_connection`.

## Still to check on the real iPhone (PRD Step 8)

1. Rear camera in portrait on the lanyard
2. Lens meter values: covered by a finger vs sky / wall / road → tune `looksCovered`
3. Voice command **with Bluetooth headphones** (audio quality, keeps listening after SeeWalk speaks)
4. Screen off → on: resumes by itself; switching apps doesn't say "Camera blocked"
