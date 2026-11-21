import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const ctx = await b.newContext({ ...devices['iPhone 14'] }); const p = await ctx.newPage();
await p.goto('http://localhost:8096/preview.html');
for (const u of process.argv.slice(2)) {
  console.log(u, JSON.stringify(await p.evaluate(async (u) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; document.body.appendChild(v); v.src = u; v.loop = false;
    let ended = false; v.onended = () => ended = true; await v.play(); v.currentTime = 6;
    const trace = []; for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 500)); trace.push(+v.currentTime.toFixed(2)); }
    return { dur: v.duration, ended, paused: v.paused, rs: v.readyState, trace: trace.join(',') }; }, u)));
}
await b.close();
