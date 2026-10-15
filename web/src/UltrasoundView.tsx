import {useEffect,useRef,useState} from 'react';
import {loadCase} from './volume';
import {DEFAULT_PROBE,probeGeometry,imagePoint,voxelPoint,type ProbeSettings,type UsVolume,type UsFrame,type Vec3} from './ultrasound';
import UltrasoundScene from './UltrasoundScene';
import {labelColor} from './labels';

const ORGAN_NAMES:Record<number,string>={1:'비장',2:'오른쪽 신장',3:'왼쪽 신장',5:'간',6:'위'};
function organPosition(v:UsVolume,id:number):Partial<ProbeSettings>|null {
  if(!v.labels)return null;
  let x=0,z=0,n=0;v.labels.forEach((label,i)=>{if(label===id){x+=i%v.dims[0];z+=Math.floor(i/(v.dims[0]*v.dims[1]));n++;}});
  return n?{lateral:x/n/(v.dims[0]-1)*100,height:z/n/(v.dims[2]-1)*100}:null;
}
export default function UltrasoundView({onOpenCase,initialOrgan=2,initialWorld}: {onOpenCase:(mode:'ct'|'xray',world:Vec3)=>void;initialOrgan?:number;initialWorld?:Vec3}) {
  const [source,setSource]=useState<'human'|'phantom'|'anatomy'>(initialWorld||initialOrgan===5?'human':'anatomy'),[retry,setRetry]=useState(0);
  const [volume,setVolume]=useState<UsVolume|null>(null),[settings,setSettings]=useState<ProbeSettings>(DEFAULT_PROBE);
  const [frame,setFrame]=useState<(UsFrame & {settings:ProbeSettings})|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const [reference,setReference]=useState(false);
  const [frozen,setFrozen]=useState(false),[overlay,setOverlay]=useState(false),[hover,setHover]=useState(''),[target,setTarget]=useState('간');
  const worker=useRef<Worker|null>(null),request=useRef(0),canvas=useRef<HTMLCanvasElement>(null);
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
        const [raw,skin]=await Promise.all([read(meta.file),read(meta.skin)]),materials=new Uint8Array(raw);
        if(materials.length!==meta.dims.reduce((a:number,b:number)=>a*b,1)||skin.byteLength!==meta.skinVertices*12)throw Error('인체 팬텀 크기가 일치하지 않습니다.');
        const data=Int16Array.from(materials,label=>label===0?-1000:label===11?1000:20);
        v={data,labels:materials,dims:meta.dims,spacing:meta.spacing,origin:meta.origin,kind:'anatomy',skinPoints:new Float32Array(skin)};
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
      w.onmessage=e=>{
        if(disposed||e.data.requestId!==request.current)return;
        setBusy(false);
        if(e.data.type==='error'){setError(e.data.message);return;}
        setFrame(e.data);setError('');
      };
      w.onerror=()=>{if(!disposed){setBusy(false);setError('초음파 계산에 실패했습니다. 다시 불러오세요.');}};
      w.postMessage({type:'init',volume:{...v,skinPoints:undefined}});
      const organId=source==='anatomy'&&initialOrgan===5?2:initialOrgan;
      setVolume(v);setTarget(source!=='phantom'?(initialWorld&&source==='human'?'CT 선택 위치':ORGAN_NAMES[organId]??'선택 장기'):'시험 팬텀');
      const initialPosition=initialWorld&&source==='human'?{lateral:Math.max(5,Math.min(95,(initialWorld[0]-v.origin[0])/((v.dims[0]-1)*v.spacing[0])*100)),height:Math.max(5,Math.min(95,(initialWorld[2]-v.origin[2])/((v.dims[2]-1)*v.spacing[2])*100))}:organPosition(v,organId);
      setSettings({...DEFAULT_PROBE,...(source!=='phantom'?initialPosition:{depth:50,height:50})});
    })().catch(e=>{if(!disposed){setBusy(false);setError(e.message);}});
    return()=>{disposed=true;abort.abort();worker.current?.terminate();worker.current=null;request.current++;};
  },[source,retry]);
  useEffect(()=>{
    if(!volume||frozen||!worker.current)return;
    const id=++request.current;setBusy(true);
    const timer=window.setTimeout(()=>worker.current?.postMessage({type:'render',requestId:id,settings}),60);
    return()=>window.clearTimeout(timer);
  },[volume,settings,frozen]);
  useEffect(()=>{
    if(!frame||!canvas.current)return;
    const c=canvas.current;c.width=frame.width;c.height=frame.height;
    const ctx=c.getContext('2d')!,img=ctx.createImageData(c.width,c.height);
    for(let i=0;i<frame.pixels.length;i++) {
      const g=reference&&frame.reference?frame.reference[i]:frame.pixels[i],color=overlay&&g>10&&frame.labels[i]&&!(volume?.kind==='anatomy'&&frame.labels[i]===10)?(volume?.kind==='anatomy'&&frame.labels[i]===11?[225,215,190]:labelColor(frame.labels[i])):null;
      img.data[i*4]=color?g*.6+color[0]*.4:g;img.data[i*4+1]=color?g*.6+color[1]*.4:g;img.data[i*4+2]=color?g*.6+color[2]*.4:g;img.data[i*4+3]=255;
    }
    ctx.putImageData(img,0,0);
    ctx.font='9px sans-serif';ctx.textAlign='right';ctx.fillStyle='#b6c9c9';ctx.strokeStyle='#849b9b';
    for(let tick=1;tick<=5;tick++){const y=Math.min(c.height-4,tick/5*c.height);ctx.fillText((frame.settings.depth/10*tick/5).toFixed(1),c.width-10,y);ctx.beginPath();ctx.moveTo(c.width-7,y-3);ctx.lineTo(c.width-2,y-3);ctx.stroke();}
  },[frame,overlay,reference]);
  const changeSource=(next:'human'|'phantom'|'anatomy')=>{if(next===source||frozen)return;request.current++;setVolume(null);setFrame(null);setBusy(true);setSource(next);};
  const change=(patch:Partial<ProbeSettings>)=>{if(!frozen){setSettings(s=>({...s,...patch}));setHover('');}};
  const reset=()=>{setFrozen(false);setSettings({...DEFAULT_PROBE,...(volume&&volume.kind!=='phantom'?organPosition(volume,volume.kind==='anatomy'?2:initialOrgan):{depth:50,height:50})});setTarget(volume?.kind==='anatomy'?'오른쪽 신장':volume?.kind==='human'?ORGAN_NAMES[initialOrgan]:'시험 팬텀');};
  const slider=(key:keyof ProbeSettings,title:string,min:number,max:number,step:number,unit:string)=>
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
      <div className="us-source-tabs us-datasets"><button disabled={frozen} className={source==='anatomy'?'active':''} onClick={()=>changeSource('anatomy')}>전신 인체 팬텀</button><button disabled={frozen} className={source==='human'?'active':''} onClick={()=>changeSource('human')}>실제 복부 CT 기반</button><button disabled={frozen} className={source==='phantom'?'active':''} onClick={()=>changeSource('phantom')}>실측 시험 팬텀</button></div>
      {source==='anatomy'&&<p className="us-muted">실제 피부 메시 · 내부 재료 4mm 근사. 신장·비장·위·뼈를 구분하며 나머지는 일반 연부조직입니다.</p>}
      <div className="us-control-section"><h3>01 <span>탐색 위치</span></h3>
      {source!=='phantom'&&<div className="us-organ-presets">{(source==='anatomy'?[2,3,1,6]:[5,2,3,1]).map(id=><button disabled={frozen||!volume} className={target===ORGAN_NAMES[id]?'active':''} key={id} onClick={()=>{const p=volume&&organPosition(volume,id);if(p){change({...p,rotation:0,tilt:0,rock:0});setTarget(ORGAN_NAMES[id]);}}}>{ORGAN_NAMES[id]}</button>)}</div>}
      {slider('lateral','좌우 위치',5,95,.5,'%')}{slider('height','상하 위치',5,95,.5,'%')}
      </div><div className="us-control-section"><h3>02 <span>탐촉자 방향</span></h3>
      <div className="us-source-tabs"><button disabled={frozen||!volume} className={settings.rotation===0?'active':''} onClick={()=>change({rotation:0,tilt:0,rock:0})}>가로 스캔</button><button disabled={frozen||!volume} className={settings.rotation===90?'active':''} onClick={()=>change({rotation:90,tilt:0,rock:0})}>세로 스캔</button></div>
      {slider('rotation','탐촉자 회전',-180,180,1,'°')}{slider('tilt','앞뒤 기울임',-35,35,1,'°')}{slider('rock','좌우 기울임',-35,35,1,'°')}
      </div><div className="us-control-section"><h3>03 <span>영상 설정</span></h3>
      <label className="us-probe-select">탐촉자<select aria-label="탐촉자 종류" value={settings.probe} disabled={frozen||!volume} onChange={e=>change({probe:e.target.value as ProbeSettings['probe'],depth:source==='phantom'?(e.target.value==='linear'?40:50):(e.target.value==='linear'?70:180)})}><option value="curved">곡면형 · 70° 부채꼴</option><option value="linear">선형 · 폭 50mm</option></select></label>
      {slider('depth','영상 깊이',source!=='phantom'?40:15,source!=='phantom'?220:85,1,'mm')}{slider('gain','전체 Gain',-24,24,1,'dB')}
      {source!=='phantom'&&<>{slider('frequency','주파수',2,8,.5,'MHz')}{slider('tgc','깊이 보상 TGC',0,1.5,.1,'')}</>}
      </div><button className="us-reset" onClick={reset}>자세·영상 설정 초기화</button>
    </aside>
    <main className="us-main">
      <div className="us-session-heading"><div><span className="us-eyebrow">{source==='anatomy'?'HUMAN ANATOMICAL PHANTOM':source==='human'?'CT → ACOUSTIC APPROXIMATION':'MEASURED 3D ULTRASOUND'}</span><h2>{source==='anatomy'?'인체 위에서 탐촉자를 움직이세요':source==='human'?'복부에서 스캔면 찾기':'실측 초음파 볼륨 탐색'}</h2></div><span className={'us-live '+(frozen?'paused':'')}>{frozen?'Ⅱ 정지':'● LIVE'}</span></div>
      <div className="us-viewports">
        <article className="us-panel"><div className="us-panel-heading"><span>01 / {source==='anatomy'?'실제 인체 형상':source==='human'?'실제 CT 기반 인체':'시험용 초음파 팬텀'}</span><span>3D + SCAN PLANE</span></div>
          {volume?<UltrasoundScene volume={volume} settings={settings} onContact={(x,z)=>change({lateral:x,height:z})}/>:<div className="us-loading" role="status">{error?'데이터를 불러오지 못했습니다.':'3D 구조와 영상을 준비하고 있습니다…'}</div>}
          <div className="us-key"><span><i style={{background:'#6fe0cb'}}/>스캔면</span><span><i style={{background:'#fbc842'}}/>탐촉자 marker = 영상 왼쪽</span></div>
        </article>
        <article className="us-panel"><div className="us-panel-heading"><span>02 / {reference?'동일면 CT':'B-MODE'}</span><span>{source!=='phantom'?(reference?'실제 CT · 사위 재단면':'합성 · 교육용 근사'):'실측 볼륨 · 재단면'}</span></div>
          <div className="us-image-area" aria-busy={busy}>
            <canvas ref={canvas} aria-label="초음파 단면 영상" data-source={volume?.kind} data-pose={frame?JSON.stringify(frame.settings):''} data-ready={!!frame} data-coverage={frame?.coverage??0} onPointerMove={e=>{
              if(!volume||!geometry||!frame||busy)return;const r=e.currentTarget.getBoundingClientRect(),col=(e.clientX-r.left)/r.width*(frame.width-1),row=(e.clientY-r.top)/r.height*(frame.height-1),p=imagePoint(geometry,settings,col,frame.width,frame.height,row);
              if(!p){setHover('영상 영역 밖');return;}const [i,j,k]=voxelPoint(volume,p).map(Math.round),[nx,ny,nz]=volume.dims;
      const label=volume.labels&&i>=0&&j>=0&&k>=0&&i<nx&&j<ny&&k<nz?volume.labels[i+j*nx+k*nx*ny]:0;
              setHover(`${label?(source==='anatomy'&&label===10?'일반 연부조직':source==='anatomy'&&label===11?'뼈':ORGAN_NAMES[label]??'분할 구조 #'+label):'미분류 조직'} · ${p.map(n=>n.toFixed(0)).join(', ')} mm`);
            }} onPointerLeave={()=>setHover('')}/>
            <span className="us-image-marker">◀</span><span className="us-image-info">{settings.probe==='curved'?'C':'L'} {source!=='phantom'?settings.frequency.toFixed(1)+'MHz':'3DUS'}<br/>{(settings.depth/10).toFixed(1)}cm · G {settings.gain}dB</span>
            {busy&&<span className="us-calculating" role="status">{frame?'영상 갱신 중…':'첫 단면 계산 중…'}</span>}
            {volume&&geometry&&!geometry.contact&&<span className="us-empty">체표를 찾을 수 없습니다. 위치를 몸 안쪽으로 옮기세요.</span>}
          </div>
          <div className="us-image-controls"><button className={frozen?'active':''} disabled={!frame||busy} onClick={()=>setFrozen(s=>!s)}>{frozen?'재생':'영상 정지'}</button>{source==='human'&&<button className={reference?'active':''} disabled={!frame} onClick={()=>setReference(s=>!s)}>{reference?'B-mode 보기':'같은 면 CT 비교'}</button>}<label><input type="checkbox" checked={overlay} disabled={source==='phantom'} onChange={e=>setOverlay(e.target.checked)}/> 구조 해설색</label><span>{frame?`${frame.ms.toFixed(0)}ms · 범위 ${(frame.coverage*100).toFixed(0)}%`:''}</span></div>
          <div className="us-readout">{hover||(overlay?'색은 해부 분할 기반 해설이며 초음파 원신호가 아닙니다.':'영상 위에 마우스를 올려 같은 위치의 구조를 확인하세요.')}</div>
        </article>
      </div>
      {error&&<div className="us-error" role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>다시 불러오기</button></div>}
      <div className="us-learning-strip"><div><span className="us-eyebrow">지금 이해할 것</span><h3>{source!=='phantom'?'같은 장기도 스캔 방향에 따라 모양이 달라집니다.':'실측 신호의 위치 관계를 먼저 확인하세요.'}</h3><p>{source==='anatomy'?'실제 피부·뼈·신장·비장·위 메시를 같은 좌표에서 사용합니다. 기타 내부는 일반 연부조직 근사입니다. 이 팬텀은 환자 CT가 아니며 완전한 간·폐·혈관, 압박·굴절·혈류는 포함하지 않습니다.':source==='human'?'가로 ↔ 세로 스캔을 비교하세요. 현재 모델은 반사·왕복 감쇠·고정 산란을 근사하며 압박·굴절·혈류는 재현하지 않습니다.':'이 모드는 실제 3DUS에서 단면을 다시 자릅니다. 탐촉자 각도에 따른 새 반사·압박 영상을 생성하는 기능은 아닙니다.'}</p></div>
      {source==='human'?<div className="us-case-links"><button disabled={!volume||busy} onClick={()=>openCase('ct')}>같은 위치 CT 보기 ↗</button><button disabled={!volume||busy} onClick={()=>openCase('xray')}>같은 사례 X-ray 보기 ↗</button><small>CT: 빔 중앙 ½ 깊이 · X-ray: 복부 전체 투영</small></div>:source==='anatomy'?<a href="./ultrasound/anatomical-phantom/ATTRIBUTION.txt" target="_blank" rel="noreferrer">BodyParts3D · 실제 해부 형상 출처 ↗</a>:<a href="./ultrasound/plus-phantom/LICENSE.txt" target="_blank" rel="noreferrer">PLUS 팬텀 · 출처와 라이선스 ↗</a>}</div>
    </main>
  </section>;
}
