// Scene stage: two layers that crossfade. Each layer = still image (with slow Ken Burns pan)
// + muted looping <video>. If a clip is missing / blocked (e.g. iOS Low Power Mode) the
// still keeps its Ken Burns animation instead.
export class SceneStage {
  constructor(root, scenes, base) {
    this.root = root; this.scenes = scenes; this.base = base; this.cur = -1; this.top = 0; this.token = 0;
    this.layers = [0, 1].map(() => {
      const el = document.createElement('div'); el.className = 'layer';
      el.innerHTML = '<img class="still" alt="" decoding="async"><video muted loop playsinline webkit-playsinline preload="auto" disablepictureinpicture></video>';
      root.appendChild(el);
      const v = el.querySelector('video'); v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
      return { el, img: el.querySelector('img'), video: v, mode: 'none' };
    });
    this.log = [];   // [{scene, mode, t}] for debugging/tests
  }
  get info() { return { index: this.cur, scene: this.scenes[this.cur]?.id, mode: this.layers[this.top]?.mode, log: this.log }; }

  async show(index, { instant = false, fadeMs = 3000 } = {}) {
    if (index === this.cur || !this.scenes.length) return;
    const my = ++this.token, sc = this.scenes[index];
    const L = this.layers[1 - this.top], old = this.layers[this.top];
    this.cur = index;
    // prepare hidden layer
    L.el.style.transition = 'none'; L.el.style.opacity = '0';
    L.img.src = sc.still ? this.base + sc.still : '';
    L.img.classList.remove('kb');
    L.video.classList.remove('on');
    L.mode = 'still';
    let ok = false;
    if (sc.clip) ok = await this._loadVideo(L, this.base + sc.clip);
    if (my !== this.token) return;
    if (ok) { L.mode = 'video'; L.video.classList.add('on'); L.img.classList.remove('kb'); }
    else { L.mode = 'kenburns'; L.video.removeAttribute('src'); L.video.load(); void L.img.offsetWidth; L.img.classList.add('kb'); }
    // layer on top of the old one, then fade in
    L.el.style.zIndex = '2'; old.el.style.zIndex = '1';
    void L.el.offsetWidth;
    L.el.style.transition = instant ? 'none' : `opacity ${fadeMs}ms ease-in-out`;
    L.el.style.opacity = '1';
    this.log.push({ scene: sc.id, mode: L.mode, t: Date.now() });
    const prev = old;
    setTimeout(() => {
      if (my !== this.token) return;
      prev.el.style.opacity = '0'; try { prev.video.pause(); } catch (e) {}
    }, instant ? 0 : fadeMs + 80);
    this.top = 1 - this.top;
  }

  _loadVideo(L, url) {
    return new Promise((resolve) => {
      const v = L.video; let done = false;
      const fin = (ok) => { if (done) return; done = true; clearTimeout(to); v.onerror = v.oncanplay = null; resolve(ok); };
      const to = setTimeout(() => fin(false), 6000);
      v.onerror = () => fin(false);
      v.oncanplay = () => { const p = v.play(); if (p && p.then) p.then(() => fin(true), () => fin(false)); else fin(true); };
      v.src = url; v.load();
    });
  }
  pause() { this.layers.forEach(l => { try { l.video.pause(); } catch (e) {} l.img.style.animationPlayState = 'paused'; }); }
  resume() { this.layers.forEach(l => { if (l.mode === 'video' && l.el.style.opacity !== '0') l.video.play().catch(() => {}); l.img.style.animationPlayState = 'running'; }); }
  destroy() { this.token++; this.layers.forEach(l => { try { l.video.pause(); l.video.removeAttribute('src'); l.video.load(); } catch (e) {} l.el.remove(); }); }
}

// ---------------------------------------------------------------------------------------------
// JourneyStage (manifest v2): plays the chained clip plan from journey.planJourney().
// Two <video> layers. While a loop plays, the next item is preloaded (paused on frame 0) in the
// hidden layer. When the plan says the next item is due, the current loop stops looping and the
// swap happens on its `ended` event — loop end frame == bridge first frame, so the swap is
// invisible (no fade). Out-of-order jumps (skip, seek, background tab, ?speed>1) crossfade.
export class JourneyStage {
  constructor(root, plan, base, { speed = 1, objectPosition } = {}) {
    this.root = root; this.plan = plan; this.base = base; this.speed = speed; this.cur = -1; this.top = 0; this.token = 0;
    this.layers = [0, 1].map(() => {
      const el = document.createElement('div'); el.className = 'layer';
      el.innerHTML = '<img class="still" alt="" decoding="async"><video muted playsinline webkit-playsinline preload="auto" disablepictureinpicture></video>';
      root.appendChild(el);
      const v = el.querySelector('video'); v.muted = true; v.defaultMuted = true; v.setAttribute('muted', '');
      if (objectPosition) { v.style.objectPosition = objectPosition; el.querySelector('img').style.objectPosition = objectPosition; }
      return { el, img: el.querySelector('img'), video: v, mode: 'none', item: -1, ready: false };
    });
    this.log = []; this.pending = null; this.failed = new Set();
  }
  get info() { const it = this.plan.items[this.cur]; return { index: this.cur, id: it?.id, kind: it?.kind, mode: this.layers[this.top]?.mode, log: this.log }; }
  url(p) { return p ? this.base + p : ''; }

