// Original-art coordinates. Each outline isolates cloth, leaving the staff,
// sails and rigging on the stationary plate. The pirate ensign flies to port.
const outlines = {
  merchant: [
    { points:[[829,208],[904,214],[904,291],[833,277],[831,271]], root:829 }
  ],
  navy: [
    { points:[[744,5],[895,8],[895,67],[744,57]], root:744 },
    { points:[[397,146],[450,159],[449,190],[396,182]], root:397 },
    { points:[[1222,450],[1347,450],[1347,570],[1219,549]], root:1221 }
  ],
  pirate: [
    { points:[[98,154],[87,218],[0,252],[0,193]], root:96, direction:-1 }
  ],
  haven: [
    { points:[[1413,65],[1466,77],[1466,105],[1414,91]], root:1413 }
  ]
};

function surface(w,h) {
  const canvas=document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  return canvas;
}

// The two travelling waves have fixed clock phases. Varying the wind blends
// their energies without restarting a cycle or changing phase on a seek.
function displacement(u,t,wind,seed,size) {
  const slow=Math.sin(t*2.65-u*6.1+seed+.31*Math.sin(t*.73+seed));
  const fast=Math.sin(t*9.8-u*10.4+seed+.57*Math.sin(t*1.19+seed));
  const ripple=Math.sin(t*15.1-u*14+seed);
  return size*u*(.36*(1-wind)**2*u+
    (.035+.035*wind)*slow+wind*wind*(.15*fast+.035*ripple));
}

export function voyageWind(leg,warm,storm,underway,time) {
  const trades=leg===3 ? .48 : .31;
  const offshore=leg===0 ? .63-.28*warm : trades+.65*storm;
  const shore=.14+(leg===0 ? .12*(1-warm) : 0);
  const gust=.92+.08*Math.sin(time*.48+.8*Math.sin(time*.17));
  return Math.min(1,(shore+(offshore-shore)*underway)*gust);
}

function fly(c,img,wind,t,seed,direction=1) {
  const width=img.width;
  const slices=Math.min(28,Math.ceil(width/2));
  const extension=.54+.45*wind;
  c.save(); c.scale(direction,1);
  for(let i=0;i<slices;i++) {
    const u=i/slices, v=(i+1)/slices;
    const x=u*width, w=(v-u)*width;
    const y=displacement(u,t,wind,seed,width);
    const next=displacement(v,t,wind,seed,width);
    c.save();
    c.transform(extension,(next-y)/w,0,1,x*extension,y);
    c.drawImage(img,x,0,w,img.height,0,0,w+.22,img.height);
    c.restore();
  }
  c.restore();
}

export function prepareFlags(art) {
  const animated=new Map();
  for (const [name,flags] of Object.entries(outlines)) {
    const image=art[name], clean=surface(image.width,image.height);
    const base=clean.getContext('2d'); base.drawImage(image,0,0);
    const sails=prepareSails(image,name);
    const cloths=flags.map(({points,root,direction=1},index)=>{
      const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
      const left=Math.min(...xs), top=Math.min(...ys);
      const w=Math.max(...xs)-left, h=Math.max(...ys)-top;
      const path=new Path2D(); path.moveTo(...points[0]);
      for (const point of points.slice(1)) path.lineTo(...point);
      path.closePath();
      const texture=surface(w,h), g=texture.getContext('2d');
      if(direction<0) {g.translate(w,0);g.scale(-1,1);}
      g.translate(-left,-top); g.clip(path); g.drawImage(image,0,0);
      base.globalCompositeOperation='destination-out'; base.fill(path);

      return {texture,left,top,root:direction<0 ? left+w : left,direction,
        seed:index*2.7+root*.019};
    });
    const plate=surface(image.width,image.height), c=plate.getContext('2d');
    c.drawImage(clean,0,0);
    animated.set(image,(wind,t)=>{
      c.clearRect(0,0,plate.width,plate.height); c.drawImage(clean,0,0);
      for (const {texture,top,root,direction,seed} of cloths) {
        c.save(); c.translate(root,top);
        fly(c,texture,wind,t,seed,direction); c.restore();
      }
      sails(c,wind,t);
      return plate;
    });
  }
  return (image,wind,t)=>animated.get(image)?.(wind,t) ?? image;
}

