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
