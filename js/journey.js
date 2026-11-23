// Manifest v2 "journey" planning: pure functions (no DOM/audio) so they run in node tests.
// A journey = origin station -> leg 1 views -> station -> leg 2 ... -> leg N -> destination station.
// Every visual item is either a seamless `loop` (same first/last frame) or a one-shot `bridge`
// whose first frame is the previous loop's frame and last frame is the next loop's frame.

/** Leg base layers + per-clip layers; a clip entry with the same layer name overrides the base gain (gain 0 removes it). */
export function mergeLayers(base = [], extra = []) {
  const m = new Map(); [...(base || []), ...(extra || [])].forEach(l => m.set(l.layer, l));
  return [...m.values()].filter(l => (l.gain ?? 1) > 0);
}

/** Flatten a v2 manifest into the ordered chain of visual nodes + bridges. */
export function chainOf(m) {
  const st = m.stations || [], legs = m.legs || [];
  const node = (n, extra) => ({ id: n.id, title: n.title, clip: n.loop, still: n.still, dur: n.loopDur || 10, ambience: n.ambience || [], ...extra });
  const out = { stations: st.map((s, i) => node(s, { kind: 'station', station: i })), legs: [] };
  legs.forEach((leg, li) => {
    const base = leg.ambience || [];
    if (leg.segments) {      // schema 3: procedural "window" cruise. Each segment is a continuously-moving view with one landmark pass-by
      out.legs.push({ id: leg.id, title: leg.title, music: leg.music || [], base, depart: null, arrive: null, speed: leg.speed ?? 1, rampIn: leg.rampIn, rampOut: leg.rampOut, cruise: true,
        views: leg.segments.map((v, vi) => ({
          id: v.id, title: v.title, kind: 'cruise', leg: li, view: vi, clip: null, still: v.backdrop, dur: 0, next: null, ambience: mergeLayers(base, v.ambience),
          introViewSeconds: v.introViewSeconds,
          scene: { panBackdrop: v.panBackdrop, paintedStrips: v.paintedStrips, exitCut: v.exitCut, backdrop: v.backdrop, mid: v.mid, near: v.near || leg.near, fog: { ...(leg.fog || {}), ...(v.fog || {}) }, weather: { ...(leg.weather || {}), ...(v.weather || {}) }, landmark: v.landmark || null },
        })) });
      return;
    }
    out.legs.push({
      id: leg.id, title: leg.title, music: leg.music || [], base,
      depart: leg.depart ? { clip: leg.depart.clip, dur: leg.depart.dur || 8 } : null,
      arrive: leg.arrive ? { clip: leg.arrive.clip, dur: leg.arrive.dur || 8 } : null,
      views: (leg.views || []).map((v, vi) => ({
        ...node(v, { kind: 'view', leg: li, view: vi }),
        ambience: mergeLayers(base, v.ambience),
        next: v.bridge ? { clip: v.bridge.clip, dur: v.bridge.dur || 8 } : null,
      })),
    });
  });
  return out;
}

/**
 * Lay the journey over a session timeline (from engine.buildTimeline).
 * Returns { items:[{start,end,kind:'loop'|'bridge'|'xfade', clip, still, ambience, leg, label, music}], stops, legSpans }.
 * Rules:
 *  - intro shows the origin station; the outro (or session end) lands on the destination station.
 *  - The N-1 intermediate stations are matched, in order, to the breaks nearest each leg boundary
 *    (in sprint/travel time). A station with no break gets a brief pass-through stop (arrive+depart bridges).
 *  - Breaks without a station (more breaks than stations) hold the current view: the train keeps rolling.
 *  - Inside a leg, views get equal dwell; if a leg is too short for all views, views are thinned
 *    (non-adjacent views are joined by a crossfade instead of a bridge).
 *  - Arrive bridges end exactly when the stop begins; depart bridges start when it ends.
 */
