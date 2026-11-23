// "Window on the world" renderer (manifest schema 3, render.type = 'window').
// Cruise views are drawn procedurally behind the interior frame, so the scenery is ALWAYS moving and loops forever
// without seams: panoramas are mirror-tiled horizontally, layers scroll at different speeds (parallax), and every
// position is a pure function of the session clock (so seeks, backgrounding and rotation can never desync it).
//
//   backdrop (normal)  → far fog → mid silhouettes (multiply) → landmark pass-by (multiply, once) → near fog
//   → near silhouettes (multiply) → rain / snow → light + vignette → interior frame (PNG, transparent pane)
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const hash = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const mod = (a, n) => ((a % n) + n) % n;

const DEFAULTS = {
  size: [1280, 720],
  speeds: { backdrop: 12, mid: 38, near: 150, fogFar: 18, fogNear: 52 },   // px/s at 720 px height, for speed multiplier 1
  xfade: 8, rampIn: 12, rampOut: 14, fps: 45,
};

export class WindowRenderer {
  constructor(canvas, render, plan, base, legs) {
    this.cv = canvas; this.base = base; this.plan = plan; this.legs = legs || [];
    this.cfg = { ...DEFAULTS, ...render, speeds: { ...DEFAULTS.speeds, ...(render.speeds || {}) } };
    const [W, H] = this.cfg.size; canvas.width = W; canvas.height = H; this.W = W; this.H = H;
    this.c = canvas.getContext('2d', { alpha: false });
    this.pane = render.frame.pane; this.imgs = new Map(); this.fogTex = {};
    this.crossings = render.crossings || { bridge: render.bridge };
    this.frame = this._img(render.frame.src);
    this.idx = -1; this.run = false;
    this._buildDistance();
    this.stripOrigins = new Map();
    this.vistaEnds = new Map();
    for (const item of plan.items) {
      if (item.scene?.panBackdrop) this.vistaEnds.set(item.scene, this.dist(item.end));
      if (item.scene?.paintedStrips && !this.stripOrigins.has(item.scene)) {
        this.stripOrigins.set(item.scene, this.dist(item.start));
      }
    }
  }

