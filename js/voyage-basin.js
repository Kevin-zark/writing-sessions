// The bowl lives in the coordinates of the open-ocean renderer. At its rim
// both the displacement and its first derivative go to zero.
export function basinPosition(p,turn,t) {
  const ease=x=>{ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); };
  const approach=ease((p-.435)/.184), escape=ease((p-.66)/.155);
  const strength=ease((p-.435)/.080)*(1-ease((p-.725)/.09));
  if (!strength) return null;
  const w=580+1180*approach-520*escape, h=w*(.36+.145*approach);
  const x=665-152*approach-156*ease((p-.56)/.14)-870*escape+5*Math.sin(t*.36)*turn;
  const seaHeight=2*(390+185*turn);
  return [(x+52)/1384,.5+.399*h/seaHeight,.48*w/1384,.24*h/seaHeight,strength];
}

export const basinFragment=`uniform sampler2D breakingSea;
uniform vec4 bowl;
uniform float pull;
vec2 stream(float radius,float angle,float weight,float age){
  float bend=weight*(0.48+.32*(1.-radius)+age*(.09+.21*weight));
  float heading=angle-bend;
  float reach=radius*(1.+.08*weight*age);
  // Upstream water comes off a shallower slope. Bringing it down the
  // wall stretches individual wave faces toward the eye.
  return bowl.xy+bowl.zw*vec2(reach*cos(heading),
    reach*(sin(heading)-.5)-weight*.34);
}
// Short breaking crests retain their photographic detail on the steep wall.
vec3 breaker(float r,float a,float age){
  float rate=.15+.60/(1.+12.*r*r);
  float angle=a-.16*time-(rate-.16)*age+.035*sin(3.*a+6.*r-time*.43);
  float reach=r*(1.+.018*age);
  return texture2D(breakingSea,vec2(.39,.68)+reach*vec2(.48*cos(angle),.24*sin(angle)-.12)).rgb;
}
void main(){
  if(pull<=0.) {gl_FragColor=vec4(ocean(uv),1.);return;}
  vec2 local=(uv-bowl.xy)/bowl.zw;
  float radius=(local.y+sqrt(local.y*local.y+3.*dot(local,local)))/1.5;
  if(radius>=1.) {gl_FragColor=vec4(ocean(uv),1.);return;}
  float angle=atan(local.y+.5*radius,local.x+.000001);
  float weight=pull*(1.-smoothstep(.035,1.,radius));
  float phase=fract(time/4.);
  vec2 q1=stream(radius,angle,weight,(phase-.5)*4.);
  vec2 q2=stream(radius,angle,weight,(fract(phase+.5)-.5)*4.);
  vec3 water=mix(ocean(q2),ocean(q1),smoothstep(0.,1.,1.-abs(2.*phase-1.)));
  float throat=1.-smoothstep(.035,.42,radius);
  float slope=sin(angle)*smoothstep(.04,.30,radius);
  water*=1.-weight*(.52*throat+.21+.22*slope);
  float breakerPhase=fract(time/6.);
  vec3 breakers=mix(breaker(radius,angle,(fract(breakerPhase+.5)-.5)*6.),
    breaker(radius,angle,(breakerPhase-.5)*6.),smoothstep(0.,1.,1.-abs(2.*breakerPhase-1.)));
  // Only the steep inner face breaks. The full outer rim keeps the moving
  // offshore waves as their headings bend. Irregular crest edges ease the join.
  float edge=radius+.035*sin(3.*angle+time*.23)+.16*(water.g-breakers.g);
  float breaking=pull*(1.-smoothstep(.42,.82,edge));
  vec3 face=breakers*vec3(.79,.94,.97)*(1.-.25*throat);
  gl_FragColor=vec4(mix(water,face,breaking),1.);
}`;

