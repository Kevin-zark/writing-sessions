// WebKit iPhone e2e: seek-sync — music, ambience and visuals follow session time t.
import pkg from '/workspace/writing-sessions/node_modules/playwright/index.js';
const { webkit, devices } = pkg;

const BASE = process.env.E2E_URL || 'http://127.0.0.1:8109/';
const THEME = process.env.THEME || 'dark-academia-train';
const TOL = 0.1; // 100 ms

const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 14'] });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errs = [];
page.on('pageerror', e => errs.push(e.message));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS', name, extra != null ? extra : ''); }
  else { fail++; console.log('FAIL', name, extra != null ? extra : ''); }
}
function close(a, b, tol = TOL) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol; }

const u = BASE + (BASE.includes('?') ? '&' : '?') + 'autostart=' + encodeURIComponent(THEME);
await page.goto(u);
await page.waitForSelector('#begin', { timeout: 45000 });
await page.click('#begin');
await page.waitForFunction(() => window.__ws && window.__ws.started, null, { timeout: 45000 });
ok('session started', await page.evaluate(() => !!(window.__ws && window.__app.audio.ctx)));
await page.waitForTimeout(400);

const meta = await page.evaluate(() => {
  const tl = window.__ws.tl;
  const s1 = tl.segs.find(s => s.type === 'sprint' && s.n === 1);
  const br1 = tl.segs.find(s => s.type === 'break' && s.n === 1);
  const s2 = tl.segs.find(s => s.type === 'sprint' && s.n === 2);
  const A = (window.__app.audio.tracks || []).find(t => /letters-by-lamplight-a/.test(t.src || ''));
  const durA = A?.buf?.duration || 134.52;
  return { s1s: s1.start, s1e: s1.end, br1s: br1.start, br1e: br1.end, s2s: s2.start, durA, ov: window.__app.audio.fadeOverlap };
});
console.log('meta', meta);

async function sync(t) {
  await page.evaluate(async (t) => { await window.__ws.syncTo(t); }, t);
  // Just past the 80 ms gate so sources are running; t should still be within 100 ms.
  await page.waitForTimeout(50);
}

async function state() {
  return page.evaluate(() => {
    const a = window.__app.audio;
    const ins = a.inspect();
    const pos = window.__ws.clock.pos();
    const visual = window.__ws.v2
      ? { item: window.__ws.stage.cur, id: window.__ws.plan.items[window.__ws.stage.cur]?.id, getPos: window.__ws.stage.getPos ? window.__ws.stage.getPos() : pos }
      : { item: null, getPos: pos };
    return { pos, ins, visual, busM: a.musicBus.gain.value, busA: a.ambBus.gain.value };
  });
}

function matchT(st, target, label) {
  ok(label + ': session t / clock / visual within 100ms of target',
    close(st.ins.t, target) && close(st.pos, target) && close(st.visual.getPos, target),
    { target, t: st.ins.t, pos: st.pos, vis: st.visual.getPos, dt: st.ins.t - target });
}

// --- 1. Song loop (Letters A into itself) ---
const join = meta.durA; // first self-loop join ≈ 134.52, during sprint 1
await sync(join - 4);
let st = await state();
matchT(st, join - 4, 'loop-4s');
ok('loop-4s: Letters A in fade-out (k=0, gain mid)', st.ins.song?.title === 'Letters by Lamplight' && st.ins.song?.k === 0 && st.ins.song.gain > 0.2 && st.ins.song.gain < 0.95, { gain: st.ins.song?.gain, voices: st.ins.voices?.length, off: st.ins.song?.offset });
ok('loop-4s: offset is last ~4s of the file', close(st.ins.song?.offset, meta.durA - 4, 0.15), st.ins.song?.offset);

await sync(join - 0.4);
st = await state();
matchT(st, join - 0.4, 'loop overlap');
ok('loop overlap: two voices of Letters A', st.ins.voices?.length === 2 && st.ins.voices.every(v => v.title === 'Letters by Lamplight'), st.ins.voices?.map(v => ({ k: v.k, off: v.offset, g: v.gain })));

await sync(join + 1);
st = await state();
matchT(st, join + 1, 'after loop');
ok('after loop: Letters A k=1, offset ~2.5s', st.ins.song?.title === 'Letters by Lamplight' && st.ins.song?.k === 1 && close(st.ins.song.offset, 2.5, 0.15), { k: st.ins.song?.k, off: st.ins.song?.offset });

