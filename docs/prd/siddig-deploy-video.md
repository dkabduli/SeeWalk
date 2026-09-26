# PRD: Tunnel, Deploy, Video + Devpost (Siddig)

> Read [the shared contract](README.md) first so you can explain the product in the video and on Devpost.

## 1. Summary

You own **getting SeeWalk in front of people**:
1. **Saturday morning:** an HTTPS tunnel so the team's iPhones can open the app (the camera only works over HTTPS)
2. **Saturday afternoon:** plan and **film** the field walk before sunset (~7 PM)
3. **Saturday night → Sunday morning:** edit the **~2 minute video**, write the **Devpost**, **submit by 9:30 AM Sunday**
4. **Stretch:** a real public URL (Vultr + GoDaddy domain)

**The video is the product we're judged on.** Everything the team builds only counts if it shows up clearly in it.

## 2. Step-by-step

### Step 1: HTTPS tunnel (Saturday 9 AM, ~20 min)

The app runs on one laptop: Aroha's server on port 8000 and the Vite app on port 5173 (which forwards `/api` to 8000). The tunnel gives that laptop a public `https://` address.

On **that laptop**:
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5173
```
It prints something like `https://quiet-river-1234.trycloudflare.com`.

1. Post the URL in the team chat. It changes every time you restart the tunnel, so keep it running.
2. On an iPhone, open it in **Safari** → tap Start → **Allow** camera.
3. If you see "Blocked request. This host is not allowed", Jibril's `vite.config.ts` needs `allowedHosts: true`.

Backup if cloudflared misbehaves: `brew install ngrok`, sign up (free), then `ngrok http 5173`.

### Step 2: Shot list: create `docs/shot-list.md` (Saturday morning)

Plan every scene before filming. Template:

| # | Scene | Where | What happens | SeeWalk should say | Caption on screen |
|---|---|---|---|---|---|
| 1 | Hook | Campus path | Walker puts on the chest-mounted phone + open-ear headphones | (silence) | "A white cane finds the ground." |
| 2 | Person approaching | Quiet path | Teammate walks toward the walker from the left | "Person ahead, left" | same |
| 3 | Stop sign | Street corner | Walker approaches a stop sign | "Stop sign ahead" | same |
| 4 | Crosswalk | Crossing | Walker approaches a painted crosswalk | "Crosswalk ahead" | same |
| 5 | Curb / pothole | Sidewalk edge / cracked pavement | Walker approaches | "Curb ahead" / "Pothole ahead" | same |
| 6 | Obstacle | Path | Chair or bin placed in the path | "Obstacle in your path" | same |
| 7 | Bilingual | Any scene above | Tap Français, repeat | "Panneau d'arrêt devant" | FR caption |
| 8 | Honesty | Anywhere | Hand over the lens → tap "What's ahead?" | "Unclear" | "It says unclear instead of guessing." |
| 9 | Fail out loud | Anywhere | Airplane mode | "No connection, I can't see right now" | "Silence never means all clear." |
| 10 | How it works | Screen recording | The 3D model + README diagram | (voice-over) | "Gemini sees. ElevenLabs speaks." |

Scout locations on campus Saturday morning: a quiet path, a real stop sign, a painted crosswalk, a curb, some rough pavement.

### Step 3: Gear checklist
- [ ] **Demo iPhone** on a lanyard or chest strap, rear camera facing forward (tape a phone mount to a bag strap if needed)
- [ ] **Open-ear or bone-conduction headphones** (Shokz), or one earbud, so the walker can still hear traffic
- [ ] **Second phone to film** the walker (1080p/30 fps, landscape)
- [ ] **Screen recording on the demo iPhone** (Control Center → Screen Recording). It captures the app's screen **and SeeWalk's audio**; you'll sync it with the filming phone in the edit
- [ ] Both phones charged, plus a power bank
- [ ] A chair/bin for the obstacle scene; a teammate to walk toward the camera

### Step 4: Film (Saturday 4:30–6:45 PM: daylight only, sunset ~7 PM)
- Abdul turns on **Gemini billing** first and sets the snapshot interval to 1.5 s (free-tier limits would cause gaps mid-take)
- The laptop running the server + tunnel stays online (campus Wi-Fi or a hotspot)
- **3+ takes per scene.** Keep the good ones and note the timestamps
- Film wide (see the walker + surroundings) **and** close (the phone screen with the caption)
- If something goes wrong (wrong words, a long pause), it's fine: retake. Don't fake audio; judges may test it live
- **Backup reshoot:** Sunday 7–8 AM (sunrise ~7 AM)

