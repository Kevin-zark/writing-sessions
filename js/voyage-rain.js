// Rain is sampled from absolute time. Each seed describes a succession of
// short-lived drops, so seeking never needs to replay a particle simulation.
function noise(n) {
  let v=Math.imul(n^(n>>>16),0x45d9f3b);
  v=Math.imul(v^(v>>>16),0x45d9f3b);
  return ((v^(v>>>16))>>>0)/4294967296;
}

function sprite(width,height) {
  const image=document.createElement('canvas');
  image.width=width; image.height=height;
  return image;
}

export function prepareRain() {
  const streak=sprite(12,64);
  const g=streak.getContext('2d');
  g.scale(6,32);
  const soft=g.createRadialGradient(1,1,0,1,1,1);
  soft.addColorStop(0,'rgba(208,219,221,.85)');
  soft.addColorStop(.46,'rgba(194,207,213,.48)');
  soft.addColorStop(1,'rgba(181,195,201,0)');
  g.fillStyle=soft; g.fillRect(0,0,2,2);

  const mist=sprite(224,84), m=mist.getContext('2d');
  const pixels=m.createImageData(mist.width,mist.height);
  const field=(x,y,scale)=>{
    const a=Math.floor(x/scale), b=Math.floor(y/scale);
    const smooth=u=>u*u*(3-2*u);
    const u=smooth(x/scale-a), v=smooth(y/scale-b);
    const n=(i,j)=>noise((a+i)*311+(b+j)*7001+472);
    return (1-v)*(n(0,0)*(1-u)+n(1,0)*u)+v*(n(0,1)*(1-u)+n(1,1)*u);
  };
  for(let y=0;y<mist.height;y++) for(let x=0;x<mist.width;x++) {
    const i=(y*mist.width+x)*4;
    const grain=.72*field(x+y*.5,y*.7,27)+.28*field(x+y*.5,y*.55,9);
    const edge=Math.sin(Math.PI*x/mist.width)**1.6*Math.sin(Math.PI*y/mist.height)**1.2;
    pixels.data.set([151,166,172,Math.round(235*edge*grain)],i);
  }
  m.putImageData(pixels,0,0);

  const seeds=Array.from({length:330},(_,i)=>({
    id:i*19301, phase:noise(i+425), period:1.15+1.24*noise(i+932),
    speed:6.3+2.3*noise(i+1201)
  }));

  function air(c,t,amount,storm) {
    if(amount<=0) return;
    c.save();
    for(let i=0;i<3;i++) {
      const x=-490+i*512+115*Math.sin(t*.030+i*2.8);
      c.globalAlpha=amount*(.26+.31*storm);
      c.drawImage(mist,x,130-i*12,1040,315+i*12);
    }
    c.restore();
  }

  function drops(c,t,amount,wind,storm,deck) {
    if(amount<=0) return;
    c.save();
    const first=deck ? 305 : 0, end=deck ? seeds.length : 305;
    for(let i=first;i<end;i++) {
      const {id,phase,period,speed}=seeds[i];
      const cycle=t/period+phase, event=Math.floor(cycle);
      const k=id+event*73;
      const visibility=Math.min(1,Math.max(0,(amount*(.67+.33*storm)-noise(k+3))*8));
      if(!visibility) continue;
      const age=(cycle-event)*period;
      const fall=period-.23;
      const z=deck ? 3.5+noise(k+4)*3 : 5+70*noise(k+4)**1.65;
      const scale=785/z;
      const gust=wind*(.88+.12*Math.sin(t*.53+z*.035));
      const drift=.16+.52*gust;
      const vy=scale*speed, vx=-vy*drift;
      let x=-115+1510*noise(k+7), y=359+3.8*scale;
      if(deck) {
        // Land only on the unobstructed boards running aft from the bow.
        const aft=noise(k+11);
        y=477+239*aft;
        x=821-147*aft+(48+130*aft)*(noise(k+7)-.5);
      }
      if(age<fall) {
        const remaining=fall-age;
        x-=vx*remaining; y-=vy*remaining;
        if(x< -35 || x>1315 || y< -30 || y>750) continue;
        const length=vy*(.012+.009*noise(k+13));
        const width=(deck?1.9:.8)+scale*.008;
        c.save(); c.translate(x,y); c.transform(1,0,-drift,1,0,0);
        c.globalAlpha=visibility*(deck ? .27+.16*storm : .21+.13*storm)*(.62+.38*noise(k+17));
        c.drawImage(streak,-width*.5,-length,width,length); c.restore();
      } else {
        const u=(age-fall)/.23;
        const radius=scale*(.019+.067*u);
        c.globalAlpha=visibility*.28*(1-u)**1.5;
        c.strokeStyle='#cfdbdb'; c.lineWidth=Math.min(1,.35+scale*.003);
        c.beginPath();
        c.ellipse(x,y,radius,Math.max(.24,radius*(deck?.24:.14)),0,.15,Math.PI*1.75);
        c.stroke();
      }
    }
    c.restore();
  }
  return {air,drops};
}
