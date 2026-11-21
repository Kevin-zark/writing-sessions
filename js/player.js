import { buildTimeline, locate, planScenes, sceneAt, fmtClock } from './engine.js';
import { SessionAudio } from './audio.js';
import { SceneStage, JourneyStage } from './scenes.js';
import { planJourney, itemAt, legAt } from './journey.js';

class Clock {
  constructor(speed) { this.speed = speed; this.base = 0; this.t0 = null; }
  start(pos = 0) { this.base = pos; this.t0 = Date.now(); }
  pos() { return this.t0 == null ? this.base : this.base + (Date.now() - this.t0) / 1000 * this.speed; }
  pause() { this.base = this.pos(); this.t0 = null; }
  resume() { if (this.t0 == null) this.t0 = Date.now(); }
  seek(p) { this.base = p; if (this.t0 != null) this.t0 = Date.now(); }
  get running() { return this.t0 != null; }
}

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${d}</svg>`;
const ICON = {
  prev: svg('<path d="M6 5h2v14H6zM20 5v14L9.5 12z"/>'), next: svg('<path d="M16 5h2v14h-2zM4 5l10.5 7L4 19z"/>'),
  pause: svg('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'), play: svg('<path d="M7 4l13 8-13 8z"/>'), close: svg('<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>'),
};

export class Player {
  constructor({ root, manifest, base, settings, speed = 1, audio, onExit }) {
    this.root = root; this.m = manifest; this.base = base; this.s = settings; this.speed = speed;
    this.audio = audio || new SessionAudio(); this.onExit = onExit;
    this.tl = buildTimeline(settings);
    this.v2 = manifest.schema === 2 && Array.isArray(manifest.legs);
    this.plan = this.v2 ? planJourney(this.tl, manifest) : planScenes(this.tl, (manifest.scenes || []).length, manifest.sceneMode || 'journey');
    this.clock = new Clock(speed);
    this.curSeg = -1; this.paused = false; this.finished = false; this.started = false;
    this.events = [];   // transition log for debugging/tests
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = `
      <div class="stage"></div><div class="vignette"></div>
      <div class="card"><p></p></div>
      <div class="breaktext"><p></p></div>
      <div class="hud" aria-live="off"><div class="hud-scene"></div><div class="hud-label"></div><div class="hud-clock">00:00</div></div>
      <div class="bar"><i></i></div>
      <div class="controls">
        <button class="ctl close" aria-label="End session">${ICON.close}</button>
        <div class="ctl-row">
          <button class="ctl prev" aria-label="Previous section">${ICON.prev}</button>
          <button class="ctl play" aria-label="Pause">${ICON.pause}</button>
          <button class="ctl next" aria-label="Next section">${ICON.next}</button>
        </div>
        <div class="speedbadge"></div>
      </div>
      <div class="prep"><p>Preparing your session…</p></div>
      <div class="confirm" hidden><div><p>End this session?</p><button class="btn ghost no">Keep writing</button><button class="btn yes">End session</button></div></div>`;
    r.hidden = false; r.classList.add('open'); r.classList.remove('done');
    const q = (s) => r.querySelector(s);
    this.el = { stage: q('.stage'), card: q('.card'), cardP: q('.card p'), bt: q('.breaktext'), btP: q('.breaktext p'),
      hud: q('.hud'), label: q('.hud-label'), scene: q('.hud-scene'), clock: q('.hud-clock'), bar: q('.bar i'), controls: q('.controls'),
      play: q('.play'), prep: q('.prep'), confirm: q('.confirm'), badge: q('.speedbadge') };
    if (this.speed !== 1) this.el.badge.textContent = '×' + this.speed;
    this.stage = this.v2
      ? new JourneyStage(this.el.stage, this.plan, this.base, { speed: this.speed, objectPosition: this.m.frame?.objectPosition })
      : new SceneStage(this.el.stage, this.m.scenes || [], this.base);
    r.style.setProperty('--accent', this.m.accent || '#d9b26f');
    // controls: tap to reveal, auto-hide
    this._onTap = (e) => { if (e.target.closest('.ctl,.confirm')) return; this._showControls(); };
    r.addEventListener('click', this._onTap);
    q('.play').onclick = () => this.paused ? this.resume() : this.pause();
    q('.next').onclick = () => this.skip(1);
    q('.prev').onclick = () => this.skip(-1);
    q('.close').onclick = () => { this.el.confirm.hidden = false; };
    q('.confirm .no').onclick = () => { this.el.confirm.hidden = true; };
    q('.confirm .yes').onclick = () => this.exit();
    this._vis = () => { if (document.visibilityState === 'visible' && this.started && !this.finished) { this._acquireWake(); if (!this.paused) { this.audio.resume(); this.stage.resume(); } this._tick(); } };
    document.addEventListener('visibilitychange', this._vis);
  }

  _showControls() {
    this.root.classList.add('show-controls'); clearTimeout(this._ct);
    this._ct = setTimeout(() => this.root.classList.remove('show-controls'), 4000);
  }

  /** Call synchronously from a tap handler. */
  async start() {
    const a = this.audio;
    a.unlock();                                    // audio context inside the gesture
    this.silent = new Audio(this.base.replace(/themes\/[^/]+\/$/, '') + 'assets/silence.mp3'); this.silent.loop = true;
    this.silent.play().catch(() => {});            // keeps the audio session + lock-screen controls alive
    this._acquireWake();
    if (this.v2) {
      const l0 = legAt(this.plan, 0), legs = this.m.legs;
      const [amb, pool] = await Promise.all([
        a.loadAmbienceLib(this.m.ambienceLib, this.base),
        a.loadMusicPool(legs[l0].id, legs[l0].music, this.base),
        this.stage.update(itemAt(this.plan, 0), 0),
      ]);
      this.loaded = { music: pool.length, amb: amb > 0, layers: amb, errors: a.loadErrors || [] };
      a.setVolumes({ music: this.s.musicVol, amb: this.s.ambVol, chime: this.s.chimeVol });
      a.tracks = pool; this.curLeg = l0;
      a.startLayers();
      this._applyItem(itemAt(this.plan, 0), true);
      this._prefetchLeg(l0 + 1);
    } else {
      const firstScene = sceneAt(this.plan, 0);
      const [loaded] = await Promise.all([a.loadTheme(this.m, this.base), this.stage.show(firstScene, { instant: true })]);
      this.loaded = loaded;
      a.setVolumes({ music: this.s.musicVol, amb: this.s.ambVol, chime: this.s.chimeVol });
      a.startAmbience();
    }
    this.started = true;
    this.el.prep.classList.add('gone');
    this.clock.start(0);
    a.schedule(this.tl, 0, this.speed);
    this._mediaSession();
    this._tick();
    this.timer = setInterval(() => this._tick(), 200);
    this._showControls();
    window.__ws = this;
  }

  _tick() {
    if (!this.started || this.finished) return;
    const pos = this.clock.pos(), loc = locate(this.tl, pos);
    if (loc.done) return this._finish();
    if (loc.i !== this.curSeg) this._enterSegment(loc);
    const seg = loc.seg;
    // HUD
    const showHud = seg.type === 'sprint' || seg.type === 'break';
    this.root.classList.toggle('hud-on', showHud);
    if (showHud) {
      const t = fmtClock(loc.remaining);
      if (this.el.clock.textContent !== t) this.el.clock.textContent = t;
    }
    this.el.bar.style.transform = `scaleX(${loc.progress.toFixed(4)})`;
    this._text(seg, loc);
    // scenes
    if (this.v2) {
      const want = itemAt(this.plan, pos);
      this.stage.update(want, pos);
      if (want !== this._item) this._applyItem(want);
      const lg = legAt(this.plan, pos);
      if (lg !== this.curLeg) this._enterLeg(lg);
    } else {
      const sc = sceneAt(this.plan, pos);
      if (sc !== this.stage.cur) this.stage.show(sc);
    }
    // audio health (1/s)
    const now = Date.now();
    if (!this._lastHealth || now - this._lastHealth > 1000) {
      this._lastHealth = now;
      if (!this.paused) {
        if (!this.audio.running) this.audio.resume();
        else if (Math.abs(this.audio.audioPos() - pos) > 2 * Math.max(1, this.speed)) this.audio.schedule(this.tl, pos, this.speed);
        this.audio.ensureMusic();
      }
    }
    // lock-screen title follows the current music track
    const tr = this.audio.currentTrack?.();
    const key = tr ? (tr.title + '|' + tr.start) : '';
    if (key !== this._trackKey) { this._trackKey = key; if (this.mediaOk) this._mediaMeta(); }
  }

  /** Per-clip ambience: crossfade layers over the bridge length (or 4 s). */
  _applyItem(i, instant) {
    this._item = i; const it = this.plan.items[i]; if (!it) return;
    const sec = instant ? 0.05 : Math.max(0.3, Math.min(8, (it.kind === 'bridge' ? (it.end - it.start) : 4) / this.speed));
    this.audio.setLayers(it.ambience, sec);
    this.el.scene.textContent = it.label || '';
  }
  async _enterLeg(lg) {
    this.curLeg = lg; const leg = this.m.legs[lg]; if (!leg) return;
    const pool = await this.audio.loadMusicPool(leg.id, leg.music, this.base);
    if (this.curLeg !== lg) return;
    const seg = this.tl.segs[this.curSeg];
    this.audio.setMusicPool(pool, { hard: !seg || seg.type === 'break' || seg.type === 'intro' });
    this.audio.prunePools([leg.id, this.m.legs[lg + 1]?.id].filter(Boolean));
    this._prefetchLeg(lg + 1);
    this.events.push({ type: 'leg', leg: leg.id, pos: Math.round(this.clock.pos()), at: Date.now() });
  }
  _prefetchLeg(lg) { const leg = this.m.legs?.[lg]; if (leg) setTimeout(() => this.audio.loadMusicPool(leg.id, leg.music, this.base), 15000 / this.speed); }

  _enterSegment(loc) {
    this.curSeg = loc.i; const seg = loc.seg;
    this.events.push({ i: seg.i, type: seg.type, n: seg.n, pos: Math.round(this.clock.pos()), at: Date.now() });
    this.el.label.textContent = seg.type === 'sprint' ? `SPRINT ${seg.n}/${seg.of}` : seg.type === 'break' ? 'BREAK' : '';
    this.root.dataset.seg = seg.type;
    this._textKey = null;
    if (this.mediaOk) this._mediaMeta();
  }

  _text(seg, loc) {
    let cardLine = '', btLine = '';
    if (seg.type === 'intro' || seg.type === 'outro') {
      const lines = (seg.type === 'intro' ? this.m.intro?.lines : this.m.outro?.lines) || [];
      const n = lines.length || 1, w = seg.dur / n, k = Math.min(n - 1, Math.floor(loc.elapsed / w));
      const within = loc.elapsed - k * w;
      if (lines.length && within > 1 && within < w - 1.5) cardLine = lines[k];
      if (seg.type === 'outro' && loc.elapsed > seg.dur - 1.5 && lines.length) cardLine = lines[lines.length - 1];
    } else if (seg.type === 'break') {
      const bts = this.m.breakText || [];
      if (bts.length && loc.elapsed > 3 && loc.elapsed < Math.min(18, seg.dur * 0.35)) btLine = bts[(seg.n - 1) % bts.length];
      else if (this.m.breakEndText && seg.dur > 40 && loc.remaining < 20 && loc.remaining > 2) btLine = this.m.breakEndText;
    }
    if (cardLine !== this._cardLine) {
      this._cardLine = cardLine;
      if (cardLine) this.el.cardP.textContent = cardLine;
      this.el.card.classList.toggle('on', !!cardLine);
    }
    if (btLine !== this._btLine) {
      this._btLine = btLine;
      if (btLine) this.el.btP.textContent = btLine;
      this.el.bt.classList.toggle('on', !!btLine);
    }
  }

  pause() {
    if (this.paused || this.finished) return;
    this.paused = true; this.clock.pause(); this.audio.suspend(); this.stage.pause();
    this.el.play.innerHTML = ICON.play; this.el.play.setAttribute('aria-label', 'Resume');
    this.root.classList.add('paused'); this._showControls();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.audio.resume(); this.clock.resume(); this.stage.resume();
    this.el.play.innerHTML = ICON.pause; this.el.play.setAttribute('aria-label', 'Pause');
    this.root.classList.remove('paused'); this._acquireWake();
    this.audio.schedule(this.tl, this.clock.pos(), this.speed);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }
  skip(dir) {
    if (this.finished) return;
    const loc = locate(this.tl, this.clock.pos()); let i = loc.i;
    if (dir > 0) i = Math.min(this.tl.segs.length, i + 1);
    else i = (loc.elapsed > 3 / 1 || i === 0) ? i : i - 1;
    if (i >= this.tl.segs.length) { this.clock.seek(this.tl.total - 0.01); } else this.clock.seek(this.tl.segs[i].start + 0.01);
    this.audio.schedule(this.tl, this.clock.pos(), this.speed);
    this._tick();
  }

  _finish() {
    if (this.finished) return;
    this.finished = true; clearInterval(this.timer);
    this.events.push({ type: 'end', pos: Math.round(this.tl.total), at: Date.now() });
    this.root.classList.add('done'); this.root.classList.remove('hud-on');
    this.el.cardP.textContent = (this.m.outro?.lines || ['Beautiful work!'])[0];
    this.el.card.classList.add('on');
    this.el.controls.innerHTML = '<button class="btn done-btn">Back to library</button>';
    this.el.controls.querySelector('.done-btn').onclick = () => this.exit();
    this.root.classList.add('show-controls'); clearTimeout(this._ct);
    this.el.bar.style.transform = 'scaleX(1)';
    setTimeout(() => { if (!this.closed) this.audio.close(); }, 9000);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
    this._releaseWake();
  }

  // ---- wake lock + fallback ----
  async _acquireWake() {
    if (!this.s.wakeLock) return;
    try {
      if ('wakeLock' in navigator) {
        if (this._wl && !this._wl.released) return;
        this._wl = await navigator.wakeLock.request('screen');
        this._wl.addEventListener?.('release', () => {});
        this.wakeMode = 'wakeLock'; return;
      }
    } catch (e) { /* fall through */ }
    // Fallback (older iOS / standalone bugs): a tiny hidden looping video keeps the screen awake.
    if (!this._nosleep) {
      const v = document.createElement('video');
      v.src = this.base.replace(/themes\/[^/]+\/$/, '') + 'assets/nosleep.mp4';
      v.muted = true; v.loop = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.className = 'nosleep';
      this.root.appendChild(v); this._nosleep = v;
    }
    this._nosleep.play().then(() => { this.wakeMode = 'video-fallback'; }).catch(() => { this.wakeMode = 'none'; });
  }
  _releaseWake() {
    try { this._wl?.release(); } catch (e) {}
    try { this._nosleep?.pause(); } catch (e) {}
  }

  // ---- lock-screen metadata ----
  _mediaSession() {
    if (!('mediaSession' in navigator)) return;
    this.mediaOk = true;
    this._mediaMeta();
    navigator.mediaSession.playbackState = 'playing';
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => this.resume()); h('pause', () => this.pause());
    h('nexttrack', () => this.skip(1)); h('previoustrack', () => this.skip(-1));
  }
  _mediaMeta() {
    if (!this.mediaOk || typeof MediaMetadata === 'undefined') return;
    const seg = this.tl.segs[this.curSeg] || this.tl.segs[0];
    const phase = !seg ? 'Writing Sessions'
      : seg.type === 'sprint' ? `Sprint ${seg.n} of ${seg.of}`
      : seg.type === 'break' ? 'Break'
      : seg.type === 'intro' ? 'Welcome' : 'Wrap-up';
    const art = new URL(this.base + this.m.cover, location.href).href;
    const tr = this.audio.currentTrack?.() || {};
    navigator.mediaSession.metadata = new MediaMetadata({
      title: tr.title || this.m.title,
      artist: tr.artist || 'Writing Sessions',
      album: `${phase} · ${this.m.title}`,
      artwork: [{ src: art, sizes: '1280x720', type: 'image/jpeg' }]
    });
  }

  exit() {
    this.closed = true; clearInterval(this.timer); clearTimeout(this._ct);
    document.removeEventListener('visibilitychange', this._vis);
    this._releaseWake(); try { this.silent?.pause(); } catch (e) {}
    this.audio.close(); this.stage.destroy();
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    this.root.classList.remove('open', 'show-controls', 'hud-on', 'paused', 'done'); this.root.hidden = true; this.root.innerHTML = '';
    this.onExit?.();
  }
}
