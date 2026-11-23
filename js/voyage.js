const BASE = new URL('../themes/pirate-voyage/', import.meta.url);
export const voyageSeconds = 52;
const clamp = x => Math.max(0, Math.min(1, x));
function ease(x) { x = clamp(x); return x * x * (3 - 2 * x); }

// Advect a photographic water surface in perspective. Displacement vanishes
// at the horizon, with independent cross swells and shorter wind-driven chop.
function waterSurface(image) {
  const surface = document.createElement('canvas');
  surface.width = 1280; surface.height = 720;
  const gl = surface.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
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
      float depth=d*d;
      float swell=sin(q.x*13.+d*17.-time*1.55)+.54*sin(q.x*8.-d*21.+time*1.11);
      float chop=sin(q.x*44.+d*63.-time*3.1);
      q.y+=d*(.009*swell+.0027*chop);
      q.x+=depth*(time*.009+.011*cos(d*24.-time*1.6)+.005*sin(q.x*21.+time*1.2));
      q.x=1.-abs(mod(q.x,2.)-1.);
      vec3 col=texture2D(sea,q).rgb;
      gl_FragColor=vec4(col*(1.+d*.024*swell),1.);
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
  const [sea, harbor, merchant, rail] = await Promise.all(['sea','harbor','merchant','rail'].map(async name => {
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
  return t => {
    const open=ease((t-5)/21);
    const swell=Math.sin(t*1.03+.15*Math.sin(t*.31));
    const cross=Math.sin(t*.72+1.1);
    const roll=(.31+.69*open)*(.022*swell+.010*cross+.0028*Math.sin(t*2.4));
    const lift=(.35+.65*open)*(7*Math.sin(t*1.03-.8)+3.2*cross+1.1*Math.sin(t*2.9));
    c.save(); c.translate(640,354+lift); c.rotate(roll); c.translate(-640,-354);
    const surface = water ? water(t) : sea;
    c.drawImage(surface,-52,-30,1384,780);
    if (!water) {
      for (let y=360;y<750;y+=3) {
        const d=(y-360)/390, shift=d*10*Math.sin(t*1.55+y*.04);
        c.drawImage(sea,0,(y+30)/780*sea.height,sea.width,3/780*sea.height,-52+shift,y,1384,3.4);
      }
    }
    const depart=clamp(t/31);
    const width=2030-380*depart;
    vessel(harbor,-360-50*t-0.43*t*t,379-13*depart,width,0,true);
    // Opposing course. The merchant rises on a different swell from our deck.
    const x=1480-(t-14)*53;
    const proximity=Math.exp(-Math.pow((x-485)/820,2));
    const w=245+190*proximity;
    const bob = 374 + 30*proximity + 2.8*Math.sin(t*.94+2);
    const heel = .016*Math.sin(t*.91+.8);
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
    c.drawImage(rail,-5,720-rh+18,1290,rh);
    c.strokeStyle='rgba(194,207,212,.14)'; c.lineWidth=.8; c.beginPath();
    for (let i=0;i<83;i++) {
      const x=(i*317.63-t*(61+i%7)+12800)%1300;
      const y=(i*191.71+t*(270+i%53))%742-12;
      c.moveTo(x,y); c.lineTo(x-2.2,y+8+i%6);
    }
    c.stroke();
  };
}

