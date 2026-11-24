// App-shell cache. NETWORK-FIRST (falls back to cache offline / on a slow link), so a new deploy is never
// shadowed by stale JS or a stale manifest (v3 and older served the old shell first, which paired old player
// code with the new schema-2 manifest => no video chain and no music). Media (mp4/mp3) is deliberately NOT
// intercepted: iOS needs HTTP Range responses for <video>/<audio>, which Cache API replays badly.
const VER = 'ws-v29';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/engine.js', 'js/audio.js', 'js/scenes.js',
  'js/player.js', 'js/window.js', 'js/voyage.js', 'js/voyage-flags.js', 'js/voyage-rain.js', 'js/voyage-stage.js', 'js/voyage-clock.js', 'js/journey.js', 'js/sync.js', 'js/request.js', 'js/config.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'themes/index.json', 'themes/dark-academia-train/manifest.json',
  'themes/dark-academia-train/stills/s0.jpg', 'themes/dark-academia-train/stills/cover.jpg', 'themes/dark-academia-train/frame/overlay.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    const legacy = ks.some(k => /^ws-v[0-3]$/.test(k));      // pre-v4 pages cannot self-update: reload them once
    await Promise.all(ks.filter(k => /^ws-v\d+$/.test(k) && k !== VER).map(k => caches.delete(k)));
    await self.clients.claim();
    if (legacy) for (const c of await self.clients.matchAll({ type: 'window' })) { try { await c.navigate(c.url); } catch (err) {} }
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'sw-updated', ver: VER });
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\.(mp4|mp3|m4a|wav)$/i.test(url.pathname) || req.headers.has('range')) return;
  e.respondWith((async () => {
    const c = await caches.open(VER);
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    try { return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]); }
    catch (err) { const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' }); return hit || net; }
  })());
});
