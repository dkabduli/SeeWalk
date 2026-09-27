# PRD: Hazards from the map, by ear (location alerts)

**Owner:** Abdul (built by Claude) · **Builds on:** Siddig's hazard map (Tiger Data, Ottawa 311, "Reported nearby")

## The point
The walker is blind or has low vision: **they never see the map**. The map only matters if it turns into
sound at the right moment: *what* is reported, *how far*, *which side* relative to the way they're walking,
and *whether the location can be trusted right now*. The screen map (`?map`) is for sighted helpers,
setting up the demo, and judges.

## What the walker hears

| When | Sound + words (EN) | FR |
|---|---|---|
| Walk starts, location on | nothing extra (Siddig's short area briefing already plays after Start) | |
| Location permission denied / unavailable | once: *"Location is off. Reported hazards won't be announced."* | *"Localisation désactivée. Les dangers signalés ne seront pas annoncés."* |
| GPS too weak (worse than ±50 m) for 20 s | once: *"Location is weak. Reported hazards paused."* | *"Localisation faible. Dangers signalés en pause."* |
| GPS good again | once: *"Location back."* | *"Localisation rétablie."* |
| A reported hazard **ahead**, ~40 m | map chime, then *"Pothole reported about 40 metres ahead."* (panned to its side if ahead-left/right) | *"Nid-de-poule signalé à environ 40 mètres devant."* |
| Any reported hazard within ~15 m | map chime, then *"Pothole nearby, on your left. Be careful."* | *"Nid-de-poule tout près, à gauche. Attention."* |
| Camera sees it too, within ~20 m of a known one | the camera alert as usual (*"Pothole ahead"*); the map alert for it is not repeated | |
| **"VisionCompanion, what's around me?"** | *"Reported within 200 metres: a pothole about 40 metres ahead, on your right; a lifted sidewalk panel about 120 metres behind you."* / *"Nothing reported within 200 metres."* (never "clear") | *"…qu'y a-t-il autour de moi ?"* |

- **Map chime:** a soft, lower two-note tone, different from the camera's tone, so the walker knows it's *reported*,
  not *seen*. Panned left/right like camera alerts.
- **Priority:** below camera alerts and answers. A map alert never interrupts anything; it waits (up to 10 s)
  for silence, then plays, or is dropped for that stage if the moment passed.
- **Distances** are rounded to 10 m ("about 40 metres"); under 15 m it's "nearby", not a number.
- **Only walkway hazards** alert: potholes/uneven pavement/curbs/obstacles/construction on the sidewalk, from other
  walkers, pins placed on purpose, and Ottawa 311 sidewalk reports. 311 potholes *in the road* stay on the screen map only (Siddig's rule: a walker isn't in the road).

## Where the walker is: GPS, honestly

- The iPhone's GPS (`watchPosition`, high accuracy) is the best source a web app has: **5–15 m** outdoors on a normal
  street, 20–50 m between tall buildings. It reports its own accuracy with every fix. Gemini and Google Maps can't
  improve on it (Google's snap-to-road puts you in the middle of the road; Gemini can't locate a photo better than GPS).
- **Smoothing:** the position used is an accuracy-weighted average of the fixes from the last ~5 s (jumpy single
  fixes don't cause alerts).
- **Direction of travel:** iOS's own `heading` when walking (speed ≥ 0.5 m/s); otherwise the bearing of the walker's
  last ≥ 8 m of movement. No direction yet (just started, standing still) → only the "nearby" stage, never "ahead".
- **Relative side:** bearing to the hazard minus direction of travel: within ±45° = *ahead*, 45–135° = *on your
  left/right*, beyond = *behind* (never announced as a heads-up).

## The algorithm (per GPS fix, on the phone)

```
d_eff = max(0, distance(position, hazard) − accuracy)      # "it could be this close": warn early, never late
heads-up  once per hazard: d_eff ≤ 40 m AND side = ahead AND direction known AND accuracy ≤ 50 m
nearby    once per hazard: d_eff ≤ 15 m AND accuracy ≤ 50 m
```
- At walking speed (1.3 m/s) that's ~30 s and ~10 s of warning.
- Subtracting the accuracy widens the zone when GPS is poor (±25 m → the "nearby" zone starts at ~40 m) and keeps it
  tight when GPS is good; beyond ±50 m nothing is announced (and the walker is told once).
- Each stage once per hazard per walk. The camera linking: if the camera reported a matching type (pothole, uneven
  pavement, curb, obstacle, construction) in the last 10 s and a known hazard of that type is within 20 m, both of its
  stages are marked said (the walker already heard the camera).

## Loading the hazards (no waiting on the network mid-walk)
- On **Start**, as soon as there's a usable fix: load every walkway hazard within **1.5 km** in one request
  (`/hazards/near?radius=1500`), keep it on the phone. All distance checks are local.
- Reload when the walker is 750 m from where the list was loaded, or every 5 minutes (new pins and sightings).

## The screen map (`?map`) for helpers and the demo
- **You are here:** a live blue dot with its accuracy circle, following the phone; "Nearest reported: pothole, 38 m".
- **📍 Pin a hazard here** (type picker, pothole by default): saved as source `pinned`, which **does** alert walkers.
  (Siddig's `test` pins stay excluded from alerts: they're for automated smoke tests.)

## Demo script
1. Find a real pothole. Stand beside it, open `…/?map`, tap **📍 Pin a hazard here → Pothole**.
2. Walk ~100 m away, turn around, open the app, **Start walk**.
3. Walk toward it: ~40 m *"Pothole reported about 40 metres ahead"*, ~15 m *"Pothole nearby. Be careful."*, then the
   camera: *"Pothole ahead."*
4. Ask *"VisionCompanion, what's around me?"* anywhere on the way.

## Build steps
1. `web/src/map/geo.ts`: distance, bearing, side-of-travel, fix smoothing, direction of travel. Unit tests.
2. `web/src/map/locationAlerts.ts` (replaces `nearbyAlerts.ts`): preload, the two stages, GPS status, camera linking,
   "what's around me" text. Unit tests with simulated walks (straight approach, passing on the other side of the
   street, standing still, GPS jitter, weak GPS, walking away, reload after moving).
3. Server: `/hazards/near` radius up to 2000 m; `pinned` source saved and included in walk alerts; tests.
4. `listen.py`: new command `around` (EN/FR keywords). Tests.
5. `WalkMode`: map chime, spoken lines + priority queue, GPS status lines, "what's around me", camera linking. EN/FR strings.
6. `?map`: you-are-here dot + accuracy circle + nearest line; **Pin a hazard here** with type.
7. Verify: unit tests; a simulated walk in the browser (fake GPS) listening to the log; deploy to Vercel; a real
   pinned test hazard near a chosen spot, removed afterwards.

## Done when
- [ ] All the rows in "What the walker hears" happen in the simulated walk, in EN and FR
- [ ] No map alert ever interrupts a camera alert or an answer
- [ ] Unit tests for geo, both stages, GPS status, camera linking, preload, "what's around me"; all suites pass
- [ ] Live on https://visioncompanion.vercel.app; a pinned hazard is announced on approach (checked with fake GPS)
- [ ] **On the iPhone (Abdul):** a real pinned pothole announced at ~40 m and ~15 m on a real walk
