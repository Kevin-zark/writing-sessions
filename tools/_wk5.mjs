import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage();
await p.addInitScript(() => { window.__vev = []; ['error','canplay','playing','ended','stalled','waiting','pause'].forEach(e => document.addEventListener(e, ev => window.__vev.push(e + ':' + (ev.target.currentSrc||'').split('/').pop() + '@' + Math.round(performance.now()/100)/10), true)); });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('http://localhost:8096/'); await p.waitForSelector('.card-theme'); await p.click('.card-theme'); await p.click('#begin');
await p.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 60000 });
await p.waitForTimeout(2500);
const br = await p.evaluate(() => { const its = window.__ws.plan.items; const k = its.findIndex((x, i) => i > 1 && x.kind === 'bridge' && its[i - 1].kind === 'loop'); window.__ws.clock.seek(its[k].start - 14); window.__ws.audio.schedule(window.__ws.tl, window.__ws.clock.pos(), 1); return { k, id: its[k].id, start: its[k].start, prev: its[k-1], next: its[k+1].id }; });
console.log(JSON.stringify(br));
for (let i = 0; i < 9; i++) { await p.waitForTimeout(3000); console.log(await p.evaluate(() => JSON.stringify({ pos: +window.__ws.clock.pos().toFixed(1), cur: window.__ws.stage.cur, pend: window.__ws.stage.pending, log: window.__ws.stage.log.slice(-3).map(x => x.id + ':' + x.mode), vs: [...document.querySelectorAll('video')].map(v => v.currentSrc.split('/').pop() + ' ' + v.paused + ' ' + v.currentTime.toFixed(1) + ' loop' + v.loop + ' end' + v.ended) }))); }
console.log(await p.evaluate(() => window.__vev.join(' ')));
await b.close();
