# VisionCompanion demo script

Two parts:
- **Part A: the video (~2:00).** Filmed outside in daylight (**Sunday 7–8 AM**; sunrise ~7:05). It shows
  VisionCompanion finding stop signs, curbs and potholes **on its own**, warning about hazards **other people reported**
  (the Tiger Data hazard map), and answering **spoken questions**, with both the question and the answer heard.
- **Part B: the live demo (~3–4 min).** In person, at the table: the questions (read this, what am I holding, what's
  blocking my path, where's the nearest pothole), the safe-to-cross refusal, and the hazard map.

Everything below is what the app actually does today (`main`, Sunday build). Don't script lines it doesn't say.
Live link: **https://visioncompanion.vercel.app** (hazard map: `…/?map`).

---

## What VisionCompanion says (so everyone knows what to listen for)

**From the camera, on its own** (street alerts, on by default). A short **beep** in the left or right ear, then the voice:

| Walk toward… | It says | When |
|---|---|---|
| Stop sign | "Stop sign ahead" / "…on your right" / "…on your left" | Once, when first seen (up to ~15 m / 50 ft). Not again for 45 s |
| Crosswalk | "Crosswalk ahead" | Once, when first seen |
| Traffic light | "Traffic light ahead" | Once. It **never** says the colour or "go" |
| Curb / drop at the street | "Curb ahead" | When first seen (~10 m), **again when under 2 m**. Turning at the corner doesn't repeat it (30 s) |
| Pothole / hole | "Pothole ahead" | When first seen, again when close |
| Broken or lifted pavement | "Uneven ground ahead" | When first seen, again when close |
| Steps up to an entrance | "Steps up ahead" | When first seen, again when close |
| A door you're heading into | "Door ahead" | Once, when it's straight ahead |
| Cones / barriers / "sidewalk closed" | "Construction ahead" | Once per work zone, plus the close-up |
| Branch or sign at head height | "Obstacle at head height ahead" | When first seen, again when close |

**From the hazard map (Tiger Data), on its own.** A softer **two-note chime** (so the walker knows it's *reported*, not *seen*), then:

| When | It says |
|---|---|
| Start walk, reports within 300 m | a short area briefing: *"Watch for a lifted or sunken sidewalk panel at 109 Osgoode Street…"* |
| ~40 m from a reported hazard, if it's **ahead** | *"Lifted or sunken sidewalk panel reported about 40 metres ahead."* |
| ~15 m from it | *"…nearby. Be careful."* (with *"on your left/right"* when it's to the side) |
| GPS weak / back / off | once each: *"Location is weak. Reported hazards paused."* · *"Location back."* · *"Location is off…"* |

**It does NOT announce on its own:** people, cars, bikes, chairs, benches, bins (in testing they never stopped).
Walkers ask instead ("VisionCompanion, what's blocking my path?").

**When asked.** Say **"VisionCompanion"**, then the question in one breath. A **rising chime** when it hears the
name (the pill says **Listening…** and its bars follow *your* voice), a **falling chime** when you stop, **Thinking…**,
then the answer (the pill shows **River** with bars that follow her voice):

| Say | Example answer |
|---|---|
| "VisionCompanion, what's ahead?" | "A sidewalk with a stop sign on the right and parked cars" |
| "VisionCompanion, what am I holding?" | "A blue water bottle" |
| "VisionCompanion, what's blocking my path?" | "A chair and a bin ahead", or "Nothing detected in your path" (never "clear") |
| "VisionCompanion, read this." | The text, word for word (up to ~25 words) |
| "VisionCompanion, where's the nearest pothole?" | "3 potholes reported within 1 kilometre. Nearest: about 200 metres, in the road, at 235 Nicholas Street…" |
| "VisionCompanion, what's around me?" | the nearest reported sidewalk problems, each named, with distance |
| "VisionCompanion, is it safe to cross?" | "I can't tell you when it's safe to cross. Listen for traffic and use your cane." |
| (tap **🗣️ Potholes near me** on the start screen, before walking) | the same pothole answer, before leaving the house |

**It never stays silent about a problem:** hand over the lens → "Camera blocked"; no internet → "No connection, I can't see right now", then "Connection back".

---

## Recording the sound: the question AND the answer ★ read this before filming

The video only makes sense if viewers hear **the walker ask** and **VisionCompanion answer**. There are two sources
of sound, and you want both on tape.

### Recommended: one phone speaker, one filming phone (simplest, always in sync)
1. **Disconnect the Shokz for the video takes.** The answer then plays from the demo iPhone's speaker (volume at
   max), loud enough for the filming phone to hear. Keep the Shokz *on the walker's head* for the look; show them
   in the hook shot.
2. The **filming phone** records video + sound. The camera person stays **within 1–1.5 m** of the walker (walk
   alongside or just behind). It then hears the walker's question and the answer from the chest phone.
3. **Wind:** shoot on the sheltered side of a building if it's windy; a phone mic hears wind as a roar. Tell the
   walker to speak a little louder than normal, facing forward.
4. **Crew is silent during a take.** VisionCompanion only answers questions that start with "VisionCompanion", but it
   does check nearby speech, and chatter can delay an answer.

### Better quality, if you have 20 minutes: add a screen recording on the demo phone
- Demo iPhone: **Control Center → long-press the Screen Recording button → Microphone On → Start Recording.** It
  records the app's own voice **digitally** (cleanest possible) and the walker's voice through the mic, plus the
  screen for close-ups (captions, arrows, the edge glow, the **River** pill).
- **Test it first (20 s):** record, Start walk, ask *"VisionCompanion, what's ahead?"*, stop, play it back. You must
  hear **both** voices. If the app stopped hearing your question while the screen recording's mic was on, turn the
  recording's **microphone off** and take the walker's voice from the filming phone instead.
- **Sync the two recordings:** at the start of every take, the director **claps once in front of both phones**.
  In the edit, line up the clap spike on both tracks.

### How the walker should speak
- **"VisionCompanion"**, then the question **in one breath**, no long pause. You'll hear the rising chime while
  you're still talking; that's normal: keep going.
- Then **stop talking** (the falling chime means it's thinking). The answer comes ~2–3 s later.
- Walk at a **normal pace** and look natural. No fake blindfold shots; the walker uses a white cane.

### In the edit
- **Caption both lines**: the question in white, *"VisionCompanion, where's the nearest pothole?"*, and the
  answer in the app's red accent. Many people watch muted.
- **Real audio only, never dubbed or re-recorded.** You may lift the answer's volume, not replace it.

---

## Before filming (7:00 AM, ~15 min)

### The demo iPhone
- [ ] Open **https://visioncompanion.vercel.app** in Safari → **Share → Add to Home Screen → Add** → launch **Companion** from the home screen (full screen looks like an app).
- [ ] Allow **camera, microphone and location** on the first Start (the home-screen app asks separately from Safari). Location powers the hazard map scenes.
- [ ] Settings → Privacy & Security → Location Services → **Safari Websites**: **While Using the App**, **Precise Location on** (this also covers the home-screen app).
- [ ] Settings → Display & Brightness → **Auto-Lock: Never**. Ringer **off silent**, volume **max**.
- [ ] Chest mount: phone upright, rear camera forward, not tilted up or down.
- [ ] Start screen: **Street alerts: On**, voice **River** (tapping a card chooses it and plays a sample).
- [ ] Tap **Start walk** once indoors: you hear "Walk mode on" (or the intro, the first time on this phone). Stop.
- [ ] Open it a minute before the first take: the very first request after it's been idle is ~2 s slower.

### Scouting (the hazard map scenes need real places)
- **A reported hazard to walk toward:** the city's report of a **lifted or sunken sidewalk panel at 109 Osgoode St**
  (near uOttawa). Walk toward it from ~120 m away. It's already in Tiger Data: nothing to set up.
- **Or your own pothole:** stand right beside a real pothole, open `…/?map`, pick **Pothole**, tap **📍 Pin here**.
  Walkers now hear it. Walk ~120 m away and start from there.
- **Nearest-pothole question:** anywhere near uOttawa; the nearest reported ones are on Nicholas St and Colonel By Dr.

## Filming rules
- **Start ~10 m (30 ft) before a camera hazard, ~120 m before a map hazard.** Starting too close looks slow.
- **Retakes:** a sign isn't repeated for 45 s, a curb or work zone for 30 s, and a map hazard only once per walk.
  Between takes: **Stop**, swipe the app closed, reopen, **Start walk**.
- **At least 3 takes per scene.** Log the good ones in the take log at the bottom.

---

# Part A: the video (~2:00)

Crew: **Walker** (phone on chest, cane, Shokz on) · **Camera** (second phone, 1080p, landscape, within 1.5 m) ·
**Director** (watches the demo phone, claps the slate, calls takes, logs).

### Scene 1: Hook (0:00–0:10)
- **Shot:** close on the phone going into the chest mount, the Shokz, then the hand tapping **Start walk**.
- **Sound:** "Walk mode on".
- **Caption:** "A white cane finds the ground. VisionCompanion finds everything else."

### Scene 2: The stop sign (0:10–0:28) ★ main shot
- **Setup:** a real stop sign on the walker's side. Start **10–15 m (30–50 ft) away**.
- **Shot A:** wide from behind the walker, sign ahead. **Shot B:** close on the demo phone's screen.
- **Sound:** beep, then **"Stop sign on your right"**. Screen: the phrase, an arrow, the right edge glowing.
- **Caption:** "Heard ~15 m before the corner."

### Scene 3: Crosswalk, curb, and the question it won't answer (0:28–0:42)
- **Sound:** "Crosswalk ahead", then near the edge **"Curb ahead"**.
- **Walker asks:** **"VisionCompanion, is it safe to cross?"** → *"I can't tell you when it's safe to cross. Listen for traffic and use your cane."*
- **Caption:** "It will never tell you it's safe to cross."

### Scene 4: Pothole the camera sees (0:42–0:52)
- **Shot:** low angle, the walker's feet approaching a real pothole or lifted slab.
- **Sound:** "Pothole ahead" (or "Uneven ground ahead"), again when close.
- **Caption:** "The things a cane finds too late."

### Scene 5: The hazard map, before the camera can see it (0:52–1:12) ★ Tiger Data
- **Setup:** walk toward 109 Osgoode St (the city's lifted panel) or your pinned pothole, from ~120 m.
- **Sound:** the two-note map chime, **"Lifted or sunken sidewalk panel reported about 40 metres ahead."** … then
  closer: **"…nearby. Be careful."**
- **Insert (2–3 s):** the map page on a phone: the blue *you are here* dot next to the pin.
- **Caption:** "Reported by the City of Ottawa 311 and other walkers · stored in Tiger Data · heard 40 m before you reach it."

### Scene 6: "Where's the nearest pothole?" (1:12–1:24)
- **Walker asks (clap first):** **"VisionCompanion, where's the nearest pothole?"**
- **Sound:** *"… potholes reported within 1 kilometre. Nearest: about 200 metres, in the road, at 235 Nicholas Street…"*
- **Alt shot (before leaving home):** at a front door, a VoiceOver user taps **🗣️ Potholes near me** and hears the same.
- **Caption:** both lines, question and answer.

### Scene 7: Door with steps (1:24–1:32), optional
- "Steps up ahead", then "Door ahead". **Caption:** "Steps, then a door."

### Scene 8: Français (1:32–1:42)
- Tap **Français**, then **Commencer**. Walk up to the stop sign: **"Panneau d'arrêt à droite"**.
- **Walker asks:** **"VisionCompanion, qu'y a-t-il devant ?"** → the answer in French, same voice.
- **Caption:** "Same voice, any language: Gemini + ElevenLabs." English subtitles.

### Scene 9: How it works (1:42–1:54)
- **Shot:** the README diagram and the 3D model (`docs/signal-path-3d.html`).
- **Voice-over:** "Almost every second, the phone sends a snapshot to Gemini, which finds the hazards in about two
  seconds. ElevenLabs' River says it, left or right, in the walker's ear. Hazards the city and other walkers
  reported live in Tiger Data, so it can warn you before the camera can see them."

### Scene 10: Close (1:54–2:00)
- **Shot:** the team. **Caption:** "VisionCompanion: Gemini sees. ElevenLabs speaks. Tiger Data remembers." Names + roles.

### Edit plan
| Time | Scenes |
|---|---|
| 0:00–0:10 | 1 Hook |
| 0:10–0:52 | 2–4 The camera: stop sign, crosswalk + refusal, pothole |
| 0:52–1:24 | 5–6 The hazard map: reported ahead, "where's the nearest pothole?" |
| 1:24–1:42 | 7 Door (optional), 8 French |
| 1:42–2:00 | 9 How it works, 10 Close |

"Read this" and "what am I holding" stay **out of the video** (a teaser at most): they're shown live (Part B).

---

# Part B: live demo for the judges (~3–4 min)

**At the table:** the Vercel link (no laptop needed), the demo iPhone in the chest mount or held at chest height,
**phone speaker on** (Shokz off so the judges hear it), location on. Props: a printed sign or menu (read this), a
water bottle (what am I holding), a chair or bag (blocking my path). A second phone or laptop on `…/?map`.

**Presenter** (holds the phone) + **Narrator** (talks to the judges). Open it from the **Companion** home-screen icon.

### 1. The pitch (30 s), Narrator
> "Over 300 million people worldwide are blind or have serious vision loss. A white cane finds what's on the ground right in front of you, but not the stop sign 50 feet ahead, the pothole coming up, or the branch at head height. VisionCompanion is a phone on your chest and open-ear headphones: it watches the path and tells you, out loud, what the cane can't find, including hazards other people already reported. And you can ask it anything."

### 2. Before leaving the house (20 s) ★ Tiger Data
- On the start screen, tap **🗣️ Potholes near me** → *"… potholes reported within 1 kilometre. Nearest: about 200 metres, in the road, at 235 Nicholas Street…"*
- *Narrator:* "The walker never sees a map, so the map talks. ~1,500 open City of Ottawa 311 reports plus what walkers' cameras saw, in Tiger Data."

### 3. Pick a voice (15 s), ElevenLabs
- Tap Alice, then Moyo: each says "Stop sign on your right" in that voice. Tap River last.

### 4. Start (10 s)
- **Start walk** → "Walk mode on", then the area briefing if reports are nearby.

### 5. "Read this" (30 s)
- Hold the sign ~40 cm in front of the camera. **"VisionCompanion, read this."** Point out the chimes and the pill: **Listening…** (bars follow the presenter's voice), **Thinking…**, then **River** as she reads. *"Those chimes mean it heard you: a blind user needs to know it's working."*

### 6. "What am I holding?" (20 s)
- Hold the bottle. **"VisionCompanion, what am I holding?"** → "A water bottle…"

### 7. "What's blocking my path?" (20 s)
- Chair in front: → "A chair ahead". Remove it, ask again → "Nothing detected in your path". *"It never says clear or safe."*

### 8. "Where's the nearest pothole?" (20 s)
- **"VisionCompanion, where's the nearest pothole?"** → distances and streets. Show the `?map` page: the pins, the blue dot, the nearest-report line.

### 9. The safety line (15 s)
- **"VisionCompanion, is it safe to cross?"** → the refusal. *"No camera can promise that, so it will never say it."*

### 10. It fails out loud (15 s)
- Cover the lens → **"Camera blocked"**. *"Silence never means all clear."*

### 11. Français (20 s), if time
- Tap **Français**. **"VisionCompanion, qu'y a-t-il devant ?"** → French, same voice. *"It never slips into English, and never says 'dégagé', the French for 'clear'."*

### 12. How it's built (30 s), Narrator
> "A snapshot every 0.8 seconds goes to Gemini 3.5 Flash-Lite, which returns hazards as structured data in about two seconds. The phone picks the one that matters and plays it in River's voice from ElevenLabs, panned left or right. Voice questions are one Gemini call with the audio and the camera frame together. Hazards live in Tiger Data: a hypertable of what walkers' cameras saw, with GPS and time, plus the city's open 311 reports. The phone loads everything within 1.5 km at Start and warns 40 metres ahead."

### If something goes wrong live
| Problem | Do this |
|---|---|
| No answer after a question | Say it again, clearly, starting with "VisionCompanion". The rising chime tells you it heard the name. |
| "No connection" | The phone lost internet: check Wi-Fi / cellular. |
| "I can't find your location" | Settings → Privacy & Security → Location Services → **Safari Websites** → **While Using the App**, Precise Location on. |
| Everything silent | Volume down, or the audio was interrupted (call/Siri): **Stop**, then **Start walk**. |
| Wrong answer | Say so honestly: "It's a snapshot model, it can miss things. That's why it never says 'safe'." |

### Likely judge questions
- **"Why not a live video model?"** The live Gemini API we tested only answers with audio, and the full model took 4–38 s per image. Flash-Lite answers in ~1.6–2 s with structured data we can filter, so it only speaks when it matters.
- **"How precise is the location?"** iPhone GPS, 5–15 m on a normal street. We smooth it, warn early by subtracting the GPS error, say left/right only once we know which way you're walking, and tell the walker when GPS is too weak.
- **"Why Tiger Data?"** Hazards are time-series: *where* and *when* matter (a pothole reported last week vs. last year). Walkers' sightings go into a TimescaleDB hypertable; the city's open reports sit beside them, refreshed daily.
- **"Why not announce people and cars?"** We did. In testing it never stopped talking and drowned out what mattered.
- **"Privacy?"** Snapshots aren't saved: each goes to Gemini and is discarded. The walker's own position isn't stored; only a hazard's position, when one is seen or pinned.
- **"What's next?"** A wearable camera instead of a phone, route planning around reported hazards, and sharing reports back to the city's 311.

---

## Backup: run it from the laptop (only if Vercel is down)
1. `cd ~/Downloads/SeeWalk && git pull && cd web && npm run build`
2. Server: `cd ~/Downloads/SeeWalk/server && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000`
3. App: `cd ~/Downloads/SeeWalk/web && npx vite preview --port 4173`
4. Tunnel: `cloudflared tunnel --protocol http2 --url http://localhost:4173` (a new link every time; re-add the home-screen icon)
5. `caffeinate -dimsu` to keep the Mac awake. The laptop needs `DATABASE_URL` in `server/.env` for the hazard map.

---

## Take log

| Scene | Take | Time | Clap at | Good? | Notes |
|---|---|---|---|---|---|
| | | | | | |