// A small cloth telltale on the forward stay also makes wind readable in
// open water, when there is no other vessel or flagstaff in sight.
export function prepareTelltale() {
  const cloth=surface(61,13), ctx=cloth.getContext('2d');
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(61,7);ctx.lineTo(43,8);
  ctx.lineTo(56,11);ctx.lineTo(0,13);ctx.closePath();ctx.clip();
  const dye=ctx.createLinearGradient(0,0,0,13);
  dye.addColorStop(0,'#b47657');dye.addColorStop(.24,'#93513c');
  dye.addColorStop(.72,'#714132');dye.addColorStop(1,'#b37e60');
  ctx.fillStyle=dye;ctx.fillRect(0,0,61,13);
  ctx.fillStyle='rgba(220,190,152,.42)'; ctx.fillRect(0,0,2,13);
  ctx.fillStyle='rgba(220,190,152,.12)';
  for(let i=4;i<61;i+=3) ctx.fillRect(i,2,.5,9);
  return (c,wind,t)=>{
    c.save(); c.translate(843,193); c.transform(1,0,-.46,1,0,0);
    fly(c,cloth,wind,t,1.47,-1); c.restore();
  };
}

// Each patch spans canvas between fixed attachments. Zero displacement on all
// four boundaries leaves the yards, mast and deck registered with the photograph.
const sailPatches={
  deck:[[.66,0,1,.417]],
  merchant:[[.07,.21,.337,.56],[.314,.19,.504,.62],[.505,.165,.693,.69],
    [.69,.25,.853,.55],[.427,.01,.59,.16],[.676,.06,.81,.21],[.786,.47,.9,.72]],
  navy:[[.12,.58,.288,.76],[.19,.354,.288,.56],[.29,.37,.368,.54],
    [.362,.253,.535,.49],[.548,.263,.63,.5],[.349,.53,.528,.77],
    [.615,.4,.742,.61],[.75,.41,.865,.55],[.746,.54,.891,.695]],
  pirate:[[.036,.227,.208,.738],[.256,.043,.461,.696],[.522,.235,.818,.72],
    [.61,.139,.879,.554]]
};
export function prepareSails(image,name) {
  const regions=(sailPatches[name]||[]).map(([l,t,r,b],i)=>({
    x:Math.floor(l*image.width),y:Math.floor(t*image.height),
    w:Math.floor((r-l)*image.width),h:Math.floor((b-t)*image.height),seed:i*.94
  }));
  return (ctx,wind,time)=>{
    for(const {x,y,w,h,seed} of regions) {
      ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
      ctx.clearRect(x,y,w,h);
      const rows=Math.min(36,Math.ceil(h/4));
      const pressure=.56*wind+.28*Math.sin(time*1.72+seed+Math.sin(time*.38))+
        (.17+.30*wind)*Math.sin(time*(name==='deck'?2.48:2.79)+seed);
      for(let i=0;i<rows;i++) {
        const v=(i+.5)/rows;
        const belly=Math.sin(Math.PI*v);
        const flutter=Math.sin(time*6.5-v*8+seed)*(.12+.13*wind);
        const offset=belly*w*(name==='deck'?.052:.042)*(pressure+flutter);
        const sy=y+i*h/rows, height=h/rows;
        // Two spans share the displaced middle seam. The surrounding artwork
        // stays registered while the filled belly and loose leech breathe.
        const mid=w*.51+offset;
        ctx.drawImage(image,x,sy,w*.51,height,x,sy,mid+.24,Math.min(height+.18,y+h-sy));
        ctx.drawImage(image,x+w*.51,sy,w*.49,height,x+mid,sy,w-mid,Math.min(height+.18,y+h-sy));
      }
      ctx.restore();
    }
  };
}
