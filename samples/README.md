# Sample photos

Chest-height photos from around uOttawa for testing Gemini (`server/scripts/eval_samples.py`). Every file is resized to 768 px, JPEG quality 70 (the same as the phone sends) and **stripped of metadata** (no GPS). People are cropped out.

**All of these are at night.** The demo is filmed in daylight, so we still need daytime photos.

| File | What's in it | Gemini should report | Must NOT report |
|---|---|---|---|
| `stop_sign_crosswalk_1.jpg` | Bilingual ARRÊT/STOP sign on a pole, painted crosswalk in front | `stop_sign` ahead/right, `crosswalk` ahead | anything "safe to cross" |
| `stop_sign_crosswalk_2.jpg` | Same corner, wider: stop sign, crosswalk, traffic cones down the road, bin on the sidewalk | `stop_sign`, `crosswalk` ahead | cones far down the road as in-path obstacles |
| `yield_sign_hydrant_crosswalk.jpg` | Yield sign, lamppost and fire hydrant on the corner, crosswalk edge | `crosswalk` and/or `curb_or_dropoff`; lamppost/hydrant as `obstacle_in_path` only if in the walking line | the street-name sign as a hazard |
| `bins_obstacle_in_path.jpg` | Row of three garbage/recycling bins blocking the sidewalk | `obstacle_in_path` ahead, close/near | |
| `hydrant_cracked_sidewalk.jpg` | Fire hydrant on the grass beside the sidewalk, crack in the pavement | `uneven_surface` (crack) at most; hydrant is off the path | hydrant as in-path obstacle |
| `lamppost_sign_sidewalk.jpg` | Lamppost and parking sign on the grass edge of a sidewalk | nothing, or a low-urgency edge obstacle | anything urgent |
| `blurry_sign_closeup.jpg` | Blurry close-up of a parking sign | `unclear: true` or nothing | invented hazards |
| `indoor_menu_board.jpg` | Restaurant menu TV, indoors (negative control) | nothing | any hazard |

Source photos: `IMG_6362`–`IMG_6371` (Abdul). Skipped `IMG_6365` (another close-up of the same parking signs) and `IMG_6369` (near-duplicate of `IMG_6368`).

## Still needed (daylight, chest height, phone upright)
- [ ] Person walking toward the camera (a teammate), from the left and from the right
- [ ] Bike or scooter on a path
- [ ] Car pulling out of a driveway / crossing the path
- [ ] Stairs going down, and a curb drop seen from the sidewalk
- [ ] Pothole or broken pavement
- [ ] Low branch at head height
- [ ] Construction fence or sign on the sidewalk
- [ ] A clear, empty path (should report nothing)

## Adding photos
Use the script. It rotates the photo upright, resizes to 768 px, saves JPEG q70 and **drops all metadata (GPS)**. Plain `sips` keeps the rotation flag and GPS, so don't use it.
```bash
server/.venv/bin/pip install pillow pillow-heif                                     # one time
server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1234.HEIC person_left
server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1235.HEIC bins --crop 0 0 0.8 1
```
`--crop` is left top right bottom as fractions (use it to cut out sky, faces and non-teammates). Then add a row to the table above with what Gemini should and shouldn't report.