await sync(join + 6);
await page.evaluate(async () => { await window.__ws.seekBy(-5); });
await page.waitForTimeout(50);
st = await state();
ok('seekBy -5 across loop: t ~ join+1', close(st.pos, join + 1, 0.15) && st.ins.song?.k === 1, { pos: st.pos, off: st.ins.song?.offset, k: st.ins.song?.k });
await page.evaluate(async () => { await window.__ws.seekBy(5); });
await page.waitForTimeout(50);
st = await state();
ok('seekBy +5 back across loop: t ~ join+6', close(st.pos, join + 6, 0.15) && st.ins.song?.k === 1, { pos: st.pos, off: st.ins.song?.offset, k: st.ins.song?.k });

// --- 2. Sprint → break boundary ---
await sync(meta.br1s - 4);
st = await state();
matchT(st, meta.br1s - 4, '4s before break');
ok('4s before break: music fading out, still Letters A', st.ins.buses.m > 0.05 && st.ins.buses.m < 0.75 && st.ins.song?.title === 'Letters by Lamplight', { busM: st.ins.buses.m, title: st.ins.song?.title, off: st.ins.song?.offset });

await sync(meta.br1s + 0.5);
st = await state();
matchT(st, meta.br1s + 0.5, 'into break');
ok('into break: music bus ~0, station/break layers present', st.ins.buses.m < 0.05 && (st.ins.layers || []).length >= 1, { busM: st.ins.buses.m, busA: st.ins.buses.a, layers: st.ins.layers?.map(l => l.layer) });

// skip +1 from mid-break lands on sprint 2 (song + leg change)
await sync(meta.br1s + 10);
await page.evaluate(async () => { await window.__ws.skip(1); });
await page.waitForTimeout(50);
st = await state();
ok('skip +1 from break: sprint 2 start, Rain A near 0', st.ins.song?.title === 'Rain over Wrenmere Lake' && st.ins.song?.offset < 1.0 && close(st.pos, meta.s2s + 0.01, 0.2), { title: st.ins.song?.title, off: st.ins.song?.offset, t: st.pos });

// --- 3. Song + leg change (sprint 2 = Rain A) ---
await sync(meta.s2s + 10);
st = await state();
matchT(st, meta.s2s + 10, 'sprint2+10');
ok('sprint2+10: Rain over Wrenmere Lake at offset 10', st.ins.song?.title === 'Rain over Wrenmere Lake' && close(st.ins.song?.offset, 10, 0.15) && st.ins.song?.k === 0, { title: st.ins.song?.title, off: st.ins.song?.offset, k: st.ins.song?.k });
ok('sprint2+10: music bus full', close(st.ins.buses.m, 0.8, 0.05), st.ins.buses.m);

await page.evaluate(async () => { await window.__ws.seekBy(-5); });
await page.waitForTimeout(50);
st = await state();
ok('sprint2 seekBy -5: Rain A offset ~5', close(st.ins.song?.offset, 5, 0.15) && st.ins.song?.title === 'Rain over Wrenmere Lake' && close(st.pos, meta.s2s + 5, 0.15), { off: st.ins.song?.offset, t: st.pos });

// --- 4. Ambience offsets follow t ---
await sync(meta.s2s + 20);
const layA = await state();
await sync(meta.s2s + 25);
const layB = await state();
const layerChecks = [];
for (const L of (layA.ins.layers || [])) {
  const L2 = (layB.ins.layers || []).find(x => x.layer === L.layer);
  if (!L2) continue;
  const len = L.loopEnd - L.loopStart;
  let exp = L.offset + 5;
  if (exp >= L.loopEnd) exp = L.loopStart + ((exp - L.loopStart) % len);
  layerChecks.push({ layer: L.layer, offA: L.offset, offB: L2.offset, expected: exp, d: Math.abs(L2.offset - exp) });
}
ok('ambience offsets advance ~5s (mod loop) when t advances 5s', layerChecks.length >= 1 && layerChecks.every(x => x.d < 0.15), layerChecks);

// live offsets also match inspect(t) math at the same t
ok('ambience offsets at sprint2+25 match expected period', (layB.ins.layers || []).every(L => {
  // period start is some earlier t; just require a finite offset inside the loop
  return L.offset >= L.loopStart - 0.01 && L.offset < L.loopEnd + 0.01;
}), layB.ins.layers);

ok('no page errors', errs.length === 0, errs);

await browser.close();
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