  // ---------- distance travelled (continuous across legs; zero while stopped at a station) ----------
  _buildDistance() {
    const total = this.plan.total || (this.plan.items.at(-1)?.end ?? 0), step = 0.5, n = Math.ceil(total / step) + 2;
    const F = new Float32Array(n), spans = this.plan.legSpans || [];
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const t = (i - 0.5) * step; let g = 0;
      for (const s of spans) {
        if (t < s.start || t >= s.end) continue;
        const lg = this.legs[s.leg] || {}, rin = lg.rampIn ?? this.cfg.rampIn, rout = lg.rampOut ?? this.cfg.rampOut;
        g = (lg.speed ?? 1) * (s.startsAtStop ? smooth((t - s.start) / rin) : 1) * (s.endsAtStop ? smooth((s.end - t) / rout) : 1);
        break;
      }
      acc += g * step; F[i] = acc;
    }
    this.F = F; this.step = step;
  }
  dist(pos) { const x = Math.max(0, pos) / this.step, i = Math.min(this.F.length - 2, Math.floor(x)), f = x - i; return this.F[i] + (this.F[i + 1] - this.F[i]) * f; }
  speedNow(pos) { return (this.dist(pos + 0.5) - this.dist(pos)) / 0.5; }

  // ---------- images ----------
  _img(src) {
    if (!src) return null;
    let e = this.imgs.get(src); if (e) return e;
    const img = new Image(); img.decoding = 'async'; e = { img, ok: false, src }; this.imgs.set(src, e);
    img.onload = () => { e.ok = true; }; img.onerror = () => { e.err = true; };
    img.src = this.base + src; return e;
  }
  _assetsOf(it) { const s = it?.scene; if (!s) return []; return [s.backdrop, s.mid, s.near, s.landmark?.src, s.landmark?.type === 'tunnel' && this.cfg.tunnelWall, this.crossings[s.exitCut]].filter(Boolean); }
  /** Which cruise item is current; preloads its assets and the next few, frees the rest. */
  setItem(idx) {
    this.idx = idx; const items = this.plan.items, want = new Set([this.cfg.frame?.src, this.frame?.src]);
    const seen = new Set(); for (let i = Math.max(0, idx - 1); i < items.length && seen.size < 3; i++) { if (items[i].kind !== "cruise") continue; seen.add(items[i].scene); this._assetsOf(items[i]).forEach(a => want.add(a)); }
    this._assetsOf(items[idx - 1]).forEach(a => want.add(a));
    want.forEach(a => a && this._img(a));
    for (const [src, e] of this.imgs) if (!want.has(src) && src !== this.frame.src) { e.img.onload = e.img.onerror = null; e.img.src = ''; this.imgs.delete(src); }
  }
  get ready() { const it = this.plan.items[this.idx], s = it?.scene; if (!s) return false; const e = this._img(s.backdrop); return !!(this.frame.ok && (!e || e.ok || e.err)); }

  start(getPos) {
    this.getPos = getPos; if (this.run) return; this.run = true; let last = 0; const minDt = 1000 / this.cfg.fps - 2;
    const loop = (ts) => { if (!this.run) return; if (ts - last >= minDt) { last = ts; try { this.draw(this.getPos()); } catch (e) { this.err = e; } } this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.run = false; cancelAnimationFrame(this.raf); }

  // ---------- drawing ----------
  _fogTexture(color) {
    if (this.fogTex[color]) return this.fogTex[color];
    const w = 512, h = 160, cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
    const d = g.createImageData(w, h);
    const rgb = color.replace('#', '').match(/../g).map(x => parseInt(x, 16));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {      // sums of periodic sines in x ⇒ tiles seamlessly
      const u = x / w * Math.PI * 2, v = y / h;
      let n = Math.sin(u * 1 + 1.3) * .5 + Math.sin(u * 2 + v * 4 + .4) * .35 + Math.sin(u * 3 - v * 3 + 2.2) * .25 + Math.sin(u * 5 + v * 7) * .12;
      n = clamp01(.5 + n * .45) * Math.sin(Math.PI * clamp01(v)) ** 1.3;
      const i = (y * w + x) * 4; d.data[i] = rgb[0]; d.data[i + 1] = rgb[1]; d.data[i + 2] = rgb[2]; d.data[i + 3] = Math.round(255 * n * n);
    }
    g.putImageData(d, 0, 0); return (this.fogTex[color] = cv);
  }

  /** Draw one mirror-tiled panorama layer across the pane. */
  _tile(e, speed, F, phase, alpha, comp, yShift = 0) {
    if (!e || !e.ok || alpha <= 0.002) return;
    const c = this.c, P = this.pane, s = (P.h * 1.05) / e.img.naturalHeight, w = e.img.naturalWidth * s, h = e.img.naturalHeight * s, Wt = 2 * w;
    const off = mod(speed * F * (P.h / 720) + phase * Wt, Wt), n0 = Math.floor(off / w);
    let x = P.x - (off - n0 * w), j = n0;
    c.globalAlpha = alpha; c.globalCompositeOperation = comp;
    for (; x < P.x + P.w + 1; x += w, j++) {
      if (j % 2 === 0) c.drawImage(e.img, x, P.y - P.h * 0.025 + yShift, w + 1, h);
      else { c.save(); c.translate(x + w, P.y - P.h * 0.025 + yShift); c.scale(-1, 1); c.drawImage(e.img, 0, 0, w + 1, h); c.restore(); }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  _fog(color, alpha, speed, F, phase, ybase, hfrac) {
    if (!alpha) return;
    const c = this.c, P = this.pane, tex = this._fogTexture(color), h = P.h * hfrac, w = tex.width * (h / tex.height), off = mod(speed * F * (P.h / 720) + phase * w, w);
    c.globalAlpha = alpha;
    for (let x = P.x - off; x < P.x + P.w; x += w) c.drawImage(tex, x, P.y + P.h * ybase, w + 1, h);
    c.globalAlpha = 1;
  }

  draw(pos) {
    const items = this.plan.items; let it = items[this.idx]; if (!it || !it.scene) return;
    const c = this.c, P = this.pane, S = it.scene, F = this.dist(pos), sp = this.speedNow(pos), sc = this.cfg.speeds;
    const prevIt = items[this.idx - 1];
    const nextIt = items[this.idx + 1];
    const arriving = prevIt?.scene !== S && this.crossings[prevIt?.scene?.exitCut];
    const departing = nextIt?.kind === 'cruise' && nextIt.scene !== S && this.crossings[S.exitCut];
    const pv = !arriving && prevIt && prevIt.kind === 'cruise' && prevIt.scene && prevIt.scene !== it.scene && Math.abs(prevIt.end - it.start) < 0.5 ? prevIt.scene : null;   // zone/segment change with no station between: cross-fade
    const a = pv ? smooth((pos - it.start) / this.cfg.xfade) : 1;
    const ph = (id) => hash(id.length * 31 + id.charCodeAt(0) * 7 + id.charCodeAt(id.length - 1) * 13);
    c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, this.W, this.H);
    c.save(); c.beginPath(); c.rect(P.x, P.y, P.w, P.h); c.clip();
    // gentle carriage sway + rail clack, scaled by how fast the train really goes
    const swaySpeed = this.cfg.sway === false ? 0 : sp;
    const swayY = swaySpeed * ((P.h / 720) * (1.1 * Math.sin(pos * 2.3) + 0.5 * Math.sin(pos * 6.7 + 1)));
    c.translate(0, swayY);
    // backdrop (+ cross-fade to the previous one while it changes)
    const layer = (key, speed, comp, shift = 0) => {
      const changing = pv && (pv[key] !== S[key] || pv.paintedStrips !== S.paintedStrips);
      const paint = (scene, alpha) => {
        const src = scene[key];
        if (!src) return;
        const painted = scene.paintedStrips;
        const distance = painted ? F - this.stripOrigins.get(scene) : F;
        if (key === 'backdrop' && scene.panBackdrop) {
          const plate = this._img(src);
          if (!plate.ok) return;
          const span = this.vistaEnds.get(scene) - this.stripOrigins.get(scene);
          const progress = clamp01(distance / Math.max(1, span));
          const scale = Math.max(P.w * 1.22 / plate.img.naturalWidth, P.h * 1.03 / plate.img.naturalHeight);
          const w = plate.img.naturalWidth * scale, h = plate.img.naturalHeight * scale;
          c.globalAlpha = alpha;
          c.drawImage(plate.img, P.x - progress * (w - P.w), P.y - (h - P.h) / 2, w, h);
          c.globalAlpha = 1;
          return;
        }
        this._tile(this._img(src), speed, distance, painted ? 0 : ph(src), alpha,
          painted ? 'source-over' : comp, painted ? 0 : shift);
      };
      if (changing) paint(pv, key === 'backdrop' ? 1 : 1 - a);
      paint(S, changing ? a : 1);
    };
    layer('backdrop', sc.backdrop, 'source-over');
    const fg = S.fog || {}; const fogC = fg.color || '#aab4c4';
    this._fog(fogC, (fg.far ?? 0.35), sc.fogFar, F, 0.13, 0.28, 0.7);
    // A passing landmark sits behind the shoreline, tree line or nearer rock shelf.
    const lm = S.landmark;
    if (lm && S.paintedStrips) this._landmark(it, lm, pos, F, sc);
    layer('mid', sc.mid, 'multiply');
    if (lm && !S.paintedStrips) this._landmark(it, lm, pos, F, sc);
    this._fog(fogC, (fg.near ?? 0.28), sc.fogNear, F, 0.61, 0.5, 0.62);
    layer('near', sc.near, 'multiply', P.h * 0.015 * Math.sin(pos * 9.1) * swaySpeed);
    // weather
    this._weather(S, pv, a, pos, F, sp);
    // tunnel darkness (procedural landmark)
    if (lm && lm.type === 'tunnel') this._tunnel(it, lm, pos, F);
    if (arriving) this._crossing(arriving, pos - it.start);
    if (departing) this._crossing(departing, pos - it.end);
    // light: slow cloud drift + glass vignette
    c.fillStyle = `rgba(0,0,0,${0.05 + 0.05 * Math.sin(pos * 0.047)})`; c.fillRect(P.x, P.y, P.w, P.h);
    const g = c.createRadialGradient(P.x + P.w / 2, P.y + P.h / 2, P.h * 0.35, P.x + P.w / 2, P.y + P.h / 2, P.w * 0.62);
    g.addColorStop(0, 'rgba(8,10,14,0)'); g.addColorStop(1, 'rgba(8,10,14,0.42)'); c.fillStyle = g; c.fillRect(P.x, P.y, P.w, P.h);
    c.restore();
    if (this.frame.ok) c.drawImage(this.frame.img, 0, 0, this.W, this.H);
  }

  // Offset is relative to the shared item boundary, so either scene draws the
  // same part of the crossing at the same time, including during a reverse seek.
  _crossing(src, offset) {
    const pane = this.pane;
    const width = pane.w * 10; // 68.8% solid masonry travels 5.88 pane widths during seven seconds of full cover
    const left = pane.x + (pane.w - width) / 2 - offset * pane.w * 0.84;
    if (left >= pane.x + pane.w || left + width <= pane.x) return;
    const plate = this._img(src);
    if (!plate?.ok) return;
    this.c.drawImage(plate.img, left, pane.y - 2, width, pane.h + 4);
  }

  _landmarkWindow(it) { return it.lmWin || null; }     // fixed by the planner (journey.js)
  _landmark(it, lm, pos, F, sc) {
    if (lm.type === 'tunnel') return;
    const win = this._landmarkWindow(it); if (!win || pos < win[0] || pos > win[1]) return;
    const e = this._img(lm.src); if (!e || !e.ok) return;
    const c = this.c, P = this.pane, dh = P.h * (lm.height ?? 0.85), dw = dh * (lm.w && lm.h ? lm.w / lm.h : e.img.naturalWidth / e.img.naturalHeight);
    const u = (pos - win[0]) / (win[1] - win[0]), x = P.x + P.w + dw * 0.02 - u * (P.w + dw * 1.04), y = P.y + P.h * (lm.base ?? 0.95) - dh;
    const edge = smooth(u * 6) * smooth((1 - u) * 6);
    c.globalCompositeOperation = it.scene.paintedStrips ? 'source-over' : 'multiply'; c.globalAlpha = (lm.alpha ?? 0.95) * (0.35 + 0.65 * edge);
    c.drawImage(e.img, x, y, dw, dh); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  _tunnel(it, lm, pos, F) {
    const win = this._landmarkWindow(it); if (!win) return; const t = pos - win[0], dur = win[1] - win[0]; if (t < -1 || t > dur + 1) return;
    const d = smooth(t / 3) * smooth((dur - t) / 3), c = this.c, P = this.pane;
    const wall = this._img(this.cfg.tunnelWall);
    if (wall?.ok) this._tile(wall, 235, F, 0, d, 'source-over');
    c.fillStyle = `rgba(6,9,12,${(wall?.ok ? .76 : .97) * d})`;
    c.fillRect(P.x, P.y, P.w, P.h);
    if (d < .01) return;
    const radius = P.h * .32, period = P.w * 1.32;
    const x = P.x + P.w + radius - mod(F * 235 * P.h / 720, period);
    const y = P.y + P.h * .43;
    const glow = c.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(224,158,77,${.32 * d})`);
    glow.addColorStop(1, 'rgba(224,158,77,0)');
    c.fillStyle = glow; c.fillRect(x-radius,y-radius,radius*2,radius*2);
    c.fillStyle = `rgba(22,22,20,${d})`;
    c.fillRect(x-5,y-9,10,18);
    c.fillStyle = `rgba(246,194,114,${.90*d})`;
    c.fillRect(x-2.5,y-6,5,11);
  }
  _weather(S, pv, a, pos, F, sp) {
    const c = this.c, P = this.pane, R = P.h / 720;
    const dens = (k) => { const cur = S.weather?.[k] || 0, old = pv ? (pv.weather?.[k] || 0) : cur; return old + (cur - old) * a; };
    const rain = dens('rain'), snow = dens('snow');
    if (rain > 0.01) {
      const N = Math.round(150 * rain), spd = Math.max(0.25, sp);
      c.strokeStyle = 'rgba(205,220,238,0.33)'; c.lineWidth = Math.max(1, R * 1.1); c.beginPath();
      for (let i = 0; i < N; i++) {
        const sy = (520 + 420 * hash(i, 2)) * R, len = (10 + 20 * hash(i, 3)) * R, slant = (0.22 + 0.5 * spd * 0.35) * len;
        const x = mod(hash(i, 1) * (P.w + 80) - (F * 34 + pos * 6) * R, P.w + 80) - 40, y = mod(hash(i, 4) * (P.h + 60) + pos * sy, P.h + 60) - 30;
        c.moveTo(P.x + x, P.y + y); c.lineTo(P.x + x - slant, P.y + y + len);
      }
      c.stroke();
      // slow beads running down the glass
      c.fillStyle = 'rgba(220,232,245,0.20)'; c.strokeStyle = 'rgba(220,232,245,0.10)'; c.lineWidth = R;
      for (let i = 0; i < Math.round(16 * rain); i++) {
        const bx = P.x + hash(i, 7) * P.w, by = P.y + mod(hash(i, 8) * P.h + pos * (7 + 9 * hash(i, 9)) * R, P.h), r = (1.6 + 2.2 * hash(i, 5)) * R;
        c.beginPath(); c.moveTo(bx, by - 26 * R * hash(i, 6)); c.lineTo(bx, by); c.stroke(); c.beginPath(); c.ellipse(bx, by, r * 0.8, r * 1.2, 0, 0, 7); c.fill();
      }
    }
    if (snow > 0.01) {
      const N = Math.round(130 * snow); c.fillStyle = 'rgba(244,248,255,0.85)';
      for (let i = 0; i < N; i++) {
        const z = hash(i, 11), r = (0.9 + 2.4 * z) * R, vx = (30 + 150 * z) * R, vy = (22 + 40 * z) * R;
        const x = mod(hash(i, 12) * (P.w + 60) - (F * .8 + pos * .2) * vx + Math.sin(pos * 0.7 + i) * 8 * R, P.w + 60) - 30, y = mod(hash(i, 13) * (P.h + 40) + pos * vy, P.h + 40) - 20;
        c.globalAlpha = 0.35 + 0.55 * z; c.beginPath(); c.arc(P.x + x, P.y + y, r, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }
  }
}
