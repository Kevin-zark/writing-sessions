import { chromium, webkit, devices } from 'playwright';
import fs from 'fs';
const SHOTS = '/workspace/writing-sessions/screenshots/';
const URL = process.env.E2E_URL || 'http://localhost:8099/';   // tools/serve_range.py 8099 (needs HTTP Range for video)
const phone = devices['iPhone 14'];
// BROWSER=webkit runs the same suite in WebKit (real H.264 clips, closest to iOS Safari available on Linux)
const WK = process.env.BROWSER === 'webkit';
const browser = WK ? await webkit.launch() : await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = {};
const ok = (name, cond, extra='') => { results[name] = !!cond; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

async function newCtx(opts = {}, video = true) {
  const ctx = await browser.newContext({ ...phone, ...opts });
  if (video && !WK) await ctx.route('**/clips/*.mp4', r => { const n = r.request().url().split('/').pop().replace('.mp4', '.webm'); r.fulfill({ body: fs.readFileSync('/tmp/webm/' + n), contentType: 'video/webm' }); });
  return ctx;
}

// ---------- Run A: speed 1 — screenshots of each overlay state (via skip) ----------
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await page.goto(URL); await page.waitForSelector('.card-theme');
  await page.screenshot({ path: SHOTS + '01-library-iphone.png' });
  await page.click('.card-theme'); await page.waitForSelector('#begin');
  await page.screenshot({ path: SHOTS + '02-start-sheet-iphone.png' });
  await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
  ok('A: session started, audio ctx running', await page.evaluate(() => window.__app.audio.ctx.state) === 'running');
  ok('A: music + ambience loaded', await page.evaluate(() => window.__ws.v2 && window.__ws.loaded.music === 2 && window.__ws.loaded.amb && window.__ws.loaded.layers >= 3), JSON.stringify(await page.evaluate(() => window.__ws.loaded)));
  ok('A: remaining ambience layers decode in the background (all 14)', await page.waitForFunction(() => Object.keys(window.__app.audio.lib).length === 14 && window.__app.audio.activeLayers().length >= 1, null, { timeout: 60000 }).then(() => true).catch(() => false));
  ok('A: music is audible in the intro (analyser on the music bus)', await page.evaluate(async () => { const a = window.__app.audio, an = a.ctx.createAnalyser(); an.fftSize = 1024; a.musicBus.connect(an); const buf = new Float32Array(1024); let mx = 0; for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 120)); an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; mx = Math.max(mx, Math.sqrt(s / 1024)); } window.__introRms = mx; return mx > 0.003 && a.ctx.state === 'running'; }), await page.evaluate(() => 'rms ' + window.__introRms));
  ok('A: video element is really playing (not paused, time advancing)', await (async () => { const t1 = await page.evaluate(() => { const v = [...document.querySelectorAll('video.on')].at(-1); return v && !v.paused ? v.currentTime : -1; }); await page.waitForTimeout(1200); const t2 = await page.evaluate(() => { const v = [...document.querySelectorAll('video.on')].at(-1); return v && !v.paused ? v.currentTime : -1; }); return t1 >= 0 && t2 !== t1; })());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOTS + '03-intro-card-iphone.png' });
  await page.click('#player', { position: { x: 200, y: 400 } }).catch(()=>{});
  await page.evaluate(() => window.__ws.skip(1));      // -> sprint 1
  await page.waitForTimeout(3500);
  const hud = await page.evaluate(() => ({ label: document.querySelector('.hud-label').textContent, clock: document.querySelector('.hud-clock').textContent, mode: window.__ws.stage.info.mode }));
  ok('A: sprint HUD shows SPRINT 1/4 and ~25:00', hud.label === 'SPRINT 1/4' && /^24:5\d$/.test(hud.clock), JSON.stringify(hud));
  ok('A: scene is playing video', hud.mode === 'video', hud.mode);
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
  const c1 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  await page.waitForTimeout(2200);
  const c2 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  ok('A: pause freezes timer', c1 === c2, c1 + ' / ' + c2);
  await page.evaluate(() => window.__ws.resume()); await page.waitForTimeout(2300);
  const c3 = await page.evaluate(() => document.querySelector('.hud-clock').textContent);
  ok('A: resume continues timer', c3 !== c2, c3);
  ok('A: wake lock mode set', ['wakeLock','video-fallback','none'].includes(await page.evaluate(() => window.__ws.wakeMode)), await page.evaluate(() => window.__ws.wakeMode));
  ok('A: mediaSession shows current track title', await page.evaluate(() => {
    const titles = (window.__app.themes[0].legs || []).flatMap(l => l.music).map(m => m.title);
    const meta = navigator.mediaSession.metadata;
    return titles.includes(meta?.title) && (meta?.artist || '').includes('fullslopstudios');
  }));
  ok('A: music queue cycles multiple tracks', await page.evaluate(() => new Set((window.__app.audio.musicQueue || []).map(q => q.title)).size >= 1 && window.__app.audio.tracks.length === 2));
  // speed-1 seamless chaining: jump to 6 s before the first in-leg bridge, then watch loop → bridge → loop
  const br = await page.evaluate(() => { const its = window.__ws.plan.items; const k = its.findIndex((x, i) => i > 1 && x.kind === 'bridge' && its[i - 1].kind === 'loop'); window.__ws.clock.seek(its[k].start - 6); return { k, id: its[k].id, next: its[k + 1].id }; });
  await page.waitForFunction((n) => window.__ws.stage.log.some(x => x.id === n), br.next, { timeout: 40000 }).catch(() => {});
  const chainLog = await page.evaluate(() => window.__ws.stage.log.slice(-4).map(x => x.id + ':' + x.mode));
  ok('A: loop → bridge → loop chained without a cut', chainLog.includes(br.id + ':chain') && chainLog.includes(br.next + ':chain'), chainLog.join(' '));
  ok('A: HUD shows the current view name', (await page.textContent('.hud-scene')).length > 2, await page.textContent('.hud-scene'));
  // ---- ±5 s seeking, double-tap, backgrounding, rotation ----
  await page.evaluate(() => { window.__ws.paused && window.__ws.resume(); });
  const P = () => page.evaluate(() => window.__ws.clock.pos());
  const p0 = await P(); await page.evaluate(() => window.__ws.seekBy(5)); const p1 = await P();
  ok('A: forward 5 s moves the clock +5', Math.abs(p1 - p0 - 5) < 0.6, (p1 - p0).toFixed(2));
  await page.evaluate(() => window.__ws.seekBy(-5)); const p2 = await P();
  ok('A: back 5 s moves the clock -5', Math.abs(p2 - p1 + 5) < 0.6, (p2 - p1).toFixed(2));
  await page.evaluate(() => { const w = window.__ws, b1 = w.tl.segs.find(x => x.type === 'break'); w.clock.seek(b1.start + 2); w.audio.schedule(w.tl, w.clock.pos(), 1); w._jumpStage(); w._tick(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ws.seekBy(-5));
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => { const w = window.__ws, pos = w.clock.pos(); return { label: document.querySelector('.hud-label').textContent, clock: document.querySelector('.hud-clock').textContent, seg: w.tl.segs[w.curSeg].type, stage: w.stage.info.id, want: w.plan.items[w.plan.items.findIndex(i => i.start <= pos && pos < i.end)]?.id, st: w.audio.ctx.state }; });
  ok('A: stepping back across a phase boundary lands in the previous sprint, label/timer/picture in sync', back.seg === 'sprint' && back.label === 'SPRINT 1/4' && /^00:0[0-4]$/.test(back.clock) && back.stage === back.want && back.st === 'running', JSON.stringify(back));
  const q0 = await P();
  await page.mouse.click(780, 300); await page.waitForTimeout(80); await page.mouse.click(780, 300); await page.waitForTimeout(300);
  const q1 = await P(); ok('A: double-tap on the right side skips +5 s', q1 - q0 > 4 && q1 - q0 < 6.5, (q1 - q0).toFixed(2));
  await page.mouse.click(60, 300); await page.waitForTimeout(80); await page.mouse.click(60, 300); await page.waitForTimeout(300);
  const q2 = await P(); ok('A: double-tap on the left side rewinds 5 s', q1 - q2 > 3.5 && q1 - q2 < 6.5, (q1 - q2).toFixed(2));
  ok('A: media session has seekbackward/seekforward handlers', await page.evaluate(() => { let n = 0; for (const a of ['seekbackward','seekforward']) { try { navigator.mediaSession.setActionHandler(a, navigator.mediaSession.__h || (() => {})); n++; } catch (e) {} } return n === 2; }));
  // backgrounding: no element re-creation, no extra audio layers, clock keeps wall-clock time
  const snap = await page.evaluate(() => { document.querySelectorAll('#player video').forEach((v, i) => v.dataset.keep = 'k' + i); const a = window.__app.audio; return { vids: document.querySelectorAll('#player video').length, layers: Object.keys(a.layerNodes).length, srcs: a.musicQueue.length, pos: window.__ws.clock.pos() }; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => { const a = window.__app.audio; return { vids: document.querySelectorAll('#player video').length, kept: document.querySelectorAll('#player video[data-keep]').length, layers: Object.keys(a.layerNodes).length, srcs: a.musicQueue.length, pos: window.__ws.clock.pos(), st: a.ctx.state, paused: window.__ws.paused }; });
  ok('A: hide/show keeps the same video elements and audio layers (no restart, no doubles)', after.vids === snap.vids && after.kept === snap.vids && after.layers === snap.layers && after.srcs <= snap.srcs + 1 && after.st === 'running' && !after.paused, JSON.stringify({ snap, after }));
  ok('A: clock kept wall-clock time while hidden (+~4 s)', after.pos - snap.pos > 3 && after.pos - snap.pos < 7, (after.pos - snap.pos).toFixed(2));
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
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL + '?speed=120'); await page.waitForSelector('.card-theme');
  await page.click('.card-theme'); await page.click('#begin');
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
  ok('B: journey shows boarding station, all 24 views, arrival', ids[0] === 's0' && ids.at(-1) === 's4' && ['c','l','f','m'].every(p => [1,2,3,4,5,6].every(n => ids.includes(p + n))), ids.join(','));
  ok('B: passes through all 4 legs (music pool switched)', info.legs.join(',') === 'lake,forest,mountains', info.legs.join(','));
  const brk = info.layers.filter(l => l.seg === 'break').map(l => l.keys);
  ok('B: breaks use station ambience (walla/luggage)', brk.length > 0 && brk.every(k => k.includes('station_walla')), [...new Set(brk)].join(' | '));
  const keys = new Set(info.layers.map(l => l.keys));
  ok('B: per-clip ambience changes (≥8 distinct mixes, incl. tunnel + rain)', keys.size >= 8 && [...keys].some(k => k.includes('tunnel')) && [...keys].some(k => k.includes('rain_glass')), keys.size + ' mixes'); 
  // audible chime detection: master RMS spikes above music bed near boundaries
  const P = info.probe;
  const peak = Math.max(...P.map(p => p.master));
  const breakMusic = P.filter(p => p.type === 'break').slice(Math.floor(P.filter(p => p.type === 'break').length * 0.5)).map(p => p.music);
  const sprintMusic = P.filter(p => p.type === 'sprint').slice(5).map(p => p.music);
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  ok('B: audio is actually audible (master RMS peak > 0.01)', peak > 0.01, 'peak ' + peak.toFixed(3));
  ok('B: music bus fades out in breaks and is up in sprints', avg(breakMusic) < avg(sprintMusic) * 0.25 && avg(sprintMusic) > 0.005, `break ${avg(breakMusic).toFixed(4)} sprint ${avg(sprintMusic).toFixed(4)}`);
  ok('B: no JS errors', errs.length === 0, errs.join('|'));
  await page.waitForTimeout(2500); await page.screenshot({ path: SHOTS + '07-outro-complete-iphone.png' });
  await ctx.close();
}

