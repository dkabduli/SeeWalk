# Shot list: SeeWalk demo video

**Film:** Saturday 4:30–6:45 PM (sunset ~7 PM). **Backup reshoot:** Sunday 7–8 AM.
**Target:** ~2:00 final cut. **3+ takes per scene**; note the good takes in the log at the bottom.

Before the first take:
- [ ] Gemini billing on (Abdul), `VITE_FRAME_INTERVAL_MS=1500`, **production build** (`npm run build && npm run preview`) + fresh tunnel URL
- [ ] Demo iPhone: Auto-Lock → Never, volume up, Bluetooth headphones paired, **Screen Recording on** (captures SeeWalk's audio)
- [ ] Filming phone: 1080p / 30 fps, landscape, lens wiped
- [ ] Server laptop online (campus Wi-Fi or hotspot), plugged in
- [ ] Props: chair or bin (obstacle), a teammate to walk toward the camera

## Scenes

| # | Scene | Where | What happens | SeeWalk should say | Caption on screen | Shots |
|---|---|---|---|---|---|---|
| 1 | Hook | Campus path | Walker with a white cane clips on the chest phone + open-ear headphones | (silence) | "A white cane finds the ground." | Wide + close on the phone mount |
| 2 | Person approaching | Quiet path | Teammate walks toward the walker from the left | "Person on your left" | same + "🔊 left ear" | Wide from behind the walker |
| 3 | Bike | Bike path / rack area | Teammate rides slowly toward the walker (or walker passes a bike rack) | "Bike ahead" | same | Wide |
| 4 | Stop sign | Street corner | Walker approaches a stop sign | "Stop sign ahead" | same | Wide + phone screen close-up |
| 5 | Crosswalk | Painted crossing | Walker approaches the crosswalk and stops | "Crosswalk ahead" | same (never "safe to cross") | Wide |
| 6 | Curb / pothole | Sidewalk edge / cracked pavement | Walker approaches | "Curb ahead" / "Pothole ahead" | same | Low angle on the ground |
| 7 | Head height | Low branch, sign or protruding fountain | Walker approaches something the cane would miss | "Obstacle at head height" | "The cane can't find this one." | Side angle showing the cane passing under it |
| 8 | Obstacle | Path | Chair or bin placed in the path | "Obstacle in your path" | same | Wide |
| 9 | Bilingual | Repeat scene 4 | Switch to Français, walk up again | "Panneau d'arrêt devant" | FR caption + EN subtitle | Phone screen close-up |
| 10 | "What's ahead?" | Anywhere | Walker says "SeeWalk, what's ahead?" or taps the lower half of the screen | Answer from Gemini, or "Nothing detected" | "Ask any time, hands-free." | Close on the walker |
| 11 | Honesty | Anywhere | Hand over the lens → ask "What's ahead?" | "Camera blocked" / "Unclear" | "It says unclear instead of guessing." | Close |
| 12 | Fail out loud | Anywhere | Turn on airplane mode mid-walk, then off | "No connection, I can't see right now" → "Connection back" | "Silence never means all clear." | Close on the phone screen |
| 13 | How it works | Screen recording | 3D model (`docs/signal-path-3d.html`) + README diagram | (voice-over) | "Gemini sees. ElevenLabs speaks." | Laptop screen capture |
| 14 | Team | Anywhere | All four together | (none) | Names + roles | Wide |

## Locations to scout (Saturday morning)

| Needed for | Candidate spot | Checked? |
|---|---|---|
| Quiet path (2, 3, 8) | | ☐ |
| Real stop sign (4, 9) | | ☐ |
| Painted crosswalk (5) | | ☐ |
| Curb + rough pavement (6) | | ☐ |
| Head-height hazard (7): low branch, sign or wall fountain | | ☐ |

## Edit plan (~2:00)

| Time | Section | Scenes |
|---|---|---|
| 0:00–0:15 | Hook | 1 |
| 0:15–1:15 | Field walk | 2–10 |
| 1:15–1:35 | Trust | 11, 12 |
| 1:35–1:50 | How it works | 13: "Gemini 3.5 Flash-Lite sees each snapshot in ~1.2 s; ElevenLabs speaks it in ~0.2 s" |
| 1:50–2:00 | Vision + team | 14: "Bilingual from day one. Phone today, wearable tomorrow." |

Rules: captions on every spoken alert (people watch muted); use the demo phone's screen-recording audio, not the filming phone's mic; real audio only, never dubbed; no blindfold "simulations".

## Take log

| Scene | Take | Time | Good? | Notes |
|---|---|---|---|---|
| | | | | |
