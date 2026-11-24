// Screen-space projection of sloping orbits measured against the storm still.
// The far wall spans more vertical pixels than the foreshortened near lip.
export const basinFragment=`precision highp float;
varying vec2 uv;
uniform sampler2D sea;
uniform float time;

vec2 orbit(float radius, float angle) {
  return vec2(.39,.68) + radius*vec2(.48*cos(angle),.24*sin(angle)-.12);
}

// Trace the photographic water backwards around its orbit. Two overlapping
// time windows allow persistent shear without stretching the waves indefinitely.
vec3 waterParcel(float radius,float angle,float age) {
  float inward=.018*smoothstep(.02,.25,radius);
  float sourceRadius=radius*(1.+inward*age);
  float speed=.15+.60/(1.+12.*radius*radius);
  float sourceAngle=angle-.16*time-(speed-.16)*age;
  sourceAngle+=.04*sin(3.*angle+6.*radius-time*.43);
  return texture2D(sea,orbit(sourceRadius,sourceAngle)).rgb;
}

void main(){
  vec2 q=uv;
  float wet=smoothstep(.281,.40,q.y);
  q.y+=wet*(.0032*sin(q.x*19.+time*.89)+.002*sin(q.x*39.-time*.62));
  vec2 local=(q-vec2(.39,.68))/vec2(.48,.24);
  // x=r*cos(a), y=r*(sin(a)-.5).
  float r=(local.y+sqrt(local.y*local.y+3.*dot(local,local)))/1.5;
  float a=atan(local.y+.5*r,local.x+.000001);
  float phase=fract(time/6.);
  vec3 first=waterParcel(r,a,(phase-.5)*6.);
  vec3 second=waterParcel(r,a,(fract(phase+.5)-.5)*6.);
  float blend=smoothstep(0.,1.,1.-abs(2.*phase-1.));
  vec3 moving=mix(second,first,blend);
  // Retain fixed incident storm light as individual crests cross the wall.
  float wall=smoothstep(.06,.34,r)*(1.-smoothstep(.72,1.05,r));
  moving*=.78+.24*smoothstep(.05,.68,r)+wall*.14*cos(a+1.1);
  vec2 drift=vec2(-sin(a)*.007,cos(a)*.003)*wet;
  vec3 outer=texture2D(sea,q+drift*sin(time*.92+11.*r)).rgb;
  vec3 col=mix(outer,moving,1.-smoothstep(.79,1.04,r));
  float edge=smoothstep(0.,.093,uv.x)*smoothstep(0.,.093,1.-uv.x)*
    smoothstep(.28,.415,uv.y)*smoothstep(0.,.14,1.-uv.y);
  gl_FragColor=vec4(col*edge,edge);
}`;

export function basinFallback(image,surface,c) {
  // Same feathered outline and downhill flow for browsers without WebGL.
  const stencil=document.createElement('canvas');
  stencil.width=surface.width; stencil.height=surface.height;
  const g=stencil.getContext('2d'), w=stencil.width,h=stencil.height;
  const x=g.createLinearGradient(0,0,w,0), y=g.createLinearGradient(0,0,0,h);
  for(const [gradient,zero,start,end] of [[x,0,.093,.907],[y,.28,.415,.86]]) {
    gradient.addColorStop(zero,'transparent'); gradient.addColorStop(start,'black');
    gradient.addColorStop(end,'black'); gradient.addColorStop(1,'transparent');
    g.fillStyle=gradient; g.fillRect(0,0,w,h); g.globalCompositeOperation='destination-in';
  }
  // Cache the inverse projection. In software the water is sampled at a
  // smaller resolution and radii share a table of angular displacements.
  const layer=document.createElement('canvas');
  const cols=layer.width=Math.min(w,720), rows=layer.height=Math.round(cols*h/w);
  const ctx=layer.getContext('2d');
  ctx.drawImage(image,0,0,cols,rows);
  const source=ctx.getImageData(0,0,cols,rows).data;
  const frame=ctx.getImageData(0,0,cols,rows);
  const count=cols*rows, radial=new Uint16Array(count);
  const localX=new Float32Array(count), localY=new Float32Array(count);
  const mix=new Float32Array(count);
  const bins=256;
  const rates=new Float32Array(bins);
  for(let i=0;i<bins;i++) rates[i]=.15+.60/(1.+12*(i/(bins-1)*1.04)**2);
  for(let i=0;i<count;i++){
    const x=((i%cols+.5)/cols-.39)/.48, y=((Math.floor(i/cols)+.5)/rows-.68)/.24;
    const r=(y+Math.sqrt(y*y+3*(x*x+y*y)))/1.5;
    if(r>=1.04) continue;
    radial[i]=Math.round(r/1.04*(bins-1));
    localX[i]=x; localY[i]=y+.5*r;
    const fade=Math.min(1,(1.04-r)/.25);
    mix[i]=fade*fade*(3-2*fade);
  }
  const first=new Float32Array(bins*2), second=new Float32Array(bins*2);
  function orbitTable(table,t,age){
    for(let i=0;i<bins;i++){
      const angle=-.16*t-(rates[i]-.16)*age, scale=1+.018*age;
      table[2*i]=Math.cos(angle)*scale; table[2*i+1]=Math.sin(angle)*scale;
    }
  }
  function sample(x,y,bin,table){
    const cs=table[2*bin],sn=table[2*bin+1],r=bin*1.04/(bins-1);
    const u=Math.max(0,Math.min(cols-1,Math.floor(cols*(.39+.48*(x*cs-y*sn)))));
    const v=Math.max(0,Math.min(rows-1,Math.floor(rows*(.68+.24*(x*sn+y*cs)-.12*r))));
    return 4*(v*cols+u);
  }
  return t=>{
    const phase=(t/6)%1;
    orbitTable(first,t,(phase-.5)*6);
    orbitTable(second,t,((phase+.5)%1-.5)*6);
    const weight=1-Math.abs(2*phase-1), alpha=weight*weight*(3-2*weight);
    for(let i=0;i<count;i++){
      if(!mix[i]) continue;
      const a=sample(localX[i],localY[i],radial[i],first);
      const b=sample(localX[i],localY[i],radial[i],second);
      for(let k=0;k<3;k++){
        const water=source[b+k]+alpha*(source[a+k]-source[b+k]);
        frame.data[i*4+k]=source[i*4+k]+mix[i]*(water-source[i*4+k]);
      }
    }
    ctx.putImageData(frame,0,0);
    c.clearRect(0,0,w,h); c.drawImage(layer,0,0,w,h);
    c.globalCompositeOperation='destination-in'; c.drawImage(stencil,0,0);
    c.globalCompositeOperation='source-over';
    return surface;
  };
}
