// Theme preview / QA page: play any clip with its exact ambience mix, step through the chain to check
// seams, and jot notes per clip (saved on this device; "Copy notes" puts them on the clipboard to send to Zeke).
import { chainOf } from './journey.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qs = new URLSearchParams(location.search);
const AC = window.AudioContext || window.webkitAudioContext;
let ctx, master, bufs = {}, nodes = {}, m, base, NKEY;

async function main() {
  const idx = await (await fetch('themes/index.json', { cache: 'no-cache' })).json();
  const id = qs.get('theme') || idx.themes[0];
  base = `themes/${id}/`; NKEY = `ws.preview.notes.${id}`;
  m = await (await fetch(base + 'manifest.json', { cache: 'no-cache' })).json();
  if (m.schema !== 2) { $('#pv').innerHTML = '<p>This theme uses the old format; nothing to preview.</p>'; return; }
  render();
}
const notes = () => { try { return JSON.parse(localStorage.getItem(NKEY)) || {}; } catch (e) { return {}; } };
function rowsFor() {
  const ch = chainOf(m), out = [];
  const st = (i) => ({ key: ch.stations[i].id, kind: 'station', title: ch.stations[i].title, clip: ch.stations[i].clip, still: ch.stations[i].still, amb: ch.stations[i].ambience });
  out.push({ head: 'Origin & intro' }, st(0));
  ch.legs.forEach((leg, li) => {
    out.push({ head: `Leg ${li + 1} · ${leg.title}`, music: leg.music });
    if (leg.depart) out.push({ key: `depart-${leg.id}`, kind: 'bridge', title: `Depart ${ch.stations[li].title}`, clip: leg.depart.clip, still: ch.stations[li].still, amb: leg.views[0].ambience });
    leg.views.forEach((v, vi) => {
      out.push({ key: v.id, kind: 'view', title: v.title, clip: v.clip, still: v.still, amb: v.ambience });
      if (v.next) out.push({ key: `br-${v.id}`, kind: 'bridge', title: `${v.title} → ${leg.views[vi + 1].title}`, clip: v.next.clip, still: v.still, amb: leg.views[vi + 1].ambience });
    });
    if (leg.arrive) out.push({ key: `arrive-${leg.id}`, kind: 'bridge', title: `Arrive ${ch.stations[li + 1].title}`, clip: leg.arrive.clip, still: leg.views.at(-1).still, amb: ch.stations[li + 1].ambience });
    out.push({ head: li < ch.legs.length - 1 ? `Break stop · ${ch.stations[li + 1].title}` : 'Arrival & outro' }, st(li + 1));
  });
  return out;
}
let rows = [], playing = -1, chainMode = false;
function render() {
  rows = rowsFor(); const n = notes();
  const clips = rows.filter(r => r.key).length;
  $('#pv').innerHTML = `
    <h1>${esc(m.title)}</h1>
    <p class="muted">Preview &amp; QA · ${clips} clips · tap a clip to hear it with its ambience. Notes stay on this phone; “Copy notes” to send them.</p>
    <div class="screen"><img id="still" alt=""><video id="vid" muted playsinline webkit-playsinline preload="auto"></video><div class="cap" id="cap">Nothing playing</div></div>
    <div class="bar">
      <button id="stop">Stop</button><button id="chain">Play chain from here</button><button id="mute">Ambience on</button>
      <button id="copy">Copy notes</button><span class="muted" id="msg"></span>
    </div>
    <div class="mix" id="mix"></div>
    ${rows.map((r, i) => r.head ? `<div class="leg"><h2>${esc(r.head)}</h2>${r.music ? `<small>Music: ${r.music.map(t => esc(t.title)).join(' · ')}</small>` : ''}</div>` : `
      <div class="row" data-i="${i}"><img src="${base + esc(r.still)}" alt="" loading="lazy">
        <div><b>${esc(r.title)}</b> <span class="tag ${r.kind === 'bridge' ? 'br' : ''}">${r.kind}</span><br>
        ${r.amb.map(a => `<span class="tag">${esc(a.layer)} ${Math.round((a.gain ?? 1) * 100)}%</span>`).join('')}
        <textarea data-k="${esc(r.key)}" placeholder="Notes (e.g. ‘tunnel too quiet’, ‘seam jumps’)">${esc(n[r.key] || '')}</textarea></div></div>`).join('')}
    <h2 style="font-family:Georgia,serif;font-weight:400;color:#d9b26f;margin-top:24px">Ambience library QA</h2>
    <table><tr><th>layer</th><th>what</th><th>LUFS</th><th>peak</th><th>seam Δ dB</th><th>len</th></tr>
      ${Object.entries(m.ambienceLib).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v.title)}</td><td>${v.qa?.lufs}</td><td>${v.qa?.true_peak_dbfs}</td><td>${v.qa?.seam_level_jump_db}</td><td>${v.qa?.seconds}s</td></tr>`).join('')}</table>
    <h2 style="font-family:Georgia,serif;font-weight:400;color:#d9b26f;margin-top:24px">Credits</h2>
    <ul class="muted" style="font-size:.8rem">${(m.credits || []).filter(c => c.kind === 'ambience').map(c => `<li><a style="color:#d9b26f" href="${esc(c.url)}">${esc(c.title)}</a> by ${esc(c.author)} · ${esc(c.license)} · used as ${esc(c.usedAs.join(', '))}</li>`).join('')}</ul>`;
  document.querySelectorAll('.row').forEach(el => el.onclick = (e) => { if (e.target.tagName === 'TEXTAREA') return; chainMode = false; play(+el.dataset.i); });
  document.querySelectorAll('textarea').forEach(t => t.oninput = () => { const n = notes(); n[t.dataset.k] = t.value; localStorage.setItem(NKEY, JSON.stringify(n)); });
  $('#stop').onclick = stop;
  $('#chain').onclick = () => { chainMode = true; play(playing >= 0 ? playing : rows.findIndex(r => r.key)); };
  $('#mute').onclick = (e) => { const on = master && master.gain.value > 0; if (master) master.gain.value = on ? 0 : 1; e.target.textContent = on ? 'Ambience off' : 'Ambience on'; };
  $('#copy').onclick = async () => {
    const n = notes(), txt = `Preview notes · ${m.title}\n` + rows.filter(r => r.key && n[r.key]).map(r => `- ${r.key} (${r.title}): ${n[r.key]}`).join('\n');
    try { await navigator.clipboard.writeText(txt); $('#msg').textContent = 'Copied'; } catch (e) { prompt('Copy these notes', txt); }
  };
  const v = $('#vid');
  v.onended = () => { if (!chainMode) return; let j = playing + 1; while (rows[j] && !rows[j].key) j++; if (rows[j]) play(j); };
}
async function ensureCtx() {
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
  if (ctx.state !== 'running') await ctx.resume();
}
async function buf(layer) {
  if (bufs[layer]) return bufs[layer];
  const ab = await (await fetch(base + m.ambienceLib[layer].src)).arrayBuffer();
  return (bufs[layer] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)));
}
async function setMix(amb) {
  const want = {}; amb.forEach(a => { want[a.layer] = (a.gain ?? 1) * (m.ambienceLib[a.layer]?.gain ?? 1) * 0.8; });
  for (const k of Object.keys(want)) if (!nodes[k]) {
    const b = await buf(k); const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(master); s.start(); nodes[k] = { s, g };
  }
  const now = ctx.currentTime;
  for (const [k, n] of Object.entries(nodes)) { n.g.gain.cancelScheduledValues(now); n.g.gain.setValueAtTime(n.g.gain.value, now); n.g.gain.linearRampToValueAtTime(want[k] || 0, now + 1.5); }
  $('#mix').textContent = 'Now: ' + (Object.keys(want).join(' + ') || 'silence');
}
async function play(i) {
  const r = rows[i]; if (!r?.key) return;
  playing = i; document.querySelectorAll('.row').forEach(el => el.style.background = +el.dataset.i === i ? '#1d1a14' : '');
  await ensureCtx();
  const v = $('#vid'); $('#still').src = base + r.still;
  v.loop = !chainMode && r.kind !== 'bridge' ? true : false;
  if (chainMode && r.kind !== 'bridge') { let n = 0; v.loop = true; v.ontimeupdate = () => { if (v.currentTime < 0.3 && ++n >= 2) { v.loop = false; v.ontimeupdate = null; } }; } else v.ontimeupdate = null;
  v.src = base + r.clip; v.play().catch(() => {});
  $('#cap').textContent = `${r.title} · ${r.kind}`;
  setMix(r.amb);
}
function stop() { chainMode = false; const v = $('#vid'); v.pause(); playing = -1; if (ctx) setMix([]); $('#cap').textContent = 'Stopped'; }
main().catch(e => { $('#pv').innerHTML = `<p>Could not load: ${esc(e.message)}</p>`; });
