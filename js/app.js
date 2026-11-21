import { PRESETS, DEFAULT_SETTINGS, clampCfg, buildTimeline, fmtTotal, INTRO_SEC, OUTRO_SEC } from './engine.js';
import { Player } from './player.js';
import { SessionAudio } from './audio.js';
import { buildRequest, submitRequest, loadRequests, saveRequests, mailtoUrl } from './request.js';
import { CONFIG } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const qs = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(qs.get('speed')) || 1);       // debug: ?speed=60 runs the clock 60x faster
const SKEY = 'ws.settings.v1';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let settings = (() => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SKEY)) }; } catch (e) { return { ...DEFAULT_SETTINGS }; } })();
const save = () => localStorage.setItem(SKEY, JSON.stringify(settings));
const audio = new SessionAudio();
let themes = [], player = null, tab = 'library';

function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id); if (!p) return;
  settings.preset = id;
  if (id !== 'custom') { settings.sprintMin = p.sprintMin; settings.breakMin = p.breakMin; settings.sprints = p.sprints; }
  save();
}
function summary() {
  const c = clampCfg(settings), tl = buildTimeline({ ...c, intro: settings.intro, outro: settings.outro });
  const br = c.breakMin > 0 && c.sprints > 1 ? ` · ${c.breakMin} min breaks` : '';
  return { text: `${c.sprints} × ${c.sprintMin} min${br}`, total: fmtTotal(tl.total) };
}

// ---------- screens ----------
function presetChips() {
  return `<div class="chips">${PRESETS.map(p => `<button class="chip ${settings.preset === p.id ? 'on' : ''}" data-preset="${p.id}"><b>${p.name}</b><small>${p.note}</small></button>`).join('')}</div>`;
}
function renderLibrary() {
  $('#view-library').innerHTML = `
    <header class="top"><h1>Writing Sessions</h1><p>Immersive sprints for your stories</p></header>
    <div class="cards">${themes.map(t => `
      <button class="card-theme" data-theme="${esc(t.id)}">
        <div class="cover" style="background-image:url('themes/${esc(t.id)}/${esc(t.cover)}')"></div>
        <div class="meta"><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p>
        <span class="pill">${t.schema === 2 ? `${t.legs.length} legs · ${t.legs.reduce((a, l) => a + l.views.length, 0)} views · ${t.legs.reduce((a, l) => a + l.music.length, 0)} songs` : `${(t.scenes || []).length} scenes`}${t.status === 'private' ? ' · private' : ''}</span></div>
      </button>`).join('') || '<p class="muted">No themes yet.</p>'}
    </div>
    <p class="muted center small">More themes appear here as they are made — use the Request tab.</p>`;
  $('#view-library').querySelectorAll('[data-theme]').forEach(b => b.onclick = () => openSheet(themes.find(t => t.id === b.dataset.theme)));
}
function openSheet(t) {
  const sh = $('#sheet'); const s = summary();
  sh.hidden = false; sh.innerHTML = `
    <div class="sheet-card">
      <button class="sheet-x" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>
      <div class="cover small" style="background-image:url('themes/${esc(t.id)}/${esc(t.cover)}')"></div>
      <h2>${esc(t.title)}</h2><p class="muted">${esc(t.description)}</p>
      ${presetChips()}
      <p class="sum" id="sheet-sum">${s.text} · about ${s.total} total${settings.intro ? '' : ' · no intro'}${settings.outro ? '' : ' · no outro'}</p>
      <button class="btn big" id="begin">Begin session</button>
      <p class="muted small center">Tap to start — sound begins when you do. <a href="#" id="to-settings">Custom lengths in Settings</a></p>
    </div>`;
  sh.querySelector('.sheet-x').onclick = () => sh.hidden = true;
  sh.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); openSheet(t); });
  $('#to-settings').onclick = (e) => { e.preventDefault(); sh.hidden = true; setTab('settings'); };
  $('#begin').onclick = () => { sh.hidden = true; begin(t); };
}
function begin(t) {
  const base = `themes/${t.id}/`;
  player = new Player({ root: $('#player'), manifest: t, base, settings: { ...clampCfg(settings), intro: settings.intro, outro: settings.outro,
    musicVol: settings.musicVol, ambVol: settings.ambVol, chimeVol: settings.chimeVol, wakeLock: settings.wakeLock },
    speed: SPEED, audio, onExit: () => { player = null; document.body.classList.remove('playing'); } });
  document.body.classList.add('playing');
  player.start();                       // synchronous part runs inside this tap
}

