import { buildTimeline, locate, planScenes, sceneAt, fmtClock } from './engine.js';
import { SessionAudio } from './audio.js';
import { SceneStage, JourneyStage, WindowStage } from './scenes.js';
import { VoyageStage } from './voyage-stage.js';
import { planJourney, itemAt, legAt } from './journey.js';

class Clock {
  constructor(speed) { this.speed = speed; this.base = 0; this.t0 = null; this.source = null; }
  follow(fn) { this.source = fn; }
  start(pos = 0) { this.base = pos; this.t0 = Date.now(); }
  pos() {
    if (this.source && this.t0 != null) return this.source();
    return this.t0 == null ? this.base : this.base + (Date.now() - this.t0) / 1000 * this.speed;
  }
  pause() { this.base = this.pos(); this.t0 = null; }
  resume() { if (this.t0 == null) this.t0 = Date.now(); }
  seek(p) { this.base = p; if (this.t0 != null) this.t0 = Date.now(); }
  get running() { return this.t0 != null; }
}

const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${d}</svg>`;
const ICON = {
  prev: svg('<path d="M6 5h2v14H6zM20 5v14L9.5 12z"/>'), next: svg('<path d="M16 5h2v14h-2zM4 5l10.5 7L4 19z"/>'),
  back5: svg('<path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z"/><text x="12" y="16.4" font-size="6.4" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">5</text>'),
  fwd5: svg('<path d="M12 5V2l5 4.5L12 11V8a5 5 0 1 0 5 5h2a7 7 0 1 1-7-8z"/><text x="12" y="16.4" font-size="6.4" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">5</text>'),
  pause: svg('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'), play: svg('<path d="M7 4l13 8-13 8z"/>'), close: svg('<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>'),
};

export class Player {
  constructor({ root, manifest, base, settings, speed = 1, audio, onExit }) {
    this.root = root; this.m = manifest; this.base = base; this.s = settings; this.speed = speed;
    this.audio = audio || new SessionAudio(); this.onExit = onExit;
    this.tl = buildTimeline(settings);
    this.v2 = manifest.schema >= 2 && Array.isArray(manifest.legs);
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
        <label class="route-scrubber">
          <span>Journey <output>00:00</output> / ${fmtClock(this.tl.total)}</span>
          <input type="range" min="0" max="${this.tl.total - 1}" step="1" value="0" aria-label="Journey position">
        </label>
        <div class="ctl-row">
          <button class="ctl prev" aria-label="Previous section">${ICON.prev}</button>
          <button class="ctl back5" aria-label="Back 5 seconds">${ICON.back5}</button>
          <button class="ctl play" aria-label="Pause">${ICON.pause}</button>
          <button class="ctl fwd5" aria-label="Forward 5 seconds">${ICON.fwd5}</button>
          <button class="ctl next" aria-label="Next section">${ICON.next}</button>
        </div>
        <div class="speedbadge"></div>
      </div>
      <div class="seekfx l"><span></span></div><div class="seekfx r"><span></span></div>
      <div class="prep"><p>Preparing your session…</p></div>
      <div class="confirm" hidden><div><p>End this session?</p><button class="btn ghost no">Keep writing</button><button class="btn yes">End session</button></div></div>`;
    r.hidden = false; r.classList.add('open'); r.classList.remove('done');
    const q = (s) => r.querySelector(s);
    this.el = { stage: q('.stage'), card: q('.card'), cardP: q('.card p'), bt: q('.breaktext'), btP: q('.breaktext p'),
      hud: q('.hud'), label: q('.hud-label'), scene: q('.hud-scene'), clock: q('.hud-clock'), bar: q('.bar i'), controls: q('.controls'),
      scrub: q('.route-scrubber input'), elapsed: q('.route-scrubber output'), play: q('.play'), prep: q('.prep'), confirm: q('.confirm'), badge: q('.speedbadge') };
    if (this.speed !== 1) this.el.badge.textContent = '×' + this.speed;
    this.stage = this.v2 && this.m.render?.type === 'voyage'
      ? new VoyageStage(this.el.stage,this.plan,this.base,()=>this.clock.pos(),this.m.legs)
      : this.v2 && this.m.render?.type === 'window'
      ? new WindowStage(this.el.stage, this.plan, this.base, { speed: this.speed, render: this.m.render, legs: this.plan.chain?.legs, getPos: () => this.clock.pos() })
      : this.v2
      ? new JourneyStage(this.el.stage, this.plan, this.base, { speed: this.speed, objectPosition: this.m.frame?.objectPosition })
      : new SceneStage(this.el.stage, this.m.scenes || [], this.base);
    r.style.setProperty('--accent', this.m.accent || '#d9b26f');
    // controls: tap to reveal, auto-hide
    // tap = show controls; double-tap left/right third = -5 s / +5 s (like YouTube)
    this._onTap = (e) => {
      if (e.target.closest('.ctl,.confirm,.route-scrubber')) return;
      const now = Date.now(), w = r.clientWidth || 1, x = (e.clientX ?? w / 2) / w, side = x < 0.4 ? -1 : x > 0.6 ? 1 : 0;
      if (side && this._lastTap && now - this._lastTap.t < 320 && this._lastTap.side === side) { this._lastTap = null; this.seekBy(5 * side); return; }
      this._lastTap = { t: now, side }; this._showControls();
    };
    r.addEventListener('click', this._onTap);
    this.el.scrub.oninput = () => {
      this.scrubbing = true;
      this._showControls();
      this.el.elapsed.textContent = fmtClock(Number(this.el.scrub.value));
    };
    this.el.scrub.onchange = () => {
      const target = Number(this.el.scrub.value);
      this.scrubbing = false;
      this.syncTo(target);
    };
    this.el.scrub.onpointercancel = () => { this.scrubbing = false; };
    q('.back5').onclick = () => this.seekBy(-5);
    q('.fwd5').onclick = () => this.seekBy(5);
    q('.play').onclick = () => this.paused ? this.resume() : this.pause();
    q('.next').onclick = () => this.skip(1);
    q('.prev').onclick = () => this.skip(-1);
    q('.close').onclick = () => { this.el.confirm.hidden = false; };
    q('.confirm .no').onclick = () => { this.el.confirm.hidden = true; };
    q('.confirm .yes').onclick = () => this.exit();
    // Backgrounding / rotating must never restart or re-seek media. The clock is wall-clock based, so on return we only
    // resume what iOS suspended and let the next tick re-sync the stage; hiding does nothing (audio keeps playing).
    this._vis = () => {
      if (document.visibilityState !== 'visible' || !this.started || this.finished) return;
      this._acquireWake();
      if (!this.paused) { this.audio.resume(); this.stage.resume(); }
      this._tick();
    };
    this._pageshow = (e) => { if (e.persisted) this._vis(); };
    this._rot = () => { clearTimeout(this._rotT); this._rotT = setTimeout(() => { this.root.dataset.orient = innerWidth > innerHeight ? 'landscape' : 'portrait'; if (this.started && !this.finished) this._tick(); }, 150); };
    document.addEventListener('visibilitychange', this._vis);
    addEventListener('pageshow', this._pageshow);
    addEventListener('resize', this._rot); addEventListener('orientationchange', this._rot);
    this._rot();
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
      // decode only the layers the first views need; the rest decode one by one in the background (iOS memory)
      const first = []; for (const it of this.plan.items.slice(0, 8)) for (const l of (it.ambience || [])) if (!first.includes(l.layer)) first.push(l.layer);
      for (const leg of legs) for (const cue of leg.cues || []) if (!first.includes(cue.layer)) first.push(cue.layer);
      const [amb, pool] = await Promise.all([
        a.loadAmbienceLib(this.m.ambienceLib, this.base, first),
        a.loadMusicPool(legs[l0].id, legs[l0].music, this.base),
        this.stage.update(itemAt(this.plan, 0), 0),
      ]);
      this.loaded = { music: pool.length, amb: amb > 0, layers: amb, errors: a.loadErrors || [] };
      a.setVolumes({ music: this.s.musicVol, amb: this.s.ambVol, chime: this.s.chimeVol });
      a.tracks = pool; a.songIndex = 0; this.curLeg = l0;
      a.startLayers(); a.keepAlive = true;
      this._nudge = () => { if (!this.paused && !this.finished) { this.audio.resume(); this.stage.resume(); } };
      this.root.addEventListener('pointerdown', this._nudge);
      this._applyItem(itemAt(this.plan, 0), true);
    } else {
      const firstScene = sceneAt(this.plan, 0);
      const [loaded] = await Promise.all([a.loadTheme(this.m, this.base), this.stage.show(firstScene, { instant: true })]);
      this.loaded = loaded;
      a.setVolumes({ music: this.s.musicVol, amb: this.s.ambVol, chime: this.s.chimeVol });
      a.startAmbience();
    }
    this.started = true;
    this.el.prep.classList.add('gone');
    a.bindSession({ tl: this.tl, plan: this.plan, legs: this.m.legs, base: this.base, speed: this.speed });
    this.clock.follow(() => this.audio.audioPos());
    this.clock.start(0);
    a.seekTo(0).catch(() => {});
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
    if (!this.scrubbing && !this._syncing) {
      this.el.scrub.value = Math.floor(pos);
      this.el.elapsed.textContent = fmtClock(Math.floor(pos));
    }
    // HUD
    const showHud = seg.type === 'sprint' || seg.type === 'break';
    this.root.classList.toggle('hud-on', showHud);
    if (showHud) {
      const t = fmtClock(loc.remaining);
      if (this.el.clock.textContent !== t) this.el.clock.textContent = t;
      const lab = seg.type === 'sprint' ? `SPRINT ${seg.n}/${seg.of}` : 'BREAK';
      if (this.el.label.textContent !== lab) this.el.label.textContent = lab;
    } else if (this.el.label.textContent) this.el.label.textContent = '';
    this.el.bar.style.transform = `scaleX(${loc.progress.toFixed(4)})`;
    this._text(seg, loc);
    // scenes
    if (this.v2) {
      const want = itemAt(this.plan, pos);
      if (!document.hidden) this.stage.update(want, pos);       // while backgrounded the picture is frozen anyway; one re-sync on return
      if (want !== this._item) this._applyItem(want);
      const lg = legAt(this.plan, pos);
      if (lg !== this.curLeg) this._enterLeg(lg);
      this._prefetchLeg(this.curLeg + 1, pos);
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
        else if (!this._syncing && Math.abs(this.audio.audioPos() - pos) > 0.05 * Math.max(1, this.speed)) this.syncTo(pos);
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
    const sec = instant ? 0.05 : Math.max(0.3, Math.min(8, (it.kind === 'bridge' ? (it.end - it.start) : it.kind === 'cruise' ? 6 : 4) / this.speed));
    this.audio.setLayers(it.ambience, sec, Math.max(it.start, this.audio.audioPos()));
    this.el.scene.textContent = it.label || '';
  }
  async _enterLeg(lg) {
    this.curLeg = lg; const leg = this.m.legs[lg]; if (!leg) return;
    const seeking = this._syncing;
    const pool = await this.audio.loadMusicPool(leg.id, leg.music, this.base);
    if (this.curLeg !== lg) return;
    const seg = this.tl.segs[this.curSeg];
    // Natural play: start the new leg's first song. A seek already placed the right offset — don't restart it.
    if (!seeking && !this._syncing && !this.closed && !this.finished) await this.syncTo(this.clock.pos());
    else { this.audio.tracks = pool; }
    this.audio.prunePools([leg.id, this.m.legs[lg + 1]?.id].filter(Boolean));
    this.events.push({ type: 'leg', leg: leg.id, pos: Math.round(this.clock.pos()), at: Date.now() });
  }
  /** Decode the next leg's songs only when its boundary is ~2 min away (keeps iOS memory down). */
  _prefetchLeg(lg, pos) {
    const leg = this.m.legs?.[lg]; if (!leg || this._pf === lg) return;
    const first = this.plan.items.find(it => it.leg === lg);
    if (pos != null && first && first.start - pos > 120) return;
    this._pf = lg; this.audio.loadMusicPool(leg.id, leg.music, this.base);
  }

  _enterSegment(loc) {
    this.curSeg = loc.i; const seg = loc.seg;
    if (seg.type === 'outro' && this.v2 && Number.isInteger(this.m.legs.at(-1)?.arrivalMusicIndex) && !this._syncing) {
      this.syncTo(this.clock.pos());
    }
    this.events.push({ i: seg.i, type: seg.type, n: seg.n, pos: Math.round(this.clock.pos()), at: Date.now() });
    this.el.label.textContent = seg.type === 'sprint' ? `SPRINT ${seg.n}/${seg.of}` : seg.type === 'break' ? 'BREAK' : '';
    this.root.dataset.seg = seg.type;
    this._textKey = null;
    if (this.mediaOk) this._mediaMeta();
    // After a break, advance the song if we are still on the same leg (a second sprint in that leg).
    // If the leg is also changing, _enterLeg starts at song 0 of the new list — do not increment the old list.
    if (seg.type === 'sprint' && (seg.n || 0) > 1) {
      const lg = legAt(this.plan, seg.start);
      if (lg === this.curLeg && !this._syncing) this.syncTo(this.clock.pos());
    }
  }

  _text(seg, loc) {
    let cardLine = '', btLine = '';
    if (seg.type === 'intro' || seg.type === 'outro') {
      const lines = (seg.type === 'intro' ? this.m.intro?.lines : this.m.outro?.lines) || [];
      const closing = seg.type === 'outro' ? Math.min(45, seg.dur) : seg.dur;
      const elapsed = loc.elapsed - (seg.dur - closing);
      const n = lines.length || 1, w = closing / n, k = Math.min(n - 1, Math.floor(elapsed / w));
      const within = elapsed - k * w;
      if (k >= 0 && lines.length && within > 1 && within < w - 1.5) cardLine = lines[k];
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
    this.paused = true; this.audio.keepAlive = false; this.clock.pause(); this.audio.suspend(); this.stage.pause();
    this.el.play.innerHTML = ICON.play; this.el.play.setAttribute('aria-label', 'Resume');
    this.root.classList.add('paused'); this._showControls();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.audio.keepAlive = true; this.audio.resume();
    const frozen = this.clock.base;
    this.clock.resume(); this.stage.resume();
    this.el.play.innerHTML = ICON.pause; this.el.play.setAttribute('aria-label', 'Pause');
    this.root.classList.remove('paused'); this._acquireWake();
    this.syncTo(frozen);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  }
  skip(dir) {
    if (this.finished) return;
    const loc = locate(this.tl, this.clock.pos()); let i = loc.i;
    if (dir > 0) i = Math.min(this.tl.segs.length, i + 1);
    else i = (loc.elapsed > 3 / 1 || i === 0) ? i : i - 1;
    const p = i >= this.tl.segs.length ? this.tl.total - 0.01 : this.tl.segs[i].start + 0.01;
    return this.syncTo(p);
  }
  /** Move the session clock by `d` seconds (±5 from the buttons, double-tap and lock screen); everything re-syncs to it. */
  seekBy(d) {
    if (!this.started || this.finished) return;
    const cur = this.clock.pos(), p = Math.max(0, Math.min(this.tl.total - 0.5, cur + d));
    const r = this.syncTo(p); this._showControls(); return r;
    const fx = this.root.querySelector(d < 0 ? '.seekfx.l' : '.seekfx.r');
    if (fx) { fx.querySelector('span').textContent = (d < 0 ? '−' : '+') + Math.abs(Math.round(d)) + 's'; fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go'); }
    this.events.push({ type: 'seek', d, pos: Math.round(p), at: Date.now() });
  }
  /** Set a single session time t; visuals, music and ambience all derive from it. */
  async syncTo(p) {
    const t = Math.max(0, Math.min(this.tl.total - 0.001, p));
    const seekId = this.seekId = (this.seekId || 0) + 1;
    this._syncing = true;
    this.clock.seek(t);
    try {
      await this.audio.seekTo(t);
      if (seekId !== this.seekId) return t;
      this._jumpStage();
      this._applyItem(itemAt(this.plan, t), true);
      // Let _tick call _enterSegment so the HUD label / dataset update; _syncing is still set so music is not advanced.
      this._tick();
    } finally {
      if (seekId === this.seekId) this._syncing = false;
    }
    return t;
  }
  /** After any clock jump, put the picture where the clock says (bypasses the "stage ran ahead" guard). */
  _jumpStage() {
    const pos = this.clock.pos();
    if (this.v2) { const w = itemAt(this.plan, pos); this.stage.jump(w, pos); this._applyItem(w, true); }
    else { const sc = sceneAt(this.plan, pos); if (sc !== this.stage.cur) this.stage.show(sc); }
  }

  _finish() {
    if (this.finished) return;
    this.finished = true; this.audio.keepAlive = false; clearInterval(this.timer);
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
    h('seekbackward', (d) => this.seekBy(-(d?.seekOffset || 5))); h('seekforward', (d) => this.seekBy(d?.seekOffset || 5));
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
    document.removeEventListener('visibilitychange', this._vis); removeEventListener('pageshow', this._pageshow); removeEventListener('resize', this._rot); removeEventListener('orientationchange', this._rot); clearTimeout(this._rotT); if (this._nudge) this.root.removeEventListener('pointerdown', this._nudge);
    this._releaseWake(); try { this.silent?.pause(); } catch (e) {}
    this.audio.close(); this.stage.destroy();
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    this.root.classList.remove('open', 'show-controls', 'hud-on', 'paused', 'done'); this.root.hidden = true; this.root.innerHTML = '';
    this.onExit?.();
  }
}
