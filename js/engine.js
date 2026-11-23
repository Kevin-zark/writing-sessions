// Pure session logic (no DOM / audio) so it can be unit-tested in node.
export const INTRO_SEC = 55;
export const OUTRO_SEC = 45;

export const PRESETS = [
  { id: 'classic', name: 'Classic', note: '4 × 25 min · 5 min breaks', sprintMin: 25, breakMin: 5, sprints: 4 },
  { id: 'thirty', name: '30 / 2', note: '2 × 30 min · 2 min breaks', sprintMin: 30, breakMin: 2, sprints: 2 },
  { id: 'sixty', name: '60 / 10', note: '2 × 60 min · 10 min breaks', sprintMin: 60, breakMin: 10, sprints: 2 },
  { id: 'custom', name: 'Custom', note: 'Your own lengths', sprintMin: 25, breakMin: 5, sprints: 4 },
];

export const DEFAULT_SETTINGS = {
  preset: 'classic', sprintMin: 25, breakMin: 5, sprints: 4,
  intro: true, outro: true,
  musicVol: 0.8, ambVol: 0.7, chimeVol: 0.8,
  wakeLock: true,
  webhookUrl: '', mailtoTo: '',
};

export function clampCfg(c) {
  const n = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  return {
    ...c,
    sprintMin: n(c.sprintMin, 1, 180, 25),
    breakMin: n(c.breakMin, 0, 60, 5),
    sprints: Math.round(n(c.sprints, 1, 12, 4)),
  };
}

/** segments: intro?, sprint1, break1, sprint2, ... sprintN, outro? (no break after the last sprint) */
export function buildTimeline(cfg) {
  const c = clampCfg(cfg);
  const segs = [];
  let t = 0;
  const push = (type, dur, extra = {}) => { segs.push({ type, start: t, dur, end: t + dur, ...extra }); t += dur; };
  if (c.intro) push('intro', INTRO_SEC);
  for (let i = 1; i <= c.sprints; i++) {
    push('sprint', c.sprintMin * 60, { n: i, of: c.sprints });
    if (i < c.sprints && c.breakMin > 0) push('break', c.breakMin * 60, { n: i, of: c.sprints });
  }
  if (c.outro) {
    const classic = c.sprints === 4 && c.sprintMin === 25 && c.breakMin === 5;
    const arrival = classic ? 5 * 60 - (c.intro ? INTRO_SEC : 0) : OUTRO_SEC;
    push('outro', arrival);
  }
  segs.forEach((s, i) => { s.i = i; });
  return { segs, total: t };
}

export function locate(tl, t) {
  const segs = tl.segs;
  if (t >= tl.total) return { done: true, seg: segs[segs.length - 1], i: segs.length - 1, elapsed: segs[segs.length - 1].dur, remaining: 0, progress: 1 };
  t = Math.max(0, t);
  let i = segs.findIndex(s => t >= s.start && t < s.end);
  if (i < 0) i = 0;
  const seg = segs[i];
  const elapsed = t - seg.start;
  return { done: false, seg, i, elapsed, remaining: seg.dur - elapsed, progress: elapsed / seg.dur };
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec - 1e-6));
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
export function fmtTotal(sec) {
  const m = Math.round(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
}

/**
 * Spread `sceneCount` scenes across the session. K slots = max(scenes, sprints).
 * Cuts are snapped to the nearest sprint/break boundary when one is close
 * (within 30% of a slot), otherwise placed mid-segment so long sprints still change.
 * mode 'journey' walks first -> last scene; 'cycle' loops them.
 * Returns [{start,end,scene}] (adjacent slots with the same scene are merged).
 */
export function planScenes(tl, sceneCount, mode = 'journey') {
  if (!sceneCount) return [];
  const sprints = tl.segs.filter(s => s.type === 'sprint').length;
  const K = Math.max(sceneCount, sprints, 1);
  const T = tl.total, slot = T / K;
  const bounds = tl.segs.slice(1).map(s => s.start);
  const cuts = [];
  for (let k = 1; k < K; k++) {
    const ideal = k * slot;
    let best = null, bd = Infinity;
    for (const b of bounds) { const d = Math.abs(b - ideal); if (d < bd) { bd = d; best = b; } }
    let cut = (best != null && bd <= slot * 0.3) ? best : ideal;
    const prev = cuts.length ? cuts[cuts.length - 1] : 0;
    if (cut <= prev + 1) cut = prev + Math.max(1, slot * 0.5);
    cuts.push(cut);
  }
  const edges = [0, ...cuts, T];
  const out = [];
  for (let k = 0; k < K; k++) {
    const scene = mode === 'cycle' ? k % sceneCount
      : (K === 1 ? 0 : Math.round(k * (sceneCount - 1) / (K - 1)));
    const last = out[out.length - 1];
    if (last && last.scene === scene) last.end = edges[k + 1];
    else out.push({ start: edges[k], end: edges[k + 1], scene });
  }
  return out;
}
export function sceneAt(plan, t) {
  for (const p of plan) if (t >= p.start && t < p.end) return p.scene;
  return plan.length ? plan[plan.length - 1].scene : 0;
}
