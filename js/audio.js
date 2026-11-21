// Web Audio session soundtrack: synthesized chimes, music chain with crossfades,
// looping ambience, all scheduled on the audio clock (so chimes stay on time even
// if the page is throttled with the screen locked). iOS ignores <audio>.volume,
// which is why fades are done with GainNodes.
const AC = window.AudioContext || window.webkitAudioContext;

export class SessionAudio {
  constructor() {
    this.ctx = null; this.vol = { music: 0.8, amb: 0.7, chime: 0.8 };
    this.tracks = []; this.ambBuf = null; this.musicEnd = 0; this.lastTrack = -1;
    this.chimeNodes = []; this.musicSrcs = []; this.musicQueue = []; this.anchor = null; this.speed = 1; this.xf = 3;
    this.chimeLog = []; // for tests / debugging: {sessionT, kind}
  }
  /** Must be called synchronously inside a user tap. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.connect(c.destination);
      this.musicBus = c.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
      this.ambBus = c.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
      this.chimeBus = c.createGain(); this.chimeBus.connect(this.master);
      // gentle shared reverb for chimes
      this.verb = c.createConvolver(); this.verb.buffer = this._impulse(2.6);
      const vg = c.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
      this.chimeBus.connect(this.verb);
    }
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
  setVolumes(v) { Object.assign(this.vol, v); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  get running() { return this.ctx && this.ctx.state === 'running'; }
  suspend() { return this.ctx?.suspend(); }
  resume() { return this.ctx?.resume(); }

  /** Session position implied by the audio clock (for drift detection). */
  audioPos() { return this.anchor ? this.anchor.pos0 + (this.ctx.currentTime - this.anchor.t0) * this.speed : 0; }

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
        case 'intro': return { m: 1.0, a: 0.5 };
        case 'sprint': return { m: 1.0, a: 0.45 };
        case 'break': return { m: 0.0, a: 1.0 };   // music out, ambience swells
        case 'outro': return { m: 0.8, a: 0.5 };
        default: return { m: 0, a: 0 };
      }
    };
    const mv = this.vol.music, av = this.vol.amb;
    const cur = segs.findIndex(s => pos >= s.start && pos < s.end);
    const fade = (seg) => Math.max(0.5, Math.min(5, (seg.dur / speed) * 0.4));
    const first = lvl(segs[Math.max(0, cur)]);
    const startFade = pos < 1 ? 3 : 0.4;
    // initial level
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, c.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(first.m * mv, t0 + startFade);
    this.ambBus.gain.setValueAtTime(this.ambBus.gain.value, c.currentTime);
    this.ambBus.gain.linearRampToValueAtTime(first.a * av, t0 + startFade);
    segs.forEach((seg, i) => {
      if (seg.start <= pos + 0.01 && i !== 0) return;       // already inside / past
      if (i > 0) {
        const prev = lvl(segs[i - 1]), next = lvl(seg), when = T(seg.start), f = fade(seg);
        // hold prev, then ramp to next over f seconds
        this.musicBus.gain.setValueAtTime(prev.m * mv, when);
        this.musicBus.gain.linearRampToValueAtTime(next.m * mv, when + f);
        this.ambBus.gain.setValueAtTime(prev.a * av, when);
        this.ambBus.gain.linearRampToValueAtTime(next.a * av, when + f);
      }
    });
    // final fade-out at the end of the session
    const endT = T(tl.total);
    if (endT > c.currentTime) {
      this.musicBus.gain.setValueAtTime(lvl(segs[segs.length - 1]).m * mv, Math.max(c.currentTime, endT - 6));
      this.musicBus.gain.linearRampToValueAtTime(0, endT);
      this.ambBus.gain.setValueAtTime(lvl(segs[segs.length - 1]).a * av, Math.max(c.currentTime, endT - 6));
      this.ambBus.gain.linearRampToValueAtTime(0, endT + 2);
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

  /** Keep ≥150s of music chained ahead; tracks crossfade by `xf` seconds. */
  ensureMusic(force) {
    const c = this.ctx; if (!c || !this.tracks.length) return;
    if (!this.musicEnd || this.musicEnd < c.currentTime) this.musicEnd = c.currentTime + 0.2;
    let guard = 0;
    while (this.musicEnd - c.currentTime < 150 && guard++ < 60) {
      let k; do { k = Math.floor(Math.random() * this.tracks.length); } while (this.tracks.length > 1 && k === this.lastTrack);
      this.lastTrack = k;
      const tr = this.tracks[k], s = c.createBufferSource(), g = c.createGain();
      s.buffer = tr.buf; s.connect(g); g.connect(this.musicBus);
      const start = this.musicEnd, dur = tr.buf.duration, xf = Math.min(this.xf, dur / 3);
      const first = this.musicSrcs.length === 0;
      g.gain.setValueAtTime(first ? 1 : 0, start);
      if (!first) g.gain.linearRampToValueAtTime(1, start + xf);
      g.gain.setValueAtTime(1, start + dur - xf);
      g.gain.linearRampToValueAtTime(0, start + dur);
      s.start(start);
      const entry = { title: tr.title, artist: tr.artist, start, end: start + dur };
      this.musicSrcs.push(s); this.musicQueue.push(entry); this.musicEnd = start + dur - xf;
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
  /** Test/preview helper. */
  previewChime() { if (this.ctx) this._chime('rise', this.ctx.currentTime + 0.02); }
  close() {
    try { this.ambSrc?.stop(); } catch (e) {}
    this.musicSrcs.forEach(s => { try { s.stop(); } catch (e) {} });
    this.chimeNodes.forEach(n => { try { n.stop(); } catch (e) {} });
    this.musicSrcs = []; this.musicQueue = []; this.chimeNodes = []; this.ambSrc = null; this.musicEnd = 0; this.lastTrack = -1;
    this.tracks = []; this.ambBuf = null; this.anchor = null;
    // keep ctx alive (created from a gesture) for reuse
    this.musicBus?.gain.cancelScheduledValues(0); this.ambBus?.gain.cancelScheduledValues(0);
    if (this.musicBus) { this.musicBus.gain.value = 0; this.ambBus.gain.value = 0; }
  }
}