### Step 5: Edit (~2:00, Saturday night)

Use iMovie, CapCut or DaVinci Resolve.

| Time | Section | Content |
|---|---|---|
| 0:00–0:15 | **Hook** | Walker with a white cane → "A white cane finds the ground. What about the bike coming at you, or the branch at head height?" |
| 0:15–1:15 | **Field walk** | Scenes 2–7, with SeeWalk's real audio and **big captions** of what it said. Show the left/right ear effect (caption "🔊 left ear") |
| 1:15–1:35 | **Trust** | Scene 8 (Unclear) + Scene 9 (No connection): "It never guesses, and silence never means all clear" |
| 1:35–1:50 | **How it works** | 3D model: Camera → Gemini → SeeWalk → ElevenLabs → Headphones. "Gemini 3.5 Flash-Lite sees every snapshot in ~1.2 s; ElevenLabs speaks it in ~0.2 s" |
| 1:50–2:00 | **Vision** | "Bilingual from day one. Phone today, wearable tomorrow." + team names |

Tips:
- **Captions on every spoken alert**: viewers often watch muted
- Use the demo phone's own audio (from the screen recording), not the filming phone's mic
- Avoid blindfold "simulations" (many blind advocates dislike them). Show the walker using a cane normally
- Export 1080p, upload to YouTube (unlisted is fine) and keep a local copy

### Step 6: Devpost (draft Saturday night, finish Sunday 7–9 AM)

Sections and what to write:
- **Inspiration:** the cane finds the ground but misses head-height and moving hazards; existing apps over-describe and guess
- **What it does:** chest-worn phone, speaks only what matters, left/right tones, EN/FR, says "unclear" instead of guessing, fails out loud
- **How we built it:** copy the tools breakdown from the main README (Gemini 3.5 Flash-Lite with structured JSON and two-frame motion, ElevenLabs Flash v2.5 + Multilingual v2 clips, FastAPI, React/Vite, Web Audio)
- **Challenges:** our latency tests: Gemini 3.8 Flash took 4–38 s per frame, Live couldn't return text, so we measured every option and landed on Flash-Lite (~1.2 s) + ElevenLabs (~0.2 s)
- **Accomplishments / what we learned / what's next:** transit (bus numbers), on-device fast layer for bikes, wearable, hazard map for the city

Submission checklist:
- [ ] Video link
- [ ] GitHub link: <https://github.com/dkabduli/SeeWalk>
- [ ] **All 4 teammates added** (each must accept the invite)
- [ ] Prize categories: Best Use of Gemini API, Best Use of ElevenLabs, Best UI/UX (+ Vultr / GoDaddy / Tiger Data only if we actually used them)
- [ ] Screenshots: app screen with a caption, the 3D model
- [ ] **Submitted by 9:30 AM Sunday** (hard deadline 10:00)

## 3. Done when

- [ ] Tunnel URL works on every teammate's iPhone Saturday morning
- [ ] `docs/shot-list.md` committed; locations scouted
- [ ] Every scene filmed in daylight, 3+ takes each
- [ ] ~2 min video exported and uploaded
- [ ] Devpost submitted with all 4 names, video + repo links

## 4. Stretch: public URL (only if the video is safe)

So the demo doesn't depend on a laptop:
1. **Vultr:** Deploy → Cloud Compute → Toronto → Ubuntu 24.04 → cheapest plan → add your SSH key
2. **GoDaddy:** claim the free MLH domain → DNS → **A record** `@` → the Vultr IP
3. On the server:
   ```bash
   sudo apt update && sudo apt install -y python3-venv caddy nodejs npm git
   git clone https://github.com/dkabduli/SeeWalk.git /srv/seewalk && cd /srv/seewalk
   cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # + create .env
   cd ../web && npm install && VITE_FRAME_INTERVAL_MS=1500 npm run build
   ```
4. `/etc/caddy/Caddyfile` (replace the domain):
   ```
   seewalk.example.com {
       handle_path /api/* {
           reverse_proxy localhost:8000
       }
       handle {
           root * /srv/seewalk/web/dist
           try_files {path} /index.html
           file_server
       }
   }
   ```
   `sudo systemctl reload caddy`. Caddy gets the HTTPS certificate automatically.
5. Run the API: `cd /srv/seewalk/server && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000` (inside `tmux` so it survives logout)

This unlocks the Vultr and GoDaddy prize categories.
