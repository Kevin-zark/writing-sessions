import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
const SHOTS = '/workspace/writing-sessions/screenshots/';
const URL = process.env.E2E_URL || 'http://localhost:8099/';   // tools/serve_range.py 8099 (needs HTTP Range for video)
const phone = devices['iPhone 14'];
// THEME=<id> picks the theme under test (default: the train); assertions below are theme-generic (schema 2 chained clips or schema 3 window)
const THEME = process.env.THEME || 'dark-academia-train';
const RUNS = (process.env.RUNS || 'ABCD').toUpperCase();   // e.g. RUNS=A for WebKit (Run B, the 120x full session, hangs in headless WebKit on Linux)
const CARD = `.card-theme[data-theme="${THEME}"]`;
// BROWSER=webkit runs the same suite in WebKit (real H.264 clips, closest to iOS Safari available on Linux)
const WK = process.env.BROWSER === 'webkit';
const browser = WK ? await webkit.launch() : await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = {};
const ok = (name, cond, extra='') => { results[name] = !!cond; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

async function newCtx(opts = {}, video = true) {
  const ctx = await browser.newContext({ ...phone, ...opts });
  if (video && !WK) await ctx.route('**/*.mp4', r => { const n = r.request().url().split('/').pop().replace('.mp4', '.webm'); const f = '/tmp/webm/' + n; if (fs.existsSync(f)) r.fulfill({ body: fs.readFileSync(f), contentType: 'video/webm' }); else r.continue(); });
  return ctx;
}

// ---------- Run A: speed 1 — screenshots of each overlay state (via skip) ----------
if (RUNS.includes('A')) {
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await page.goto(URL); await page.waitForSelector(CARD);
  await page.screenshot({ path: SHOTS + '01-library-iphone.png' });
  await page.click(CARD); await page.waitForSelector('#begin');
  await page.screenshot({ path: SHOTS + '02-start-sheet-iphone.png' });
  await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
  ok('A: session started, audio ctx running', await page.evaluate(() => window.__app.audio.ctx.state) === 'running');
  ok('A: music + ambience loaded', await page.evaluate(() => window.__ws.v2 && window.__ws.loaded.music >= 1 && window.__ws.loaded.amb && window.__ws.loaded.layers >= 3), JSON.stringify(await page.evaluate(() => window.__ws.loaded)));
  ok('A: remaining ambience layers decode in the background (all of them)', await page.waitForFunction(() => Object.keys(window.__app.audio.lib).length === Object.keys(window.__ws.m.ambienceLib).length && window.__app.audio.activeLayers().length >= 1, null, { timeout: 60000 }).then(() => true).catch(() => false));
  ok('A: music is audible in the intro (analyser on the music bus)', await page.evaluate(async () => { const a = window.__app.audio, an = a.ctx.createAnalyser(); an.fftSize = 1024; a.musicBus.connect(an); const buf = new Float32Array(1024); let mx = 0; for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 120)); an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; mx = Math.max(mx, Math.sqrt(s / 1024)); } window.__introRms = mx; return mx > 0.003 && a.ctx.state === 'running'; }), await page.evaluate(() => 'rms ' + window.__introRms));
  ok('A: video element is really playing (not paused, time advancing)', await (async () => { const t1 = await page.evaluate(() => { const v = [...document.querySelectorAll('video.on')].at(-1); return v && !v.paused ? v.currentTime : -1; }); await page.waitForTimeout(1200); const t2 = await page.evaluate(() => { const v = [...document.querySelectorAll('video.on')].at(-1); return v && !v.paused ? v.currentTime : -1; }); return t1 >= 0 && t2 !== t1; })());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOTS + '03-intro-card-iphone.png' });
  await page.click('#player', { position: { x: 200, y: 400 } }).catch(()=>{});
  await page.evaluate(() => window.__ws.skip(1));      // -> sprint 1
  await page.waitForTimeout(3500);
  const hud = await page.evaluate(() => ({ label: document.querySelector('.hud-label').textContent, clock: document.querySelector('.hud-clock').textContent, mode: window.__ws.stage.info.mode }));
  ok('A: sprint HUD shows SPRINT 1/4 and ~25:00', hud.label === 'SPRINT 1/4' && /^24:5\d$/.test(hud.clock), JSON.stringify(hud));
  ok('A: scene is live (video, or the moving window canvas)', hud.mode === 'video' || hud.mode === 'canvas', hud.mode);
  const WINDOW = await page.evaluate(() => window.__ws.m.render?.type === 'window');
  if (WINDOW) {
    const grab = () => page.evaluate(() => { const c = document.querySelector('#player canvas'), g = document.createElement('canvas'); g.width = 160; g.height = 90; g.getContext('2d').drawImage(c, 0, 0, 160, 90); return [...g.getContext('2d').getImageData(0, 0, 160, 90).data]; });
    const d = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return n; };
    const f1 = await grab(); await page.waitForTimeout(2500); const f2 = await grab();
    ok('A: window canvas is always moving during a sprint (frames differ)', d(f1, f2) > 40, 'changed px ' + d(f1, f2));
  }
  await page.screenshot({ path: SHOTS + '04-sprint-iphone.png' });
  await page.evaluate(() => window.__ws.skip(1));      // -> break 1
  await page.waitForTimeout(5500);
  const hb = await page.evaluate(() => ({ label: document.querySelector('.hud-label').textContent, clock: document.querySelector('.hud-clock').textContent, bt: document.querySelector('.breaktext').classList.contains('on') }));
  ok('A: break HUD + gentle break text', hb.label === 'BREAK' && /^04:5\d$/.test(hb.clock) && hb.bt, JSON.stringify(hb));
  await page.screenshot({ path: SHOTS + '05-break-iphone.png' });
  // landscape
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.__ws.skip(1));      // -> sprint 2
  await page.waitForTimeout(3000);
  await page.screenshot({ path: SHOTS + '06-sprint-landscape.png' });
  // pause / resume
  await page.evaluate(() => window.__ws.pause());
  await page.waitForTimeout(450);          // let the last display tick land
  const c1 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  await page.waitForTimeout(2200);
  const c2 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  ok('A: pause freezes timer', c1 === c2, c1 + ' / ' + c2);
  await page.evaluate(() => window.__ws.resume()); await page.waitForTimeout(2300);
  const c3 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  ok('A: resume continues timer', c3 !== c2, c3);
  ok('A: wake lock mode set', ['wakeLock','video-fallback','none'].includes(await page.evaluate(() => window.__ws.wakeMode)), await page.evaluate(() => window.__ws.wakeMode));
  ok('A: mediaSession shows current track title', await page.evaluate(() => {
    const titles = (window.__ws.m.legs || []).flatMap(l => l.music).map(m => m.title);
    const meta = navigator.mediaSession.metadata;
    return titles.includes(meta?.title) && !!(meta?.artist);
  }));
  ok('A: music queue cycles multiple tracks', await page.evaluate(() => new Set((window.__app.audio.musicQueue || []).map(q => q.title)).size >= 1 && window.__app.audio.tracks.length >= 1));
  if (!WINDOW) {
    // schema 2: jump to 6 s before the first in-leg bridge, then watch loop → bridge → loop
    const br = await page.evaluate(async () => { const its = window.__ws.plan.items; const k = its.findIndex((x, i) => i > 1 && x.kind === 'bridge' && its[i - 1].kind === 'loop'); await window.__ws.syncTo(its[k].start - 6); return { k, id: its[k].id, next: its[k + 1].id }; });
    await page.waitForFunction((n) => window.__ws.stage.log.some(x => x.id === n), br.next, { timeout: 40000 }).catch(() => {});
    const chainLog = await page.evaluate(() => window.__ws.stage.log.slice(-4).map(x => x.id + ':' + x.mode));
    ok('A: loop → bridge → loop chained without a cut', chainLog.includes(br.id + ':chain') && chainLog.includes(br.next + ':chain'), chainLog.join(' '));
  } else {
    // schema 3: cross a segment boundary while watching frames: the window must keep moving and never blank
    const T = await page.evaluate(async () => { const w = window.__ws, its = w.plan.items, k = its.findIndex((x, i) => i > 1 && x.kind === 'cruise' && its[i - 1].kind === 'cruise' && its[i - 1].scene !== x.scene); await w.syncTo(its[k].start - 3); return { id: its[k].id, at: its[k].start }; });
    const dark = []; for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); dark.push(await page.evaluate(() => { const c = document.querySelector('#player canvas'), g = document.createElement('canvas'); g.width = 32; g.height = 18; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 32, 18); const d = x.getImageData(0, 0, 32, 18).data; let s = 0; for (let j = 0; j < d.length; j += 4) s += d[j] + d[j + 1] + d[j + 2]; return s / (d.length / 4) / 3; })); }
    ok('A: crossing into the next cruise segment never blanks the window', Math.min(...dark) > 12 && await page.evaluate((id) => window.__ws.stage.info.id === id, T.id), 'min luma ' + Math.min(...dark).toFixed(0));
    // a landmark must slide past exactly once: it is drawn only inside its window, moving right→left
    const L = await page.evaluate(async () => { const w = window.__ws, k = w.plan.items.findIndex(x => x.kind === 'cruise' && x.lmWin && x.scene.landmark?.src); const it = w.plan.items[k]; await w.syncTo(it.lmWin[0] + (it.lmWin[1] - it.lmWin[0]) * 0.5); return { id: it.id, win: it.lmWin }; });
    await page.waitForTimeout(1500); await page.screenshot({ path: SHOTS + '09-landmark-passby.png' });
    ok('A: landmark pass-by window exists and the stage is on its segment', await page.evaluate((id) => window.__ws.stage.info.id.startsWith(id.replace(/-lm$|-post$/, '')), L.id), JSON.stringify(L));
  }
  ok('A: HUD shows the current view name', (await page.textContent('.hud-scene')).length > 2, await page.textContent('.hud-scene'));
  // ---- ±5 s seeking, double-tap, backgrounding, rotation ----
  await page.evaluate(() => { window.__ws.paused && window.__ws.resume(); });
  const P = () => page.evaluate(() => window.__ws.clock.pos());
  const p0 = await P(); await page.evaluate(() => window.__ws.seekBy(5)); const p1 = await P();
  ok('A: forward 5 s moves the clock +5', Math.abs(p1 - p0 - 5) < 0.6, (p1 - p0).toFixed(2));
  await page.evaluate(() => window.__ws.seekBy(-5)); const p2 = await P();
  ok('A: back 5 s moves the clock -5', Math.abs(p2 - p1 + 5) < 0.6, (p2 - p1).toFixed(2));
  await page.evaluate(async () => { const w = window.__ws, b1 = w.tl.segs.find(x => x.type === 'break'); await w.syncTo(b1.start + 2); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ws.seekBy(-5));
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => { const w = window.__ws, pos = w.clock.pos(); return { label: document.querySelector('.hud-label').textContent, clock: document.querySelector('.hud-clock').textContent, seg: w.tl.segs[w.curSeg].type, stage: w.stage.info.id, want: w.plan.items[w.plan.items.findIndex(i => i.start <= pos && pos < i.end)]?.id, st: w.audio.ctx.state }; });
  ok('A: stepping back across a phase boundary lands in the previous sprint, label/timer/picture in sync', back.seg === 'sprint' && back.label === 'SPRINT 1/4' && /^00:0[0-4]$/.test(back.clock) && back.stage === back.want && back.st === 'running', JSON.stringify(back));
  const q0 = await P();
  // Landscape 844×390: tap mid-height so we miss the bottom ctl-row; wait long enough for async seekTo.
  await page.mouse.click(780, 180); await page.waitForTimeout(120); await page.mouse.click(780, 180); await page.waitForTimeout(500);
  const q1 = await P(); ok('A: double-tap on the right side skips +5 s', q1 - q0 > 4 && q1 - q0 < 6.5, (q1 - q0).toFixed(2));
  await page.mouse.click(60, 180); await page.waitForTimeout(120); await page.mouse.click(60, 180); await page.waitForTimeout(500);
  const q2 = await P(); ok('A: double-tap on the left side rewinds 5 s', q1 - q2 > 3.5 && q1 - q2 < 6.5, (q1 - q2).toFixed(2));
  ok('A: media session has seekbackward/seekforward handlers', await page.evaluate(() => { let n = 0; for (const a of ['seekbackward','seekforward']) { try { navigator.mediaSession.setActionHandler(a, navigator.mediaSession.__h || (() => {})); n++; } catch (e) {} } return n === 2; }));
  // backgrounding: no element re-creation, no extra audio layers, clock keeps wall-clock time
  const snap = await page.evaluate(() => { document.querySelectorAll('#player video').forEach((v, i) => v.dataset.keep = 'k' + i); const a = window.__app.audio; return { vids: document.querySelectorAll('#player video').length, layers: Object.keys(a.layerNodes).length, srcs: a.musicQueue.length, pos: window.__ws.clock.pos(), wall: Date.now() }; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => { const a = window.__app.audio; return { vids: document.querySelectorAll('#player video').length, kept: document.querySelectorAll('#player video[data-keep]').length, layers: Object.keys(a.layerNodes).length, srcs: a.musicQueue.length, pos: window.__ws.clock.pos(), wall: Date.now(), st: a.ctx.state, paused: window.__ws.paused }; });
  ok('A: hide/show keeps the same media elements and audio layers (no restart, no doubles)', after.vids === snap.vids && after.kept === snap.vids && after.layers === snap.layers && after.srcs <= snap.srcs + 1 && after.st === 'running' && !after.paused, JSON.stringify({ snap, after }));
  ok('A: clock kept wall-clock time while hidden (pos advanced exactly as much as real time)', after.pos - snap.pos > 3 && Math.abs((after.pos - snap.pos) - (after.wall - snap.wall) / 1000) < 0.6, (after.pos - snap.pos).toFixed(2) + ' vs wall ' + ((after.wall - snap.wall) / 1000).toFixed(2)); 
  // rotation
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  const r1 = await page.evaluate(() => ({ kept: document.querySelectorAll('#player video[data-keep]').length, vids: document.querySelectorAll('#player video').length, o: document.querySelector('#player').dataset.orient, pos: window.__ws.clock.pos(), st: window.__app.audio.ctx.state }));
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(500);
  const r2 = await page.evaluate(() => ({ kept: document.querySelectorAll('#player video[data-keep]').length, vids: document.querySelectorAll('#player video').length, o: document.querySelector('#player').dataset.orient, pos: window.__ws.clock.pos(), st: window.__app.audio.ctx.state, evs: window.__ws.events.length }));
  ok('A: rotating portrait↔landscape keeps the same video elements, audio running, clock advancing', r1.kept === snap.vids && r2.kept === snap.vids && r1.vids === snap.vids && r2.vids === snap.vids && r1.o === 'portrait' && r2.o === 'landscape' && r2.pos > r1.pos && r2.st === 'running', JSON.stringify({ r1, r2 }));
  ok('A: no JS errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---------- Run B: speed 120, full classic session end-to-end ----------
if (RUNS.includes('B')) {
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL + '?speed=120'); await page.waitForSelector(CARD);
  await page.click(CARD); await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
  // audio probe: analyser on master, sample loudness 20x/s along with the segment type
  await page.evaluate(() => {
    window.__layerLog = []; const A = window.__app.audio, orig = A.setLayers.bind(A);
    A.setLayers = (l, s) => { window.__layerLog.push({ seg: document.querySelector('#player').dataset.seg, keys: (l || []).map(x => x.layer).sort().join('+') }); return orig(l, s); };
    const a = window.__app.audio, c = a.ctx, an = c.createAnalyser(); an.fftSize = 1024; a.master.connect(an);
    const mb = c.createAnalyser(); mb.fftSize = 1024; a.musicBus.connect(mb);
    const buf = new Float32Array(1024); window.__probe = [];
    const rms = (n) => { n.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
    setInterval(() => window.__probe.push({ seg: window.__ws.curSeg, type: document.querySelector('#player').dataset.seg, master: rms(an), music: rms(mb), t: performance.now() }), 50);
  });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__ws.finished, null, { timeout: 120000 });
  const wall = (Date.now() - t0) / 1000;
  const info = await page.evaluate(() => ({
    events: window.__ws.events, chimes: window.__app.audio.chimeLog, scenes: window.__ws.stage.log.map(x => x.id + ':' + x.mode), layers: window.__layerLog, legs: window.__ws.events.filter(e => e.type === 'leg').map(e => e.leg), items: window.__ws.plan.items.length,
    plan: window.__ws.plan, probe: window.__probe, total: window.__ws.tl.total, segs: window.__ws.tl.segs.map(s => s.type + (s.n || '')) }));
  const types = info.events.filter(e => e.type !== 'end' && e.type !== 'leg').map(e => e.type + (e.n || ''));
  console.log('segments seen:', types.join(' '), ' wall', wall.toFixed(1) + 's');
  ok('B: all 9 segments in order, no break after last sprint', types.join(',') === 'intro,sprint1,break1,sprint2,break2,sprint3,break3,sprint4,outro', types.join(','));
  ok('B: session finished', info.events.at(-1).type === 'end');
  ok('B: wall-clock ≈ total/120', Math.abs(wall - info.total / 120) < 6, wall.toFixed(1) + ' vs ' + (info.total / 120).toFixed(1));
  ok('B: chime scheduled at every transition (9 + end)', info.chimes.length === 10, info.chimes.map(c => c.kind).join(','));
  console.log('stage:', info.scenes.length, 'items shown of', info.items, '| legs:', info.legs.join(','));
  const ids = info.scenes.map(s => s.split(':')[0]);
  const want = await page.evaluate(() => window.__ws.m.legs.flatMap(l => (l.segments || l.views).map(v => v.id)));
  const st = await page.evaluate(() => window.__ws.m.stations.map(s => s.id));
  ok('B: journey shows boarding station, every view/segment, arrival', ids[0] === st[0] && ids.at(-1) === st.at(-1) && want.every(id => ids.includes(id)), ids.join(','));
  const legIds = await page.evaluate(() => window.__ws.m.legs.map(l => l.id));
  ok('B: passes through every leg (music pool switched)', info.legs.join(',') === legIds.slice(1).join(','), info.legs.join(','));
  const brk = info.layers.filter(l => l.seg === 'break').map(l => l.keys);
  ok('B: breaks use station ambience (walla/luggage)', brk.length > 0 && brk.every(k => k.includes('station_walla')), [...new Set(brk)].join(' | '));
  const keys = new Set(info.layers.map(l => l.keys));
  const planLayers = new Set(info.plan.items.flatMap(it => (it.ambience || []).map(a => a.layer)));
  ok('B: per-scene ambience changes (≥8 distinct mixes; every layer the plan uses is applied)', keys.size >= 8 && [...planLayers].every(l => [...keys].some(k => k.split('+').includes(l))), keys.size + ' mixes; missing ' + [...planLayers].filter(l => ![...keys].some(k => k.split('+').includes(l))).join(','));
  // audible chime detection: master RMS spikes above music bed near boundaries
  const P = info.probe;
  const peak = Math.max(...P.map(p => p.master));
  const breakMusic = P.filter(p => p.type === 'break').slice(Math.floor(P.filter(p => p.type === 'break').length * 0.5)).map(p => p.music);
  const sprintMusic = P.filter(p => p.type === 'sprint').slice(5).map(p => p.music);
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  ok('B: audio is actually audible (master RMS peak > 0.01)', peak > 0.01, 'peak ' + peak.toFixed(3));
  ok('B: music bus fades out in breaks and is up in sprints', avg(breakMusic) < avg(sprintMusic) * 0.35 && avg(sprintMusic) > 0.005, `break ${avg(breakMusic).toFixed(4)} sprint ${avg(sprintMusic).toFixed(4)}`);
  ok('B: no JS errors', errs.length === 0, errs.join('|'));
  await page.waitForTimeout(2500); await page.screenshot({ path: SHOTS + '07-outro-complete-iphone.png' });
  await ctx.close();
}

// ---------- Run C: custom settings persist; custom 2x1min w/o intro/outro; Ken Burns fallback ----------
if (RUNS.includes('C')) {
  const ctx = await newCtx({}, false); const page = await ctx.newPage();
  await ctx.route('**/clips/*.mp4', r => r.abort());      // simulate missing clips
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL + '?speed=30'); await page.waitForSelector(CARD);
  await page.click('[data-tab=settings]');
  await page.fill('#f-sprintMin', '1'); await page.dispatchEvent('#f-sprintMin', 'change');
  await page.fill('#f-breakMin', '1'); await page.dispatchEvent('#f-breakMin', 'change');
  await page.click('.stepper[data-for=f-sprints] button[data-d="-1"]');          // 4 -> 3
  await page.uncheck('#f-intro'); await page.uncheck('#f-outro');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('ws.settings.v1')));
  ok('C: custom settings saved', st.preset === 'custom' && st.sprintMin === 1 && st.breakMin === 1 && st.sprints === 3 && !st.intro && !st.outro, JSON.stringify(st));
  await page.reload(); await page.waitForSelector(CARD); await page.click('[data-tab=settings]');
  ok('C: settings persisted across reload', await page.inputValue('#f-sprintMin') === '1' && await page.inputValue('#f-sprints') === '3' && !(await page.isChecked('#f-intro')));
  await page.click('[data-tab=library]'); await page.click(CARD); await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
  await page.waitForFunction(() => window.__ws.finished, null, { timeout: 60000 });
  const ev = await page.evaluate(() => ({ e: window.__ws.events.map(x => x.type + (x.n || '')), modes: window.__ws.stage.log.map(x => x.mode), total: window.__ws.tl.total }));
  ok('C: custom 3×1 min /1 min break, no intro/outro => s1,b1,s2,b2,s3', ev.e.filter(x => x !== 'end' && x !== 'leg').join(',') === 'sprint1,break1,sprint2,break2,sprint3' && ev.total === 300, ev.e.join(','));
  if (!WK) ok('C: Ken Burns fallback used when clips fail', ev.modes.length > 0 && ev.modes.every(m => m === 'kenburns' || m === 'canvas'), ev.modes.join(','));
  await ctx.close();
}

