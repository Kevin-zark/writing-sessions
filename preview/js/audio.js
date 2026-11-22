import { FADE, buildMusicRuns, musicAt, busAt, layersAt, layerOffset, chimesFrom, lvlOf } from './sync.js';

// Web Audio session soundtrack: synthesized chimes, music chain with dip-to-quiet fades,
// looping ambience, all scheduled on the audio clock (so chimes stay on time even
// if the page is throttled with the screen locked). iOS ignores <audio>.volume,
// which is why fades are done with GainNodes.
const AC = window.AudioContext || window.webkitAudioContext;

export class SessionAudio {
  constructor() {
    this.ctx = null; this.vol = { music: 0.8, amb: 0.7, chime: 0.8 };
    this.tracks = []; this.ambBuf = null; this.musicEnd = 0; this.songIndex = 0;
    this.chimeNodes = []; this.musicSrcs = []; this.musicQueue = []; this.anchor = null; this.speed = 1;
    // listen9 strong-a: outgoing fades out over 8 s to silence; incoming starts in the last 1.5 s and reaches full over 6 s
    this.fadeOut = 8; this.fadeIn = 6; this.fadeOverlap = 1.5;
    // sprint→break: music is down when the fall chime hits; break→sprint uses the 6 s fade-in
    this.breakFadeOut = 8; this.sprintFadeIn = 6;
    this.musicLookahead = 150;
    this.seekRamp = FADE.seekRamp;
    this.musicHalted = false;
    this.chimeLog = []; // for tests / debugging: {sessionT, kind}
  }
  /** Must be called synchronously inside a user tap. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      // Hard clip at −1.2 dBFS after the buses sum, so music+amb never exceeds −1 dBTP at the DAC.
      // (The amb compressor is amb-only and can leak; the two buses can also add constructively.)
      this.outClip = this._clipper(-1.2);
      this.master.connect(this.outClip); this.outClip.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
      this.ambBus = c.createGain(); this.ambBus.gain.value = 0;
      // Peak limiter on the ambience bus only (music gain is untouched).
      this.ambLimiter = c.createDynamicsCompressor();
      this.ambLimiter.threshold.value = -1.5;
      this.ambLimiter.knee.value = 0;
      this.ambLimiter.ratio.value = 20;
      this.ambLimiter.attack.value = 0.001;
      this.ambLimiter.release.value = 0.08;
      this.ambBus.connect(this.ambLimiter);
      this.ambLimiter.connect(this.master);
      this.chimeBus = c.createGain(); this.chimeBus.connect(this.master);
      // gentle shared reverb for chimes
      this.verb = c.createConvolver(); this.verb.buffer = this._impulse(2.6);
      const vg = c.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
      this.chimeBus.connect(this.verb);
    }
    // iOS 16.4+: 'playback' makes Web Audio ignore the ringer/silent switch and keeps it alive with the screen locked
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    this.ctx.onstatechange = () => { this.stateLog = (this.stateLog || []).concat(this.ctx.state).slice(-20); if (this.keepAlive && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); };
    if (this.ctx.state !== 'running') this.ctx.resume();
    // iOS: play a tick of silence to open the audio session
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);
  }
  _impulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
    return b;
  }
  /** Hard-clip WaveShaper at `db` dBFS. */
  _clipper(db) {
    const ceil = Math.pow(10, db / 20), n = 65536, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.max(-ceil, Math.min(ceil, (i / (n - 1)) * 2 - 1));
    const sh = this.ctx.createWaveShaper(); sh.curve = curve; sh.oversample = 'none';
    return sh;
  }
  async _load(url) {
    const r = await fetch(url); if (!r.ok) throw new Error('audio ' + r.status);
    const ab = await r.arrayBuffer();
    return await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
  }
  async loadTheme(manifest, base) {
    const out = { music: 0, amb: false, errors: [] };
    const jobs = (manifest.music || []).map(async (m) => {
      try { this.tracks.push({ title: m.title, artist: m.artist || '', buf: await this._load(base + m.src) }); out.music++; }
      catch (e) { out.errors.push(m.src); }
    });
    if (manifest.ambience?.src) jobs.push((async () => {
      try { this.ambBuf = await this._load(base + manifest.ambience.src); out.amb = true; } catch (e) { out.errors.push(manifest.ambience.src); }
    })());
    await Promise.all(jobs);
    return out;
  }
  // ---------- manifest v2: per-leg music pools + layered ambience ----------
  /** Load only the given leg's tracks (and keep a small cache); returns the pool. */
  async loadMusicPool(key, list, base) {
    this.pools = this.pools || {};
    if (this.pools[key]) return this.pools[key];
    const pool = [];
    await Promise.all((list || []).map(async (m) => { try { pool.push({ title: m.title, artist: m.artist || '', buf: await this._load(base + m.src), src: m.src }); } catch (e) { this.loadErrors = (this.loadErrors || []).concat(m.src); } }));
    this.pools[key] = pool;
    return pool;
  }
  /** Free pools not in `keep` (iOS memory). */
  prunePools(keep) { for (const k of Object.keys(this.pools || {})) if (!keep.includes(k)) delete this.pools[k]; }
  /** Switch the track pool. A new pool starts at song 0 (first of that leg). `hard` also stops the playing source. */
  setMusicPool(pool, { hard = false } = {}) {
    if (!pool || pool === this.tracks) return;
    const c = this.ctx; this.tracks = pool; this.songIndex = 0;
    this.musicHalted = false;
    if (!c) return;
    this._stopQueue(hard);
    this.ensureMusic();
  }
  /** Advance to the next song in the current leg's list. Does not wrap; stays on the last song if there is no next. */
  advanceSong() {
    if (!this.tracks.length) return;
    if (this.songIndex < this.tracks.length - 1) this.songIndex++;
    this.musicHalted = false;
    this._stopQueue(true);
    this.ensureMusic();
  }
  _stopQueue(hard) {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime;
    this.musicQueue.forEach((q) => { if (q.start > now || hard) { try { q.src.stop(); } catch (e) {} } });
    this.musicQueue = this.musicQueue.filter(q => !(q.start > now || hard));
    this.musicSrcs = this.musicQueue.map(q => q.src);
    this.musicEnd = this.musicQueue.length ? Math.max(...this.musicQueue.map(q => q.end - this.fadeOverlap)) : 0;
  }
  /** Cosine fade: out is cos(π/2 · x), in is sin(π/2 · x). */
  _cosOut(n = 512) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.cos(0.5 * Math.PI * i / (n - 1));
    return c;
  }
  _cosIn(n = 512) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.sin(0.5 * Math.PI * i / (n - 1));
    return c;
  }
  /** Interpolate `from`→`to` with the same cosine used for song fades (from·cos + to·sin). */
  _cosLerp(from, to, n = 512) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      c[i] = from * Math.cos(0.5 * Math.PI * x) + to * Math.sin(0.5 * Math.PI * x);
    }
    return c;
  }
  /** Schedule a cosine ramp on a GainParam, including the case where we are already mid-fade. */
  _ramp(param, from, to, tStart, tEnd, now) {
    if (!(tEnd > tStart)) { param.setValueAtTime(to, now); return; }
    if (tEnd <= now) { param.setValueAtTime(to, now); return; }
    if (tStart >= now) {
      param.setValueAtTime(from, tStart);
      param.setValueCurveAtTime(this._cosLerp(from, to), tStart, tEnd - tStart);
      return;
    }
    const dur = tEnd - tStart, done = (now - tStart) / dur, n = 512;
    const full = this._cosLerp(from, to, n);
    const i0 = Math.min(n - 2, Math.max(0, Math.floor(done * (n - 1))));
    param.setValueCurveAtTime(full.slice(i0), now, tEnd - now);
  }
  /** Decode the theme's ambience library. Layers in `first` are awaited (needed right away); the rest decode
   *  one at a time in the background, so iOS never decodes 14 files at once. Each entry loops seamlessly. */
  async loadAmbienceLib(lib, base, first) {
    this.lib = this.lib || {}; this.libDef = lib || {};
    const keys = Object.keys(this.libDef), head = (first && first.length ? first : keys).filter(k => this.libDef[k]);
    const one = async (k) => {
      if (this.lib[k]) return;
      try { this.lib[k] = { ...this.libDef[k], buf: await this._load(base + this.libDef[k].src) }; this._addLayerNode(k); }
      catch (e) { this.loadErrors = (this.loadErrors || []).concat(this.libDef[k].src); }
    };
    await Promise.all(head.map(one));
    const rest = keys.filter(k => !head.includes(k));
    this.libRest = (async () => { for (const k of rest) await one(k); if (this.lastLayers) this.setLayers(this.lastLayers, 2); })();
    return Object.keys(this.lib).length;
  }
  _addLayerNode(k) {
    const c = this.ctx; if (!c || !this.layerNodes || this.layerNodes[k] || !this.lib[k]) return;
    const v = this.lib[k], s = c.createBufferSource(), g = c.createGain(); s.buffer = v.buf; s.loop = true; g.gain.value = 0;
    // trim 50 ms/30 ms off the loop ends: some decoders keep the MP3 encoder-delay silence, which would click once per loop
    const dur = v.buf.duration; if (dur > 2) { s.loopStart = 0.05; s.loopEnd = dur - 0.03; }
    s.connect(g); g.connect(this.ambBus); s.start(0, 0.05 + (Object.keys(this.libDef).indexOf(k) * 7.3) % Math.max(1, dur - 0.1));
    this.layerNodes[k] = { s, g, target: 0 };
  }
  /** Create looping nodes (gain 0) for every decoded layer; later layers are added as they finish decoding. */
  startLayers() {
    const c = this.ctx; if (!c || this.layerNodes) return;
    this.layerNodes = {};
    Object.keys(this.lib || {}).forEach(k => this._addLayerNode(k));
  }
  /** Ramp every layer to its gain in `layers` ([{layer, gain}]) over `sec` seconds; others fade to 0. */
  setLayers(layers, sec = 4) {
    const c = this.ctx; if (!c || !this.layerNodes) return;
    this.lastLayers = layers;
    const want = {}; (layers || []).forEach(l => { if (this.lib[l.layer]) want[l.layer] = (l.gain ?? 1) * (this.lib[l.layer].gain ?? 1); });
    const now = c.currentTime;
    for (const [k, n] of Object.entries(this.layerNodes)) {
      const t = want[k] || 0; if (Math.abs(t - n.target) < 1e-4) continue;
      n.target = t; n.g.gain.cancelScheduledValues(now); n.g.gain.setValueAtTime(n.g.gain.value, now);
      n.g.gain.linearRampToValueAtTime(t, now + Math.max(0.05, sec));
    }
    this.layerLog = (this.layerLog || []).concat([{ t: now, layers: Object.keys(want) }]).slice(-200);
  }
  activeLayers() { return Object.entries(this.layerNodes || {}).filter(([, n]) => n.target > 0).map(([k]) => k); }

  setVolumes(v) { Object.assign(this.vol, v); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  get running() { return this.ctx && this.ctx.state === 'running'; }
  suspend() { return this.ctx?.suspend(); }
  resume() { return this.ctx?.resume(); }

  /** Session position implied by the audio clock (for drift detection). */
  audioPos() {
    if (!this.anchor || !this.ctx) return 0;
    if (this._gate != null && this.ctx.currentTime < this._gate) return this.anchor.pos0;
    return this.anchor.pos0 + (this.ctx.currentTime - this.anchor.t0) * this.speed;
  }
  bindSession({ tl, plan, legs, base, speed }) {
    this.tl = tl; this.plan = plan; this.legs = legs;
    if (base) this.themeBase = base;
    if (speed != null) this.speed = speed;
    this._runs = (tl && plan && legs) ? buildMusicRuns(tl, plan, legs) : null;
  }
  durations() {
    const d = {};
    for (const pool of Object.values(this.pools || {})) {
      for (const tr of pool) if (tr.buf && tr.src) d[tr.src] = tr.buf.duration;
    }
    for (const tr of this.tracks || []) if (tr.buf && tr.src) d[tr.src] = tr.buf.duration;
    return d;
  }
  /** Snapshot of music / ambience / buses at session time t (default: live audio clock). */
  inspect(t) {
    if (t == null) t = this.audioPos();
    const mus = this._runs ? musicAt(t, this._runs, this.durations()) : { voices: [], primary: null, run: null };
    const buses = this.tl ? busAt(t, this.tl, this.vol) : { m: 0, a: 0 };
    const lay = this.plan ? layersAt(t, this.plan) : { layers: [], periodStart: {} };
    const layers = (lay.layers || []).map((L) => {
      const buf = this.lib?.[L.layer]?.buf;
      const dur = buf?.duration || 0;
      const ls = dur > 2 ? 0.05 : 0, le = dur > 2 ? dur - 0.03 : dur;
      return { layer: L.layer, offset: layerOffset(t, lay.periodStart[L.layer] ?? 0, ls, le), target: (L.gain ?? 1) * (this.lib?.[L.layer]?.gain ?? 1), loopStart: ls, loopEnd: le };
    });
    return { t, song: mus.primary, voices: mus.voices, run: mus.run, buses, layers, item: { id: lay.id, label: lay.label, kind: lay.kind, start: lay.start, end: lay.end, index: lay.item } };
  }

  startAmbience() {
    if (!this.ambBuf || this.ambSrc) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.ambBuf; s.loop = true;
    s.connect(this.ambBus); s.start(); this.ambSrc = s;
  }

  /** (Re)schedule chimes + fades from session position `pos`. */
  schedule(tl, pos, speed) {
    const c = this.ctx; if (!c) return;
    this.speed = speed;
    const t0 = c.currentTime + 0.06;
    this.anchor = { t0, pos0: pos };
    const T = (s) => t0 + (s - pos) / speed;
    // cancel previous chimes
    this.chimeNodes.forEach(n => { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
    this.chimeNodes = [];
    for (const b of [this.musicBus.gain, this.ambBus.gain]) { b.cancelScheduledValues(0); }
    const segs = tl.segs;
    const lvl = (seg) => {
      if (!seg) return { m: 0, a: 0 };
      switch (seg.type) {
        case 'intro': return { m: 1.0, a: 0.8 };
        case 'sprint': return { m: 1.0, a: 0.65 };   // train bed sat ~-4 dB under the music live (a bit hot): ~-8 dB now, still clearly audible on phone speakers
        case 'break': return { m: 0.0, a: 1.0 };   // music out, ambience swells
        case 'outro': return { m: 0.8, a: 0.7 };
        default: return { m: 0, a: 0 };
      }
    };
    const mv = this.vol.music, av = this.vol.amb;
    const cur = segs.findIndex(s => pos >= s.start && pos < s.end);
    const first = lvl(segs[Math.max(0, cur)]);
    const startFade = pos < 1 ? 3 : 0.4;
    const nowG = c.currentTime;
    // initial level
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, nowG);
    this._ramp(this.musicBus.gain, this.musicBus.gain.value, first.m * mv, t0, t0 + startFade, nowG);
    this.ambBus.gain.setValueAtTime(this.ambBus.gain.value, nowG);
    this._ramp(this.ambBus.gain, this.ambBus.gain.value, first.a * av, t0, t0 + startFade, nowG);
    const settle = t0 + startFade + 0.02; // later ramps must not overlap the initial settle
    segs.forEach((seg, i) => {
      if (i === 0) return;
      if (seg.start <= pos + 0.01) return;       // already at or past this boundary
      const prev = lvl(segs[i - 1]), next = lvl(seg), when = T(seg.start);
      if (prev.m === next.m && prev.a === next.a) return;
      // Music down by the break/chime (8 s fade-out ending at `when`); music in over 6 s from a sprint start.
      let m0, m1;
      if (next.m < prev.m) { m0 = when - this.breakFadeOut; m1 = when; }
      else { m0 = when; m1 = when + this.sprintFadeIn; }
      if (m1 <= settle) return;
      if (m0 < settle) m0 = settle;
      if (prev.m !== next.m) this._ramp(this.musicBus.gain, prev.m * mv, next.m * mv, m0, m1, t0);
      if (prev.a !== next.a) this._ramp(this.ambBus.gain, prev.a * av, next.a * av, m0, m1, t0);
    });
    // final fade-out at the end of the session (8 s, down at the end)
    const endT = T(tl.total);
    if (endT > c.currentTime) {
      const last = lvl(segs[segs.length - 1]);
      this._ramp(this.musicBus.gain, last.m * mv, 0, endT - this.breakFadeOut, endT, t0);
      this._ramp(this.ambBus.gain, last.a * av, 0, endT - this.breakFadeOut, endT + 2, t0);
    }
    // chimes at every transition
    this.chimeLog = this.chimeLog.filter(x => x.sessionT < pos);
    const chimeAt = (s, kind) => {
      if (s < pos - 0.01 && !(s === 0 && pos === 0)) return;
      const when = Math.max(T(s), c.currentTime + 0.02);
      this._chime(kind, when); this.chimeLog.push({ sessionT: s, kind });
    };
    segs.forEach((seg) => {
      const kind = seg.type === 'intro' ? 'start' : seg.type === 'sprint' ? 'rise' : seg.type === 'break' ? 'fall' : 'finish';
      chimeAt(seg.start, kind);
    });
    chimeAt(tl.total, 'end');
    this.ensureMusic(true);
  }

  /** Keep ≥150s of music chained ahead. The current song loops into itself with the strong-a fade
   *  (8 s out to silence, next starts 1.5 s before the end and fades in over 6 s) until advanceSong(). */
  ensureMusic(force) {
    const c = this.ctx; if (!c || !this.tracks.length || this.musicHalted) return;
    if (!this.musicEnd || this.musicEnd < c.currentTime) this.musicEnd = c.currentTime + 0.2;
    let guard = 0;
    while (this.musicEnd - c.currentTime < this.musicLookahead && guard++ < 60) {
      const k = Math.max(0, Math.min(this.songIndex, this.tracks.length - 1));
      const tr = this.tracks[k], s = c.createBufferSource(), g = c.createGain();
      s.buffer = tr.buf; s.connect(g); g.connect(this.musicBus);
      const start = this.musicEnd, dur = tr.buf.duration;
      const fo = Math.min(this.fadeOut, dur * 0.4);
      const fi = Math.min(this.fadeIn, dur * 0.4);
      const ov = Math.min(this.fadeOverlap, fo);
      const first = this.musicSrcs.length === 0;
      if (first) {
        g.gain.setValueAtTime(1, start);
      } else {
        g.gain.setValueAtTime(0, start);
        g.gain.setValueCurveAtTime(this._cosIn(), start, fi);
        g.gain.setValueAtTime(1, start + fi);
      }
      g.gain.setValueAtTime(1, Math.max(start, start + dur - fo));
      g.gain.setValueCurveAtTime(this._cosOut(), start + dur - fo, fo);
      s.start(start);
      const entry = { title: tr.title, artist: tr.artist, start, end: start + dur, src: s, index: k };
      this.musicSrcs.push(s); this.musicQueue.push(entry); this.musicEnd = start + dur - ov;
      s.onended = () => {
        this.musicSrcs = this.musicSrcs.filter(x => x !== s);
        this.musicQueue = this.musicQueue.filter(q => q !== entry);
        if (!this.musicSrcs.length) this.musicEnd = 0;
      };
    }
  }

  /** Track currently audible (the later start wins during a crossfade). */
  currentTrack() {
    if (!this.ctx || !this.musicQueue.length) return null;
    const t = this.ctx.currentTime;
    const playing = this.musicQueue.filter(q => t >= q.start && t < q.end);
    if (playing.length) return playing[playing.length - 1];
    const upcoming = this.musicQueue.filter(q => q.start > t).sort((a, b) => a.start - b.start)[0];
    return upcoming || this.musicQueue[this.musicQueue.length - 1];
  }

  _chime(kind, when) {
    const c = this.ctx, vol = this.vol.chime; if (vol <= 0) return;
    const notes = {
      start: [659.25, 880, 1318.5], rise: [783.99, 1174.66], fall: [987.77, 659.25],
      finish: [659.25, 783.99, 987.77, 1318.5], end: [880],
    }[kind] || [880];
    notes.forEach((f, i) => {
      const t = when + i * (kind === 'end' ? 0 : 0.42);
      // bell: inharmonic partials with exponential decay
      [[1, 1, 3.6], [2.0, 0.35, 2.4], [2.76, 0.2, 1.6], [5.4, 0.07, 0.9]].forEach(([r, a, d]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.value = f * r;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16 * a * vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
        o.connect(g); g.connect(this.chimeBus);
        o.start(t); o.stop(t + d + 1.4);
        this.chimeNodes.push(o);
      });
    });
  }
  _cosSlice(kind, x0, x1, n = 256) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = x0 + (x1 - x0) * i / (n - 1);
      c[i] = kind === 'in' ? Math.sin(0.5 * Math.PI * x) : Math.cos(0.5 * Math.PI * x);
    }
    return c;
  }
  _automateVoice(g, v, when, D) {
    const u = v.offset, fo = Math.min(this.fadeOut, D * 0.4), fi = Math.min(this.fadeIn, D * 0.4);
    g.gain.cancelScheduledValues(when);
    g.gain.setValueAtTime(Math.max(0, v.gain), when);
    if (v.k > 0 && u < fi) {
      const left = fi - u;
      g.gain.setValueCurveAtTime(this._cosSlice('in', u / fi, 1), when, Math.max(0.01, left));
      g.gain.setValueAtTime(1, when + left);
    }
    const outStart = D - fo;
    if (u < outStart) {
      g.gain.setValueAtTime(1, when + (outStart - u));
      g.gain.setValueCurveAtTime(this._cosOut(), when + (outStart - u), fo);
    } else if (D - u > 0.01) {
      const x0 = (u - outStart) / fo;
      g.gain.setValueCurveAtTime(this._cosSlice('out', x0, 1), when, D - u);
    }
  }
  _restartLayersAt(lay, t, when) {
    const c = this.ctx; if (!c || !this.lib) return;
    if (!this.layerNodes) this.layerNodes = {};
    const want = {};
    (lay.layers || []).forEach((L) => {
      if (this.lib[L.layer]) want[L.layer] = (L.gain ?? 1) * (this.lib[L.layer].gain ?? 1);
    });
    for (const [k, n] of Object.entries(this.layerNodes)) {
      try { n.s.stop(when); } catch (e) {}
      try { n.s.disconnect(); n.g.disconnect(); } catch (e) {}
      delete this.layerNodes[k];
    }
    for (const k of Object.keys(want)) {
      const v = this.lib[k]; if (!v?.buf) continue;
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = v.buf; s.loop = true;
      const dur = v.buf.duration;
      const ls = dur > 2 ? 0.05 : 0, le = dur > 2 ? dur - 0.03 : dur;
      s.loopStart = ls; s.loopEnd = le;
      const off = layerOffset(t, lay.periodStart[k] ?? 0, ls, le);
      s.connect(g); g.connect(this.ambBus);
      g.gain.setValueAtTime(want[k], when);
      try { s.start(when, off); } catch (e) { try { s.start(when); } catch (err) {} }
      this.layerNodes[k] = { s, g, target: want[k] };
    }
    this.lastLayers = lay.layers;
  }

  /**
   * Jump the soundtrack to session time `t`: 50–100 ms bus ramp down, restart
   * music and ambience at the computed offsets (including mid-fade gains), then ramp up.
   */
  async seekTo(t, { play = true } = {}) {
    const c = this.ctx; if (!c || !this.tl) return t;
    t = Math.max(0, Math.min((this.tl.total || t) - 0.001, t));
    if (this._runs == null && this.plan && this.legs) this._runs = buildMusicRuns(this.tl, this.plan, this.legs);

    // Hold the session clock at t until the new sources actually start (load may take time).
    this.anchor = { t0: c.currentTime, pos0: t };
    this._gate = Infinity;

    const r = this.seekRamp || 0.08;
    const now0 = c.currentTime, muteAt = now0 + r;
    for (const g of [this.musicBus.gain, this.ambBus.gain]) {
      g.cancelScheduledValues(now0);
      try { g.setValueAtTime(g.value, now0); } catch (e) { g.setValueAtTime(0, now0); }
      g.linearRampToValueAtTime(0, muteAt);
    }
    this.musicQueue.forEach((q) => { try { q.src.stop(muteAt); } catch (e) {} });
    this.musicQueue = []; this.musicSrcs = [];
    this.musicEnd = 0;
    this.musicHalted = true;

    let mus = this._runs ? musicAt(t, this._runs, this.durations()) : { voices: [], primary: null, run: null };
    const song = mus.primary || mus.run?.song;
    if (song && this.legs && this.themeBase) {
      const list = this.legs[song.leg]?.music;
      const pool = await this.loadMusicPool(song.legId, list, this.themeBase);
      if (pool && pool.length) { this.tracks = pool; this.songIndex = song.index; }
    }

    // Timestamp AFTER the load so BufferSource.start is never in the past.
    const now = c.currentTime;
    const when = Math.max(now + 0.02, muteAt);
    const buses = busAt(t, this.tl, this.vol);
    mus = this._runs ? musicAt(t, this._runs, this.durations()) : mus;
    const lay = this.plan ? layersAt(t, this.plan) : { layers: [], periodStart: {} };

    this.musicHalted = !(play && mus.voices.length && (buses.m > 1e-4 || t < (mus.run?.audibleEnd ?? 0) - 0.01));
    if (!this.musicHalted) {
      for (const v of mus.voices) {
        const tr = (this.tracks || []).find(x => x.src === v.src) || this.tracks[v.index];
        if (!tr?.buf) continue;
        const s = c.createBufferSource(), g = c.createGain();
        s.buffer = tr.buf; s.connect(g); g.connect(this.musicBus);
        this._automateVoice(g, v, when, tr.buf.duration);
        const off = Math.max(0, Math.min(v.offset, Math.max(0, tr.buf.duration - 0.001)));
        try { s.start(when, off); } catch (e) { try { s.start(when); } catch (err) {} }
        const entry = { title: tr.title, artist: tr.artist, start: when - v.offset, end: when + (tr.buf.duration - v.offset), src: s, index: v.index };
        this.musicSrcs.push(s); this.musicQueue.push(entry);
        s.onended = () => {
          this.musicSrcs = this.musicSrcs.filter(x => x !== s);
          this.musicQueue = this.musicQueue.filter(q => q !== entry);
        };
      }
      if (mus.voices.length && mus.duration) {
        const last = mus.voices[mus.voices.length - 1];
        this.musicEnd = when + (mus.duration - last.offset) - this.fadeOverlap;
      } else this.musicEnd = when + 0.2;
      this.ensureMusic();
    } else {
      this.musicEnd = 0;
    }

    if (this.lib) this._restartLayersAt(lay, t, when);

    this.musicBus.gain.cancelScheduledValues(when);
    this.musicBus.gain.setValueAtTime(0, when);
    this.musicBus.gain.linearRampToValueAtTime(buses.m, when + r);
    this.ambBus.gain.cancelScheduledValues(when);
    this.ambBus.gain.setValueAtTime(0, when);
    this.ambBus.gain.linearRampToValueAtTime(buses.a, when + r);

    this.anchor = { t0: when, pos0: t };
    this._gate = when;
    this._scheduleFrom(t, when);
    return t;
  }

  /** Schedule future bus ramps + chimes from session position `pos`, anchored at audio time `t0`. */
  _scheduleFrom(pos, t0) {
    const c = this.ctx, tl = this.tl; if (!c || !tl) return;
    const T = (s) => t0 + (s - pos) / this.speed;
    const settle = t0 + (this.seekRamp || 0.08) + 0.02;
    const mv = this.vol.music, av = this.vol.amb, segs = tl.segs;
    if (pos < FADE.startIn && segs[0]) {
      const L0 = lvlOf(segs[0]), cur = busAt(pos, tl, this.vol);
      const end = t0 + (FADE.startIn - pos) / this.speed;
      if (end > settle) {
        this._ramp(this.musicBus.gain, cur.m, L0.m * mv, settle, end, settle);
        this._ramp(this.ambBus.gain, cur.a, L0.a * av, settle, end, settle);
      }
    }
    segs.forEach((seg, i) => {
      if (i === 0) return;
      if (seg.start <= pos + 0.01) return;
      const prev = lvlOf(segs[i - 1]), next = lvlOf(seg);
      if (prev.m === next.m && prev.a === next.a) return;
      const when = T(seg.start);
      let m0, m1;
      if (next.m < prev.m) { m0 = when - this.breakFadeOut; m1 = when; }
      else { m0 = when; m1 = when + this.sprintFadeIn; }
      if (m1 <= settle) return;
      if (m0 < settle) m0 = settle;
      if (prev.m !== next.m) this._ramp(this.musicBus.gain, prev.m * mv, next.m * mv, m0, m1, settle);
      if (prev.a !== next.a) this._ramp(this.ambBus.gain, prev.a * av, next.a * av, m0, m1, settle);
    });
    const endT = T(tl.total);
    if (endT > settle) {
      const L = lvlOf(segs[segs.length - 1]);
      this._ramp(this.musicBus.gain, L.m * mv, 0, endT - this.breakFadeOut, endT, settle);
      this._ramp(this.ambBus.gain, L.a * av, 0, endT - this.breakFadeOut, endT + 2, settle);
    }
    this.chimeNodes.forEach(n => { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
    this.chimeNodes = [];
    this.chimeLog = (this.chimeLog || []).filter(x => x.sessionT < pos);
    for (const ev of chimesFrom(pos, tl)) {
      const when = Math.max(T(ev.sessionT), t0 + 0.02);
      this._chime(ev.kind, when);
      this.chimeLog.push({ sessionT: ev.sessionT, kind: ev.kind });
    }
  }

  /** Test/preview helper. */
  previewChime() { if (this.ctx) this._chime('rise', this.ctx.currentTime + 0.02); }
  close() {
    try { this.ambSrc?.stop(); } catch (e) {}
    Object.values(this.layerNodes || {}).forEach(n => { try { n.s.stop(); } catch (e) {} });
    this.layerNodes = null; this.lib = {}; this.pools = {};
    this.musicSrcs.forEach(s => { try { s.stop(); } catch (e) {} });
    this.chimeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    this.musicSrcs = []; this.musicQueue = []; this.chimeNodes = []; this.ambSrc = null; this.musicEnd = 0; this.songIndex = 0;
    this.tracks = []; this.ambBuf = null; this.anchor = null;
    // keep ctx alive (created from a gesture) for reuse
    this.musicBus?.gain.cancelScheduledValues(0); this.ambBus?.gain.cancelScheduledValues(0);
    if (this.musicBus) { this.musicBus.gain.value = 0; this.ambBus.gain.value = 0; }
  }
}
