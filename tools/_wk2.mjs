import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage();
await p.goto('https://kevin-zark.github.io/writing-sessions/preview.html');
console.log(await p.evaluate(async () => {
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; document.body.appendChild(v);
  const r = { h264: v.canPlayType('video/mp4; codecs="avc1.640028"'), webm: v.canPlayType('video/webm; codecs="vp8"'), mp4: v.canPlayType('video/mp4') };
  const ev = []; ['loadedmetadata','loadeddata','canplay','canplaythrough','error','stalled','suspend','playing'].forEach(e => v.addEventListener(e, () => ev.push(e + '@' + Math.round(performance.now()))));
  v.preload = 'auto'; v.src = '/writing-sessions/themes/dark-academia-train/clips/loop-s0.mp4'; v.load();
  await new Promise(r => setTimeout(r, 6000)); r.noPlay = ev.join(','); r.rs = v.readyState; r.err = v.error && v.error.code + ' ' + v.error.message;
  try { await v.play(); } catch (e) { r.playErr = e.message; } await new Promise(r => setTimeout(r, 3000)); r.afterPlay = ev.join(','); r.rs2 = v.readyState; r.t = v.currentTime; r.err2 = v.error && v.error.code + ' ' + v.error.message; return r; }));
await b.close();
