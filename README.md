# Writing Sessions

An iPhone-first PWA for immersive writing sprints: slow cinematic looping scenes, ambient sound, soft chimes and a big
serif countdown — in the spirit of the "immersive writing session" videos, but built from your own theme packs.
Plain HTML/CSS/ES-modules, no build step, no dependencies.

## Run locally
```
npx http-server -p 8099 -c-1        # or: python3 -m http.server (video seeking works better with http-server)
open http://localhost:8099/?speed=60
```
Debug query params: `?speed=60` runs the session clock 60× faster (chimes/fades/scene changes still fire); `?autostart=<themeId>` opens a theme's start sheet.
In the running page, `window.__ws` (player) and `window.__app` expose state (`__ws.events`, `__ws.stage.log`, `__app.audio.chimeLog`).

## Session model (`js/engine.js`)
`intro (55 s, optional) → sprint 1 → break 1 → … → sprint N → outro (45 s, optional)` — **no break after the last sprint**.
Presets: **Classic** 4×25/5 (≈1h57m with intro/outro), **30 / 2** (2×30, 2 min breaks), **60 / 10** (2×60, 10 min breaks), **Custom**
(sprint minutes 1–180, break minutes 0–60, sprints 1–12). Settings (incl. volumes, intro/outro, delivery) persist in `localStorage` (`ws.settings.v1`).
Overlay: lower-left `SPRINT n/N` / `BREAK` over a large `MM:SS`, thin progress bar along the bottom (current segment), welcome/outro cards, gentle break text.

## Audio (`js/audio.js`)
Web Audio (iOS ignores `<audio>.volume`, so fades use GainNodes). Everything is scheduled on the audio clock so it stays on time even when
the page is throttled with the screen locked.
* **Chimes** are synthesized bell partials (no samples) at every transition: start, sprint (rising pair), break (falling pair), outro, end.
* **Music** (the pack's tracks, shuffled, 3 s crossfades) fades out at each break and back in for the next sprint; the **ambience** loop swells up during breaks.
* A silent looping `<audio>` element keeps the iOS audio session alive and gives lock-screen controls (Media Session metadata + play/pause/next/prev).
* Screen stays awake with the Wake Lock API; falls back to a hidden 1-px looping video if unavailable/denied.
Audio only starts from the *Begin session* tap (iOS requirement).

## Theme packs (`themes/<id>/`)

Each theme is a folder listed in `themes/index.json`, described by its `manifest.json`.

**Schema 3: journeys with a live window (what Dark Academia Train uses).** The full spec and the step-by-step build process are in [`docs/THEME_RECIPE.md`](docs/THEME_RECIPE.md).

- Every leg is a **cruise**: the window is drawn live on a `<canvas>` by `js/window.js` (parallax backdrop / mid / near layers, fog, rain or snow, sway, behind a window-frame overlay). It is always moving, loops forever without a seam and is a pure function of the session clock, so seeks, backgrounding and rotation can never desync it.
- Each cruise segment has **one landmark** that slides past once, then the next segment (new backdrop and landmark); a new zone starts each leg.
- `stations[5]` are the intro, the 3 break platforms and the arrival: short seamless video loops (`clips/loop-*.mp4`). The canvas speed ramps down to a stop and back up.
- `legs[4]` each have 4 `segments` (backdrop, mid, landmark, weather, per-segment ambience), a base `ambience` and a `music` pool of 1–2 songs × 2 versions.
- Cruise assets are ~43 small images in `zones/<zone>/` (≈4 MB; the old chained-clip version was ≈104 MB).
- `ambienceLib` lists the looped layers in `audio/amb/`, which are CC0 Freesound recordings. Each segment mixes its own layers (the train bed is mid-boosted so it is audible on a phone speaker).
- `credits` records the source and licence of every audio file.
- `status`, `owner` and `origin` are forward-compatible fields; no UI uses them yet.
- `js/journey.js` plans the journey for any session length:
  - stations go to the breaks nearest each leg boundary;
  - the arrival lands at the end;
  - each segment dwells for at least 45 s, and its landmark window is fixed by the planner.
- `js/scenes.js` `WindowStage` shows the canvas for cruise items and a video loop for stops (plain cross-fades, so skips and seeks need no clip chaining; Ken Burns still if a loop fails). `JourneyStage` still plays older schema-2 chained-clip themes.
- `preview.html?theme=<id>` previews any stop loop or live cruise segment (speed toggle, jump to its landmark) with its ambience mix, and holds per-item notes and the ambience QA table.
- `THEME=<id> node tools/e2e.mjs` runs the end-to-end suite for any theme (`BROWSER=webkit` for WebKit); `tools/window_qa.mjs` saves a PNG of every cruise segment mid-landmark.
- Build tools:
  - `tools/seam_fix.py` (seam smoothing + encode);
  - `tools/match_clips.py` (verifies each clip's endpoints);
  - `tools/fs_search.py` (Freesound CC0 search);
  - `tools/make_ambience.py` (loop, loudness-match and QA the layers);
  - `tools/process_window_assets.py` (turns generated images into backdrop / layer / landmark assets);
  - `tools/build_train_manifest.py`;
  - `tools/serve_range.py` (static server with HTTP Range, needed for video in WebKit).

**Schema 1** (a flat `scenes[]`, `music[]` and one ambience file) is still supported by the player.

## Request tab → delivery (`js/request.js`, `js/config.js`)
The form (theme, mood, music notes) builds `{id, createdAt, theme, mood, music, status}`, stores it in `localStorage` (`ws.requests.v1`) and shows a **Sent** state + history.
Delivery is one pluggable function, `submitRequest(req, settings)`:
1. **Webhook** (Settings → *Webhook URL*, or `CONFIG.REQUEST_WEBHOOK_URL` in `js/config.js`): `POST` JSON
   `{"id","createdAt","theme","mood","music","app":"writing-sessions","status":"pending"}`.
   If the URL starts with `https://ntfy.sh/` it posts a plain-text body with a title instead — a no-account way to get a phone push and let an agent poll `https://ntfy.sh/<topic>/json?poll=1`.
   If the POST fails the request is saved as *queued* and a "send by email instead" link appears.
2. **mailto fallback** (default when no webhook): opens a prefilled email to Settings → *Email for requests* (or `CONFIG.REQUEST_MAILTO_TO`).
   Until a recipient is set the mail app opens with an empty "To".
To change the transport, edit only `submitRequest`.

## PWA
`manifest.webmanifest` + icons (180/192/512/maskable) for Add to Home Screen; `sw.js` precaches the app shell (stale-while-revalidate).
Media files are deliberately not routed through the service worker (iOS Range requests) — they use the HTTP cache. Bump `VER` in `sw.js` when shipping changes.

## Tests
`tools/e2e.mjs` (Playwright, iPhone 14 viewport): see `screenshots/` and the test log in the task report.
Note Playwright's Chromium has no H.264, so the test serves WebM bytes for the `.mp4` URLs; real iOS Safari plays the mp4s natively.

## Deploy
Static files only. GitHub Pages: push this folder to a repo and enable Pages (root). Any static host works (needs HTTPS for the service worker, Wake Lock and Add to Home Screen).
