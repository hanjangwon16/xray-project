import {useEffect,useRef,useState} from 'react';
import {loadCase,type Volume} from './volume';
import type {DrrRequest,DrrResponse} from './types';

export type AnatomySelection={name:string;labelId?:number;region:string};
export default function AnatomyPreview({selection,onClose}:{selection:AnatomySelection;onClose:()=>void}){
 const [vol,setVol]=useState<Volume|null>(null),[error,setError]=useState('');
 const [mode,setMode]=useState<'ct'|'xray'>('ct'),[slice,setSlice]=useState(15),[angle,setAngle]=useState(0);
 const [busy,setBusy]=useState(false);const canvas=useRef<HTMLCanvasElement>(null),worker=useRef<Worker|null>(null),serial=useRef(0);
 const supported=selection.region==='upper-abdomen';
 useEffect(()=>{let active=true;setVol(null);setError('');if(supported)loadCase('example_ct_sm').then(v=>{if(active)setVol(v);}).catch(()=>{if(active)setError('CT 데이터를 불러오지 못했습니다. 다시 선택해 주세요.');});return()=>{active=false;};},[supported]);
 useEffect(()=>{if(!vol)return;let n=0,z=0;vol.labels?.forEach((id,i)=>{if(id===selection.labelId){z+=Math.floor(i/(vol.meta.dims[0]*vol.meta.dims[1]));n++;}});setSlice(n?Math.round(z/n):Math.floor(vol.meta.dims[2]/2));},[vol,selection]);
 useEffect(()=>{const w=new Worker(new URL('./drr.worker.ts',import.meta.url),{type:'module'});worker.current=w;return()=>{w.terminate();worker.current=null;};},[]);
 useEffect(()=>{
  if(!supported||!vol||!canvas.current)return;const c=canvas.current,ctx=c.getContext('2d')!;
  if(mode==='ct'){
   serial.current++;setBusy(false);const [nx,ny,nz]=vol.meta.dims;c.width=nx;c.height=ny;const img=ctx.createImageData(nx,ny);const k=Math.min(nz-1,slice);
   for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const idx=i+j*nx+k*nx*ny,g=Math.max(0,Math.min(255,(vol.data[idx]+160)/400*255)),dst=((nx-1-i)+(ny-1-j)*nx)*4;img.data[dst]=g;img.data[dst+1]=g;img.data[dst+2]=g;img.data[dst+3]=255;}
   ctx.putImageData(img,0,0);return;
  }
  const w=worker.current!;const id=++serial.current;setBusy(true);
  w.onmessage=(event:MessageEvent<DrrResponse>)=>{const d=event.data;if(d.requestId!==serial.current)return;c.width=d.width;c.height=d.height;const img=ctx.createImageData(d.width,d.height),px=new Uint8Array(d.pixels);for(let i=0;i<px.length;i++){img.data[i*4]=img.data[i*4+1]=img.data[i*4+2]=px[i];img.data[i*4+3]=255;}ctx.putImageData(img,0,0);setBusy(false);};
  w.onerror=()=>{setError('X-ray 계산에 실패했습니다.');setBusy(false);};
  const buffer=vol.data.slice().buffer;const req:DrrRequest={type:'render',requestId:id,caseId:vol.meta.caseId,buffer,labelBuffer:null,dims:vol.meta.dims,spacing:vol.meta.spacing,yawDeg:angle,pitchDeg:0,rollDeg:0,sid:1000,sdd:1150,outSize:320,stepMm:1.5};w.postMessage(req,[buffer]);
 },[vol,mode,slice,angle,supported]);
 return <aside className="anatomy-preview" aria-label="선택 부위 영상"><div className="preview-title"><strong>{selection.name}</strong><button onClick={onClose} aria-label="영상 패널 닫기">닫기</button></div>
 {supported?<><p>상복부 실제 사례와 비교 · 전신 모델과 다른 사람의 영상</p><div className="preview-tabs"><button className={mode==='ct'?'active':''} onClick={()=>setMode('ct')}>이 부위 CT</button><button className={mode==='xray'?'active':''} onClick={()=>setMode('xray')}>이 부위 X-ray</button></div>
 <p>{mode==='ct'?'가로 단면 · 위=앞 / 화면 왼쪽=환자 오른쪽':'상복부 전체 가상 투영 · 선택 장기만의 영상이 아닙니다'}</p>
 <div className="preview-image"><canvas ref={canvas}/>{(!vol||busy)&&<span role="status">{busy?'X-ray 계산 중…':'CT 불러오는 중…'}</span>}</div>
 {mode==='ct'?<label>CT 단면 {slice+1} / {vol?.meta.dims[2] ?? '…'}<input aria-label="미리보기 CT 위치" type="range" min={0} max={(vol?.meta.dims[2]??1)-1} value={slice} onChange={e=>setSlice(+e.target.value)}/></label>:<div className="preview-tabs">{[[0,'PA'],[180,'AP'],[90,'측면'],[45,'사위']].map(([v,n])=><button key={v} className={angle===v?'active':''} onClick={()=>setAngle(Number(v))}>{n}</button>)}</div>}
 {selection.labelId&&mode==='ct'&&<p>선택 장기가 포함된 사례 단면으로 이동했습니다. 슬라이더로 위아래를 비교하세요.</p>}</>:<><p>이 부위의 CT·X-ray 사례가 아직 없습니다.</p><p>지원 부위: 상복부 · 간, 신장, 비장, 위. 다른 부위 영상을 대신 표시하지 않습니다.</p></>}
 {error&&<p role="alert">{error}</p>}
 </aside>;
}
