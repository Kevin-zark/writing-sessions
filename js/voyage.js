const BASE = new URL('../themes/pirate-voyage/', import.meta.url);
export const voyageSeconds = 104;
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
    return t => {
      const w=surface.width, h=surface.height;
      ctx.drawImage(image,0,0,w,h);
      const age=t%6, other=(t+3)%6, focus=.61*w;
      for (const [seconds,opacity] of [[other,1],[age,1-Math.abs(age-3)/3]]) {
        ctx.globalAlpha=opacity;
        for (let y=h/2; y<h; y+=3) {
          const d=(2*y-h)/h, range=3.7/Math.max(.014,d);
          const ratio=range/(range+1.7*seconds);
          const swell=Math.sin(.63*(range+t*1.7)-.81*t);
          const sourceY=(.5+(y/h-.5+d*.018*swell)*ratio)*image.height;
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
    varying vec2 uv; uniform sampler2D sea; uniform float time;
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
      vec2 world=vec2((q.x-.61)*range*2.6,range+time*1.7);
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
      float age=mod(time,6.);
      float other=mod(time+3.,6.);
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
  return t => { gl.uniform1f(clock,t); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); return surface; };
}

export async function voyageScene(canvas) {
  const [sea, harbor, merchant, foredeck, foam] = await Promise.all(['sea','harbor','merchant','foredeck','wash'].map(async name => {
    const img = new Image(); img.src = new URL(name+'.webp',BASE); await img.decode(); return img;
  }));
  canvas.width=1280; canvas.height=720;
  const c=canvas.getContext('2d',{alpha:false});
  const water=waterSurface(sea);
  function vessel(img,x,y,width,roll,reflection) {
    const h=width*img.height/img.width;
    c.save(); c.translate(x,y); c.rotate(roll);
    if (reflection) {
      c.save(); c.scale(1,-.13); c.globalAlpha=.14;
      c.drawImage(img,0,-h,width,h); c.restore();
    }
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

  function bowWash(t,open) {
    // Each patch is shed at the stem and widens down the port side as it falls aft.
    for (let i=0;i<76;i++) {
      const age=(t*.23+i*.618034)%1;
      const spread=Math.sin(i*78.53);
      const y=451+266*age*age;
      const x=795-1040*age*age+(22+78*age)*spread;
      const w=(24+118*age)*(1+.22*Math.sin(i*4.12));
      c.globalAlpha=(.16+.30*open)*Math.sin(Math.PI*age)**.65;
      c.drawImage(foam,x-w/2,y,w,w*(.09+.12*age));
    }
    c.globalAlpha=1;
  }

  return t => {
    const route=t/2;
    const open=ease((route-5)/21);
    const swell=Math.sin(t*.68+.16*Math.sin(t*.23));
    const cross=Math.sin(t*.47+1.1);
    const roll=(.30+.70*open)*(.019*swell+.009*cross+.0018*Math.sin(t*1.7));
    const lift=(.35+.65*open)*(6*Math.sin(t*.68-.8)+3*cross);
    const lean=3*Math.sin(t*.68-.5)+1.8*cross;
    c.save(); c.translate(640,354+lift); c.rotate(roll); c.translate(-640,-354);
    const surface=water(t);
    c.drawImage(surface,-52,-30,1384,780);
    const travel=1.7*t;
    // Kilometres beyond the quay, the distant ridge barely changes bearing.
    c.drawImage(land,-1520-travel*.22,281,2400,80);
    waterfront(travel);
    // Opposing course. The merchant rises on a different swell from our deck.
    const x=1480-(route-14)*53;
    const proximity=Math.exp(-Math.pow((x-485)/820,2));
    const w=245+190*proximity;
    const bob = 374 + 30*proximity + 3.4*Math.sin(t*.72+2);
    const heel = .012*Math.sin(t*.62+.8);
    vessel(merchant,x,bob-w*.5*heel,w,heel,true);
    // Waves cross in front of the hull. Their crest follows the waterline
    // as the vessel heels, and a short broken wake trails from the stern.
    if (x < 1332 && x+w*1.5 > -52) {
      c.save(); c.beginPath();
      for (let i=0;i<=64;i++) {
        const u=i/64, px=x+w*u;
        const py=bob+(u-.5)*w*heel-2.1+1.6*Math.sin(px*.074+t*2.2)+.8*Math.sin(px*.135-t*1.72);
        if (i===0) c.moveTo(px,py); else c.lineTo(px,py);
      }
      c.lineTo(x+w,bob+16); c.lineTo(x,bob+16); c.closePath(); c.clip();
      c.drawImage(surface,-52,-30,1384,780); c.restore();
      c.lineWidth=.9;
      for (let i=0;i<65;i++) {
        const u=(i/65+t*.35)%1, spread=Math.sin(i*61.27);
        const px=x+w*(.91+u*.28), py=bob+w*.41*heel+u*(1+spread*3)+Math.sin(i+t);
        c.strokeStyle='rgba(202,215,210,'+(.24*(1-u))+')';
        c.beginPath(); c.moveTo(px,py); c.lineTo(px+2+u*3,py+.3); c.stroke();
      }
    }
    c.restore();
    c.save();
    c.translate(lean*.45, lift*.18);
    bowWash(t,open);
    c.drawImage(foredeck,-7,-5,1294,730);
    c.restore();
    c.strokeStyle='rgba(194,207,212,.14)'; c.lineWidth=.8; c.beginPath();
    for (let i=0;i<83;i++) {
      const x=(i*317.63-t*(61+i%7)+12800)%1300;
      const y=(i*191.71+t*(270+i%53))%742-12;
      c.moveTo(x,y); c.lineTo(x-2.2,y+8+i%6);
    }
    c.stroke();
  };
}

