# Sample photos

Chest-height photos from around uOttawa for testing Gemini (`server/scripts/eval_samples.py`). Every file is resized to 768 px, JPEG quality 70 (the same as the phone sends) and **stripped of metadata** (no GPS). People are cropped out.

The first 8 are at night; the `day_…` ones are daylight (what the demo is filmed in).

| File | What's in it | Gemini should report | Must NOT report |
|---|---|---|---|
| `stop_sign_crosswalk_1.jpg` | Bilingual ARRÊT/STOP sign on a pole, painted crosswalk in front | `stop_sign` ahead/right, `crosswalk` ahead | anything "safe to cross" |
| `stop_sign_crosswalk_2.jpg` | Same corner, wider: stop sign, crosswalk, traffic cones down the road, bin on the sidewalk | `stop_sign`, `crosswalk` ahead | cones far down the road as in-path obstacles |
| `yield_sign_hydrant_crosswalk.jpg` | Yield sign, lamppost and fire hydrant on the corner, crosswalk edge | `crosswalk` and/or `curb_or_dropoff`; a `pole` only if its base is in the walking line | the yield sign as a stop sign; the hydrant on the grass as an obstacle |
| `bins_obstacle_in_path.jpg` | Row of three garbage/recycling bins blocking the sidewalk | `obstacle_in_path` ahead, close/near | |
| `hydrant_cracked_sidewalk.jpg` | Fire hydrant on the grass beside the sidewalk, crack in the pavement | `uneven_surface` (crack) at most; hydrant is off the path | hydrant as in-path obstacle |
| `lamppost_sign_sidewalk.jpg` | Lamppost and parking sign on the grass edge of a sidewalk | nothing (the post is beside the path) | `pillar`, or the lamp post as a hazard |
| `blurry_sign_closeup.jpg` | Blurry close-up of a parking sign | `unclear: true` or nothing | invented hazards |
| `indoor_menu_board.jpg` | Restaurant menu TV, indoors (negative control) | nothing | any hazard |
| `day_bike_rack_parked_bikes_sidewalk.jpg` | Metal bike rack right in front, parked bikes along the sidewalk | `obstacle_in_path` ahead, close (the rack) | a bike **approaching** (they're parked: `approaching: false`) |
| `day_parked_ebike_curb_street.jpg` | Parked e-bike at a rack on the curb, street beyond | parked bike as an obstacle, close; possibly `curb_or_dropoff` ahead | bike approaching; the distant parked car or cones as hazards |
| `day_door_button_post_glass_door.jpg` | Accessible-door button post directly in front of a glass door (photographer's reflection) | `door` (the corridor ends at the glass) and `pole` for the thin button post | the post as `pillar`; the reflection as a person |
| `day_closed_glass_door.jpg` | Closed glass door ("Tirez / Pull") filling the view | `door` ahead, close (the walker is walking into it; glass under 2 m is urgent) | "clear" or nothing |
| `day_indoor_pillar_sign_stairs_up.jpg` | Wayfinding sign on a pillar right ahead, stairs going **up** in the background | `pillar` ahead, close | `pole` (it is a wide column); `stairs_down` (the stairs go up, and are far) |
| `day_wall_water_fountains_protruding.jpg` | Wall-mounted water fountains sticking out at waist height | obstacle at the side/ahead: things that **protrude from walls are a classic white-cane miss** | nothing |
| `day_exit_door_stairs_sign.jpg` | Closed emergency exit door with an "F1 stairs / Sortie Exit" sign | `door` ahead (the corridor ends at it) | `stairs_down`: it's a sign, not actual stairs |

Source photos: `IMG_6362`–`IMG_6378` (Abdul). Skipped `IMG_6365` (another close-up of the same parking signs) and `IMG_6369` (near-duplicate of `IMG_6368`).

## Photos from Wikimedia Commons (`web_…`)
Added so the prompt is tested on more street hazards than we could photograph ourselves. Same processing (768 px, JPEG q70, metadata stripped). Landscape photos are kept as they are.

| File | What's in it | Gemini should report | Must NOT report |
|---|---|---|---|
| `web_broken_sidewalk.jpg` | Sidewalk with broken, patched asphalt | `uneven_surface` ahead | nothing |
| `web_building_entrance_far.jpg` | Glass building entrance ~15 m away, one cone | `door` (far) at most | urgent hazards |
| `web_clear_empty_sidewalk.jpg` | Empty sidewalk beside a road (negative) | no street alert | any street alert |
| `web_clear_tree_lined_sidewalk.jpg` | Sidewalk under high oak branches | nothing, or real cracks as `uneven_surface` | `head_height_obstacle` (branches are high) |
| `web_construction_barriers_cones.jpg` | Barriers and cones across the path | `construction` ahead |  |
| `web_heaved_sidewalk_tree_root.jpg` | Pavement lifted by a tree root | `uneven_surface` |  |
| `web_hole_in_pavement.jpg` | Hole in the pavement, seen from above | `pothole` close |  |
| `web_plaza_sidewalk_benches.jpg` | Wide plaza sidewalk, benches, manhole cover (negative) | no street alert (a bench at the side may be a `chair`, which is asked about, not announced) | manhole cover as an obstacle |
| `web_pothole_closeup.jpg` | Pothole close-up | `pothole` |  |
| `web_revolving_doors_ahead.jpg` | Two steps up to revolving doors | `steps_up` + `door` ahead | `stairs_down` |
| `web_sidewalk_closed_cones.jpg` | 'Sidewalk closed ahead' sign with cones | `construction` ahead |  |
| `web_stop_sign_20ft_behind_parking_signs.jpg` | Stop sign ~20 ft (6 m) away behind parking signs | `stop_sign` (must: the 20 ft case) | parking signs as hazards |
| `web_stop_sign_beside_path.jpg` | Stop sign beside a narrow path | `stop_sign` left |  |
| `web_traffic_light_stop_sign_intersection.jpg` | Intersection: traffic lights, stop sign, crosswalk | `traffic_light`, `stop_sign`, `crosswalk` | any light colour or 'go' |

### Credits (all freely licensed; resized)
| File | Author | License | Source |
|---|---|---|---|
| `web_broken_sidewalk.jpg` | Unregistrierter Nutzer | CC BY-SA 4.0 | [File:Zustand des Gehsteiges ist eine Stolperfalle (Max-Planck-Straße) (2024-06-21) 01.jpg](https://commons.wikimedia.org/wiki/File:Zustand_des_Gehsteiges_ist_eine_Stolperfalle_(Max-Planck-Stra%C3%9Fe)_(2024-06-21)_01.jpg) |
| `web_building_entrance_far.jpg` | Solomon203 | CC BY 3.0 | [File:China Television Building glass doors 20100426.jpg](https://commons.wikimedia.org/wiki/File:China_Television_Building_glass_doors_20100426.jpg) |
| `web_clear_empty_sidewalk.jpg` | Apelcini | CC BY-SA 4.0 | [File:Empty Winter Sidewalk.jpg](https://commons.wikimedia.org/wiki/File:Empty_Winter_Sidewalk.jpg) |
| `web_clear_tree_lined_sidewalk.jpg` | Infrogmation of New Orleans | CC BY-SA 4.0 | [File:Baronne Street at Napoleon Double Sign, Uptown New Orleans - 04.jpg](https://commons.wikimedia.org/wiki/File:Baronne_Street_at_Napoleon_Double_Sign,_Uptown_New_Orleans_-_04.jpg) |
| `web_construction_barriers_cones.jpg` | Samuel Zeller samuelzeller | CC0 | [File:London sidewalk construction (Unsplash).jpg](https://commons.wikimedia.org/wiki/File:London_sidewalk_construction_(Unsplash).jpg) |
| `web_heaved_sidewalk_tree_root.jpg` | Eden, Janine and Jim | CC BY 2.0 | [File:Cracked sidewalk in Manhattan.jpg](https://commons.wikimedia.org/wiki/File:Cracked_sidewalk_in_Manhattan.jpg) |
| `web_hole_in_pavement.jpg` | ŠJů | CC BY 4.0 | [File:Krč, Vídeňská, díra v chodníku.jpg](https://commons.wikimedia.org/wiki/File:Kr%C4%8D,_V%C3%ADde%C5%88sk%C3%A1,_d%C3%ADra_v_chodn%C3%ADku.jpg) |
| `web_plaza_sidewalk_benches.jpg` | Eric Fischer | CC BY 2.0 | [File:Empty sidewalk with a van parked on it (18623476739).jpg](https://commons.wikimedia.org/wiki/File:Empty_sidewalk_with_a_van_parked_on_it_(18623476739).jpg) |
| `web_pothole_closeup.jpg` | Unregistrierter Nutzer | CC BY-SA 4.0 | [File:Zustand des Gehsteiges ist eine Stolperfalle (Max-Planck-Straße) (2024-06-21) 03.jpg](https://commons.wikimedia.org/wiki/File:Zustand_des_Gehsteiges_ist_eine_Stolperfalle_(Max-Planck-Stra%C3%9Fe)_(2024-06-21)_03.jpg) |
| `web_revolving_doors_ahead.jpg` | Solomon203 | CC BY 3.0 | [File:Chung Sheng Building entrance 20100426.jpg](https://commons.wikimedia.org/wiki/File:Chung_Sheng_Building_entrance_20100426.jpg) |
| `web_sidewalk_closed_cones.jpg` | Missvain | CC BY 4.0 | [File:Crosswalk light construction in Sonoma - January 2024 - Sarah Stierch.jpg](https://commons.wikimedia.org/wiki/File:Crosswalk_light_construction_in_Sonoma_-_January_2024_-_Sarah_Stierch.jpg) |
| `web_stop_sign_20ft_behind_parking_signs.jpg` | Artaxerxes | CC BY-SA 4.0 | [File:Street signs Church and Main Streets downtown Saint Johnsbury VT September 2017.jpg](https://commons.wikimedia.org/wiki/File:Street_signs_Church_and_Main_Streets_downtown_Saint_Johnsbury_VT_September_2017.jpg) |
| `web_stop_sign_beside_path.jpg` | Ser Amantio di Nicolao | CC BY-SA 4.0 | [File:Franklin Sidewalk - corner by a stop sign.jpg](https://commons.wikimedia.org/wiki/File:Franklin_Sidewalk_-_corner_by_a_stop_sign.jpg) |
| `web_traffic_light_stop_sign_intersection.jpg` | The Bushranger | CC BY-SA 4.0 | [File:Pedestrian crossing signal on EB US98, Carrabelle Beach, Florida.jpg](https://commons.wikimedia.org/wiki/File:Pedestrian_crossing_signal_on_EB_US98,_Carrabelle_Beach,_Florida.jpg) |

## Still needed (daylight, chest height, phone upright)
- [ ] Person walking toward the camera (a teammate), from the left and from the right
- [ ] Bike or scooter **moving** on a path (parked ones are covered)
- [ ] Car pulling out of a driveway / crossing the path
- [ ] Stairs going down, and a curb drop seen from the sidewalk
- [x] Pothole or broken pavement (web photos)
- [ ] Low branch at head height
- [x] Construction fence or sign on the sidewalk (web photos)
- [x] A clear, empty path (web photos)

## Adding photos
Use the script. It rotates the photo upright, resizes to 768 px, saves JPEG q70 and **drops all metadata (GPS)**. Plain `sips` keeps the rotation flag and GPS, so don't use it.
```bash
server/.venv/bin/pip install pillow pillow-heif                                     # one time
server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1234.HEIC person_left
server/.venv/bin/python samples/prepare_photos.py ~/Downloads/IMG_1235.HEIC bins --crop 0 0 0.8 1
```
`--crop` is left top right bottom as fractions (use it to cut out sky, faces and non-teammates). Then add a row to the table above with what Gemini should and shouldn't report.
