# VisionCompanion demo script

Two parts:
- **Part A: the video (~2:00).** Filmed outside Saturday 4:30–6:45 PM (sunset ~7). It shows VisionCompanion finding stop signs, curbs, potholes and doors **on its own** while someone walks.
- **Part B: the live demo (~3–4 min).** In person, at the table. The judges hear VisionCompanion **answer questions**: read this, what am I holding, what's blocking my path, what's ahead, and the safe-to-cross refusal.

Everything below is what the app actually does today (`main`, commit `a0dcd8e` or later). Don't script lines it doesn't say.

---

## What VisionCompanion says (so everyone knows what to listen for)

**On its own (street alerts, on by default).** A tone in the left or right ear, then River says:

| Walk toward… | VisionCompanion says | When |
|---|---|---|
| Stop sign | "Stop sign ahead" / "…on your right" / "…on your left" | Once, when first seen (up to ~15 m / 50 ft). Not again for 45 s |
| Crosswalk | "Crosswalk ahead" | Once, when first seen |
| Traffic light | "Traffic light ahead" | Once. It **never** says the colour or "go" |
| Curb / drop at the street | "Curb ahead" | When first seen (~10 m), **again when under 2 m** |
| Pothole / hole | "Pothole ahead" | When first seen, again when close |
| Broken or lifted pavement | "Uneven ground ahead" | When first seen, again when close |
| Steps up to an entrance | "Steps up ahead" | When first seen, again when close |
| A door you're heading into | "Door ahead" | When first seen, again when close |
| Cones / barriers / "sidewalk closed" | "Construction ahead" | When first seen, again when close |
| Branch or sign at head height | "Obstacle at head height ahead" | When first seen, again when close |

From the moment something comes into view, it takes **about 2 seconds** to speak.

**It does NOT announce on its own:** people, cars, bikes, chairs, benches, bins. That's on purpose: in testing, those announcements never stopped. Walkers ask for them instead ("VisionCompanion, what's blocking my path?").

**When asked.** Say **"VisionCompanion"** first, then the question. You hear a soft chirp ("got it"), a gentle pulse while it thinks, and on screen a pill reading "Listening… / Thinking…" with a waveform. Then River answers:

