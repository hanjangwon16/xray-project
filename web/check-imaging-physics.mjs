import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {DEFAULT_PROBE,probeGeometry,rayPoint,imagePoint,renderUltrasound,sample,scatter} from './src/ultrasound.ts';
import {computeBeam} from './src/beam.ts';
import {renderDrr} from './src/drr.ts';
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const v={data:new Int16Array(100*80*70),labels:null,dims:[100,80,70],spacing:[1,1,1],origin:[-50,-40,-35],kind:'human'};
const s={...DEFAULT_PROBE,depth:60};
for(const inward of [[1,0,0],[0,1,0],[0,0,-1]]) {
  const surface=probeGeometry(v,{...s,contact:{point:[0,0,0],inward}});
  assert.equal(surface.contact,true);surface.inward.forEach((n,i)=>close(n,inward[i]));
  close(dot(surface.inward,surface.across),0);close(dot(surface.normal,surface.across),0);
}
const outside={...s,contact:{point:[-500,0,0],inward:[1,0,0]}};
assert.equal(probeGeometry(v,outside).contact,false);
const lifted=renderUltrasound(v,{...s,lifted:true},64);assert.equal(lifted.coverage,0);assert.ok(lifted.pixels.every(n=>n===0));
for(const rotation of [-180,-30,0,90,180])for(const tilt of [-35,0,35])for(const rock of [-35,0,35]) {
  const pose=probeGeometry(v,{...s,rotation,tilt,rock});
  for(const axis of [pose.inward,pose.across,pose.normal])close(dot(axis,axis),1);
  close(dot(pose.inward,pose.across),0);close(dot(pose.inward,pose.normal),0);close(dot(pose.normal,pose.across),0);
  const p=rayPoint(pose,s,.5,20),image=imagePoint(pose,s,50,101,61,20);
  p.forEach((x,i)=>close(x,image[i]));
}
const ramp={...v,data:Float32Array.from({length:100*80*70},(_,i)=>i%100+2*(Math.floor(i/100)%80)+3*Math.floor(i/8000))};
close(sample(ramp,[-39.75,-19.5,-4.25]),10.25+2*20.5+3*30.75);
assert.equal(sample(ramp,[-500,0,0]),null);
const normal=renderUltrasound(v,s,128),repeat=renderUltrasound(v,s,128);
assert.deepEqual(normal.pixels,repeat.pixels);assert.ok(normal.coverage>.8);
assert.equal(scatter([1.3,2.1,7]),scatter([1.3,2.1,7]));
const mean=(f,from=0,to=f.height)=>{let sum=0,n=0;for(let row=from;row<to;row++)for(let col=Math.floor(f.width*.46);col<f.width*.54;col++){sum+=f.pixels[row*f.width+col];n++;}return sum/n;};
const bone={...v,data:v.data.slice()};
for(let z=0;z<70;z++)for(let y=55;y<60;y++)for(let x=0;x<100;x++)bone.data[x+y*100+z*8000]=1000;
const shadow=renderUltrasound(bone,s,128);assert.ok(mean(shadow,85,120)<mean(normal,85,120)*.5,'Bone must attenuate distal signal');
const high=renderUltrasound(v,{...s,frequency:8,tgc:0},128),low=renderUltrasound(v,{...s,frequency:2,tgc:0},128);
assert.ok(mean(high,85,120)<mean(low,85,120),'Frequency increases attenuation');
assert.ok(mean(renderUltrasound(v,{...s,gain:10},128))>mean(normal),'Gain increases displayed brightness');
const empty=renderUltrasound({...v,data:new Int16Array(v.data.length).fill(-1000)},s,128);assert.equal(empty.coverage,0);assert.ok(empty.pixels.every(n=>n===0));
const measured=renderUltrasound({...v,kind:'phantom',data:new Uint8Array(v.data.length).fill(93)},{...s,gain:0},128);
close(mean(measured,20,90),93); // Measured mode must not fabricate acoustic texture.
for(const yaw of [-90,0,45,180]) {
  const beam=computeBeam([16,16,16],[2,2,2],yaw,25,17,1000,1150);
  close(dot(beam.u,beam.v),0);close(dot(beam.u,beam.b),0);close(dot(beam.v,beam.b),0);
  close(Math.hypot(...beam.src),1000);close(Math.hypot(...beam.detC),150);
}
const request=(n,yaw=0)=>({type:'render',requestId:1,caseId:'uniform-phantom',buffer:new Int16Array(n*n*n).buffer,labelBuffer:null,dims:[n,n,n],spacing:[2,2,2],yawDeg:yaw,pitchDeg:0,rollDeg:0,sid:1000,sdd:1150,outSize:33,stepMm:.25});
const drr=renderDrr(request(16)),ap=renderDrr(request(16,180)),thick=renderDrr(request(32));
assert.deepEqual(new Uint8Array(drr.pixels),new Uint8Array(ap.pixels));
const center=16*33+16;
assert.ok(new Uint8Array(thick.pixels)[center]>new Uint8Array(drr.pixels)[center],'Fixed DRR window must preserve thickness difference');
const folder=new URL('./public/ultrasound/anatomical-phantom/',import.meta.url);
const meta=JSON.parse(readFileSync(new URL('case.json',folder),'utf8'));
const labels=new Uint8Array(gunzipSync(readFileSync(new URL(meta.file,folder))));
assert.equal(labels.length,meta.dims.reduce((a,b)=>a*b,1));
assert.equal(createHash('sha256').update(labels).digest('hex'),meta.sha256);
assert.ok((meta.dims[2]-1)*meta.spacing[2]>1600,'Human phantom must include full body height');
for(const id of [1,2,3,6,10,11])assert.ok(meta.counts[id]>1000);
const centroidX=id=>{let sum=0,n=0;labels.forEach((label,i)=>{if(label===id){sum+=meta.origin[0]+i%meta.dims[0]*meta.spacing[0];n++;}});return sum/n;};
assert.ok(centroidX(2)>0&&centroidX(3)<0,'Kidneys must retain patient laterality');
const anatomy={data:Int16Array.from(labels,id=>id===0?-1000:id===11?1000:20),labels,dims:meta.dims,spacing:meta.spacing,origin:meta.origin,kind:'anatomy'};
assert.equal(renderUltrasound(anatomy,DEFAULT_PROBE,64).reference,null,'Anatomical materials must not be presented as acquired CT');
console.log(JSON.stringify({passed:true,checks:['probe orthonormality and image/3D coordinates','trilinear interpolation','deterministic spatial scattering','bone shadow','frequency attenuation','gain','no-contact blank','measured constant intensity','shared Xray geometry','symmetric AP/PA','DRR thickness comparison'],normalUsMs:normal.ms}));
