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
      for (let y=h/2; y<h; y+=3) {
        const d=(2*y-h)/h, range=3.7/Math.max(.014,d);
        const swell=Math.sin(.63*range-.81*t);
        const cross=Math.sin(.46*range-1.08*t);
        const sourceY=(y/h+d*(.29*swell+.13*cross)*.069)*image.height;
        const shift=d*(8*swell+4*cross);
        ctx.drawImage(image,0,Math.max(0,Math.min(image.height-5,sourceY)),image.width,4,
          -14+shift,y,w+28,3.1);
      }
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
    void main(){
      vec2 q=uv;
      float d=clamp((q.y-.50)*2.,0.,1.);
      // Intersect the sightline with the sea plane. A metre of swell
      // occupies many pixels by the rail and a fraction of one at the horizon.
      float range=3.7/max(.014,d);
      vec2 world=vec2((q.x-.5)*range*2.6+time*.34,range);
      vec2 k1=vec2(.39,.63), k2=vec2(-.78,.46), k3=vec2(1.72,.94);
      float longWave=dot(world,k1)-time*.81;
      float crossWave=dot(world,k2)-time*1.08;
      float ripple=dot(world,k3)-time*1.62;
      float amplitude=smoothstep(.012,.13,d);
      float height=.29*sin(longWave)+.13*sin(crossWave)+.045*sin(ripple);
      vec2 slope=.29*k1*cos(longWave)+.13*k2*cos(crossWave)+.045*k3*cos(ripple);
      q.y+=amplitude*d*height*.069;
      q.x+=d*(time*.0016+.009*slope.x);
      q.x=1.-abs(mod(q.x,2.)-1.);
      vec3 col=texture2D(sea,q).rgb;
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
  const [sea, harbor, merchant, rail, shrouds] = await Promise.all(['sea','harbor','merchant','rail','shrouds'].map(async name => {
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
    c.drawImage(land,-550-route*40,281,2400,80);
    const depart=clamp(route/31);
    const width=2030-380*depart;
    vessel(harbor,-360-50*route-0.43*route*route+lean*.3,379-13*depart,width,0,true);
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
    // The viewer is braced against the rail. All apparent roll belongs to the world.
    const rh=1290*rail.height/rail.width;
    c.drawImage(rail,-5+lean*.5,720-rh+18+lift*.12,1290,rh);
    // The shrouds hang closer to the viewer than the rail. A small body lean
    // changes the gap between them while the same horizon stays in view.
    const shroudHeight=754, shroudWidth=shroudHeight*shrouds.width/shrouds.height;
    c.drawImage(shrouds,1280-shroudWidth+24+lean*1.45,-12+lift*.28,shroudWidth,shroudHeight);
    c.strokeStyle='rgba(194,207,212,.14)'; c.lineWidth=.8; c.beginPath();
    for (let i=0;i<83;i++) {
      const x=(i*317.63-t*(61+i%7)+12800)%1300;
      const y=(i*191.71+t*(270+i%53))%742-12;
      c.moveTo(x,y); c.lineTo(x-2.2,y+8+i%6);
    }
    c.stroke();
  };
}