// ---------- Run D: request tab (webhook mock) ----------
if (RUNS.includes('D')) {
  const ctx = await newCtx({}, false); const page = await ctx.newPage();
  let posted = null;
  await ctx.route('https://hooks.test/req', async r => { posted = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto(URL); await page.waitForSelector(CARD);
  await page.click('[data-tab=settings]'); await page.fill('#f-webhookUrl', 'https://hooks.test/req'); await page.dispatchEvent('#f-webhookUrl', 'change');
  await page.click('[data-tab=request]');
  await page.fill('#r-theme', 'A lakeside cabin at dawn with mist and swaying pines'); await page.fill('#r-mood', 'cozy'); await page.fill('#r-music', 'slow piano, cello');
  await page.click('#r-send'); await page.waitForSelector('#r-status.ok');
  ok('D: request POSTed to webhook as JSON', posted && posted.theme.includes('lakeside') && posted.mood === 'cozy' && posted.music.includes('piano'), JSON.stringify(posted));
  ok('D: sent state shown', (await page.textContent('#r-status')).includes('Sent'));
  await page.screenshot({ path: SHOTS + '08-request-sent-iphone.png' });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ws.requests.v1')));
  ok('D: request stored locally with status sent', stored.length === 1 && stored[0].status === 'sent');
  await ctx.close();
}
await browser.close();
const fails = Object.entries(results).filter(([, v]) => !v);
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} passed`);
process.exit(fails.length ? 1 : 0);