  /** Called every tick with the item index the clock says should be showing. */
  update(want, pos) {
    if (want < 0) return;
    if (this.cur < 0) return this._hard(want, { instant: true, pos });
    const items = this.plan.items, cur = items[this.cur];
    if (this.speed === 1 && !document.hidden) {
      // stage may run a little ahead (a bridge finished early) — let the clock catch up
      if (want === this.cur - 1 && items[this.cur].start - pos < 20) return;
      // start a chained bridge half a loop early, so on average it lands on time
      const nx = items[this.cur + 1];
      if (want === this.cur && cur.kind === 'loop' && nx?.kind === 'bridge' && !cur.xfadeNext && pos >= nx.start - (cur.loopDur || 10) / 2) want = this.cur + 1;
    }
    if (want === this.cur) { this._maybePreload(pos); return; }
    const it = items[want], L = this.layers[this.top];
    const chained = want === this.cur + 1 && this.speed === 1 && L.mode === 'video' && !cur.xfadeNext && it.kind !== 'xfade' && !document.hidden;
    if (!chained) return this._hard(want, { pos });
    if (this.pending === want) {
      // safety: if 'ended' never arrives (stall), force the swap
      if (pos > it.start + (cur.kind === 'bridge' ? 12 : (cur.loopDur || 10) + 6)) this._hard(want, { pos });
      return;
    }
    this.pending = want;
    const v = L.video;
    if (cur.kind === 'bridge') return;            // its own onended swaps to the next loop
    if (!v.ended) { v.loop = false; this._onEnd(v, () => this._swap(want)); }
    else this._swap(want);
  }