export function planJourney(tl, m, { minDwell = 25 } = {}) {
  const ch = chainOf(m), L = ch.legs.length;
  const segs = tl.segs, sprints = segs.filter(s => s.type === 'sprint'), breaks = segs.filter(s => s.type === 'break');
  const intro = segs.find(s => s.type === 'intro'), outro = segs.find(s => s.type === 'outro');
  if (!L || !sprints.length) return { items: [], stops: [], legSpans: [] };
  // travel-time coordinate (sprint seconds only)
  const travelAt = (t) => { let acc = 0; for (const s of sprints) { if (t >= s.end) acc += s.dur; else if (t > s.start) acc += t - s.start; } return acc; };
  const S = sprints.reduce((a, s) => a + s.dur, 0);
  // choose a break for each intermediate boundary
  const bt = breaks.map(b => ({ b, x: travelAt(b.start) }));
  const used = new Set(), stopFor = [];
  let lastIdx = -1;
  for (let k = 1; k < L; k++) {
    const ideal = S * k / L; let best = -1, bd = Infinity;
    bt.forEach((o, i) => { if (i <= lastIdx || used.has(i)) return; const d = Math.abs(o.x - ideal); if (d < bd) { bd = d; best = i; } });
    // leave enough remaining breaks for later boundaries? (greedy is fine; falls back to pass-through)
    if (best >= 0 && bd <= S / L * 0.5) { used.add(best); lastIdx = best; stopFor[k] = bt[best].b; } else stopFor[k] = null;
  }
  // map a travel coordinate back to session time
  const timeAt = (x) => { let acc = 0; for (const s of sprints) { if (x <= acc + s.dur) return s.start + (x - acc); acc += s.dur; } return sprints[sprints.length - 1].end; };
  const items = [], stops = [];
  const push = (it) => { if (it.end - it.start > 1e-6) items.push(it); };
  const stLoop = (si, start, end, label) => { const s = ch.stations[si]; if (!s) return; push({ start, end, kind: 'loop', clip: s.clip, still: s.still, ambience: s.ambience, leg: -1, station: si, label: label || s.title, id: s.id, loopDur: s.dur }); };
  // origin
  const t0 = segs[0].start, tEnd = tl.total;
  const firstSprint = sprints[0];
  stLoop(0, t0, firstSprint.start, ch.stations[0]?.title);
  stops.push({ station: 0, start: t0, end: firstSprint.start, kind: intro ? 'intro' : 'origin' });
  const legSpans = [];
  /** Schema 3: a leg is a run of cruise items (one per segment). The landmark pass-by window is fixed here (single source of truth for the renderer);
   *  a landmark that brings its own ambience (tunnel) splits its segment into before / during / after so the sound only plays while it passes. */
  const cruiseItems = (leg, li, dep, arr) => {
    const V = leg.views, minD = Math.max(minDwell, 45), span = arr - dep;
    let n = V.length; while (n > 1 && n * minD > span) n--;
    const pick = n >= V.length ? V.map((_, i) => i) : Array.from({ length: n }, (_, i) => n === 1 ? 0 : Math.round(i * (V.length - 1) / (n - 1)));
    if (!pick.length) return;
    const equalDwell = span / pick.length;
    const opening = Math.min(V[pick[0]].introViewSeconds ?? equalDwell, equalDwell);
    const dwell = pick.length > 1 ? (span - opening) / (pick.length - 1) : span;
    pick.forEach((vi, i) => {
      const v = V[vi], s0 = i === 0 ? dep : dep + opening + (i - 1) * dwell, e0 = i === pick.length - 1 ? arr : dep + opening + i * dwell, lm = v.scene.landmark, len = e0 - s0, dur = lm?.dur || 26;
      const base = { kind: 'cruise', scene: v.scene, leg: li, view: vi, label: v.title, id: v.id, still: v.still, clip: null };
      let win = null; if (lm && len >= dur + 14) { const a = s0 + 8 + Math.max(0, len - dur - 16) * (lm.at ?? 0.55); win = [a, a + dur]; }
      if (win && lm.ambience?.length) {
        const a = Math.max(s0 + 1, win[0] - 2), b = Math.min(e0 - 1, win[1] + 1);
        push({ ...base, start: s0, end: a, ambience: v.ambience, lmWin: win }); push({ ...base, start: a, end: b, ambience: mergeLayers(v.ambience, lm.ambience), lmWin: win, id: v.id + '-lm' }); push({ ...base, start: b, end: e0, ambience: v.ambience, lmWin: win, id: v.id + '-post' });
      } else push({ ...base, start: s0, end: e0, ambience: v.ambience, lmWin: win });
    });
  };
  for (let li = 0; li < L; li++) {
    const leg = ch.legs[li];
    // leg start (departure) and end (arrival)
    const dep = li === 0 ? firstSprint.start : (stopFor[li] ? stopFor[li].end : timeAt(S * li / L));
    const arr = li === L - 1 ? (outro ? outro.start : sprints[sprints.length - 1].end) : (stopFor[li + 1] ? stopFor[li + 1].start : timeAt(S * (li + 1) / L));
    legSpans.push({ leg: li, start: dep, end: arr, id: leg.id });
    if (leg.cruise) {
      legSpans.push({ ...legSpans.pop(), startsAtStop: li === 0 || !!stopFor[li], endsAtStop: li === L - 1 || !!stopFor[li + 1], speed: leg.speed });
      cruiseItems(leg, li, dep, arr);
      if (li < L - 1) {
        if (stopFor[li + 1]) { stLoop(li + 1, stopFor[li + 1].start, stopFor[li + 1].end); stops.push({ station: li + 1, start: stopFor[li + 1].start, end: stopFor[li + 1].end, kind: 'break' }); }
        else stops.push({ station: li + 1, start: arr, end: arr, kind: 'pass' });
      }
      continue;
    }
    const passThroughIn = li > 0 && !stopFor[li];
    // available travel seconds in this leg, excluding unmatched breaks (train holds during them)
    const holds = breaks.filter(b => !Array.from(used).some(i => bt[i].b === b) && b.start >= dep && b.end <= arr);
    // build a list of travel windows [a,b] excluding holds
    const windows = []; let cur = dep;
    for (const h of holds) { if (h.start > cur) windows.push([cur, h.start]); cur = h.end; }
    if (arr > cur) windows.push([cur, arr]);
    const travel = windows.reduce((a, w) => a + (w[1] - w[0]), 0);
    const tmap = (x) => { for (const [a, b] of windows) { if (x <= b - a) return a + x; x -= b - a; } return arr; };
    const D = leg.depart?.dur || 8, A = leg.arrive?.dur || 8, V = leg.views;
    const useDepart = !!leg.depart && travel >= D + A + minDwell;
    const useArrive = !!leg.arrive && travel >= D + A + minDwell;
    let avail = travel - (useDepart ? D : 0) - (useArrive ? A : 0);
    // choose how many views fit
    let n = V.length;
    const need = (k) => k * minDwell + (k - 1) * 8;
    while (n > 1 && need(n) > avail) n--;
    const pick = n >= V.length ? V.map((_, i) => i) : Array.from({ length: n }, (_, i) => n === 1 ? 0 : Math.round(i * (V.length - 1) / (n - 1)));
    const bridgeDur = (i) => (pick[i + 1] === pick[i] + 1 && V[pick[i]].next) ? V[pick[i]].next.dur : 0;
    const bridges = pick.slice(0, -1).reduce((a, _, i) => a + bridgeDur(i), 0);
    const dwell = Math.max(1, (avail - bridges) / pick.length);
    let x = 0;
    const seg = (dur, it) => { const s = tmap(x), e = tmap(x + dur); x += dur; push({ ...it, start: s, end: e }); };
    if (useDepart) seg(D, { kind: 'bridge', clip: leg.depart.clip, ambience: V[0]?.ambience || leg.base, from: passThroughIn ? 'pass' : 'station', leg: li, label: `Departing Â· ${leg.title}`, id: `depart-${leg.id}` });
    pick.forEach((vi, i) => {
      const v = V[vi];
      seg(dwell, { kind: i === 0 && !useDepart ? 'xfade' : 'loop', clip: v.clip, still: v.still, ambience: v.ambience, leg: li, view: vi, label: v.title, id: v.id, loopDur: v.dur });
      if (i < pick.length - 1) {
        const bd = bridgeDur(i);
        if (bd) seg(bd, { kind: 'bridge', clip: v.next.clip, ambience: V[pick[i + 1]].ambience, leg: li, label: `${v.title} â†’ ${V[pick[i + 1]].title}`, id: `br-${v.id}` });
        else { const nx = items[items.length - 1]; nx.xfadeNext = true; }
      }
    });
    if (useArrive) seg(A, { kind: 'bridge', clip: leg.arrive.clip, ambience: ch.stations[li + 1]?.ambience || [], leg: li, label: `Arriving Â· ${ch.stations[li + 1]?.title || ''}`, id: `arrive-${leg.id}` });
    // pad any rounding remainder onto the last item
    if (items.length) items[items.length - 1].end = Math.max(items[items.length - 1].end, arr);
    // the stop after this leg
    if (li < L - 1) {
      if (stopFor[li + 1]) { stLoop(li + 1, stopFor[li + 1].start, stopFor[li + 1].end); stops.push({ station: li + 1, start: stopFor[li + 1].start, end: stopFor[li + 1].end, kind: 'break' }); }
      else stops.push({ station: li + 1, start: arr, end: arr, kind: 'pass' });
    }
  }
  // destination
  const lastEnd = items.length ? items[items.length - 1].end : t0;
  stLoop(ch.stations.length - 1, lastEnd, Math.max(lastEnd + 0.001, tEnd));
  stops.push({ station: ch.stations.length - 1, start: lastEnd, end: tEnd, kind: outro ? 'outro' : 'destination' });
  // Custom sessions can stop more often than the four-leg itinerary. Give every
  // extra break a quiet platform and stop the distance clock for its full dwell.
  if (ch.legs.every(leg => leg.cruise)) {
    for (const [index, { b, x }] of bt.entries()) {
      if (used.has(index)) continue;
      const pause = spans => spans.flatMap(span => {
        if (span.end <= b.start || span.start >= b.end) return [span];
        const parts = [];
        if (span.start < b.start) parts.push({ ...span, end: b.start, endsAtStop: true });
        if (span.end > b.end) parts.push({ ...span, start: b.end, startsAtStop: true });
        return parts;
      });
      const remaining = pause(items);
      items.splice(0, items.length, ...remaining);
      const travelSpans = pause(legSpans);
      legSpans.splice(0, legSpans.length, ...travelSpans);
      const station = Math.max(1, Math.min(ch.stations.length - 2, Math.round(x / S * L)));
      stLoop(station, b.start, b.end);
      stops.push({ station, start: b.start, end: b.end, kind: 'break' });
    }
    stops.sort((a, b) => a.start - b.start);
  }
  items.sort((a, b) => a.start - b.start);
  items.forEach((it, i) => { it.i = i; it.music = it.leg >= 0 ? ch.legs[it.leg].music : []; });
  return { items, stops, legSpans, chain: ch, total: tEnd };
}

export function itemAt(plan, t) {
  const it = plan.items; if (!it.length) return -1;
  let lo = 0, hi = it.length - 1;
  if (t < it[0].start) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (it[mid].start <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Leg whose music should play at time t (stations between legs keep the previous leg's set; music is muted there anyway). */
export function legAt(plan, t) {
  for (const s of plan.legSpans) if (t >= s.start && t < s.end) return s.leg;
  if (!plan.legSpans.length) return -1;
  return t < plan.legSpans[0].start ? 0 : plan.legSpans.filter(s => s.start <= t).pop()?.leg ?? 0;
}
