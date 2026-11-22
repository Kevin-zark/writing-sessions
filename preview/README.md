# Seek-sync preview

This folder is a standalone copy of the Writing Sessions PWA used to try the seek-sync timeline **without replacing the live app**.

- URL (after push): https://kevin-zark.github.io/writing-sessions/preview/
- Service worker: `ws-preview-seek-v1`, scope `/writing-sessions/preview/`
- Theme media is loaded from `../themes/` (not duplicated here)
- The live app stays on `ws-v9` at the site root

If an already-installed live service worker (scope `/writing-sessions/`) serves a stale page on first visit, open this URL in a Private/Safari tab, or reload once; the preview SW will then control only `/preview/`.