| Say | Example answer |
|---|---|
| "VisionCompanion, what's ahead?" | "A sidewalk with a stop sign on the right and parked cars" |
| "VisionCompanion, what am I holding?" | "A blue water bottle" |
| "VisionCompanion, what's blocking my path?" | "A chair and a bin ahead", or "Nothing detected in your path" (never "clear") |
| "VisionCompanion, read this." | The text, word for word (up to ~25 words) |
| "VisionCompanion, is it safe to cross?" | "I can't tell you when it's safe to cross. Listen for traffic and use your cane." |
| (tap the **What's ahead?** button) | A short scene description |

**It never stays silent about a problem:**
- Hand over the lens → "Camera blocked"
- Wi-Fi/data off → "No connection, I can't see right now"; when it's back → "Connection back"

---

## Before you go out (laptop: Abdul, 15 min)

VisionCompanion runs on the laptop. **The laptop stays on, awake, plugged in and online the whole time.**

1. Pull the latest `main` and build the app (the snapshot interval is baked in at build time):
```bash
cd ~/Downloads/SeeWalk && git pull && cd web && echo "VITE_FRAME_INTERVAL_MS=800" > .env.local && npm run build
```
2. Start the server (terminal 1):
```bash
cd ~/Downloads/SeeWalk/server && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```
3. Serve the app (terminal 2):
```bash
cd ~/Downloads/SeeWalk/web && npx vite preview --port 4173
```
4. Open the tunnel (terminal 3). It prints a new `https://….trycloudflare.com` link each time:
```bash
cloudflared tunnel --protocol http2 --url http://localhost:4173
```
5. Keep the Mac awake (terminal 4):
```bash
caffeinate -dimsu
```
6. **Laptop internet:** use the same Wi-Fi you've tested on, or the phone's hotspot. If you switch networks, restart the tunnel and use the new link.

## The demo iPhone (5 min)

- [ ] Open the tunnel link in **Safari**. Allow the camera and microphone.
- [ ] Settings → Display & Brightness → **Auto-Lock: Never**
- [ ] Ring/silent switch **off silent**, volume **high**
- [ ] Shokz (or other open-ear headphones) paired and on
- [ ] Control Center → **Screen Recording** on the demo phone. It records VisionCompanion's own audio for the edit. **Do one 10-second test recording first** and play it back to confirm River is audible with the Shokz connected. If she isn't, film with the Shokz disconnected so VisionCompanion plays from the phone speaker.
- [ ] Chest mount: phone upright, rear camera forward, not tilted toward the ground or the sky
- [ ] Setup screen shows **Street alerts: On**
- [ ] Tap **Start walk** once indoors to check. You should hear "Walk mode on" (or the intro, the very first time on this phone).

## Filming rules

- **Walk at normal pace. Start ~10 m (30 ft) before the thing.** VisionCompanion needs ~2 s after it's in view. Starting too close makes it look slow.
- **Retakes of the same stop sign:** VisionCompanion won't repeat a sign for 45 s. Between takes, either wait 45 s or **reload the page** (pull down in Safari) and tap Start again.
- **Real audio only, never dubbed.** Captions on every line (people watch muted).
- **No fake blindfold "simulation" shots.** The walker uses a white cane naturally.
- **At least 3 takes per scene.** Log the good ones in the take log at the bottom.

---

# Part A: the video (~2:00)

Crew: **Walker** (phone on chest, cane, Shokz) · **Camera** (second phone, 1080p, landscape) · **Director** (watches the demo phone's screen, calls takes, logs).

### Scene 1: Hook (0:00–0:12)
- **Shot:** close on the phone going into the chest mount, then the Shokz, then the walker's hand tapping **Start walk**.
- **Audio:** "Walk mode on" (real).
- **Caption:** "A white cane finds the ground. VisionCompanion finds everything else."

### Scene 2: The stop sign (0:12–0:32) ★ main shot
- **Setup:** a real stop sign on the walker's side of the street. Start **~10–15 m (30–50 ft) away**, walking toward it.
- **Shot A:** wide from behind the walker, sign visible ahead.
- **Shot B:** close on the demo phone's screen (for the edit).
- **What happens:** a few steps in, a tone, then **"Stop sign on your right"** (or "ahead"). The screen shows the phrase with an arrow.
- **Caption:** "Stop sign on your right": heard ~15 m before the corner.
- **If it's silent:** check the phone is upright and the sign isn't hidden by a tree. Reload, then retake from farther back.

### Scene 3: Crosswalk + curb (0:32–0:47)
- **Setup:** continue from Scene 2 to the corner, or use any corner with a painted crossing.
- **What happens:** "Crosswalk ahead", then close to the edge: **"Curb ahead"** (the close-up repeat).
- **Then:** the walker says **"VisionCompanion, is it safe to cross?"** → "I can't tell you when it's safe to cross. Listen for traffic and use your cane."
- **Caption:** "It will never tell you it's safe to cross."

### Scene 4: Pothole or broken pavement (0:47–1:00)
- **Setup:** a real pothole, crack or lifted slab on the path.
- **Shot:** low angle on the ground, walker's feet approaching.
- **What happens:** "Pothole ahead" (or "Uneven ground ahead") early, **again when close**.
- **Caption:** "The things a cane finds too late."

### Scene 5: Head height (1:00–1:10), if you find one
- **Setup:** a low branch, a sign on a pole at head height, or anything sticking out above cane height.
- **Shot:** side angle showing the cane passing *under* it.
- **What happens:** "Obstacle at head height ahead".
- **Caption:** "The cane can't find this one."
- **No spot?** Skip it. Don't fake it.

### Scene 6: Door with steps (1:10–1:22)
- **Setup:** a building entrance with steps up to the door (or just a door).
- **What happens:** "Steps up ahead", then "Door ahead".
- **Caption:** "Steps, then a door."

### Scene 7: Construction (optional, 1:22–1:30)
- Only if there are real cones or barriers on a sidewalk. "Construction ahead".

### Scene 8: Français (1:30–1:40)
- **Setup:** before this take, stop. Tap **Français** in the top corner, then **Commencer**, and walk up to the stop sign again. Remember the 45 s wait or reload between takes.
- **What happens:** "Panneau d'arrêt à droite" (or "devant").
- **Then:** "VisionCompanion, qu'y a-t-il devant ?" → the answer in French.
- **Caption:** "Same voice, any language. Gemini + ElevenLabs Multilingual." Add English subtitles.

### Scene 9: How it works (1:40–1:52)
- **Shot:** screen capture of `docs/signal-path-3d.html` and the README diagram.
- **Voice-over (read by a teammate):** "Almost every second, the phone sends a snapshot to Gemini 3.5 Flash-Lite, which finds the hazards in about a second and a half. ElevenLabs' River voice says it, left or right, in the walker's ear."

### Scene 10: Close (1:52–2:00)
- **Shot:** team together.
- **Caption:** "VisionCompanion: Gemini sees. ElevenLabs speaks." Names + roles.

### Edit plan
| Time | Scenes |
|---|---|
| 0:00–0:12 | 1 Hook |
| 0:12–1:30 | 2–7 Street walk (stop sign first, it's the strongest) |
| 1:30–1:40 | 8 French |
| 1:40–2:00 | 9 How it works, 10 Close |

Keep the reading/holding features **out of the video** except a teaser if there's time. They're shown live (Part B).

---

# Part B: live demo for the judges (~3–4 min)

**Setup at the table:** laptop running (the same 4 terminals), demo iPhone in the chest mount or held at chest height, **phone speaker on** (disconnect the Shokz so the judges hear it). Have these props:
- a printed sign or a menu with large text (for "read this")
- a water bottle, a mug, or something with a clear shape (for "what am I holding")
- a chair or a bag to put in front of the camera (for "blocking my path")

**Presenter** (holds the phone) + **Narrator** (talks to the judges).

### 1. The pitch (30 s), Narrator
> "Over 300 million people worldwide are blind or have serious vision loss. A white cane finds what's on the ground right in front of you, but not the stop sign 50 feet ahead, the pothole coming up, or the branch at head height. VisionCompanion is a phone on your chest and open-ear headphones: it watches the path and tells you, out loud, what the cane can't find. And you can ask it anything."

### 2. Start (10 s)
- Tap **Start walk**. It says "Walk mode on".
- *Narrator:* "Street alerts are on: it's watching for hazards now. Everything else, you ask."

### 3. Show the video clip of the stop sign (20 s), optional
- If the judges haven't seen the video, play Scene 2 on the laptop.

### 4. "Read this" (30 s)
- Hold the printed sign or menu ~40 cm in front of the camera.
- *Presenter:* **"VisionCompanion, read this."**
- Point out the chirp and the pulsing "Thinking…" indicator: *"That sound means it heard you: a blind user needs to know it's working."*
- It reads the text word for word.

### 5. "What am I holding?" (20 s)
- Hold the bottle in front of the chest camera.
- **"VisionCompanion, what am I holding?"** → "A water bottle…"

### 6. "What's blocking my path?" (20 s)
- Put the chair or bag in front of the phone.
- **"VisionCompanion, what's blocking my path?"** → "A chair ahead"
- Remove it, ask again → "Nothing detected in your path".
- *Narrator:* "Notice it never says 'clear' or 'safe'. It only reports what it sees."

### 7. "What's ahead?" (15 s)
- Point the phone at the room. **"VisionCompanion, what's ahead?"** → a short description of the room.
- Or tap the **What's ahead?** button: same thing, no voice needed.

### 8. The safety line (15 s)
- **"VisionCompanion, is it safe to cross?"** → "I can't tell you when it's safe to cross. Listen for traffic and use your cane."
- *Narrator:* "No camera can promise that, so it will never say it."

### 9. It fails out loud (20 s)
- Cover the lens with your hand → **"Camera blocked"**.
- *Narrator:* "Silence never means all clear."

### 10. Français (20 s), if time
- Tap **Français**. **"VisionCompanion, lis ceci."** with the sign → it reads it and speaks French in the same voice.

### 11. How it's built (30 s), Narrator
> "The phone takes a snapshot every 0.8 seconds and sends it to Gemini 3.5 Flash-Lite, which returns the hazards as structured data in about a second and a half. The phone picks the one that matters and plays it in River's voice from ElevenLabs, panned to the left or right ear. Street alerts are pre-recorded so they play instantly; answers to questions use ElevenLabs Flash live. Voice commands are one Gemini call with the audio and the camera frame together."

### If something goes wrong live
| Problem | Do this |
|---|---|
| No answer after a question | Say it again, clearly, starting with "VisionCompanion". The chirp tells you it heard. |
| "No connection" | Laptop Wi-Fi dropped: check the tunnel terminal. Switch to the phone hotspot, restart the tunnel, open the new link. |
| Everything silent | Phone on silent, or volume down. Or the audio was interrupted (call/Siri): tap **Stop**, then **Start walk**. |
| Wrong answer | Say so honestly: "It's a snapshot model, it can miss things. That's why it never says 'safe'." |

### Likely judge questions
- **"Why not just a live video model?"** The live Gemini API we tested only answers with audio, and the full model took 4–38 s per image. Flash-Lite answers in ~1.5 s with structured data we can filter, so it only speaks when it matters.
- **"Why not announce people and cars?"** We did. In testing it never stopped talking and drowned out what mattered. Walkers ask when they want it.
- **"Latency?"** About 2 s from the moment something is in view to hearing it. That's why it reports signs ~15 m out and trip hazards ~10 m out, and repeats a trip hazard once more when it's close.
- **"Privacy?"** We don't save the snapshots: each one is sent to Gemini to be analyzed and then discarded by our server.
- **"What's next?"** A wearable camera instead of a phone, and on-device detection for the fastest hazards.

---

## Take log

| Scene | Take | Time | Good? | Notes |
|---|---|---|---|---|
| | | | | |
