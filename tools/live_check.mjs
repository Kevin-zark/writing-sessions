// Live smoke test in WebKit (iPhone emulation): node tools/live_check.mjs [url] [themeIndex]
import { webkit, devices } from 'playwright';
const URL = process.argv[2] || 'https://kevin-zark.github.io/writing-sessions/';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(URL + '?t=' + Date.now()); await p.waitForSelector('.card-theme');
const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration(); return r ? (r.active?.scriptURL || 'installing') : 'none'; });
const cards = await p.$$('.card-theme'); await cards[+(process.argv[3] || 0)].click(); await p.click('#begin');
await p.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 90000 });
await p.waitForTimeout(6000);
const probe = () => p.evaluate(async () => { const w = window.__ws, a = window.__app.audio, an = a.ctx.createAnalyser(); an.fftSize = 1024; a.musicBus.connect(an); const ab = a.ctx.createAnalyser(); ab.fftSize = 1024; a.ambBus.connect(ab);
  const buf = new Float32Array(1024), rms = (n) => { n.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / 1024); };
  let m = 0, am = 0; for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 100)); m = Math.max(m, rms(an)); am = Math.max(am, rms(ab)); }
  return { v2: w.v2, ctx: a.ctx.state, loaded: w.loaded, pos: +w.clock.pos().toFixed(1), stageMode: w.stage.info.mode, item: w.stage.info.id, music: +m.toFixed(4), amb: +am.toFixed(4), layers: a.activeLayers(), vids: [...document.querySelectorAll('#player video')].map(v => ({ s: v.currentSrc.split('/').pop(), paused: v.paused, t: +v.currentTime.toFixed(1) })), canvas: !!document.querySelector('#player canvas') }; });
console.log('sw', sw); console.log(JSON.stringify(await probe()));
// seek: forward 5 s, then watch clip advance after a jump near a bridge
await p.evaluate(() => window.__ws.seekBy(5)); await p.waitForTimeout(1500);
console.log('after +5s', JSON.stringify(await probe()));
await p.evaluate(() => window.__ws.skip(1)); await p.waitForTimeout(7000);
console.log('in sprint', JSON.stringify(await probe()));
await p.screenshot({ path: '/tmp/live-wk.png' });
console.log('errors', JSON.stringify(errs));
await b.close();