  /** Run `fn` once when `v` reaches its end. `ended` alone is not reliable (WebKit can stall just short of EOS and
   *  never fire it), so a 40 ms watcher also fires at duration-0.1 s or when playback freezes in the last 1.5 s. */
  _onEnd(v, fn) {
    clearInterval(v._wi); let fired = false, last = -1, tAdv = Date.now();
    const go = () => { if (fired) return; fired = true; clearInterval(v._wi); v.onended = null; fn(); };
    v.onended = go;
    v._wi = setInterval(() => {
      const t = v.currentTime, d = v.duration || 0;
      if (t !== last) { last = t; tAdv = Date.now(); }
      if (v.ended || (d && t >= d - 0.1) || (d && t > d - 1.5 && !v.paused && Date.now() - tAdv > 900)) go();
    }, 40);
  }
  /** Hard jump after a seek/skip (crossfade; ignores the chaining guards). */
  jump(want, pos) { if (want < 0 || want === this.cur) return; this._hard(want, { pos }); }
  _maybePreload(pos) {
    const n = this.cur + 1, it = this.plan.items[n]; if (!it) return;
    const H = this.layers[1 - this.top];
    if (H.item === n || this.speed !== 1) return;
    if (it.start - pos > 25) return;            // preload ~25 s ahead
    this._prepare(H, n);
  }
  _prepare(H, n) {
    const it = this.plan.items[n]; H.item = n; H.ready = false;
    H.img.src = this.url(it.still || this.plan.items[n + 1]?.still || '');
    clearInterval(H.video._wi); H.video.loop = it.kind !== 'bridge'; H.video.onended = null;
    if (!it.clip || this.failed.has(it.clip)) { H.mode = 'still'; return Promise.resolve(false); }
    const tok = H.tok = (H.tok || 0) + 1;                 // a newer prepare on this layer supersedes (and must not be clobbered by) older ones
    return H.prep = new Promise((resolve) => {
      const v = H.video; let done = false;
      // iOS Safari ignores preload="auto" (Low Power Mode / cellular) and never fires canplay for a paused,
      // hidden video, so we nudge it with a muted play() and pause again once it has data.
      const fin = (ok, hard) => {
        if (done) return; done = true; clearTimeout(to);
        if (H.tok !== tok) return resolve(false);          // superseded: leave the layer state to the newer prepare
        v.oncanplay = v.onloadeddata = v.onerror = null; H.ready = ok;
        if (ok) { try { v.pause(); v.currentTime = 0; } catch (e) {} }
        else if (hard) this.failed.add(it.clip);     // only a real decode/404 error is permanent; a slow network is retried
        resolve(ok);
      };
      const to = setTimeout(() => fin(false, false), 25000);
      v.onerror = () => fin(false, true);
      v.oncanplay = () => fin(true); v.onloadeddata = () => { if (v.readyState >= 3) fin(true); };
      v.src = this.url(it.clip); v.load();
      try { const pp = v.play(); if (pp && pp.catch) pp.catch(() => {}); } catch (e) {}
    });
  }
  async _swap(n) {
    const H = this.layers[1 - this.top], old = this.layers[this.top], my = ++this.token;
    if (H.item !== n) await this._prepare(H, n); else if (!H.ready && H.prep) await H.prep;   // preload still in flight: wait for it, don't restart it
    if (my !== this.token) return;
    this.pending = null;
    const it = this.plan.items[n];
    if (!H.ready) return this._hard(n, {});
    H.mode = 'video'; H.video.classList.add('on'); H.img.classList.remove('kb');
    H.video.currentTime = 0;
    const p = H.video.play(); if (p?.catch) p.catch(() => {});
    H.el.style.transition = 'none'; H.el.style.opacity = '1'; H.el.style.zIndex = '2'; old.el.style.zIndex = '1';
    this.top = 1 - this.top; this.cur = n;
    this.log.push({ id: it.id, kind: it.kind, mode: 'chain', t: Date.now() });
    // hide old layer a frame later
    requestAnimationFrame(() => requestAnimationFrame(() => { if (my === this.token) { old.el.style.opacity = '0'; try { old.video.pause(); } catch (e) {} old.item = -1; } }));
    // bridges: swap to the next loop when the bridge ends
    if (it.kind === 'bridge') this._onEnd(H.video, () => { if (this.cur === n) this._swap(n + 1); });
  }
  async _hard(n, { instant = false, pos } = {}) {
    const my = ++this.token, it = this.plan.items[n]; if (!it) return;
    this.pending = null;
    const H = this.layers[1 - this.top], old = this.layers[this.top];
    this.cur = n;
    H.el.style.transition = 'none'; H.el.style.opacity = '0';
    H.img.classList.remove('kb'); H.video.classList.remove('on');
    const ok = H.item === n && H.ready ? true : (H.item === n && H.prep ? await H.prep : await this._prepare(H, n));
    if (my !== this.token) return;
    if (ok) {
      H.mode = 'video'; H.video.classList.add('on');
      // join a bridge part-way through if we arrived late
      if (it.kind === 'bridge' && pos != null && this.speed === 1) { const off = pos - it.start; if (off > 0.2 && off < (H.video.duration || 8)) H.video.currentTime = off; }
      const p = H.video.play(); if (p?.catch) p.catch(() => {});
      if (it.kind === 'bridge') this._onEnd(H.video, () => { if (this.cur === n && this.speed === 1) this._swap(n + 1); });
    } else {
      H.mode = 'kenburns'; H.video.removeAttribute('src'); try { H.video.load(); } catch (e) {}
      H.img.src = this.url(it.still || this.plan.items[n + 1]?.still || this.plan.items[n - 1]?.still);
      void H.img.offsetWidth; H.img.classList.add('kb');
    }
    H.el.style.zIndex = '2'; old.el.style.zIndex = '1'; void H.el.offsetWidth;
    const fade = instant ? 0 : (this.speed === 1 ? 2500 : 300);
    H.el.style.transition = fade ? `opacity ${fade}ms ease-in-out` : 'none'; H.el.style.opacity = '1';
    this.top = 1 - this.top;
    this.log.push({ id: it.id, kind: it.kind, mode: H.mode, t: Date.now() });
    setTimeout(() => { if (my !== this.token) return; old.el.style.opacity = '0'; try { old.video.pause(); } catch (e) {} old.item = -1; }, fade + 80);
  }
  pause() { this.layers.forEach(l => { try { l.video.pause(); } catch (e) {} l.img.style.animationPlayState = 'paused'; }); }
  resume() { const l = this.layers[this.top]; if (l.mode === 'video') l.video.play().catch(() => {}); this.layers.forEach(x => x.img.style.animationPlayState = 'running'); }
  destroy() { this.token++; this.layers.forEach(l => { try { l.video.pause(); l.video.removeAttribute('src'); l.video.load(); } catch (e) {} l.el.remove(); }); }
}
