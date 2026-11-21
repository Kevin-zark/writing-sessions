import { chromium, devices } from 'playwright';
import fs from 'fs';
const SHOTS = '/workspace/writing-sessions/screenshots/';
const URL = 'http://localhost:8099/';
const phone = devices['iPhone 14'];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const results = {};
const ok = (name, cond, extra='') => { results[name] = !!cond; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

async function newCtx(opts = {}, video = true) {
  const ctx = await browser.newContext({ ...phone, ...opts });
  if (video) await ctx.route('**/scenes/*.mp4', r => { const n = r.request().url().split('/').pop().replace('.mp4', '.webm'); r.fulfill({ body: fs.readFileSync('/tmp/webm/' + n), contentType: 'video/webm' }); });
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
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 15000 });
  ok('A: session started, audio ctx running', await page.evaluate(() => window.__app.audio.ctx.state) === 'running');
  ok('A: music + ambience loaded', await page.evaluate(() => window.__ws.loaded.music === 3 && window.__ws.loaded.amb));
  await page.waitForTimeout(3500);
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
  ok('A: mediaSession metadata', await page.evaluate(() => navigator.mediaSession.metadata?.title) === 'Dark Academia Train to a Snowy Village');
  ok('A: no JS errors', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---------- Run B: speed 120, full classic session end-to-end ----------
{
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL + '?speed=120'); await page.waitForSelector('.card-theme');
  await page.click('.card-theme'); await page.click('#begin');
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 15000 });
  // audio probe: analyser on master, sample loudness 20x/s along with the segment type
  await page.evaluate(() => {
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
    events: window.__ws.events, chimes: window.__app.audio.chimeLog, scenes: window.__ws.stage.log.map(x => x.scene + ':' + x.mode),
    plan: window.__ws.plan, probe: window.__probe, total: window.__ws.tl.total, segs: window.__ws.tl.segs.map(s => s.type + (s.n || '')) }));
  const types = info.events.filter(e => e.type !== 'end').map(e => e.type + (e.n || ''));
  console.log('segments seen:', types.join(' '), ' wall', wall.toFixed(1) + 's');
  ok('B: all 9 segments in order, no break after last sprint', types.join(',') === 'intro,sprint1,break1,sprint2,break2,sprint3,break3,sprint4,outro', types.join(','));
  ok('B: session finished', info.events.at(-1).type === 'end');
  ok('B: wall-clock ≈ total/120', Math.abs(wall - info.total / 120) < 6, wall.toFixed(1) + ' vs ' + (info.total / 120).toFixed(1));
  ok('B: chime scheduled at every transition (9 + end)', info.chimes.length === 10, info.chimes.map(c => c.kind).join(','));
  console.log('scenes:', info.scenes.join(' → '), JSON.stringify(info.plan.map(p => [Math.round(p.start / 60), Math.round(p.end / 60), p.scene])));
  ok('B: crossfaded through all 3 scenes', ['window', 'compartment', 'village'].every((s, i) => info.scenes[i]?.startsWith(s)), info.scenes.join(','));
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
  await ctx.route('**/scenes/*.mp4', r => r.abort());      // simulate missing clips
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
  await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__ws.finished, null, { timeout: 60000 });
  const ev = await page.evaluate(() => ({ e: window.__ws.events.map(x => x.type + (x.n || '')), modes: window.__ws.stage.log.map(x => x.mode), total: window.__ws.tl.total }));
  ok('C: custom 3×1 min /1 min break, no intro/outro => s1,b1,s2,b2,s3', ev.e.filter(x => x !== 'end').join(',') === 'sprint1,break1,sprint2,break2,sprint3' && ev.total === 300, ev.e.join(','));
  ok('C: Ken Burns fallback used when clips fail', ev.modes.length > 0 && ev.modes.every(m => m === 'kenburns'), ev.modes.join(','));
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
