// Optical flow follows the photographed far wall, near lip and plunging foam.
// Short overlapping advection intervals keep detail sharp without accumulating
// distortion across the five-minute encounter.
export const basinFragment=`precision highp float;
varying vec2 uv; uniform sampler2D sea; uniform sampler2D spindrift; uniform float time;
vec2 current(vec2 q) {
  vec2 r=(q-vec2(.39,.665))*vec2(1.,1.62);
  float dist=length(r);
  vec2 radial=r/max(dist,.018);
  vec2 tangent=vec2(-radial.y,radial.x/1.62);
  float nearLip=smoothstep(.74,.94,q.y);
  return (-radial*vec2(.013,.014)+tangent*vec2(.061,.048))*
    smoothstep(.012,.12,dist)*(1.-.35*nearLip);
}
float streaks(vec2 position,float angle) {
  float cs=cos(angle), sn=sin(angle);
  vec2 q=mat2(cs,-sn,sn,cs)*position;
  return texture2D(spindrift,.5+.49*q).a;
}
void main() {
  vec2 q=uv;
  float rim=.281;
  float wet=smoothstep(rim-.022,rim+.045,q.y);
  vec2 flow=current(q)*wet;
  float noise=sin(q.x*32.+q.y*16.-time*1.7)*sin(q.y*30.-time*.84);
  q+=wet*.0018*vec2(noise,sin(q.x*54.+time*1.6));
  float a=fract(time/1.7), b=fract(time/1.7+.5);
  vec3 first=texture2D(sea,q-flow*(a-.5)*1.7).rgb;
  vec3 second=texture2D(sea,q-flow*(b-.5)*1.7).rgb;
  vec3 col=mix(second,first,1.-abs(2.*a-1.));
  // Recover fine foam texture lost when the two moving samples overlap.
  vec2 texel=vec2(.00065,.0011);
  vec2 moving=q-flow*((a>.25 && a<.75 ? a : b)-.5)*1.7;
  vec3 center=texture2D(sea,moving).rgb;
  vec3 surround=.25*(texture2D(sea,moving+vec2(texel.x,0.)).rgb+
    texture2D(sea,moving-vec2(texel.x,0.)).rgb+texture2D(sea,moving+vec2(0.,texel.y)).rgb+
    texture2D(sea,moving-vec2(0.,texel.y)).rgb);
  col+=.45*wet*(center-surround);
  vec2 bowl=(uv-vec2(.36,.65))*vec2(1.,1.55);
  float depth=1.-smoothstep(.06,.31,length(bowl));
  col*=1.-.36*depth*(1.-smoothstep(.14,.54,max(col.r,col.g)));
  // Project a rotating current onto sloping water. The centres of projected
  // orbits sink lower in the image as their radius approaches the throat.
  vec2 ring=(uv-vec2(.375,.64))/vec2(.55,.27);
  float radius=length(ring);
  for(int i=0;i<3;i++){
    ring.y=(uv.y-.605-.087*(1.-smoothstep(.0,1.,radius)))/.27;
    radius=length(ring);
  }
  float angular=atan(ring.y,ring.x);
  float mask=(1.-smoothstep(.76,1.03,radius))*smoothstep(.045,.16,radius);
  vec2 eddy=ring*(1.+.047*sin(3.*angular+.41*time)+.024*sin(5.*angular-.23*time));
  float outer=streaks(eddy,.31*time+.82*radius);
  float inner=streaks(eddy,.69*time+1.22*radius);
  float froth=mix(inner,outer,smoothstep(.25,.75,radius));
  vec3 whitewater=mix(vec3(.48,.61,.62),vec3(.87,.92,.90),froth);
  col=mix(col,whitewater,mask*froth*.92);
  float edge=smoothstep(0.,.093,uv.x)*smoothstep(0.,.093,1.-uv.x)*
    smoothstep(.28,.415,uv.y)*smoothstep(0.,.14,1.-uv.y);
  gl_FragColor=vec4(col*edge,edge);
}`;

export function basinFoam(image) {
  // Extract only aerated streaks; the photographed walls supply all depth,
  // colour and shadow, including the dark trough beneath the near rim.
  const plate=document.createElement('canvas');
  plate.width=image.width; plate.height=image.height;
  const ctx=plate.getContext('2d');
  ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,plate.width,plate.height);
  for(let i=0;i<pixels.data.length;i+=4) {
    const data=pixels.data;
    const light=(data[i]*.22+data[i+1]*.60+data[i+2]*.18)/255;
    data[i+3]*=Math.min(1,Math.max(0,(light-.31)*1.95))**1.25;
    data[i]=186; data[i+1]=207; data[i+2]=207;
  }
  ctx.putImageData(pixels,0,0);
  return plate;
}

export function basinFallback(image,surface,c,foamMap) {
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
  const tiles=[];
  for(let row=7;row<24;row++) for(let col=0;col<36;col++) {
    const u=(col+.5)/36, v=(row+.5)/24;
    const rx=u-.39, ry=(v-.665)*1.62, radius=Math.max(.018,Math.hypot(rx,ry));
    const dx=(-.013*rx-.061*ry)/radius, dy=(-.014*ry+.048*rx/1.62)/radius;
    const x=Math.floor(col*w/36), y=Math.floor(row*h/24);
    tiles.push({x,y,width:Math.floor((col+1)*w/36)-x,height:Math.floor((row+1)*h/24)-y,dx,dy});
  }
  return t=>{
    c.clearRect(0,0,w,h);
    c.drawImage(image,0,0,w,h);
    const phase=(t/1.7)%1;
    for(const [age,alpha] of [[(phase+.5)%1,1],[phase,1-Math.abs(2*phase-1)]]) {
      c.globalAlpha=alpha;
      for(const tile of tiles) {
        const {x,y,width,height,dx,dy}=tile;
        const sx=Math.min(w-width,Math.max(0,x-dx*(age-.5)*1.7*w));
        const sy=Math.min(h-height,Math.max(0,y-dy*(age-.5)*1.7*h));
        c.drawImage(image,sx*image.width/w,sy*image.height/h,width*image.width/w,height*image.height/h,
          x,y,width,height);
      }
    }
    c.globalAlpha=1;
    // Separate inner and outer orbits on the low-detail canvas path.
    for(const [radius,cy,speed,opacity] of [[1,.605,.31,.73],[.45,.666,.69,.56]]) {
      c.save();
      c.translate(w*.375,h*cy); c.scale(w*.55*radius,h*.27*radius);
      c.rotate(t*speed+.8*radius); c.globalAlpha=opacity;
      c.drawImage(foamMap,-1,-1,2,2); c.restore();
    }
    c.globalCompositeOperation='destination-in'; c.drawImage(stencil,0,0);
    c.globalCompositeOperation='source-over';
    return surface;
  };
}