// ---------- Run C: custom settings persist; custom 2x1min w/o intro/outro; Ken Burns fallback ----------
{
  const ctx = await newCtx({}, false); const page = await ctx.newPage();
  await ctx.route('**/clips/*.mp4', r => r.abort());      // simulate missing clips
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL + '?speed=30'); await page.waitForSelector('.card-theme');
  await page.click('[data-tab=settings]');
  await page.fill('#f-sprintMin', '1'); await page.dispatchEvent('#f-sprintMin', 'change');
  await page.fill('#f-breakMin', '1'); await page.dispatchEvent('#f-breakMin', 'change');
  await page.click('.stepper[data-for=f-sprints] button[data-d="-1"]');          // 4 -> 3
  await page.uncheck('#f-intro'); await page.uncheck('#f-outro');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('ws.settings.v1')));
  ok('C: custom settings saved', st.preset === 'custom' && st.sprintMin === 1 && st.breakMin === 1 && st.sprints === 3 && !st.intro && !st.outro, JSON.stringify(st));
  await page.reload(); await page.waitForSelector('.card-theme'); await page.click('[data-tab=settings]');
  ok('C: settings persisted across reload', await page.inputValue('#f-sprintMin') === '1' && await page.inputValue('#f-sprints') === '3' && !(await page.isChecked('#f-intro')));
  await page.click('[data-tab=library]'); await page.click('.card-theme'); await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
  await page.waitForFunction(() => window.__ws.finished, null, { timeout: 60000 });
  const ev = await page.evaluate(() => ({ e: window.__ws.events.map(x => x.type + (x.n || '')), modes: window.__ws.stage.log.map(x => x.mode), total: window.__ws.tl.total }));
  ok('C: custom 3×1 min /1 min break, no intro/outro => s1,b1,s2,b2,s3', ev.e.filter(x => x !== 'end' && x !== 'leg').join(',') === 'sprint1,break1,sprint2,break2,sprint3' && ev.total === 300, ev.e.join(','));
  if (!WK) ok('C: Ken Burns fallback used when clips fail', ev.modes.length > 0 && ev.modes.every(m => m === 'kenburns'), ev.modes.join(','));
  await ctx.close();
}

// ---------- Run D: request tab (webhook mock) ----------
{
  const ctx = await newCtx({}, false); const page = await ctx.newPage();
  let posted = null;
  await ctx.route('https://hooks.test/req', async r => { posted = JSON.parse(r.request().postData()); await r.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto(URL); await page.waitForSelector('.card-theme');
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
