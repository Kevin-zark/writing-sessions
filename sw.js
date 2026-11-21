// App-shell cache. Media (mp4/mp3) is deliberately NOT intercepted: iOS needs HTTP Range
// responses for <video>/<audio>, which Cache API replays badly. The browser's HTTP cache handles media.
const VER = 'ws-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/engine.js', 'js/audio.js', 'js/scenes.js',
  'js/player.js', 'js/request.js', 'js/config.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'themes/index.json', 'themes/dark-academia-train/manifest.json',
  'themes/dark-academia-train/scenes/train-window.jpg', 'themes/dark-academia-train/scenes/train-compartment.jpg', 'themes/dark-academia-train/scenes/village-arrival.jpg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\.(mp4|mp3|m4a|wav)$/i.test(url.pathname) || req.headers.has('range')) return;
  // stale-while-revalidate: instant load, updates picked up next launch
  e.respondWith(caches.open(VER).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
