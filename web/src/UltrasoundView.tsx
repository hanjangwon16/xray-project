import {useEffect,useRef,useState} from 'react';
import {loadCase} from './volume';
import {DEFAULT_PROBE,probeGeometry,imagePoint,voxelPoint,type ProbeSettings,type UsVolume,type UsFrame,type Vec3} from './ultrasound';
import UltrasoundScene from './UltrasoundScene';
import {labelColor,labelName} from './labels';

const ORGAN_NAMES:Record<number,string>={1:'비장',2:'오른쪽 신장',3:'왼쪽 신장',5:'간',6:'위',7:'췌장',8:'담낭',9:'방광'};
function readSurfaces(data:ArrayBuffer,entries:{id:number;vertices:number;triangles:number;offset:number;bytes:number}[]) {
  return entries.map(entry=>{
    if(entry.offset<0||entry.offset%4!==0||entry.bytes!==entry.vertices*24+entry.triangles*16||entry.offset+entry.bytes>data.byteLength)throw Error('3D 표면 데이터 크기가 일치하지 않습니다.');
    return {id:entry.id,points:new Float32Array(data,entry.offset,entry.vertices*3),normals:new Float32Array(data,entry.offset+entry.vertices*12,entry.vertices*3),polys:new Uint32Array(data,entry.offset+entry.vertices*24,entry.triangles*4)};
  });
}
function organPosition(v:UsVolume,id:number):Partial<ProbeSettings>|null {
  if(!v.labels)return null;
  let x=0,z=0,n=0;v.labels.forEach((label,i)=>{if(label===id){x+=i%v.dims[0];z+=Math.floor(i/(v.dims[0]*v.dims[1]));n++;}});
  return n?{lateral:x/n/(v.dims[0]-1)*100,height:z/n/(v.dims[2]-1)*100}:null;
}
export default function UltrasoundView({onOpenCase,onOpenReference,initialOrgan=2,initialWorld,initialSource='acquired'}: {onOpenCase:(mode:'ct'|'xray',world:Vec3)=>void;onOpenReference:(organ:number,source:'human'|'anatomy')=>void;initialOrgan?:number;initialWorld?:Vec3;initialSource?:UsVolume['kind']}) {
  const [source,setSource]=useState<UsVolume['kind']>(initialWorld?'human':initialSource),[retry,setRetry]=useState(0);
  const measured=source==='acquired'||source==='phantom';
  const [volume,setVolume]=useState<UsVolume|null>(null),[settings,setSettings]=useState<ProbeSettings>(DEFAULT_PROBE);
  const [frame,setFrame]=useState<(UsFrame & {settings:ProbeSettings})|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const [reference,setReference]=useState(false);
  const [focusRequest,setFocusRequest]=useState(0);
  const [frozen,setFrozen]=useState(false),[overlay,setOverlay]=useState(false),[hover,setHover]=useState(''),[target,setTarget]=useState('간');
  const worker=useRef<Worker|null>(null),request=useRef(0),canvas=useRef<HTMLCanvasElement>(null);
  const submit=useRef<(pose:ProbeSettings)=>void>(()=>{});
  useEffect(()=>{
    const abort=new AbortController();let disposed=false;
    setVolume(null);setFrame(null);setError('');setBusy(true);setFrozen(false);setHover('');setReference(false);
    (async()=>{
      let v:UsVolume;
      if(source==='human') {
        const ct=await loadCase('example_ct',abort.signal);
        if(ct.meta.direction.flat().some((x,i)=>Math.abs(x-([0,4,8].includes(i)?1:0))>1e-5))throw Error('지원하지 않는 CT 방향행렬입니다.');
        v={data:ct.data,labels:ct.labels,dims:ct.meta.dims,spacing:ct.meta.spacing,origin:ct.meta.origin,kind:'human'};
      } else if(source==='anatomy') {
        const response=await fetch('./ultrasound/anatomical-phantom/case.json',{signal:abort.signal});if(!response.ok)throw Error('인체 팬텀 정보를 불러오지 못했습니다.');
        const meta=await response.json();
        const read=async(file:string)=>{const r=await fetch('./ultrasound/anatomical-phantom/'+file,{signal:abort.signal});if(!r.ok)throw Error('인체 팬텀 파일을 불러오지 못했습니다.');return new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();};
        const [raw,surfaces]=await Promise.all([read(meta.file),read(meta.surfaceFile)]),materials=new Uint8Array(raw);
        if(materials.length!==meta.dims.reduce((a:number,b:number)=>a*b,1))throw Error('인체 팬텀 크기가 일치하지 않습니다.');
        const data=Int16Array.from(materials,label=>label===0?-1000:label===11?1000:20);
        v={data,labels:materials,dims:meta.dims,spacing:meta.spacing,origin:meta.origin,kind:'anatomy',surfaces:readSurfaces(surfaces,meta.surfaces)};
      } else if(source==='acquired') {
        const response=await fetch('./ultrasound/segthy/case.json',{signal:abort.signal});if(!response.ok)throw Error('실측 인체 초음파 정보를 불러오지 못했습니다.');
        const meta=await response.json();
        const read=async(file:string)=>{const r=await fetch('./ultrasound/segthy/'+file,{signal:abort.signal});if(!r.ok)throw Error('실측 인체 초음파 파일을 불러오지 못했습니다.');return new Uint8Array(await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());};
        const [data,labels,surfaceData]=await Promise.all([read(meta.file),read(meta.labels),read(meta.surfaceFile)]);
        if(data.length!==meta.dims.reduce((a:number,b:number)=>a*b,1)||labels.length!==data.length)throw Error('실측 영상과 분할 크기가 일치하지 않습니다.');
        const surfaces=meta.surfaces.map((entry:{id:number;vertices:number;triangles:number;offset:number;bytes:number})=>{
          if(entry.offset<0||entry.bytes!==entry.vertices*24+entry.triangles*16||entry.offset+entry.bytes>surfaceData.byteLength)throw Error('3D 표면 데이터 크기가 일치하지 않습니다.');
          const points=new Float32Array(surfaceData.buffer,entry.offset,entry.vertices*3),normals=new Float32Array(surfaceData.buffer,entry.offset+entry.vertices*12,entry.vertices*3),polys=new Uint32Array(surfaceData.buffer,entry.offset+entry.vertices*24,entry.triangles*4);
          return {id:entry.id,points,normals,polys};
        });
        v={data,labels,dims:meta.dims,spacing:meta.spacing,origin:meta.origin,kind:'acquired',surfaces};
      } else {
        const response=await fetch('./ultrasound/plus-phantom/case.json',{signal:abort.signal});if(!response.ok)throw Error('팬텀 정보를 불러오지 못했습니다.');
        const meta=await response.json();
        const raw=await fetch('./ultrasound/plus-phantom/'+meta.file,{signal:abort.signal});if(!raw.ok)throw Error('팬텀 볼륨을 불러오지 못했습니다.');
        const data=new Uint8Array(await raw.arrayBuffer());
        if(data.length!==meta.dims.reduce((a:number,b:number)=>a*b,1))throw Error('팬텀 파일 크기가 일치하지 않습니다.');
        v={data,labels:null,dims:meta.dims,spacing:meta.spacing,origin:meta.origin,kind:'phantom'};
      }
      if(disposed)return;
      const w=new Worker(new URL('./ultrasound.worker.ts',import.meta.url),{type:'module'});worker.current=w;
      let rendering=false,pending:ProbeSettings|null=null;
      const send=(pose:ProbeSettings)=>{
        setBusy(true);
        if(rendering){pending=pose;return;}
        rendering=true;w.postMessage({type:'render',requestId:++request.current,settings:pose});
      };
      submit.current=send;
      w.onmessage=e=>{
        if(disposed||worker.current!==w)return;
        rendering=false;
        if(e.data.type==='error'){pending=null;setBusy(false);setError(e.data.message);return;}
        setFrame(e.data);setError('');
        if(pending){const next=pending;pending=null;send(next);}else setBusy(false);
      };
      w.onerror=()=>{if(!disposed){rendering=false;pending=null;w.terminate();worker.current=null;submit.current=()=>{};setBusy(false);setError('초음파 계산에 실패했습니다. 다시 불러오세요.');}};
      w.postMessage({type:'init',volume:{...v,skinPoints:undefined,surfaces:undefined}});
      const organId=initialOrgan;
      setVolume(v);setTarget(source==='acquired'?'갑상선 · 왼쪽 엽':source!=='phantom'?(initialWorld&&source==='human'?'CT 선택 위치':ORGAN_NAMES[organId]??'선택 장기'):'시험 팬텀');
      const initialPosition=initialWorld&&source==='human'?{lateral:Math.max(5,Math.min(95,(initialWorld[0]-v.origin[0])/((v.dims[0]-1)*v.spacing[0])*100)),height:Math.max(5,Math.min(95,(initialWorld[2]-v.origin[2])/((v.dims[2]-1)*v.spacing[2])*100))}:organPosition(v,organId);
      setSettings({...DEFAULT_PROBE,...(source==='acquired'?{...organPosition(v,1),depth:55,probe:'linear',frequency:12}:source!=='phantom'?initialPosition:{depth:50,height:50})});
    })().catch(e=>{if(!disposed){setBusy(false);setError(e.message);}});
    return()=>{disposed=true;abort.abort();worker.current?.terminate();worker.current=null;submit.current=()=>{};request.current++;};
  },[source,retry]);
  useEffect(()=>{
    if(!volume||frozen||!worker.current)return;
    submit.current(settings);
  },[volume,settings,frozen]);
  useEffect(()=>{
    if(!frame||!canvas.current)return;
    const c=canvas.current;c.width=frame.width;c.height=frame.height;
    const ctx=c.getContext('2d')!,img=ctx.createImageData(c.width,c.height);
    for(let i=0;i<frame.pixels.length;i++) {
      const g=reference&&frame.reference?frame.reference[i]:frame.pixels[i],color=overlay&&g>10&&frame.labels[i]&&!(volume?.kind==='anatomy'&&frame.labels[i]===10)?(volume?.kind==='acquired'?({1:[240,117,97],2:[77,217,209],3:[173,128,242]}[frame.labels[i]]??null):volume?.kind==='anatomy'&&frame.labels[i]===11?[225,215,190]:labelColor(frame.labels[i])):null;
      img.data[i*4]=color?g*.6+color[0]*.4:g;img.data[i*4+1]=color?g*.6+color[1]*.4:g;img.data[i*4+2]=color?g*.6+color[2]*.4:g;img.data[i*4+3]=255;
    }
    ctx.putImageData(img,0,0);
    ctx.font='9px sans-serif';ctx.textAlign='right';ctx.fillStyle='#b6c9c9';ctx.strokeStyle='#849b9b';
    for(let tick=1;tick<=5;tick++){const y=Math.min(c.height-4,tick/5*c.height);ctx.fillText((frame.settings.depth/10*tick/5).toFixed(1),c.width-10,y);ctx.beginPath();ctx.moveTo(c.width-7,y-3);ctx.lineTo(c.width-2,y-3);ctx.stroke();}
  },[frame,overlay,reference]);
  const changeSource=(next:UsVolume['kind'])=>{if(next===source||frozen)return;request.current++;setVolume(null);setFrame(null);setBusy(true);setSource(next);};
  const change=(patch:Partial<ProbeSettings>)=>{if(!frozen){
    if(patch.lateral!==undefined||patch.height!==undefined){if(!patch.contact)patch={...patch,contact:undefined,lifted:false};setTarget('자유 스캔');}
    setSettings(s=>({...s,...patch}));setHover('');
  }};
  const reset=()=>{setFrozen(false);setSettings({...DEFAULT_PROBE,...(volume?.kind==='acquired'?{...organPosition(volume,1),depth:55,probe:'linear',frequency:12}:volume&&volume.kind!=='phantom'?organPosition(volume,initialOrgan):{depth:50,height:50})});setTarget(volume?.kind==='acquired'?'갑상선 · 왼쪽 엽':volume&&volume.kind!=='phantom'?ORGAN_NAMES[initialOrgan]:'시험 팬텀');};
  const slider=(key:keyof Omit<ProbeSettings,'contact'|'lifted'>,title:string,min:number,max:number,step:number,unit:string)=>
    <label className="us-slider" key={key}><span>{title}<output>{Number(settings[key]).toFixed(step<1?1:0)}{unit}</output></span><input aria-label={title} type="range" min={min} max={max} step={step} value={settings[key]} disabled={frozen||!volume} onChange={e=>change({[key]:+e.target.value})}/></label>;
  const geometry=volume?probeGeometry(volume,settings):null;
  const openCase=(mode:'ct'|'xray')=>{
    if(!volume||volume.kind!=='human'||!geometry)return;
    const p=imagePoint(geometry,settings,(frame?.width??320)/2,frame?.width??320,frame?.height??320,(frame?.height??320)*.5);
    if(p)onOpenCase(mode,p);
  };
  return <section className="us-workspace" aria-label="초음파 촬영 시뮬레이터">
    <aside className="us-tools">
      <div className="us-eyebrow">ULTRASOUND LAB</div><h2>탐촉자에서<br/>단면까지.</h2><p className="us-muted">위치와 방향을 바꾸며 인체와 영상의 관계를 익힙니다.</p>
      <div className="us-source-tabs us-datasets"><button disabled={frozen} className={source==='acquired'?'active':''} onClick={()=>changeSource('acquired')}>실제 인체 3D 초음파 · 갑상선</button><button disabled={frozen} className={source==='phantom'?'active':''} onClick={()=>changeSource('phantom')}>실측 시험 팬텀</button><button disabled={frozen} className={source==='anatomy'?'active':''} onClick={()=>changeSource('anatomy')}>전신 인체 팬텀</button><button disabled={frozen} className={source==='human'?'active':''} onClick={()=>changeSource('human')}>실제 복부 CT 기반</button></div>
      {source==='acquired'&&<p className="us-muted">SegThy · 실제 측정 B-mode와 같은 사례의 수동 분할. 왼쪽 목의 촬영 범위만 제공합니다. 전신 아틀라스와 정합되지 않았습니다.</p>}
      {source==='anatomy'&&<p className="us-muted">전신 피부와 8개 장기 · 4mm 재료 근사. 장기를 선택하면 해당 부위를 확대합니다. B-mode는 실측이 아닌 합성 영상입니다.</p>}
      <div className="us-control-section"><h3>01 <span>탐색 위치</span></h3>
      {source==='acquired'&&<button disabled={frozen||!volume} onClick={reset}>갑상선 중심으로 복귀</button>}
      {!measured&&<div className="us-organ-presets">{(source==='anatomy'?[5,8,7,2,3,1,6,9]:[5,2,3,1]).map(id=><button disabled={frozen||!volume} className={target===ORGAN_NAMES[id]?'active':''} key={id} onClick={()=>{const p=volume&&organPosition(volume,id);if(p){change({...p,rotation:0,tilt:0,rock:0});setTarget(ORGAN_NAMES[id]);setFocusRequest(n=>n+1);}}}>{ORGAN_NAMES[id]}</button>)}</div>}
      {slider('lateral','좌우 위치',0,100,.5,'%')}{slider('height','상하 위치',0,100,.5,'%')}
      {!measured&&[2,3,5,8].map(id=>target===ORGAN_NAMES[id]&&<button key={id} onClick={()=>onOpenReference(id,source==='anatomy'?'anatomy':'human')}>실제 {ORGAN_NAMES[id]} 참고 영상 ↗</button>)}
      </div><div className="us-control-section"><h3>02 <span>탐촉자 방향</span></h3>
      <div className="us-source-tabs"><button disabled={frozen||!volume} className={settings.rotation===0?'active':''} onClick={()=>change({rotation:0,tilt:0,rock:0})}>가로 스캔</button><button disabled={frozen||!volume} className={settings.rotation===90?'active':''} onClick={()=>change({rotation:90,tilt:0,rock:0})}>세로 스캔</button></div>
      {slider('rotation','탐촉자 회전',-180,180,1,'°')}{slider('tilt','앞뒤 기울임',-35,35,1,'°')}{slider('rock','좌우 기울임',-35,35,1,'°')}
      </div><div className="us-control-section"><h3>03 <span>영상 설정</span></h3>
      <label className="us-probe-select">{measured?'재단면 표시 형태':'탐촉자'}<select aria-label="탐촉자 종류" value={settings.probe} disabled={frozen||!volume} onChange={e=>change({probe:e.target.value as ProbeSettings['probe'],depth:source==='acquired'?55:source==='phantom'?(e.target.value==='linear'?40:50):(e.target.value==='linear'?70:180)})}><option value="curved">곡면형</option><option value="linear">선형</option></select></label>
      {slider('width',measured?'표시 폭':'프로브 폭',15,70,1,'mm')}{settings.probe==='curved'&&slider('sectorAngle','시야각',30,100,1,'°')}
      {slider('standoff',measured?'표시 시작 거리':'젤 스탠드오프 거리',0,30,1,'mm')}
      {slider('depth','영상 깊이',measured?15:40,measured?85:220,1,'mm')}{slider('gain','전체 Gain',-24,24,1,'dB')}
      {!measured&&<>{slider('frequency','주파수',2,15,.5,'MHz')}{slider('tgc','깊이 보상 TGC',0,1.5,.1,'')}<p className="us-muted">주파수·폭·깊이에 따른 감쇠와 횡방향 빔 퍼짐 근사. 젤 거리는 피부 앞 결합층이며 공중 접촉은 해제됩니다. 재료 해상도 이하의 세부 구조는 생성하지 않습니다.</p></>}
      </div><button className="us-reset" onClick={reset}>자세·영상 설정 초기화</button>
    </aside>
    <main className="us-main">
      <div className="us-session-heading"><div><span className="us-eyebrow">{source==='anatomy'?'EXPERIMENTAL · ANATOMICAL PHANTOM':source==='human'?'EXPERIMENTAL · CT → ACOUSTIC APPROXIMATION':'MEASURED 3D ULTRASOUND'}</span><h2>{source==='acquired'?'실제 갑상선 영상과 장기 형태를 함께 보세요':source==='anatomy'?'인체 조작 실험 · 합성 영상':source==='human'?'복부 CT 음향 근사 · 실험용':'실측 초음파 볼륨 탐색'}</h2></div><span role="status" className={'us-live '+(frozen||!geometry?.contact?'paused':'')}>{frozen?'Ⅱ 정지':geometry?.contact?(measured?'실측 · 재단면':'● 접촉 · LIVE'):'접촉 해제'}</span></div>
      <div className="us-viewports">
        <article className="us-panel"><div className="us-panel-heading"><span>01 / {source==='acquired'?'같은 사례 · 갑상선 분할':source==='anatomy'?'실제 인체 형상':source==='human'?'실제 CT 기반 인체':'시험용 초음파 팬텀'}</span><span>3D + SCAN PLANE</span></div>
          {volume?<UltrasoundScene volume={volume} settings={settings} onChange={change} frozen={frozen} focusRequest={focusRequest}/>:<div className="us-loading" role="status">{error?'데이터를 불러오지 못했습니다.':'3D 구조와 영상을 준비하고 있습니다…'}</div>}
          <div className="us-key"><span><i style={{background:'#6fe0cb'}}/>스캔면</span>{source==='acquired'&&<><span><i style={{background:'#f07561'}}/>갑상선</span><span><i style={{background:'#4dd9d1'}}/>혈관 #2</span><span><i style={{background:'#ad80f2'}}/>혈관 #3</span></>}<span><i style={{background:'#fbc842'}}/>{source==='acquired'?'단면 조작점':'탐촉자 marker'} = 영상 왼쪽</span></div>
        </article>
        <article className="us-panel"><div className="us-panel-heading"><span>02 / {reference?'동일면 CT':'B-MODE'}</span><span>{measured?'실측 볼륨 · 재단면':(reference?'실제 CT · 사위 재단면':'합성 · 교육용 근사')}</span></div>
          <div className="us-image-area" aria-busy={busy}>
            <canvas ref={canvas} aria-label="초음파 단면 영상" data-source={volume?.kind} data-pose={frame?JSON.stringify(frame.settings):''} data-ready={!!frame} data-coverage={frame?.coverage??0} onPointerMove={e=>{
              if(!volume||!geometry||!frame||busy)return;const r=e.currentTarget.getBoundingClientRect(),col=(e.clientX-r.left)/r.width*(frame.width-1),row=(e.clientY-r.top)/r.height*(frame.height-1),p=imagePoint(geometry,settings,col,frame.width,frame.height,row);
              if(!p){setHover('영상 영역 밖');return;}const [i,j,k]=voxelPoint(volume,p).map(Math.round),[nx,ny,nz]=volume.dims;
      const label=volume.labels&&i>=0&&j>=0&&k>=0&&i<nx&&j<ny&&k<nz?volume.labels[i+j*nx+k*nx*ny]:0;
              setHover(`${label?(source==='acquired'?({1:'갑상선 · 왼쪽 엽',2:'혈관 분할 #2',3:'혈관 분할 #3'}[label]??'분할 구조 #'+label):source==='anatomy'&&label===10?'일반 연부조직':source==='anatomy'&&label===11?'뼈':source==='human'?labelName(label):ORGAN_NAMES[label]??'분할 구조 #'+label):'미분류 조직'} · ${p.map(n=>n.toFixed(0)).join(', ')} mm`);
            }} onPointerLeave={()=>setHover('')}/>
            <span className="us-image-marker">◀</span><span className="us-image-info">{settings.probe==='curved'?'C':'L'} {measured?'3DUS':settings.frequency.toFixed(1)+'MHz'}<br/>{(settings.depth/10).toFixed(1)}cm · G {settings.gain}dB</span>
            {busy&&<span className="us-calculating" role="status">{frame?'영상 갱신 중…':'첫 단면 계산 중…'}</span>}
            {volume&&geometry&&!geometry.contact&&<span className="us-empty">{source==='acquired'?'촬영 범위를 벗어났습니다. 갑상선 중심으로 복귀하세요.':settings.lifted?'탐촉자가 떨어져 있습니다. 피부 위로 끌어 접촉하세요.':'체표를 찾을 수 없습니다. 위치를 몸 안쪽으로 옮기세요.'}</span>}
          </div>
          <div className="us-image-controls"><button className={frozen?'active':''} disabled={!frame||busy} onClick={()=>setFrozen(s=>!s)}>{frozen?'재생':'영상 정지'}</button>{source==='human'&&<button className={reference?'active':''} disabled={!frame} onClick={()=>setReference(s=>!s)}>{reference?'B-mode 보기':'같은 면 CT 비교'}</button>}<label><input type="checkbox" checked={overlay} disabled={source==='phantom'} onChange={e=>setOverlay(e.target.checked)}/> 구조 해설색</label><span>{frame?`${frame.ms.toFixed(0)}ms · 범위 ${(frame.coverage*100).toFixed(0)}%`:''}</span></div>
          <div className="us-readout">{target} · {geometry&&`위치 ${geometry.origin.map(n=>n.toFixed(1)).join(', ')} mm`}<br/>{hover||(overlay?'색은 해부 분할 기반 해설이며 초음파 원신호가 아닙니다.':'영상 위에 마우스를 올려 같은 위치의 구조를 확인하세요.')}</div>
        </article>
      </div>
      {error&&<div className="us-error" role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>다시 불러오기</button></div>}
      <div className="us-learning-strip"><div><span className="us-eyebrow">지금 이해할 것</span><h3>{source==='acquired'?'붉은 갑상선과 혈관 분할을 실제 영상에서 찾아보세요.':source!=='phantom'?'같은 장기도 스캔 방향에 따라 모양이 달라집니다.':'실측 신호의 위치 관계를 먼저 확인하세요.'}</h3><p>{source==='acquired'?'SegThy 001 · 왼쪽 목 · 원본 0.12mm → 웹 0.24mm. 구조 해설색으로 같은 단면의 분할을 확인하세요. 실제 신호를 재단면하며 새로운 입사각의 반사·압박·혈류를 생성하지 않습니다. 혈관은 원본 분할 ID로 표시합니다.':source==='anatomy'?'피부·뼈와 간·담낭·췌장·양쪽 신장·비장·위·방광을 같은 좌표에서 사용합니다. 기타 내부는 일반 연부조직 근사입니다. 4mm 재료 모델이며 실측 초음파가 아닙니다. 폐·혈관·근육 구분과 압박·굴절·혈류는 포함하지 않습니다.':source==='human'?'가로 ↔ 세로 스캔을 비교하세요. 현재 모델은 반사·왕복 감쇠·고정 산란을 근사하며 압박·굴절·혈류는 재현하지 않습니다.':'이 모드는 실제 3DUS에서 단면을 다시 자릅니다. 탐촉자 각도에 따른 새 반사·압박 영상을 생성하는 기능은 아닙니다.'}</p></div>
      {source==='acquired'?<a href="./ultrasound/segthy/LICENSE.txt" target="_blank" rel="noreferrer">SegThy · Krönke et al. (2022) · CC BY ↗</a>:source==='human'?<div className="us-case-links"><button disabled={!volume||busy} onClick={()=>openCase('ct')}>같은 위치 CT 보기 ↗</button><button disabled={!volume||busy} onClick={()=>openCase('xray')}>같은 사례 X-ray 보기 ↗</button><small>CT: 빔 중앙 ½ 깊이 · X-ray: 복부 전체 투영</small></div>:source==='anatomy'?<a href="./ultrasound/anatomical-phantom/ATTRIBUTION.txt" target="_blank" rel="noreferrer">BodyParts3D · 실제 해부 형상 출처 ↗</a>:<a href="./ultrasound/plus-phantom/LICENSE.txt" target="_blank" rel="noreferrer">PLUS 팬텀 · 출처와 라이선스 ↗</a>}</div>
    </main>
  </section>;
}
