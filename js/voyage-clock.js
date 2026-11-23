// The four passages retain their bearings when sprint lengths change or an
// additional break interrupts a leg. Station dwell does not advance distance.
export function passageTime(plan, leg, time) {
  let length=0, sailed=0;
  for (const span of plan.legSpans) {
    if (span.leg!==leg) continue;
    const duration=span.end-span.start;
    length+=duration;
    sailed+=Math.max(0,Math.min(duration,time-span.start));
  }
  return 1500*sailed/Math.max(.001,length);
}

export function passageCueTime(plan, leg, fraction) {
  const spans=plan.legSpans.filter(s=>s.leg===leg);
  let distance=fraction*spans.reduce((sum,s)=>sum+s.end-s.start,0);
  for (const span of spans) {
    if (distance<=span.end-span.start) return span.start+distance;
    distance-=span.end-span.start;
  }
  return spans.at(-1)?.end;
}