function stepper(id, label, val, min, max, step = 1, unit = '') {
  return `<label class="field"><span>${label}</span><div class="stepper" data-for="${id}">
    <button type="button" data-d="-${step}" aria-label="less">−</button>
    <input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${val}"><em>${unit}</em>
    <button type="button" data-d="${step}" aria-label="more">+</button></div></label>`;
}
function renderSettings() {
  const s = summary();
  $('#view-settings').innerHTML = `
    <header class="top"><h1>Settings</h1><p>Session shape &amp; sound</p></header>
    <section><h3>Presets</h3>${presetChips()}</section>
    <section><h3>Lengths</h3>
      ${stepper('f-sprintMin', 'Sprint length', settings.sprintMin, 1, 180, 1, 'min')}
      ${stepper('f-breakMin', 'Break length', settings.breakMin, 0, 60, 1, 'min')}
      ${stepper('f-sprints', 'Number of sprints', settings.sprints, 1, 12, 1, '')}
      <p class="sum" id="set-sum">${s.text} · about ${s.total} total</p>
      <p class="muted small">No break after the final sprint. Editing a value switches to Custom.</p>
    </section>
    <section><h3>Intro &amp; outro</h3>
      <label class="switch"><span>Intro (~${INTRO_SEC}s welcome)</span><input type="checkbox" id="f-intro" ${settings.intro ? 'checked' : ''}></label>
      <label class="switch"><span>Outro (~${OUTRO_SEC}s wrap-up)</span><input type="checkbox" id="f-outro" ${settings.outro ? 'checked' : ''}></label>
    </section>
    <section><h3>Sound</h3>
      <label class="slider"><span>Music</span><input type="range" id="f-musicVol" min="0" max="1" step="0.05" value="${settings.musicVol}"></label>
      <label class="slider"><span>Ambience</span><input type="range" id="f-ambVol" min="0" max="1" step="0.05" value="${settings.ambVol}"></label>
      <label class="slider"><span>Chime</span><input type="range" id="f-chimeVol" min="0" max="1" step="0.05" value="${settings.chimeVol}"></label>
      <button class="btn ghost" id="test-chime">Play test chime</button>
      <label class="switch"><span>Keep screen awake</span><input type="checkbox" id="f-wakeLock" ${settings.wakeLock ? 'checked' : ''}></label>
    </section>
    <section><h3>Request delivery</h3>
      <label class="field col"><span>Webhook URL <small>(optional)</small></span><input id="f-webhookUrl" type="url" placeholder="https://ntfy.sh/your-secret-topic" value="${esc(settings.webhookUrl)}"></label>
      <label class="field col"><span>Email for requests <small>(used when no webhook)</small></span><input id="f-mailtoTo" type="email" placeholder="you@example.com" value="${esc(settings.mailtoTo || CONFIG.REQUEST_MAILTO_TO)}"></label>
    </section>
    <p class="muted small center"><a href="preview.html" style="color:var(--accent,#d9b26f)">Theme preview &amp; QA</a></p>
    <p class="muted small center">v2 journeys${SPEED !== 1 ? ` · debug speed ×${SPEED}` : ''}</p>`;
  const v = $('#view-settings');
  v.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); renderSettings(); });
  const refresh = () => { const s2 = summary(); $('#set-sum').textContent = `${s2.text} · about ${s2.total} total`; };
  const markCustom = () => { if (settings.preset !== 'custom') { settings.preset = 'custom'; v.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.preset === 'custom')); } };
  ['sprintMin', 'breakMin', 'sprints'].forEach(k => {
    const inp = $('#f-' + k), st = inp.closest('.stepper');
    const set = (val) => { settings[k] = Number(val); markCustom(); save(); refresh(); };
    inp.onchange = () => { const c = clampCfg({ ...settings, [k]: inp.value }); inp.value = c[k]; set(c[k]); };
    st.querySelectorAll('button').forEach(b => b.onclick = () => { const c = clampCfg({ ...settings, [k]: Number(inp.value || 0) + Number(b.dataset.d) }); inp.value = c[k]; set(c[k]); });
  });
  ['intro', 'outro', 'wakeLock'].forEach(k => $('#f-' + k).onchange = (e) => { settings[k] = e.target.checked; save(); refresh(); });
  ['musicVol', 'ambVol', 'chimeVol'].forEach(k => $('#f-' + k).oninput = (e) => { settings[k] = Number(e.target.value); save(); });
  ['webhookUrl', 'mailtoTo'].forEach(k => $('#f-' + k).onchange = (e) => { settings[k] = e.target.value.trim(); save(); });
  $('#test-chime').onclick = () => { audio.unlock(); audio.setVolumes({ chime: settings.chimeVol }); setTimeout(() => audio.previewChime(), 50); };
}

