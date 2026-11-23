import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTimeline, DEFAULT_SETTINGS } from '../js/engine.js';
import { planJourney } from '../js/journey.js';
import { passageCueTime, passageTime } from '../js/voyage-clock.js';

const theme=JSON.parse(readFileSync(new URL('../themes/pirate-voyage/manifest.json',import.meta.url)));
for (const sprints of [1,2,4,6,12]) {
  const timeline=buildTimeline({...DEFAULT_SETTINGS,sprints});
  const plan=planJourney(timeline,theme);
  for (const [leg,passage] of theme.legs.entries()) {
    for (const fraction of [0,.5,1,...(passage.cues||[]).map(cue=>cue.at)]) {
      const time=passageCueTime(plan,leg,fraction);
      assert.ok(Number.isFinite(time));
      assert.ok(Math.abs(passageTime(plan,leg,time)-fraction*1500)<.001);
    }
    for (const stop of plan.stops) {
      assert.ok(Math.abs(passageTime(plan,leg,stop.start)-passageTime(plan,leg,stop.end))<.001);
    }
  }
  if (sprints===4) {
    assert.equal(timeline.total,7200);
    assert.equal(plan.items.at(-1).station,4);
    assert.equal(timeline.segs.filter(s=>s.type==='break').length,3);
  }
}
console.log('Voyage clock, cue positions, and docked intervals passed.');
