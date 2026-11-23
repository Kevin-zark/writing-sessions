// Pure session-time math: given t, the current song (and offset / fade),
// ambience layer offsets, and bus levels. Used by SessionAudio.seekTo and tests.
import { itemAt, legAt } from './journey.js';

export const FADE = {
  out: 8, in: 6, overlap: 1.5,
  breakOut: 8, sprintIn: 6, startIn: 3,
  seekRamp: 0.08,
};

export function lvlOf(seg) {
  if (!seg) return { m: 0, a: 0 };
  switch (seg.type) {
    case 'intro': return { m: 1.0, a: 0.8 };
    case 'sprint': return { m: 1.0, a: 0.65 };
    case 'break': return { m: 0.0, a: 1.0 };
    case 'outro': return { m: 0.8, a: 0.7 };
    default: return { m: 0, a: 0 };
  }
}

export function cosLerp(from, to, x) {
  x = Math.min(1, Math.max(0, x));
  return from * Math.cos(0.5 * Math.PI * x) + to * Math.sin(0.5 * Math.PI * x);
}

export function songOf(legs, leg, idx) {
  const list = legs[leg]?.music || [];
  if (!list.length) return null;
  const i = Math.max(0, Math.min(idx, list.length - 1));
  return { leg, legId: legs[leg].id, index: i, title: list[i].title, src: list[i].src, artist: list[i].artist || '' };
}

/** One music "run" per sprint: the song chosen at that sprint (intro is folded into sprint 1). */
export function buildMusicRuns(tl, plan, legs) {
  const segs = tl.segs || [];
  const sprints = segs.filter(s => s.type === 'sprint');
  const runs = [];
  let curLeg = Math.max(0, legAt(plan, 0));
  let songIndex = 0;
  sprints.forEach((sp) => {
    if ((sp.n || 0) > 1) {
      const lg = legAt(plan, sp.start);
      const useLg = (lg == null || lg < 0) ? curLeg : lg;
      if (useLg === curLeg) {
        const list = legs[curLeg]?.music || [];
        if (songIndex < list.length - 1) songIndex++;
      } else {
        curLeg = useLg;
        songIndex = 0;
      }
    } else {
      const lg = legAt(plan, sp.start);
      curLeg = (lg == null || lg < 0) ? 0 : lg;
      songIndex = 0;
    }
    const prev = segs.find(s => s.end === sp.start);
    const next = segs.find(s => s.start === sp.end);
    const audioStart = (sp.n === 1 && prev && prev.type === 'intro') ? prev.start : sp.start;
    const audibleEnd = next ? next.start : tl.total;
    const silentUntil = (next && next.type === 'break') ? next.end : audibleEnd;
    runs.push({ audioStart, audibleEnd, silentUntil, sprintN: sp.n, song: songOf(legs, curLeg, songIndex) });
  });
  const arrival = segs.find(seg => seg.type === 'outro');
  const destinationLeg = legs.length - 1;
  const arrivalIndex = legs[destinationLeg]?.arrivalMusicIndex;
  if (arrival && Number.isInteger(arrivalIndex)) {
    runs.push({ audioStart: arrival.start, audibleEnd: tl.total, silentUntil: tl.total,
      sprintN: sprints.length, song: songOf(legs, destinationLeg, arrivalIndex) });
  }
  return runs;
}

export function runAt(t, runs) {
  if (!runs.length) return null;
  let r = runs[0];
  for (const x of runs) if (t + 1e-9 >= x.audioStart) r = x;
  return r;
}

/**
 * Voices (0–2) of the current song at session time t, with file offset and gain.
 * The later-started voice is the primary (current) track.
 */
