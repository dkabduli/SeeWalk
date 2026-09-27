# PRD: Open like a real app (home-screen icon, full screen)

**Owner:** Abdul (built by Claude) · **Status:** built and verified on the laptop; waiting on the iPhone check (last box) · **Effort:** ~30–45 min

## Why
In the demo video, the app should look like an app, not a website: no Safari address bar, no toolbar, a real icon on the home screen. It also gives the walker more of the screen for the camera.

## What the walker (or filmer) does
1. Open the test link in **Safari** on the iPhone.
2. **Share → Add to Home Screen → Add.** The icon appears, named **Companion**.
3. Launch it from the icon. It opens full screen, with no browser controls. The clock and battery bar sits over the app's own dark background.

## Scope

| # | Piece | File(s) |
|---|---|---|
| 1 | **Icon:** the white cane band with its red tip, on the app's near-black `#0f1113`. The same mark as the wordmark in the top bar | `web/public/icons/icon.svg` (source), PNGs made from it |
| 2 | **Icon sizes:** 180 px (iPhone home screen), 192 + 512 px (Android / install), 512 px "maskable" (extra margin so Android's round/squircle crop never cuts the cane), 32 px favicon | `web/public/icons/*.png`, `web/public/favicon.svg` |
| 3 | **App description** (`manifest.webmanifest`): name, short name, `display: standalone`, dark theme/background colours, start at `/`, icons | `web/public/manifest.webmanifest` |
| 4 | **iPhone tags** in `index.html`: full-screen capable, status bar `black-translucent`, title `Companion`, `apple-touch-icon`, `viewport-fit=cover` (turns on the notch safe areas the CSS already uses) | `web/index.html` |
| 5 | **Fixes found on the way:** browser bar colour is the old teal (`#5ec8bd`) → `#0f1113`; `favicon.svg` is referenced but missing; the page's teal gradient would flash at launch → dark `html` background before the CSS loads | `web/index.html`, `web/public/favicon.svg` |
| 6 | **Guard test:** a test fails if someone later drops the manifest, a tag, or an icon, or changes an icon's size | `web/scripts/homeScreen.test.ts` |
| 7 | **Icon generator:** one script re-creates every PNG from the design, so the icon can be tweaked later | `web/scripts/make_icons.py` |

**Out of scope:** offline mode / service worker (the app needs the laptop server anyway), push notifications, iPhone launch-screen images (one per device size; the dark background covers it).

## Decisions
- **Name under the icon: "Companion".** iPhone cuts home-screen names at ~12 characters ("VisionCompa…"). The full name "VisionCompanion" stays in the app, the manifest `name`, and the browser tab. One line to change (`apple-mobile-web-app-title` + manifest `short_name`).
- **Status bar: `black-translucent`.** The app's dark background runs under the clock. The layout already pads for it with `env(safe-area-inset-top)`, which only works once `viewport-fit=cover` is on.
- **Icon design:** a real white cane held at an angle: steel-grey grip, white shaft, red band at the bottom, tapping the ground (two flat ripples). A first try without grip or ripples read as a thermometer. On near-black, inside Android's safe circle (furthest mark at 39% of the width, limit 40%). Flat, same colours as the app. The 32 px browser-tab icon drops the ripples, which turn to mush that small.
- **No service worker.** It would add caching risk (stale builds during a hackathon) for no benefit: the app can't work without the server.

## Gotchas (tell the team)
- **The icon remembers the link it was added from.** Quick tunnels get a new link on every restart, so after a restart the icon opens a dead page. **Add it after the final tunnel start and don't restart before filming**; otherwise delete and re-add it.
- **The home-screen app has its own storage and permissions, separate from Safari.** On first launch it asks for camera + mic again, plays the intro again, and uses the default voice. Do one practice run from the icon before filming.
- **Older iOS:** camera works in home-screen apps on iOS 13.4+. Keeping the screen awake (wake lock) from a home-screen app only works on newer iOS (18.4+); on older phones set **Auto-Lock: Never** (already in the demo checklist).

## Done when
- [x] `/manifest.webmanifest` loads as JSON with `display: standalone`, dark colours, and icons that all load at their stated sizes
- [x] `index.html` has the manifest link, apple tags, `viewport-fit=cover`, dark theme colour, and a favicon that exists
- [x] Icon checked visually at 180 px and in a round crop (Android)
- [x] Guard test passes; typecheck, lint, all tests, and the build pass
- [x] Served through the tunnel: manifest and icons load over HTTPS
- [ ] **On the iPhone (Abdul):** Add to Home Screen shows the icon named "Companion"; it opens full screen; camera, mic and voice work; nothing is hidden under the notch or the home bar