function renderRequest() {
  const reqs = loadRequests().slice().reverse();
  const via = (settings.webhookUrl || CONFIG.REQUEST_WEBHOOK_URL) ? 'Sends to your webhook' : 'Opens an email to send';
  $('#view-request').innerHTML = `
    <header class="top"><h1>Request a theme</h1><p>Describe a world and I'll make the session</p></header>
    <form id="req-form" autocomplete="off">
      <label class="field col"><span>Theme</span><textarea id="r-theme" rows="4" required placeholder="A lakeside cabin at dawn: mist on the water, pines swaying, a loon calling…"></textarea></label>
      <label class="field col"><span>Mood <small>(optional)</small></span><input id="r-mood" placeholder="cozy, melancholy, mysterious…"></label>
      <label class="field col"><span>Music notes <small>(optional)</small></span><input id="r-music" placeholder="slow piano, cello, no drums, 70 bpm…"></label>
      <button class="btn big" id="r-send" type="submit">Send request</button>
      <p class="muted small center" id="r-via">${via}</p>
      <div id="r-status" class="status" hidden></div>
    </form>
    ${reqs.length ? `<section><h3>Your requests</h3><ul class="reqs">${reqs.map(r => `<li><b>${esc(r.theme.slice(0, 90))}${r.theme.length > 90 ? '…' : ''}</b><small>${new Date(r.createdAt).toLocaleDateString()} · <span class="st ${r.status}">${r.status}</span></small></li>`).join('')}</ul></section>` : ''}`;
  $('#req-form').onsubmit = (e) => {
    e.preventDefault();
    const theme = $('#r-theme').value; if (!theme.trim()) return;
    const r = buildRequest({ theme, mood: $('#r-mood').value, music: $('#r-music').value });
    const btn = $('#r-send'), st = $('#r-status'); btn.disabled = true; btn.textContent = 'Sending…';
    const done = (res) => {
      const all = loadRequests();
      r.status = res.ok ? 'sent' : 'queued'; r.via = res.via; all.push(r); saveRequests(all);
      st.hidden = false; st.className = 'status ' + (res.ok ? 'ok' : 'warn');
      if (res.ok) {
        st.innerHTML = `<b>✓ Sent</b><span>${res.via === 'mailto' ? (res.hasRecipient ? 'Your mail app opened — press send there.' : 'Your mail app opened. Add a recipient (or set one in Settings) and press send.') : 'Your request is on its way.'}</span>`;
        $('#req-form').reset();
      } else {
        const to = (settings.mailtoTo || CONFIG.REQUEST_MAILTO_TO || '');
        st.innerHTML = `<b>Couldn't reach the webhook</b><span>Saved on this phone. <a href="${esc(mailtoUrl(r, to))}">Send by email instead</a></span>`;
      }
      btn.disabled = false; btn.textContent = 'Send request';
      setTimeout(() => { const keep = st.cloneNode(true); renderRequest(); const s2 = $('#r-status'); s2.replaceWith(keep); }, 0);
    };
    submitRequest(r, settings).then(done);
  };
}

// ---------- shell ----------
function setTab(t) {
  tab = t;
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + t);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ({ library: renderLibrary, settings: renderSettings, request: renderRequest })[t]();
  window.scrollTo(0, 0);
}
async function init() {
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  try {
    const idx = await (await fetch('themes/index.json', { cache: 'no-cache' })).json();
    themes = (await Promise.all(idx.themes.map(async id => { try { return await (await fetch(`themes/${id}/manifest.json`, { cache: 'no-cache' })).json(); } catch (e) { return null; } }))).filter(Boolean);
  } catch (e) { themes = []; }
  setTab('library');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__app = { get settings() { return settings; }, themes, audio, get player() { return player; } };
  const auto = qs.get('autostart');            // debug: ?autostart=<themeId> opens the start sheet
  if (auto) { const t = themes.find(x => x.id === auto); if (t) openSheet(t); }
}
init();
