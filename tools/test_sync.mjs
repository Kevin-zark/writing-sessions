import { readFileSync } from 'fs';
import { buildTimeline, DEFAULT_SETTINGS, INTRO_SEC } from '../js/engine.js';
import { planJourney } from '../js/journey.js';
import { buildMusicRuns, musicAt, busAt, FADE } from '../js/sync.js';

const m = JSON.parse(readFileSync(new URL('../themes/dark-academia-train/manifest.json', import.meta.url), 'utf8'));
const tl = buildTimeline({ ...DEFAULT_SETTINGS, sprintMin: 25, breakMin: 5, sprints: 4, intro: true, outro: true });
const plan = planJourney(tl, m);
const durs = {
  'audio/letters-by-lamplight-a.mp3': 134.52,
  'audio/letters-by-lamplight-b.mp3': 60.024,
  'audio/rain-over-wrenmere-lake-a.mp3': 182.544,
  'audio/rain-over-wrenmere-lake-b.mp3': 208.824,
  'audio/snowbound-compartment-a.mp3': 179.904,
  'audio/the-high-pass-a.mp3': 188.424,
};
const runs = buildMusicRuns(tl, plan, m.legs);
const vol = { music: 0.8, amb: 0.7 };
let fail = 0;
function check(name, cond, extra) {
  if (!cond) { fail++; console.log('FAIL', name, extra || ''); }
  else console.log('ok  ', name, extra || '');
}

const sprint1 = tl.segs.find(s => s.type === 'sprint' && s.n === 1);
const br1 = tl.segs.find(s => s.type === 'break' && s.n === 1);
const sprint2 = tl.segs.find(s => s.type === 'sprint' && s.n === 2);
console.log('intro', INTRO_SEC, 's1', sprint1.start, sprint1.end, 'br1', br1.start, br1.end, 's2', sprint2.start);

const a0 = musicAt(10, runs, durs);
check('t=10 Letters A first play', a0.primary?.title === 'Letters by Lamplight' && a0.primary.k === 0 && Math.abs(a0.primary.offset - 10) < 1e-6 && a0.primary.gain > 0.99, a0.primary);

const join = 134.52;
const midFadeOut = join - 4; // 4s into the 8s fade-out of play 0
const mfo = musicAt(midFadeOut, runs, durs);
check('in first fade-out, still A k=0, gain mid', mfo.primary?.k === 0 && mfo.primary.gain > 0.2 && mfo.primary.gain < 0.9, mfo.primary && { g: mfo.primary.gain, off: mfo.primary.offset, n: mfo.voices.length });

const overlapT = join - 0.5; // last 0.5s of play 0 + play 1 fade-in
const ov = musicAt(overlapT, runs, durs);
check('at overlap: two A voices', ov.voices.length === 2 && ov.voices[0].k === 0 && ov.voices[1].k === 1, ov.voices.map(v => ({ k: v.k, off: +v.offset.toFixed(3), g: +v.gain.toFixed(3) })));

const after = join + 1; // play 0 ended, play 1 at offset 1.5+1=2.5? play 1 starts at join-1.5, so offset = 1 - (-1.5 wait)
// start_1 = 0 + 1*(134.52-1.5) = 133.02, offset at t=135.52 = 2.5, still in 6s fade-in
const af = musicAt(join + 1, runs, durs);
check('just after join: A k=1 offset ~2.5, still fading in', af.primary?.k === 1 && Math.abs(af.primary.offset - 2.5) < 1e-3 && af.primary.gain < 1 && af.primary.gain > 0.3, af.primary && { off: af.primary.offset, g: af.primary.gain, n: af.voices.length });

const bpre = busAt(br1.start - 4, tl, vol);
const bat = busAt(br1.start, tl, vol);
const bmid = busAt((br1.start + br1.end) / 2, tl, vol);
check('4s before break, music fading (not full, not 0)', bpre.m > 0.05 && bpre.m < 0.75, bpre);
check('at break start, music down', bmid.m === 0 || Math.abs(bat.m) < 1e-4, { bat, bmid });
check('mid break, music stays 0, amb up', Math.abs(bmid.m) < 1e-4 && bmid.a > 0.6, bmid);

const s2 = musicAt(sprint2.start + 10, runs, durs);
check('sprint 2 +10s is Rain A offset 10', s2.primary?.title === 'Rain over Wrenmere Lake' && Math.abs(s2.primary.offset - 10) < 1e-6 && s2.primary.k === 0, s2.primary);
const bin = busAt(sprint2.start + 1, tl, vol);
const bfull = busAt(sprint2.start + 8, tl, vol);
check('1s into sprint 2, music fading in', bin.m > 0.05 && bin.m < 0.7, bin);
check('8s into sprint 2, music full', Math.abs(bfull.m - 0.8) < 1e-3, bfull);

check('sprint 2 is a new run (leg change)', s2.run.song.legId === 'lake' && s2.run.audioStart === sprint2.start, s2.run);

const eight = buildTimeline({ ...DEFAULT_SETTINGS, sprintMin: 25, breakMin: 5, sprints: 8, intro: true, outro: true });
const plan8 = planJourney(eight, m);
const runs8 = buildMusicRuns(eight, plan8, m.legs);
const sp2 = eight.segs.find(s => s.type === 'sprint' && s.n === 2);
const m8 = musicAt(sp2.start + 3, runs8, durs);
check('8-sprint session: sprint 2 is Letters B (same city leg)', m8.primary?.title === 'Letters by Lamplight (II)', m8.primary);

if (fail) { console.log(fail, 'FAILED'); process.exit(1); }
console.log('all sync tests passed');