export function musicAt(t, runs, durations, fade = FADE) {
  const run = runAt(t, runs);
  if (!run || !run.song) return { run: null, voices: [], primary: null };
  const D = durations[run.song.src] ?? durations[run.song.title];
  if (!D || !(D > 1)) return { run, voices: [], primary: null, missingDuration: true };
  const T0 = run.audioStart, ov = Math.min(fade.overlap, fade.out), fo = Math.min(fade.out, D * 0.4), fi = Math.min(fade.in, D * 0.4);
  const period = Math.max(0.01, D - ov);
  const voices = [];
  if (t < T0) return { run, voices, primary: null, period, duration: D };
  const kMax = Math.floor((t - T0) / period) + 2;
  for (let k = 0; k <= kMax; k++) {
    const start = T0 + k * period, end = start + D;
    if (t < start || t >= end) continue;
    const u = t - start;
    let gain = 1;
    if (k > 0 && u < fi) gain = Math.sin(0.5 * Math.PI * (u / fi));
    if (u >= D - fo) {
      const x = (u - (D - fo)) / fo;
      gain *= Math.cos(0.5 * Math.PI * Math.min(1, Math.max(0, x)));
    }
    voices.push({ ...run.song, k, start, end, offset: u, gain, first: k === 0 });
  }
  voices.sort((a, b) => a.start - b.start);
  const primary = voices.length ? voices[voices.length - 1] : null;
  return { run, voices, primary, period, duration: D };
}

export function busAt(t, tl, vol, fade = FADE) {
  const segs = tl.segs || [];
  const mv = vol?.music ?? 0.8, av = vol?.amb ?? 0.7;
  if (!segs.length || t < 0) return { m: 0, a: 0 };
  const L0 = lvlOf(segs[0]);
  let m, a;
  if (t < fade.startIn) {
    const x = t / fade.startIn;
    m = cosLerp(0, L0.m * mv, x);
    a = cosLerp(0, L0.a * av, x);
  } else { m = L0.m * mv; a = L0.a * av; }
  for (let i = 1; i < segs.length; i++) {
    const prev = lvlOf(segs[i - 1]), next = lvlOf(segs[i]), when = segs[i].start;
    if (prev.m === next.m && prev.a === next.a) continue;
    let m0, m1;
    if (next.m < prev.m) { m0 = when - fade.breakOut; m1 = when; }
    else { m0 = when; m1 = when + fade.sprintIn; }
    if (t >= m1) {
      if (prev.m !== next.m) m = next.m * mv;
      if (prev.a !== next.a) a = next.a * av;
    } else if (t > m0) {
      const x = (t - m0) / (m1 - m0);
      if (prev.m !== next.m) m = cosLerp(prev.m * mv, next.m * mv, x);
      if (prev.a !== next.a) a = cosLerp(prev.a * av, next.a * av, x);
    }
  }
  const end = tl.total, last = lvlOf(segs[segs.length - 1]);
  if (t >= end + 2) return { m: 0, a: 0 };
  if (t >= end) {
    return { m: 0, a: cosLerp(last.a * av, 0, (t - (end - fade.breakOut)) / (fade.breakOut + 2)) };
  }
  if (t > end - fade.breakOut) {
    const xm = (t - (end - fade.breakOut)) / fade.breakOut;
    const xa = (t - (end - fade.breakOut)) / (fade.breakOut + 2);
    m = cosLerp(last.m * mv, 0, xm);
    a = cosLerp(last.a * av, 0, xa);
  }
  return { m, a };
}

export function layersAt(t, plan) {
  const i = itemAt(plan, t);
  const it = plan?.items?.[i];
  if (!it) return { item: i, layers: [], periodStart: {}, id: null, label: '' };
  const layers = it.ambience || [];
  const periodStart = {};
  for (const L of layers) {
    let s = it.start, j = i;
    while (j > 0) {
      const prev = plan.items[j - 1];
      if (!(prev.ambience || []).some(x => x.layer === L.layer)) break;
      j--; s = plan.items[j].start;
    }
    periodStart[L.layer] = s;
  }
  return { item: i, id: it.id, kind: it.kind, label: it.label || '', layers, periodStart, start: it.start, end: it.end };
}

export function layerOffset(t, periodStart, loopStart, loopEnd) {
  const len = Math.max(1e-3, loopEnd - loopStart);
  const u = ((t - periodStart) % len + len) % len;
  return loopStart + u;
}

/** Upcoming (or exact) chime times at or after t. */
export function chimesFrom(t, tl) {
  const out = [];
  for (const seg of (tl.segs || [])) {
    if (seg.start >= t - 0.01) {
      const kind = seg.type === 'intro' ? 'start' : seg.type === 'sprint' ? 'rise' : seg.type === 'break' ? 'fall' : 'finish';
      out.push({ sessionT: seg.start, kind });
    }
  }
  if (tl.total >= t - 0.01) out.push({ sessionT: tl.total, kind: 'end' });
  return out;
}
