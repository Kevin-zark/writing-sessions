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
Add a folder with a `manifest.json` and list its id in `themes/index.json`:
```jsonc
{
  "id": "dark-academia-train", "title": "…", "description": "…", "cover": "scenes/x.jpg", "accent": "#d9b26f",
  "sceneMode": "journey",            // "journey" = walk first→last scene, "cycle" = loop them
  "scenes": [{ "id": "window", "title": "…", "clip": "scenes/x.mp4", "still": "scenes/x.jpg" }],
  "music":  [{ "title": "…", "src": "audio/track1.mp3" }],           // Suno exports go here
  "ambience": { "src": "audio/ambience.mp3" },                        // seamless loop
  "intro": { "lines": ["Welcome, Writers..."] }, "breakText": ["…"], "breakEndText": "…",
  "outro": { "lines": ["Beautiful work, my friend!"] }
}
```
* **Clips**: 6–10 s seamless loops, H.264 mp4 (`-pix_fmt yuv420p -movflags +faststart`), muted, ≤ ~2 MB each. They play with `muted loop playsinline`.
  The sample clips were generated image→video with the first and last frame set to the same still so they loop.
* **Fallback**: if a clip is missing, fails, or autoplay is blocked (Low Power Mode) the still gets a slow Ken Burns pan instead.
* **Scene changes** (`planScenes`): slots = max(scenes, sprints); cuts snap to the nearest sprint/break boundary when one is within 30 % of a slot,
  otherwise land mid-sprint, so changes are spread evenly. Crossfade is 3 s.
* **Sample pack**: stills + clips are AI-generated (Grok Imagine). **Music/ambience are procedural placeholders** made by
  `tools/make_placeholder_audio.py` (numpy + ffmpeg, fully original — no samples). Replace with Suno tracks by dropping mp3s into `audio/` and editing `music[]`.

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
