import { prepareRain } from './voyage-rain.js';
import { prepareFlags, prepareSails, prepareTelltale, voyageWind } from './voyage-flags.js';
const BASE = new URL('../themes/pirate-voyage/', import.meta.url);
export const voyageSeconds = 104; // Standalone Ravensgate departure excerpt
const legSeconds=1500;
const ports=['port','haven','post','beach'];
const between=(x,a,b)=>ease((x-a)/(b-a));
const arc=(x,a,b,c,d)=>between(x,a,b)*(1-between(x,c,d));
const clamp = x => Math.max(0, Math.min(1, x));
function ease(x) { x = clamp(x); return x * x * (3 - 2 * x); }

// Advect a photographic water surface in perspective. Displacement vanishes
// at the horizon, with independent cross swells and shorter wind-driven chop.
function waterSurface(image) {
  const surface = document.createElement('canvas');
  surface.width = 1280; surface.height = 720;
  const gl = surface.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) {
    const ctx=surface.getContext('2d');
    return (t,distance,shelter) => {
      const w=surface.width, h=surface.height;
      ctx.drawImage(image,0,0,w,h);
      const age=distance%6, other=(distance+3)%6, focus=.61*w;
      for (const [seconds,opacity] of [[other,1],[age,1-Math.abs(age-3)/3]]) {
        ctx.globalAlpha=opacity;
        for (let y=h/2; y<h; y+=3) {
          const d=(2*y-h)/h, range=3.7/Math.max(.014,d);
          const ratio=range/(range+1.7*seconds);
          const swell=Math.sin(.63*(range+distance*1.7)-.81*t);
          const basin=1-.70*shelter;
          const sourceY=(.5+(y/h-.5+d*.018*swell*basin)*ratio*basin)*image.height;
          ctx.drawImage(image,focus/w*(1-ratio)*image.width,Math.min(image.height-4,sourceY),
            image.width*ratio,4,0,y,w,3.1);
        }
      }
      ctx.globalAlpha=1;
      return surface;
    };
  }
  function shader(type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `precision highp float;
    varying vec2 uv; uniform sampler2D sea; uniform float time; uniform float distanceClock; uniform float shelter; uniform float rainfall;
    // Reproject from a recent point along the track. Two overlapping
    // reference times keep photographic wave detail streaming past indefinitely.
    vec3 underway(vec2 q,float range,float age){
      float ratio=range/(range+age*1.7);
      vec2 focus=vec2(.61,.5);
      return texture2D(sea,focus+(q-focus)*ratio).rgb;
    }
    void main(){
      vec2 q=uv;
      float d=clamp((q.y-.50)*2.,0.,1.);
      // Intersect the sightline with the sea plane. A metre of swell
      // occupies many pixels by the rail and a fraction of one at the horizon.
      float range=3.7/max(.014,d);
      vec2 world=vec2((q.x-.61)*range*2.6,range+distanceClock*1.7);
      vec2 k1=vec2(.39,.63), k2=vec2(-.78,.46), k3=vec2(1.72,.94);
      float longWave=dot(world,k1)-time*.81;
      float crossWave=dot(world,k2)-time*1.08;
      float ripple=dot(world,k3)-time*1.62;
      float amplitude=smoothstep(.012,.13,d);
      float height=.29*sin(longWave)+.13*sin(crossWave)+.045*sin(ripple);
      vec2 slope=.29*k1*cos(longWave)+.13*k2*cos(crossWave)+.045*k3*cos(ripple);
      q.y+=amplitude*d*height*.069;
      q.x+=d*.009*slope.x;
      q.x=1.-abs(mod(q.x,2.)-1.);
      float age=mod(distanceClock,6.);
      float other=mod(distanceClock+3.,6.);
      vec3 traveling=mix(underway(q,range,other),underway(q,range,age),1.-abs(age-3.)/3.);
      vec3 col=mix(texture2D(sea,q).rgb,traveling,smoothstep(.005,.05,d));
      // Foam flecks on the water have fixed world coordinates. Nearby flecks
      // expand out from the heading and run aft as the camera overtakes them.
      vec2 seaPatch=world*vec2(.059,.105)+vec2(.12*slope.y,.08*slope.x);
      vec2 folded=1.-abs(mod(seaPatch,2.)-1.);
      vec3 grain=texture2D(sea,vec2(.09+.78*folded.x,.75+.22*folded.y)).rgb;
      float nearWater=smoothstep(.07,.49,d);
      col=mix(col,grain,.33*nearWater);
      col+=vec3(.24,.27,.27)*smoothstep(.38,.66,grain.g)*nearWater;
      float facing=dot(slope,vec2(-.45,.84));
      col*=1.+amplitude*(.10*facing+.035*height);
      col+=vec3(.030,.036,.039)*amplitude*smoothstep(.045,.32,facing);
      if (shelter>0. && d>0.) {
        // Inside the headlands, short ripples disturb a quieter reflection.
        // Sample the fine-grained sea below the horizon rather than scaling
        // the offshore whitecaps down in place.
        float inlet=sin(world.x*1.13+world.y*.77-time*1.42);
        float rebound=sin(world.y*1.46-world.x*.64+time*.94);
        vec2 stillUV=vec2(uv.x+.0023*d*inlet,.5+d*(.135+.004*rebound));
        vec3 calm=texture2D(sea,stillUV).rgb;
        calm*=1.+.055*d*(inlet+.48*rebound);
        col=mix(col,calm,shelter*smoothstep(.0,.018,d));
      }
      // Resolve impacts only on the nearby surface. Each cell has its own
      // onset, centre and lifetime; a passing ring briefly tilts reflected light.
      if (rainfall>0. && d>.12) {
        vec2 patch=world*2.35;
        vec2 cell=floor(patch);
        float seed=fract(sin(dot(cell,vec2(41.27,83.13)))*1647.31);
        float tick=time*1.56+seed*11.;
        float hit=fract(sin(dot(cell,vec2(17.11,59.43))+floor(tick))*1853.73);
        vec2 center=.30+.4*fract(vec2(seed*17.+hit*3.,hit*11.));
        float age=fract(tick);
        float edge=length(fract(patch)-center)-(.015+.30*age);
        float crest=exp(-edge*edge*580.)*(1.-age)*(1.-age);
        float wet=smoothstep(.12,.40,d)*smoothstep(hit,hit+.12,rainfall);
        col+=wet*crest*vec3(.095,.106,.11);
      }
      gl_FragColor=vec4(col,1.);

    }`));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const param of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);
  for (const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
  const clock=gl.getUniformLocation(program,'time');
  const distanceClock=gl.getUniformLocation(program,'distanceClock');
  const shelterUniform=gl.getUniformLocation(program,'shelter');
  const rainUniform=gl.getUniformLocation(program,'rainfall');
  const render=(t,distance,shelter,rain)=>{ gl.uniform1f(rainUniform,rain); gl.uniform1f(shelterUniform,shelter); gl.uniform1f(clock,t); gl.uniform1f(distanceClock,distance); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); return surface; };
  render.dispose=()=>gl.getExtension('WEBGL_lose_context')?.loseContext();
  return render;
}

