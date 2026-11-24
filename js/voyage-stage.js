import { voyageScene } from './voyage.js';
import { passageTime, passageCueTime } from './voyage-clock.js';
import { itemAt } from './journey.js';

export class VoyageStage {
  constructor(root,plan,base,getPos,legs) {
    this.events=legs.map((leg,i)=>(leg.cues||[]).map(cue=>passageCueTime(plan,i,cue.at)));
    this.plan=plan; this.getPos=getPos;
    this.playing=true;
    this.visibility=()=>{
      if(document.hidden) this.stopFrames();
      else if(this.draw && !this.closed) {
        this.paint(this.getPos());
        if(this.playing) this.resume();
      }
    };
    document.addEventListener('visibilitychange',this.visibility);
    this.canvas=document.createElement('canvas');
    this.canvas.className='voyage-canvas';
    this.canvas.setAttribute('aria-label','View along the port bow');
    root.appendChild(this.canvas);
    this.ready=voyageScene(this.canvas,new URL(base,document.baseURI)).then(draw=>{
      this.draw=draw;
      if (this.closed) draw.dispose?.();
      else {
        this.paint(this.getPos());
        if(this.playing) this.resume();
      }
    });
  }
  paint(pos) {
    if (!this.draw || this.closed) return;
    this.cur=itemAt(this.plan,pos);
    const it=this.plan.items[this.cur];
    if (!it) return;
    const docked=it.station!=null;
    const leg=docked ? Math.max(0,it.station-1) : it.leg;
    const course=docked ? (it.station===0 ? 0 : 1500) : passageTime(this.plan,leg,pos);
    this.draw(course,leg,pos,docked,this.events[leg]);
  }
  update(index,pos) {
    if (!this.draw) return this.ready;
    if (index!==this.cur) this.paint(pos);
  }
  jump(index,pos) { this.paint(pos); }
  stopFrames() { cancelAnimationFrame(this.raf); this.raf=0; }
  pause() { this.playing=false; this.stopFrames(); }
  resume() {
    this.playing=true;
    if (document.hidden || this.raf || this.closed || !this.draw) return;
    let previous=-Infinity;
    const tick=timestamp=>{
      if (timestamp-previous>=32) { this.paint(this.getPos()); previous=timestamp; }
      this.raf=requestAnimationFrame(tick);
    };
    this.raf=requestAnimationFrame(tick);
  }
  destroy() {
    this.closed=true; this.pause();
    document.removeEventListener('visibilitychange',this.visibility);
    this.draw?.dispose?.(); this.canvas.remove();
  }
}