// Software rendering samples the current storm frame with the same orbits.
export function basinFallback(surface,breakingSea){
  const layer=document.createElement('canvas');
  const w=layer.width=Math.min(surface.width,800),h=layer.height=Math.round(w*surface.height/surface.width);
  const ctx=layer.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(breakingSea,0,0,w,h);
  const foam=ctx.getImageData(0,0,w,h).data;
  const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
  function breaker(r,a,age,t) {
    const rate=.15+.60/(1+12*r*r);
    const angle=a-.16*t-(rate-.16)*age+.035*Math.sin(3*a+6*r-t*.43);
    const reach=r*(1+.018*age);
    const u=Math.max(0,Math.min(w-1,Math.floor(w*(.39+.48*reach*Math.cos(angle)))));
    const v=Math.max(0,Math.min(h-1,Math.floor(h*(.68+reach*(.24*Math.sin(angle)-.12)))));
    return 4*(v*w+u);
  }
  const tint=[.79,.94,.97];
  return (t,[cx,cy,rx,ry,pull])=>{
    ctx.drawImage(surface,0,0,w,h);
    const source=ctx.getImageData(0,0,w,h).data;
    const frame=ctx.createImageData(w,h);
    const breakerPhase=(t/6)%1, breakerBlend=smooth(1-Math.abs(2*breakerPhase-1));
    const phase=(t/4)%1, blend=smooth(1-Math.abs(2*phase-1));
    for(let y=Math.max(0,Math.floor((cy-1.5*ry)*h));y<Math.min(h,(cy+.5*ry)*h);y++){
      for(let x=Math.max(0,Math.floor((cx-rx)*w));x<Math.min(w,(cx+rx)*w);x++){
        const dx=((x+.5)/w-cx)/rx,dy=((y+.5)/h-cy)/ry;
        const r=(dy+Math.sqrt(4*dy*dy+3*dx*dx))/1.5;
        if(r>=1)continue;
        const a=Math.atan2(dy+.5*r,dx), weight=pull*(1-smooth((r-.035)/.965));
        function sample(age){
          const angle=a-weight*(0.48+.32*(1-r)+age*(.09+.21*weight));
          const d=r*(1+.08*weight*age);
          const sx=Math.min(w-1,Math.max(0,Math.floor(w*(cx+rx*d*Math.cos(angle)))));
          const sy=Math.min(h-1,Math.max(0,Math.floor(h*(cy+ry*(d*(Math.sin(angle)-.5)-weight*.34)))));
          return 4*(sy*w+sx);
        }
        const i=sample((phase-.5)*4),j=sample(((phase+.5)%1-.5)*4);
        const light=1-weight*(.52*(1-smooth((r-.035)/.385))+.21+.22*Math.sin(a)*smooth((r-.04)/.26));
        const b1=breaker(r,a,(breakerPhase-.5)*6,t), b2=breaker(r,a,((breakerPhase+.5)%1-.5)*6,t);
        const green=light*(source[j+1]+blend*(source[i+1]-source[j+1]));
        const foamGreen=foam[b2+1]+breakerBlend*(foam[b1+1]-foam[b2+1]);
        const edge=r+.035*Math.sin(3*a+t*.23)+.16*(green-foamGreen)/255;
        const breaking=pull*(1-smooth((edge-.42)/.40));
        const offset=(y*w+x)*4;
        for(let k=0;k<3;k++){
          const water=light*(source[j+k]+blend*(source[i+k]-source[j+k]));
          const face=(foam[b2+k]+breakerBlend*(foam[b1+k]-foam[b2+k]))*tint[k]*(.75+.25*smooth((r-.035)/.385));
          frame.data[offset+k]=water+breaking*(face-water);
        }
        frame.data[offset+3]=255*smooth((1-r)/.12)*smooth(pull/.12);
      }
    }
    ctx.putImageData(frame,0,0);
    surface.getContext('2d').drawImage(layer,0,0,surface.width,surface.height);
    return surface;
  };
}