export async function voyageScene(canvas, base=BASE) {
  const names=['sea','harbor','merchant','foredeck','wash','navy','sunny','port','isles','pirate','storm','haven','post','beach','map','maelstrom','sign','sunset','tender'];
  const art=Object.fromEntries(await Promise.all(names.map(async name=>{
    const img=new Image(); img.src=new URL(name+'.webp',base); await img.decode(); return [name,img];
  })));
  const {sea,harbor,merchant,foredeck,wash:foam,navy,sunny}=art;
  const flags=prepareFlags(art), telltale=prepareTelltale();
  const rainfall=prepareRain();
  let wind=0, windTime=0;
  canvas.width=1280; canvas.height=720;
  const c=canvas.getContext('2d',{alpha:false});
  const water=waterSurface(sea), warmWater=waterSurface(sunny), tempest=waterSurface(art.storm), eveningSea=waterSurface(art.sunset);
  function lightDeck(filter) {
    const plate=document.createElement('canvas');
    plate.width=1280; plate.height=720;
    const g=plate.getContext('2d'); g.filter=filter;
    g.drawImage(foredeck,0,0,plate.width,plate.height); return plate;
  }
  const sunDeck=lightDeck('sepia(.22) saturate(1.24) brightness(1.18)');
  const duskDeck=lightDeck('sepia(.35) saturate(1.3) brightness(.90)');
  const wetDeck=lightDeck('saturate(.72) brightness(.69) contrast(1.12)');
  const decks=new Map([foredeck,sunDeck,duskDeck,wetDeck].map(image=>{
    const plate=document.createElement('canvas');
    plate.width=image.width; plate.height=image.height;
    const ctx=plate.getContext('2d'); ctx.drawImage(image,0,0);
    const sails=prepareSails(image,'deck');
    return [image,()=>{ sails(ctx,wind,windTime); return plate; }];
  }));
  const ocean=document.createElement('canvas');
  ocean.width=1280; ocean.height=720;
  const oceanCtx=ocean.getContext('2d');
  function blendSea(t, distance, warm, storm, evening, shelter, rain) {
    if (evening>0) {
      if (evening>=1) return eveningSea(t,distance,shelter,rain);
      oceanCtx.drawImage(warmWater(t,distance,shelter,rain),0,0);
      oceanCtx.globalAlpha=evening; oceanCtx.drawImage(eveningSea(t,distance,shelter,rain),0,0); oceanCtx.globalAlpha=1;
      return ocean;
    }
    if (storm>0) {
      if (storm>=1) return tempest(t,distance,shelter,rain);
      oceanCtx.drawImage(warmWater(t,distance,shelter,rain),0,0);
      oceanCtx.globalAlpha=storm; oceanCtx.drawImage(tempest(t,distance,shelter,rain),0,0); oceanCtx.globalAlpha=1;
      return ocean;
    }
    if (warm<=0) return water(t,distance,shelter,rain);
    if (warm>=1) return warmWater(t,distance,shelter,rain);
    oceanCtx.drawImage(water(t,distance,shelter,rain),0,0);
    oceanCtx.globalAlpha=warm; oceanCtx.drawImage(warmWater(t,distance,shelter,rain),0,0); oceanCtx.globalAlpha=1;
    return ocean;
  }

  // Project the same metres for eye height, shoreline, outlying rocks and boats.
  // Sway is a translation of the observer, so its effect falls off with distance.
  let eyeX=0, eyeHeight=3.8;
  const focal=785, horizon=359;
  function project(x,z,height=0) {
    const scale=focal/z;
    return {x:630+(x-eyeX)*scale, y:horizon+(eyeHeight-height)*scale, scale};
  }

  function reflected(img,x,y,w,t,opacity) {
    const h=w*img.height/img.width;
    c.save();
    const alpha=c.globalAlpha;
    for (let row=0;row<15;row++) {
      const d=row/15;
      c.globalAlpha=alpha*opacity*(1-d)**1.5*(.72+.28*Math.cos(t*1.6-row));
      const shift=d*(3.2*Math.sin(t*1.2-row*.83)+2*Math.sin(row*.44-t*.9));
      c.drawImage(img,0,img.height*(14-row)/15,img.width,img.height/15,
        x+shift,y+d*h*.27,w,Math.max(1,h*.27/15));
    }
    c.restore();
  }

  // The port photograph looks obliquely down a quay. Register its visible
  // waterline before projecting, so the distant end meets the sea as well.
  const count=64;
  const mask=document.createElement('canvas');
  mask.width=count; mask.height=128;
  const maskCtx=mask.getContext('2d');
  maskCtx.drawImage(art.port,0,0,count,128);
  const alpha=maskCtx.getImageData(0,0,count,128).data;
  const portBase=Array.from({length:count},(_,i)=>{
    let row=127;
    while (row>0 && alpha[4*(row*count+i)+3]<90) row--;
    return (row+1)/128;
  });
  // A transparent strip of broken foam. Each strand shares the crest's travel
  // while gaps in the lace expose the photographic shallows underneath.
  const swash=document.createElement('canvas');
  swash.width=768; swash.height=48;
  const lace=swash.getContext('2d');
  for(let strand=0;strand<23;strand++) {
    lace.beginPath();
    for(let x=0;x<=768;x+=2) {
      const crest=10+3*Math.sin(x*.019)+2*Math.sin(x*.093+.8);
      const y=crest+strand*.88+Math.sin(x*.037+strand*.61)*(1+strand*.21)
        +1.4*Math.sin(x*.13+strand*.67);
      if(x===0 || (strand>4 && Math.sin(x*.046+strand*1.8)<-.35)) lace.moveTo(x,y);
      else lace.lineTo(x,y);
    }
    lace.strokeStyle='rgba(251,238,217,'+(.54/(1+strand*.095))+')';
    lace.lineWidth=strand<5 ? 2.3 : 1.25; lace.stroke();
  }
  const berths={
    port:{ridge:-94, skew:20, tender:1.5},
    haven:{ridge:78, skew:-24, tender:16},
    post:{ridge:-62, skew:14, tender:-17},
    beach:{ridge:104, skew:-17}
  };
  function landfall(name, approach, t) {
    if (approach<=0) return;
    const img=flags(art[name],wind,windTime), berth=berths[name];
    const range=67+920*(1-approach)**1.4;
    // Follow the channel on a shallow diagonal. Nearby moorings change bearing
    // against town, while the high ground lies another half kilometre inland.
    const center=-9+38*(1-approach);
    const ridge=project(center+berth.ridge,range+525);
    const ridgeWidth=555*ridge.scale;
    c.save(); c.globalAlpha=ease(approach*6)*.64;
    vessel(art.isles,ridge.x-ridgeWidth/2,ridge.y,ridgeWidth,0);
    c.globalAlpha=ease(approach*6);
    function shorePoint(u) {
      const bend=berth.skew*(u-.5)+6*Math.cos(u*Math.PI*2+.5);
      return project(center+(u-.5)*110,range+bend);
    }
    let left=shorePoint(0);
    const height=110*img.height/img.width;
    for (let i=0;i<count;i++) {
      const right=shorePoint((i+1)/count);
      const h=height*(left.scale+right.scale)/2;
      const width=right.x-left.x+.35;
      if (width>0 && right.x>0 && left.x<1280) {
        const sx=i*img.width/count, sw=img.width/count;
        const foot=name==='port' ? portBase[i] : 1;
        const top=left.y-h*(name==='port' ? .70 : 1);
        c.drawImage(img,sx,0,sw,img.height,left.x,top,width,h);
        // The lower quay and trees cast a broken reflection at the local waterline.
        c.save(); c.globalAlpha*=.17;
        c.translate(left.x,top+h*foot); c.scale(1,-.25);
        c.drawImage(img,sx,img.height*(foot-.4),sw,img.height*.4,0,-h*.4,width,h*.4);
        c.restore();
      }
      left=right;
    }
    // Breaker crests progress landward across a gently curving beach.
    // On a hard quay, only scattered small patches slap against the masonry.
    const beach=name==='beach', rocky=name==='post';
    if (beach) {
      for(let wave=0;wave<3;wave++) {
        for(let i=0;i<count;i++) {
          const u=(i+.5)/count, pt=shorePoint(u);
          const left=shorePoint(i/count), right=shorePoint((i+1)/count);
          const phase=(t/8.6+wave/3+.028*Math.sin(u*12+t*.16)+.09*u)%1;
          const breaking=between(phase,.13,.48)*(1-between(phase,.72,1));
          const width=right.x-left.x;
          if(width<=0 || right.x<0 || left.x>1280 || !breaking) continue;
          const reach=5.8*(1-phase)**1.55-.37*between(phase,.69,1);
          const y=pt.y+reach*pt.scale;
          const h=pt.scale*(.46+.53*between(phase,.42,.88));
          c.globalAlpha=ease(approach*4)*breaking*(.61+.18*Math.sin(14*u+wave*2));
          c.drawImage(swash,i*swash.width/count,0,swash.width/count,48,
            left.x,y-h*.34,width+.45,h);
        }
      }
    } else {
      for (let i=0;i<18;i++) {
        const u=(i+.5)/18, pt=shorePoint(u);
        const foot=name==='port' ? portBase[Math.floor(u*count)]-.70 : 0;
        const phase=(t/4.3+.21*Math.sin(u*13)+.32*Math.sin(i*4.1))%1;
        const y=pt.y+foot*height*pt.scale+(1-phase)**1.7*pt.scale*(rocky?.57:.32);
        const width=pt.scale*1.8*(1+.23*Math.sin(i*3.1));
        c.globalAlpha=ease(approach*4)*Math.sin(Math.PI*phase)**2*.24;
        c.drawImage(foam,pt.x-width*.5,y,width,Math.max(.65,width*.12));
      }
    }
    c.globalAlpha=ease(approach*6);
    if (berth.tender!==undefined) {
      const boat=project(berth.tender+.32*Math.sin(t*.14),range-32);
      const w=5.4*boat.scale, bob=.09*boat.scale*Math.sin(t*.72+.8);
      reflected(art.tender,boat.x-w/2,boat.y+bob,w,t,.27);
      vessel(art.tender,boat.x-w/2,boat.y+bob,w,.016*Math.sin(t*.49));
    }
    if (name==='beach') {
      const peg=project(center+3,range-12), h=9.5*peg.scale;
      const w=h*art.sign.width/art.sign.height;
      c.drawImage(art.sign,peg.x-w/2,peg.y-h,w,h);
    }
    c.restore();
  }
  function vessel(img,x,y,width,roll) {
    const h=width*img.height/img.width;
    c.save(); c.translate(x,y); c.rotate(roll);
    c.drawImage(img,0,-h,width,h); c.restore();
  }
  // A misted headland beyond the port provides a distant reference as the
  // waterfront slips astern. Render the ridge once at its native depth.
  const land = document.createElement('canvas');
  land.width=2400; land.height=80;
  const coast=land.getContext('2d');
  coast.beginPath(); coast.moveTo(0,80);
  for (let x=0;x<=2400;x+=3) {
    const envelope=1-ease((x-1650)/750);
    const shape=29+11*Math.sin(x*.003)+6*Math.sin(x*.009)+2*Math.sin(x*.043);
    coast.lineTo(x,80-envelope*shape);
  }
  coast.lineTo(2400,80); coast.closePath();
  const haze=coast.createLinearGradient(0,25,0,80);
  haze.addColorStop(0,'rgba(94,113,120,.58)'); haze.addColorStop(1,'rgba(132,144,146,.49)');
  coast.fillStyle=haze; coast.fill();

  function waterfront(travel) {
    // The quay runs obliquely down the port edge of the channel. Project each
    // bay from its fixed position in metres; the lighthouse is at the outer end.
    const columns=144, focal=790, eye=3.8, horizon=359;
    const project=u=>{
      const z=33+77*u-travel;
      return { z, x:780+focal*(-66+42*u)/z, scale:focal/z };
    };
    for (let i=0;i<columns;i++) {
      const a=project(i/columns), b=project((i+1)/columns);
      if (a.z<1 || b.z<1 || b.x < -60 || a.x>1332) continue;
      const scale=(a.scale+b.scale)/2;
      const h=13.8*scale, bottom=horizon+eye*scale;
      c.drawImage(harbor,i*harbor.width/columns,0,harbor.width/columns,harbor.height,
        a.x,bottom-h,b.x-a.x+.6,h);
    }
  }

  function bowWash(t,open,underwayWash) {
    // Each patch is shed at the stem and widens down the port side as it falls aft.
    for (let i=0;i<76;i++) {
      const age=(t*.23+i*.618034)%1;
      const spread=Math.sin(i*78.53);
      const y=451+266*age*age;
      const x=795-1040*age*age+(22+78*age)*spread;
      const w=(24+118*age)*(1+.22*Math.sin(i*4.12));
      c.globalAlpha=underwayWash*(.16+.30*open)*Math.sin(Math.PI*age)**.65;
      c.drawImage(foam,x-w/2,y,w,w*(.09+.12*age));
    }
    c.globalAlpha=1;
  }

  function passShip(image,x,w,proximity,t,surface,forward=false) {
    if (x>1340 || x+w*1.5 < -52) return;
    image=flags(image,wind,windTime);
    const bob = 374 + 30*proximity + 3.4*Math.sin(t*.72+2);
    const heel = .012*Math.sin(t*.62+.8);
    // Project stations along the keel at their respective ranges. The ends
    // foreshorten on different bearings as the ship crosses our heading.
    const bearing=Math.atan2(x+w*.5-630,785);
    const yaw=(forward ? -.24 : .24)+bearing*.54;
    const length=w*Math.cos(yaw), h=w*image.height/image.width;
    x+=(w-length)/2;
    w=length;
    reflected(image,x,bob,w,t,.26);
    c.save(); c.translate(x+w*.5,bob); c.rotate(heel);
    let lastX=-w*.5;
    const pitch=.012*Math.sin(t*.48+1.4);
    for (let i=0;i<40;i++) {
      const u=(i+1)/40, inv=1/(1+(u-.5)*Math.sin(yaw)*w/785);
      const next=(u-.5)*w*inv;
      if (i===0) lastX=-.5*w/(1-.5*Math.sin(yaw)*w/785);
      const mid=(i+.5)/40-.5;
      const scale=1/(1+mid*Math.sin(yaw)*w/785);
      const base=(bob-horizon)*(scale-1)+mid*w*pitch;
      c.drawImage(image,i*image.width/40,0,image.width/40,image.height,
        lastX,base-h*scale+h*.063,next-lastX+.32,h*scale);
      lastX=next;
    }
    c.restore();
    // Waves cross in front of the hull. Their crest follows the waterline
    // as the vessel heels, and a short broken wake trails from the stern.
    if (x < 1332 && x+w*1.5 > -52) {
      c.save(); c.beginPath();
      for (let i=0;i<=64;i++) {
        const u=i/64, px=x+w*u;
        const py=bob+(u-.5)*w*(heel+pitch-(bob-horizon)*Math.sin(yaw)/785)-2.1+1.6*Math.sin(px*.074+t*2.2)+.8*Math.sin(px*.135-t*1.72);
        if (i===0) c.moveTo(px,py); else c.lineTo(px,py);
      }
      c.lineTo(x+w,bob+64); c.lineTo(x,bob+64); c.closePath(); c.clip();
      c.drawImage(surface,-52,-30,1384,780); c.restore();
      c.lineWidth=.9;
      for (let i=0;i<65;i++) {
        const u=(i/65+t*.35)%1, spread=Math.sin(i*61.27);
        const px=x+w*(forward ? .09-u*.28 : .91+u*.28), py=bob+w*.41*heel+u*(1+spread*3)+Math.sin(i+t);
        c.strokeStyle='rgba(202,215,210,'+(.24*(1-u))+')';
        c.beginPath(); c.moveTo(px,py); c.lineTo(px+2+u*3,py+.3); c.stroke();
      }
    }
  }

  // Separate rocky outcrops at natural breaks in the photographed coastline.
  const rockCuts=[[0,1078],[1078,1187],[1187,1328],[1328,1527],[1527,1627]].map(([a,b])=>{
    const cut=document.createElement('canvas');
    cut.width=b-a; cut.height=art.isles.height;
    cut.getContext('2d').drawImage(art.isles,a,0,b-a,cut.height,0,0,cut.width,cut.height);
    return cut;
  });
  function seaStacks(progress,a,b,t) {
    if (progress<=a || progress>=b) return;
    const u=(progress-a)/(b-a);
    const side=a>.5 ? -1 : 1;
    // A long headland lies well beyond the reef. Rock bases and reflections
    // rise from the same sea plane as the ships, even when the camera heaves.
    const ranges=[1160,490,390,240,185], spans=[910,19,27,29,11];
    const bearings=[.10,.34,.22,.28,.18];
    c.save();
    for (let i=0;i<rockCuts.length;i++) {
      const z=ranges[i]+620*(1-u);
      const point=project(side*(bearings[i]*ranges[i]+330-1120*u),z);
      const w=spans[i]*point.scale;
      c.globalAlpha=arc(u,0,.16,.88,1)*(i===0 ? .62 : .86);
      const left=point.x-w/2;
      reflected(rockCuts[i],left,point.y,w,t,.19);
      vessel(rockCuts[i],left,point.y,w,0);
    }
    c.restore();
  }

  const innerEye=document.createElement('canvas');
  innerEye.width=innerEye.height=512;
  const eye=innerEye.getContext('2d');
  eye.drawImage(art.maelstrom,0,0,512,512);
  eye.globalCompositeOperation='destination-in';
  const fade=eye.createRadialGradient(256,256,45,256,256,180);
  fade.addColorStop(0,'black');fade.addColorStop(1,'transparent');
  eye.fillStyle=fade;eye.fillRect(0,0,512,512);

  function whirlpool(p,t) {
    const strength=arc(p,.45,.53,.70,.80);
    if (!strength) return;
    const u=between(p,.45,.79);
    const x=675-900*u;
    const radius=105+345*Math.sin(Math.PI*u);
    const tilt=.10+.09*Math.sin(Math.PI*u);
    const y=370+radius*tilt+24*Math.sin(Math.PI*u);
    c.save(); c.translate(x,y); c.scale(1,tilt);
    c.rotate(-t*.078); c.globalAlpha=strength*.94;
    c.drawImage(art.maelstrom,-radius,-radius,2*radius,2*radius);
    // Faster inner water winds around the eye independently of the outer foam.
    c.rotate(-t*.10); c.globalAlpha=strength*.69;
    c.drawImage(innerEye,-radius,-radius,2*radius,2*radius); c.restore();
  }

  function pirateRun(p,t,surface,race,events) {
    const presence=race ? arc(p,.17,.34,.82,.93) : arc(p,.26,.39,.73,.85);
    if (!presence) return;
    const near=race ? between(p,.27,.68) : between(p,.30,.59);
    const w=(race ? 220 : 340)*near+42;
    const x=race ? 340+140*Math.sin(p*9)-620*between(p,.72,.92)
                 : 1050-850*between(p,.26,.66)-590*between(p,.68,.86);
    c.save(); c.globalAlpha=presence;
    passShip(art.pirate,x,w,near,t,surface,true);
    if (!race) for (const event of events) {
      const age=t-event;
      if (age<0 || age>14) continue;
      const y=374+30*near;
      for (let k=0;k<8;k++) {
        const delay=k*.085, dt=age-delay;
        if (dt<0) continue;
        const cx=x+w*(.29+k*.055)-dt*(2+k*.22), cy=y-w*.08-dt*(1+k*.25);
        const radius=3+Math.sqrt(dt)*(3.1+k*.31);
        if (dt<.17) { c.fillStyle='rgba(255,216,134,.9)'; c.fillRect(cx-3,cy-2,6,3); }
        const puff=c.createRadialGradient(cx,cy,0,cx,cy,radius);
        puff.addColorStop(0,'rgba(205,199,178,'+(.54*(1-dt/15))+')');
        puff.addColorStop(1,'rgba(169,168,157,0)'); c.fillStyle=puff;
        c.fillRect(cx-radius,cy-radius,2*radius,2*radius);
      }
    }
    c.restore();
  }

  const draw=(position,leg=0,t=position,atAnchor=false,events=[]) => {
    const route=position/2, progress=clamp(position/legSeconds);
    const warm=leg===0 ? between(progress,.40,.87) : 1;
    const storm=leg===2 ? arc(progress,.06,.32,.67,.92) : 0;
    const rain=leg===0 ? 1-between(progress,.40,.67) : storm;
    const underway=atAnchor ? 0 : arc(progress,0,.025,.90,1);
    windTime=t;
    wind=voyageWind(leg,warm,storm,underway,t);
    const open=underway*(1-.77*warm+2.1*storm);
    const swell=Math.sin(t*.68+.16*Math.sin(t*.23));
    const cross=Math.sin(t*.47+1.1);
    const roll=(.30+.70*open)*(.019*swell+.009*cross+.0018*Math.sin(t*1.7));
    const lift=(.35+.65*open)*(6*Math.sin(t*.68-.8)+3*cross);
    eyeX=.32*cross+.15*swell;
    eyeHeight=3.8+.15*swell;
    const lean=3*Math.sin(t*.68-.5)+1.8*cross;
    c.save(); c.translate(640,354+lift); c.rotate(roll); c.translate(-640,-354);
    const turn=leg===2 ? arc(progress,.46,.60,.70,.79) : 0;
    c.translate(26*turn,0); c.rotate(.012*turn);
    const evening=leg===3 ? between(progress,.37,.93) : 0;
    // Integrate a linear acceleration and braking ramp on each passage.
    const ramp=30;
    const speedIntegral=position<ramp ? position*position/(2*ramp)
      : position>legSeconds-ramp ? legSeconds-ramp-(legSeconds-position)**2/(2*ramp)
      : position-ramp/2;
    const distance=leg*(legSeconds-ramp)+speedIntegral;
    const departure=1-between(progress,0,leg===0 ? .054 : .15);
    const arrival=between(progress,leg===0 ? .64 : .76,1);
    const shelter=Math.max(departure*.91,arrival*(leg===3 ? .68 : .91));
    const surface=blendSea(t,distance,warm,storm,evening,shelter,rain);
    c.drawImage(surface,-52,-30,1384,780);
    const travel=1.7*speedIntegral;
    // Kilometres beyond the quay, the distant ridge barely changes bearing.
    if (leg===0) {
      c.globalAlpha=1-between(progress,.22,.52);
      c.drawImage(land,-1520-travel*.22,281,2400,80); c.globalAlpha=1;
      if (position<100) {
        waterfront(travel);
        const z=50-travel;
        if (z>5) {
          const boat=project(-15,z), w=4.8*boat.scale;
          const y=boat.y+.06*boat.scale*Math.sin(t*.82);
          reflected(art.tender,boat.x-w/2,y,w,t,.19);
          vessel(art.tender,boat.x-w/2,y,w,.018*Math.sin(t*.6));
        }
      }
    }
    rainfall.air(c,t,rain,storm);
    // Opposing course. The merchant rises on a different swell from our deck.
    const x=1480-(route-14)*53;
    const proximity=Math.exp(-Math.pow((x-485)/820,2));
    if (leg===0) {
      passShip(merchant,x,245+190*proximity,proximity,t,surface);
      const approach=ease((progress-.14)/.17);
      const navyX=910-455*approach-Math.max(0,progress-.31)*12400;
      const near=ease((progress-.16)/.17);
      if (progress>.14 && progress<.46) {
        c.globalAlpha=ease((progress-.14)/.025);
        passShip(navy,navyX,32+560*near,near,t+.9,surface);
        c.globalAlpha=1;
      }
      seaStacks(progress,.48,.78,t);
    } else {
      landfall(ports[leg-1],1-between(progress,0,.15),t);
      if (leg===1 || leg===3) pirateRun(progress,t,surface,leg===3,events);
      if (leg===2) whirlpool(progress,t);
      seaStacks(progress,.12,.41,t);
      seaStacks(progress,.57,.83,t);
    }
    landfall(ports[leg],arrival,t);
    rainfall.drops(c,t,rain,wind,storm,false);
    c.restore();
    c.save();
    c.translate(lean*.45, lift*.18);
    c.save();
    c.globalCompositeOperation='source-over';
    if (underway>.001) { bowWash(t,open,underway); }
    c.restore();
    if (warm<1) c.drawImage(decks.get(foredeck)(),-7,-5,1294,730);
    if (warm>0 && storm<1 && evening<1) { c.globalAlpha=warm; c.drawImage(decks.get(sunDeck)(),-7,-5,1294,730); }
    if (evening>0) { c.globalAlpha=evening; c.drawImage(decks.get(duskDeck)(),-7,-5,1294,730); }
    if (storm>0) { c.globalAlpha=storm; c.drawImage(decks.get(wetDeck)(),-7,-5,1294,730); }
    c.globalAlpha=1;
    telltale(c,wind,t);
    rainfall.drops(c,t,rain,wind,storm,true);
    const chart=leg===2 ? between(progress,.985,1) : leg===3 ? 1-between(progress,.02,.10) : 0;
    if (chart>0) {
      c.save(); c.globalAlpha=chart; c.translate(1020,655+(1-chart)*85); c.rotate(-.16);
      c.transform(1,0,-.27,.58,0,0); c.drawImage(art.map,-140,-80,280,175); c.restore();
    }
    c.restore();
  };
  draw.dispose=()=>[water,warmWater,tempest,eveningSea].forEach(render=>render.dispose?.());
  return draw;
}

