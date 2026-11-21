import { webkit, devices } from 'playwright';
const URL = process.argv[2] || 'https://kevin-zark.github.io/writing-sessions/';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 14'] });
const p = await ctx.newPage(); const logs=[];
p.on('pageerror', e => logs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error','warning'].includes(m.type())) logs.push(m.type()+' '+m.text()); });
p.on('requestfailed', r => logs.push('REQFAIL ' + r.url().split('/').slice(-2).join('/') + ' ' + r.failure()?.errorText));
await p.goto(URL); await p.waitForSelector('.card-theme', {timeout: 20000});
console.log('themes:', await p.$$eval('.card-theme', n => n.map(x => x.textContent.slice(0,40))));
await p.click('.card-theme'); await p.waitForSelector('#begin'); await p.click('#begin');
await p.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 60000 }).catch(e => logs.push('NOT STARTED'));
for (let i = 0; i < 4; i++) {
  await p.waitForTimeout(4000);
  console.log(JSON.stringify(await p.evaluate(() => { const w = window.__ws; if (!w) return null; const a = window.__app.audio; const vs = [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc.split('/').pop(), paused: v.paused, t: +v.currentTime.toFixed(1), rs: v.readyState, err: v.error?.code, op: v.style.opacity || getComputedStyle(v).opacity })); return { ctx: a.ctx.state, loaded: w.loaded, pos: +w.clock.pos().toFixed(1), mode: w.stage.info.mode, item: w.stage.info.id, vs, mq: (a.musicQueue||[]).length, track: a.currentTrack?.()?.title, layers: a.activeLayers?.(), audioEls: document.querySelectorAll('audio').length }; })));
}
console.log(logs.join('\n'));
await p.screenshot({ path: '/tmp/wk.png' });
await b.close();
