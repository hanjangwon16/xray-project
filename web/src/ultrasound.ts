/** Educational ray model. Coordinates are mm; this is not a calibrated clinical scanner. */
export type Vec3 = [number, number, number];
export interface UsVolume {
  data: Int16Array | Uint8Array;
  labels: Uint8Array | null;
  dims: Vec3;
  spacing: Vec3;
  origin: Vec3;
  kind: 'human' | 'phantom' | 'anatomy' | 'acquired';
  skinPoints?: Float32Array;
  surfaces?: {id:number;points:Float32Array;normals:Float32Array;polys:Uint32Array}[];
}
export interface ProbeSettings {
  lateral: number; height: number; rotation: number; tilt: number; rock: number;
  depth: number; frequency: number; gain: number; tgc: number;
  probe: 'curved' | 'linear';
  width?: number; sectorAngle?: number; standoff?: number;
  contact?: {point:Vec3;inward:Vec3};
  lifted?: boolean;
}
export interface ProbeGeometry { origin: Vec3; inward: Vec3; across: Vec3; normal: Vec3; contact: boolean }
export interface UsFrame {
  width: number; height: number; pixels: Uint8ClampedArray; labels: Uint8Array;
  reference: Uint8ClampedArray | null;
  coverage: number; ms: number;
}
export const DEFAULT_PROBE: ProbeSettings = {
  lateral: 50, height: 55, rotation: 0, tilt: 0, rock: 0,
  depth: 180, frequency: 3.5, gain: 0, tgc: 0.7, probe: 'curved', width:50,sectorAngle:70,standoff:0,
};
const rad = (x: number) => x * Math.PI / 180;
export const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function rotate(p: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle), d = p.reduce((v,x,i) => v+x*axis[i], 0), cr = cross(axis,p);
  return p.map((x,i) => x*c+cr[i]*s+axis[i]*d*(1-c)) as Vec3;
}
export function voxelPoint(v: UsVolume, world: Vec3): Vec3 {
  return world.map((p,i) => (p-v.origin[i])/v.spacing[i]) as Vec3;
}
export function sample(v: UsVolume, point: Vec3): number | null {
  return sampleVoxel(v,(point[0]-v.origin[0])/v.spacing[0],(point[1]-v.origin[1])/v.spacing[1],(point[2]-v.origin[2])/v.spacing[2]);
}
function sampleVoxel(v:UsVolume,x:number,y:number,z:number):number|null {
  const [nx,ny,nz]=v.dims;
  if (x<0 || y<0 || z<0 || x>nx-1 || y>ny-1 || z>nz-1) return null;
  const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),fx=x-i,fy=y-j,fz=z-k;
  const a=i+j*nx+k*nx*ny,dx=i<nx-1?1:0,dy=j<ny-1?nx:0,dz=k<nz-1?nx*ny:0,data=v.data;
  const front=(data[a]*(1-fx)+data[a+dx]*fx)*(1-fy)+(data[a+dy]*(1-fx)+data[a+dy+dx]*fx)*fy;
  const back=(data[a+dz]*(1-fx)+data[a+dz+dx]*fx)*(1-fy)+(data[a+dz+dy]*(1-fx)+data[a+dz+dy+dx]*fx)*fy;
  return front*(1-fz)+back*fz;
}
export function labelAt(v: UsVolume, p: Vec3): number {
  if(!v.labels) return 0;
  const [x,y,z]=voxelPoint(v,p).map(Math.round),[nx,ny,nz]=v.dims;
  return x<0||y<0||z<0||x>=nx||y>=ny||z>=nz?0:v.labels[x+y*nx+z*nx*ny];
}
export function probeGeometry(v: UsVolume, s: ProbeSettings): ProbeGeometry {
  const x=v.origin[0]+(v.dims[0]-1)*v.spacing[0]*s.lateral/100;
  const z=v.origin[2]+(v.dims[2]-1)*v.spacing[2]*s.height/100;
  let y=v.origin[1]+(v.dims[1]-1)*v.spacing[1], contact=v.kind==='phantom'||v.kind==='acquired';
  if(v.kind==='human'||v.kind==='anatomy') {
    // Constrain the transducer to the anterior skin surface, not the CT box.
    for(let j=v.dims[1]-1;j>=0;j--) {
      const yp=v.origin[1]+j*v.spacing[1];
      if((sample(v,[x,yp,z])??-1000)>-350) {y=yp;contact=true;break;}
    }
  }
  let origin:Vec3=[x,y,z],inward:Vec3=[0,-1,0],across:Vec3=[-1,0,0];
  if(s.contact) {
    const length=Math.hypot(...s.contact.inward);
    inward=length>1e-6?s.contact.inward.map(n=>n/length) as Vec3:[0,-1,0];
    const tangent=cross(inward,Math.abs(inward[2])<.95?[0,0,1]:[0,1,0]),norm=Math.hypot(...tangent);
    across=tangent.map(n=>n/norm) as Vec3;
    origin=s.contact.point;contact=false;
    for(let d=0;d<=Math.max(...v.spacing)*3+2;d+=.5) {
      const p=add(s.contact.point,inward,d);
      if((sample(v,p)??-1000)>-350){origin=p;contact=true;break;}
    }
  }
  if(s.lifted){contact=false;origin=add(origin,inward,-25);}
  origin=add(origin,inward,-(s.standoff??0));
  across=rotate(across,inward,rad(s.rotation));
  let normal=cross(inward,across);
  inward=rotate(inward,across,rad(s.tilt));normal=rotate(normal,across,rad(s.tilt));
  inward=rotate(inward,normal,rad(s.rock));across=rotate(across,normal,rad(s.rock));
  return {origin,inward,across,normal,contact};
}
export function rayPoint(g: ProbeGeometry, s: ProbeSettings, line: number, depth: number): Vec3 {
  const width=s.width??50;
  if(s.probe==='linear')return add(add(g.origin,g.across,(line-.5)*width),g.inward,depth);
  const half=rad((s.sectorAngle??70)/2),radius=width/(2*Math.sin(half)),angle=(line-.5)*half*2;
  return add(add(g.origin,g.inward,(depth+radius)*Math.cos(angle)-radius),g.across,(depth+radius)*Math.sin(angle));
}
export function beamExtent(s:ProbeSettings):number {
  const half=rad((s.sectorAngle??70)/2);
  return s.probe==='linear'?(s.width??50)/2:(s.width??50)/2+s.depth*Math.sin(half);
}
function beamSample(s:ProbeSettings,horizontal:number,vertical:number):[number,number]|null {
  if(s.probe==='linear') {
    const halfWidth=(s.width??50)/2*(.5+.5*vertical/s.depth);
    return vertical<0||vertical>s.depth||Math.abs(horizontal)>halfWidth?null:[horizontal/(s.width??50)+.5,vertical];
  }
  const half=rad((s.sectorAngle??70)/2),radius=(s.width??50)/(2*Math.sin(half));
  const angle=Math.atan2(horizontal,vertical+radius),depth=Math.hypot(horizontal,vertical+radius)-radius;
  return Math.abs(angle)>half||depth<0||depth>s.depth?null:[angle/(half*2)+.5,depth];
}
export function imagePoint(g: ProbeGeometry,s:ProbeSettings,u:number,w:number,h:number,row:number):Vec3|null {
  const extent=beamExtent(s);
  const horizontal=(u/(w-1)*2-1)*extent,vertical=row/(h-1)*s.depth;
  if(!beamSample(s,horizontal,vertical))return null;
  return add(add(g.origin,g.inward,vertical),g.across,horizontal);
}
// Illustrative acoustic properties: impedance MRayl, attenuation dB/(cm MHz), scattering scale.
// CT HU identifies broad material classes; HU is never displayed as B-mode intensity.
export function material(hu:number,label:number,kind:UsVolume['kind']='human'):[number,number,number] {
  if(hu<-650)return [.0004,40,.002];
  if(hu>350)return [6.5,12,.12];
  if(hu<-30)return [1.38,.6,.09];
  if(label===5)return [1.65,.5,.16];
  if(label===2||label===3)return [1.62,.6,.13];
  if(label===1)return [1.66,.5,.17];
  if(kind==='anatomy'&&(label===8||label===9))return [1.5,.05,.006];
  if(kind==='anatomy'&&label===7)return [1.65,.6,.14];
  return [1.58,.5,.12];
}
function hash(x:number,y:number,z:number):number {
  const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return n-Math.floor(n);
}
export function scatter(p:Vec3):number {
  const [x,y,z]=p.map(n=>n/1.1),i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);
  const smooth=(a:number)=>a*a*(3-2*a),fx=smooth(x-i),fy=smooth(y-j),fz=smooth(z-k);
  let v=0;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)v+=hash(i+dx,j+dy,k+dz)*(dx?fx:1-fx)*(dy?fy:1-fy)*(dz?fz:1-fz);
  return .12+v*1.8;
}
export function renderUltrasound(v:UsVolume,s:ProbeSettings,size=320):UsFrame {
  const start=performance.now(),g=probeGeometry(v,s),lines=192,samples=320,ds=s.depth/(samples-1);
  if(v.kind==='acquired'||v.kind==='phantom') {
    const width=Math.max(2,Math.round(size*2*beamExtent(s)/s.depth));
    const pixels=new Uint8ClampedArray(width*size),labels=new Uint8Array(width*size);
    const gain=Math.pow(10,s.gain/20),extent=beamExtent(s);
    const origin=g.origin.map((n,i)=>(n-v.origin[i])/v.spacing[i]),across=g.across.map((n,i)=>n/v.spacing[i]),inward=g.inward.map((n,i)=>n/v.spacing[i]);
    let inside=0,total=0;
    for(let row=0;row<size;row++)for(let col=0;col<width;col++) {
      const horizontal=(col/(width-1)*2-1)*extent,vertical=row/(size-1)*s.depth;
      if(!beamSample(s,horizontal,vertical))continue;
      total++;
      if(!g.contact)continue;
      const x=origin[0]+inward[0]*vertical+across[0]*horizontal,y=origin[1]+inward[1]*vertical+across[1]*horizontal,z=origin[2]+inward[2]*vertical+across[2]*horizontal;
      const value=sampleVoxel(v,x,y,z);if(value===null)continue;inside++;
      pixels[row*width+col]=Math.max(0,Math.min(255,value*gain));
      if(v.labels)labels[row*width+col]=v.labels[Math.round(x)+Math.round(y)*v.dims[0]+Math.round(z)*v.dims[0]*v.dims[1]];
    }
    return {width,height:size,pixels,labels,reference:null,coverage:total?inside/total:0,ms:performance.now()-start};
  }
  const signal=new Float32Array(lines*samples),valid=new Uint8Array(lines*samples),labels=new Uint8Array(lines*samples);
  if(g.contact)for(let l=0;l<lines;l++) {
    let loss=0,previous=0,entered=false;
    for(let d=0;d<samples;d++) {
      const depth=d*ds,p=rayPoint(g,s,l/(lines-1),depth),value=sample(v,p),index=l*samples+d;
      if(value===null){previous=0;continue;}
      if(!entered&&value<-650&&(s.standoff??0)>0)continue;
      entered=true;
      valid[index]=1;
      const lid=labelAt(v,p);labels[index]=lid;
      const [z,alpha,scattering]=material(value,lid,v.kind);
      const reflection=previous?Math.abs((z-previous)/(z+previous)):0;
      const amplitude=scattering*scatter(p)+reflection*2;
      const db=20*Math.log10(Math.max(amplitude,1e-6))-loss+s.gain+s.tgc*(depth/10)*s.frequency;
      signal[index]=Math.max(0,Math.min(255,(db+58)/58*255));
      loss+=2*alpha*s.frequency*(ds/10);previous=z;
    }
  }
  const filtered=signal.slice();
  for(let l=0;l<lines;l++)for(let d=0;d<samples;d++) {
    const depth=d*ds,footprint=2*beamExtent(s)*Math.max(.1,depth/s.depth)/(lines-1);
    const radius=Math.min(5,Math.ceil(.61*(1.54/s.frequency)*Math.max(1,depth/(s.width??50))/footprint));
    let sum=0,weight=0;
    for(let k=-radius;k<=radius;k++){const line=l+k;if(line<0||line>=lines)continue;const w=Math.exp(-2*k*k/(radius*radius));sum+=signal[line*samples+d]*w;weight+=w;}
    filtered[l*samples+d]=sum/weight;
  }
  const width=Math.max(2,Math.round(size*2*beamExtent(s)/s.depth));
  const pixels=new Uint8ClampedArray(width*size),outLabels=new Uint8Array(width*size);
  const reference=v.kind==='human'?new Uint8ClampedArray(width*size):null;
  let inside=0,total=0;
  for(let row=0;row<size;row++)for(let col=0;col<width;col++) {
    const p=imagePoint(g,s,col,width,size,row);if(!p)continue;total++;
    if(reference){const hu=sample(v,p);reference[row*width+col]=hu===null?0:Math.max(0,Math.min(255,(hu+160)/400*255));}
    const horizontal=(col/(width-1)*2-1)*beamExtent(s),vertical=row/(size-1)*s.depth;
    const beam=beamSample(s,horizontal,vertical);if(!beam)continue;
    const l=beam[0]*(lines-1),d=beam[1]/s.depth*(samples-1);
    const il=Math.max(0,Math.min(lines-1,Math.round(l))),id=Math.min(samples-1,Math.round(d)),idx=il*samples+id;
    if(valid[idx])inside++;
    pixels[row*width+col]=filtered[idx];outLabels[row*width+col]=labels[idx];
  }
  return {width,height:size,pixels,labels:outLabels,reference,coverage:total?inside/total:0,ms:performance.now()-start};
}
