import { useEffect, useRef, useState, useCallback } from 'react';
import AtlasView from './AtlasView';
import UltrasoundView from './UltrasoundView';
import ImagingLibrary from './ImagingLibrary';
import type {Vec3} from './ultrasound';
import { loadCase, type Volume } from './volume';
import { buildImageData, buildLabelData, createSliceView, createVolumeView, setSlicePosition, updateBeam, updateCrosshair, setSliceWindow, updateSlicePlanes, type SliceView, type VolumeView } from './vtkSetup';
import { computeBeam } from './beam';
import { labelColor } from './labels';
import type { DrrRequest, DrrResponse, ViewName } from './types';

const CASES = [{ id: 'example_ct', name: '복부 CT · 넓은 범위' }, { id: 'example_ct_sm', name: '상복부 · 장기 연동' }];

interface Preset { name: string; yaw: number; pitch: number; roll: number; desc: string }
const PRESETS: Preset[] = [
  { name: 'PA', yaw: 0, pitch: 0, roll: 0, desc: '후-전 정면' },
  { name: 'AP', yaw: 180, pitch: 0, roll: 0, desc: '전-후 정면' },
  { name: '좌측면', yaw: -90, pitch: 0, roll: 0, desc: '좌측 측면' },
  { name: '우측면', yaw: 90, pitch: 0, roll: 0, desc: '우측 측면' },
  { name: 'LAO 45°', yaw: -45, pitch: 0, roll: 0, desc: '좌전방 사위' },
  { name: 'RAO 45°', yaw: 45, pitch: 0, roll: 0, desc: '우전방 사위' },
];

export default function App() {
  const [workspace,setWorkspace] = useState<'atlas'|'case'|'ultrasound'|'library'>('atlas');
  const [libraryOrgan,setLibraryOrgan]=useState<number|undefined>();
  const pendingFocus=useRef<Vec3|null>(null);
  const [usInitial,setUsInitial]=useState<{organ:number;world?:Vec3;source?:'human'|'anatomy'}>({organ:2});
  const [caseError,setCaseError]=useState('');
  const [caseRetry,setCaseRetry]=useState(0);
  const [activePlane,setActivePlane] = useState<ViewName>('axial');
  const [mode,setMode] = useState<'ct'|'xray'>('ct');
  const [selectedOrgan,setSelectedOrgan] = useState('');
  const [vol, setVol] = useState<Volume | null>(null);
  const [slices, setSlices] = useState<Record<ViewName, number>>({ axial: 15, coronal: 50, sagittal: 61 });
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [sid, setSid] = useState(1000);
  const [preset, setPreset] = useState<string>('PA');
  const [drrUrl, setDrrUrl] = useState<string | null>(null);
  const [drrMs, setDrrMs] = useState<number | null>(null);
  const [showBeam, setShowBeam] = useState(false);
  const [tint, setTint] = useState(false);
  const tintRef = useRef(tint); tintRef.current = tint;
  const [xrayTab, setXrayTab] = useState<'drr' | 'pos'>('drr');
  const [winPreset, setWinPreset] = useState<string>('연조직');
  const [caseId, setCaseId] = useState('example_ct_sm');

  const WINDOWS: Record<string, [number, number]> = {
    '기본': [2307, 53], '뼈': [2000, 400], '폐': [1600, -600], '연조직': [400, 40],
  };

  const axialRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const viewsRef = useRef<Record<ViewName, SliceView> | null>(null);
  const volViewRef = useRef<VolumeView | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const drrTimer = useRef<number>(0);
  const requestIdRef = useRef(0);

  const applyPreset = useCallback((p: Preset) => {
    setPreset(p.name);
    setYaw(p.yaw); setPitch(p.pitch); setRoll(p.roll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVol(null); setDrrUrl(null);setCaseError('');
    const abort=new AbortController();
    // clear previous views
    for (const el of [axialRef.current, coronalRef.current, sagittalRef.current, volRef.current]) {
      if (el) el.innerHTML = '';
    }
    viewsRef.current = null; volViewRef.current = null;
    workerRef.current?.terminate();
    loadCase(caseId,abort.signal).then((v) => {
      if (cancelled) return;
      setVol(v);
      const p=pendingFocus.current;pendingFocus.current=null;
      const ijk=p?p.map((x,i)=>Math.max(0,Math.min(v.meta.dims[i]-1,Math.round((x-v.meta.origin[i])/v.meta.spacing[i])))):v.meta.dims.map(n=>Math.floor(n/2));
      setSlices({axial:ijk[2],coronal:ijk[1],sagittal:ijk[0]});
      const imageData = buildImageData(v);
      const labelData = buildLabelData(v);
      viewsRef.current = {
        axial: createSliceView(axialRef.current!, imageData, 'axial'),
        coronal: createSliceView(coronalRef.current!, imageData, 'coronal'),
        sagittal: createSliceView(sagittalRef.current!, imageData, 'sagittal'),
      };
      volViewRef.current = createVolumeView(volRef.current!, imageData, labelData);
      const w = new Worker(new URL('./drr.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<DrrResponse>) => {
        const d = e.data;
        if(d.requestId !== requestIdRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = d.width; canvas.height = d.height;
        const ctx = canvas.getContext('2d')!;
        const img = ctx.createImageData(d.width, d.height);
        const px = new Uint8ClampedArray(d.pixels);
        const lp = d.labelPix ? new Uint8Array(d.labelPix) : null;
        for (let i = 0; i < px.length; i++) {
          const g = px[i];
          let r = g, gg = g, b = g;
          if (tintRef.current && lp && lp[i] !== 0) {
            const c = labelColor(lp[i]);
            r = g * 0.55 + c[0] * 0.45;
            gg = g * 0.55 + c[1] * 0.45;
            b = g * 0.55 + c[2] * 0.45;
          }
          img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        setDrrUrl(canvas.toDataURL('image/png'));
        setDrrMs(d.ms);
      };
      workerRef.current = w;
    }).catch(e=>{if(!cancelled)setCaseError(e.message);});
    return () => { cancelled = true;abort.abort();workerRef.current?.terminate();
      if (viewsRef.current) Object.values(viewsRef.current).forEach(v => v.grw.delete());
      volViewRef.current?.grw.delete();
    };
  }, [caseId,caseRetry]);

  // re-render tint when toggled (worker holds last result; just re-request)
  useEffect(() => {
    if (!vol) return;
    const copy = vol.data.slice().buffer;
    const lcopy = vol.labels ? vol.labels.slice().buffer : null;
    const sdd = sid * 1.15;
    const req: DrrRequest = {
      type: 'render', requestId: ++requestIdRef.current, caseId: caseId, buffer: copy, labelBuffer: lcopy,
      dims: vol.meta.dims, spacing: vol.meta.spacing,
      yawDeg: yaw, pitchDeg: pitch, rollDeg: roll, sid, sdd, outSize: 320, stepMm: 1.5,
    };
    window.clearTimeout(drrTimer.current);
    drrTimer.current = window.setTimeout(() => {
      const transfers: Transferable[] = [copy];
      if (lcopy) transfers.push(lcopy);
      workerRef.current?.postMessage(req, transfers);
    }, 180);
    return () => window.clearTimeout(drrTimer.current);
  }, [yaw, pitch, roll, sid, vol, tint]);

  // slice sync
  useEffect(() => {
    if (!vol || !viewsRef.current) return;
    const [ox, oy, oz] = vol.meta.origin;
    const [sx, sy, sz] = vol.meta.spacing;
    const world: [number, number, number] = [
      ox + slices.sagittal * sx,
      oy + slices.coronal * sy,
      oz + slices.axial * sz,
    ];
    setSlicePosition(viewsRef.current.axial, world);
    setSlicePosition(viewsRef.current.coronal, world);
    setSlicePosition(viewsRef.current.sagittal, world);
    const b = viewsRef.current.axial.mapper.getInputData().getBounds();
    updateCrosshair(viewsRef.current.axial, world, b);
    updateCrosshair(viewsRef.current.coronal, world, b);
    updateCrosshair(viewsRef.current.sagittal, world, b);
    if (volViewRef.current) updateSlicePlanes(volViewRef.current, world, b);
  }, [slices, vol]);

  useEffect(() => {
    if (!viewsRef.current) return;
    const [w, l] = WINDOWS[winPreset] ?? WINDOWS['기본'];
    setSliceWindow(viewsRef.current.axial, w, l);
    setSliceWindow(viewsRef.current.coronal, w, l);
    setSliceWindow(viewsRef.current.sagittal, w, l);
  }, [winPreset, vol]);

  // beam overlay
  useEffect(() => {
    if (!vol || !volViewRef.current) return;
    if (!showBeam) {
      const vv = volViewRef.current;
      for (const a of vv.beamActors) vv.renderer.removeActor(a);
      vv.beamActors.length = 0;
      vv.grw.getRenderWindow().render();
      return;
    }
    const beam = computeBeam(vol.meta.dims, vol.meta.spacing, yaw, pitch, roll, sid, sid * 1.15);
    updateBeam(volViewRef.current, beam, vol.center);
  }, [yaw, pitch, roll, sid, vol, showBeam]);

  const selectOrgan = (id:number,name:string) => {
    if (!vol?.labels) return;
    const [nx,ny] = vol.meta.dims; let x=0,y=0,z=0,n=0;
    vol.labels.forEach((v,i)=>{if(v===id){x+=i%nx;y+=Math.floor(i/nx)%ny;z+=Math.floor(i/(nx*ny));n++;}});
    if(n){setSlices({sagittal:Math.round(x/n),coronal:Math.round(y/n),axial:Math.round(z/n)});setSelectedOrgan(name);setMode('ct');}
  };
  useEffect(()=>{
    requestAnimationFrame(()=>{
      if(viewsRef.current) Object.values(viewsRef.current).forEach(v=>{v.grw.resize();v.grw.getRenderWindow().render();});
      if(volViewRef.current){
        for(const v of ['axial','coronal','sagittal'] as ViewName[]) volViewRef.current.slicePlanes[v].setVisibility(mode==='ct' && v===activePlane);
        volViewRef.current.grw.resize();volViewRef.current.grw.getRenderWindow().render();
      }
    });
  },[activePlane,mode,vol,workspace]);
  const curPreset = PRESETS.find((p) => p.name === preset);

  return (
    <div className="app">
      <header>
        <h1>X-ray <span className="accent">Anatomy Lab</span></h1>
        <span className="sub">해부 아틀라스 · CT · X-ray · 초음파 촬영 학습</span>
        <select aria-label="CT 사례" className="winsel" value={caseId} disabled={workspace!=='case'} onChange={(e) => setCaseId(e.target.value)}>{CASES.map((cs) => <option key={cs.id} value={cs.id}>{cs.name}</option>)}</select><span className="badge">교육용 · 비진단</span>
      </header>
      <nav className="top-workspaces" aria-label="학습 작업 공간"><button className={workspace==='atlas'?'active':''} onClick={()=>setWorkspace('atlas')}>전신 · 계통별 탐색</button><button className={workspace==='case'?'active':''} onClick={()=>setWorkspace('case')}>실제 CT · X-ray 사례</button><button className={workspace==='ultrasound'?'active':''} onClick={()=>setWorkspace('ultrasound')}>초음파 촬영 연습</button><button className={workspace==='library'?'active':''} onClick={()=>setWorkspace('library')}>실제 영상 자료</button></nav>
      {workspace==='atlas' && <AtlasView onUltrasound={id=>{setUsInitial({organ:id,source:id===5?'human':'anatomy'});setWorkspace('ultrasound');}}/>}
      {workspace==='ultrasound' && <UltrasoundView initialOrgan={usInitial.organ} initialWorld={usInitial.world} initialSource={usInitial.source} onOpenReference={(organ,source)=>{setUsInitial({organ,source});setLibraryOrgan(organ);setWorkspace('library');}} onOpenCase={(nextMode,p)=>{
        if(caseId==='example_ct'&&vol){const ijk=p.map((x,i)=>Math.max(0,Math.min(vol.meta.dims[i]-1,Math.round((x-vol.meta.origin[i])/vol.meta.spacing[i]))));setSlices({sagittal:ijk[0],coronal:ijk[1],axial:ijk[2]});}
        else {pendingFocus.current=p;setCaseId('example_ct');}
        setSelectedOrgan('초음파 빔 중앙 위치');setMode(nextMode);setActivePlane('axial');setShowBeam(nextMode==='xray');setWorkspace('case');
      }}/>}
      {workspace==='library' && <ImagingLibrary initialOrgan={libraryOrgan}/>}
      <div style={{display:workspace==='case'?'contents':'none'}}>
      {caseError&&<div role="alert" className="us-error">{caseError}<button onClick={()=>setCaseRetry(n=>n+1)}>CT 다시 불러오기</button></div>}
      <div className="guide">① 복부 3D에서 장기 위치 확인 → ② CT 슬라이더로 절단 위치 이동 → ③ 같은 높이의 단면 비교 · X-ray는 여러 구조가 겹친 투영 영상입니다.</div>
      <nav className="workspace-nav">
        <button className={mode==='ct'?'active':''} onClick={()=>setMode('ct')}>CT 단면 학습</button>
        <button className={mode==='xray'?'active':''} onClick={()=>setMode('xray')}>X-ray 촬영 방향</button>
        <button disabled={!vol} onClick={()=>{if(vol){setUsInitial({organ:5,world:[vol.meta.origin[0]+slices.sagittal*vol.meta.spacing[0],vol.meta.origin[1]+slices.coronal*vol.meta.spacing[1],vol.meta.origin[2]+slices.axial*vol.meta.spacing[2]]});setWorkspace('ultrasound');}}}>같은 높이 초음파 연습 ↗</button>
        {(['axial','coronal','sagittal'] as ViewName[]).map((v,i)=><button className={activePlane===v?'active':''} key={v} onClick={()=>{setActivePlane(v);setMode('ct');}}>{['가로','앞뒤','좌우'][i]} 단면</button>)}
        <span>부위: {selectedOrgan || '상복부'} · {vol?.meta.dims[2]}개 CT 단면</span>
      </nav>
      <main className={'layout mode-'+mode+' plane-'+activePlane}>
        {/* left: 3 CT slices */}
        <div className="col slices">
          <div className="cell axial"><div className="orientation">위: 앞(A) · 아래: 뒤(P) · 화면 왼쪽: 환자 오른쪽(R)</div>
            <div className="cellhead"><span>CT · 가로 단면</span><select className="winsel" value={winPreset} onChange={(e) => setWinPreset(e.target.value)}>{Object.keys(WINDOWS).map((k) => <option key={k} value={k}>{k}</option>)}</select><input type="range" min={0} max={(vol?.meta.dims[2] ?? 1) - 1} value={slices.axial} onChange={(e) => setSlices((s) => ({ ...s, axial: +e.target.value }))} /></div>
            <div ref={axialRef} className="vpwrap" />
          </div>
          <div className="cell coronal">
            <div className="cellhead"><span>CT · 앞뒤 단면</span><input type="range" min={0} max={(vol?.meta.dims[1] ?? 1) - 1} value={slices.coronal} onChange={(e) => setSlices((s) => ({ ...s, coronal: +e.target.value }))} /></div>
            <div ref={coronalRef} className="vpwrap" />
          </div>
          <div className="cell sagittal">
            <div className="cellhead"><span>CT · 좌우 단면</span><input type="range" min={0} max={(vol?.meta.dims[0] ?? 1) - 1} value={slices.sagittal} onChange={(e) => setSlices((s) => ({ ...s, sagittal: +e.target.value }))} /></div>
            <div ref={sagittalRef} className="vpwrap" />
          </div>
        </div>

        {/* center: 3D */}
        <div className="col center">
          <div className="cell fill">
            <div className="cellhead">
              <span>실제 CT로 재구성한 복부 3D</span>
              <label className="inline"><input type="checkbox" checked={showBeam} onChange={(e) => setShowBeam(e.target.checked)} /> 빔</label>
            </div>
            <div className="organ-select">
            {vol?.labels && [[5,'간'],[1,'비장'],[2,'우신장'],[3,'좌신장'],[6,'위']].map(([id,name])=><button key={id} className={selectedOrgan===name?'active':''} onClick={()=>selectOrgan(Number(id),String(name))}>{name}</button>)}
            <span>장기를 선택하면 해당 위치의 CT 단면으로 이동합니다.</span>
            </div>
            <div ref={volRef} className="vpwrap" />
            <div className="legend" style={{visibility: vol?.labels ? "visible" : "hidden"}}>
              <span><i style={{ background: '#ffa359' }} />신장</span>
              <span><i style={{ background: '#a673d9' }} />비장</span>
              <span><i style={{ background: '#e6bf66' }} />위</span>
              <span><i style={{ background: '#cc8040' }} />간</span>
              <span><i style={{ background: '#ddd6c0' }} />뼈</span>
            </div>
          </div>
        </div>

        {/* right: X-ray + controls */}
        <div className="col right">
          <div className="cell fill">
            <div className="cellhead">
              <div className="tabs">
                <button className={xrayTab === 'drr' ? 'active' : ''} onClick={() => setXrayTab('drr')}>가상 X-ray</button>
                <button className={xrayTab === 'pos' ? 'active' : ''} onClick={() => setXrayTab('pos')}>포지셔닝</button>
              </div>
              <label className="inline"><input type="checkbox" disabled={!vol?.labels} checked={tint} onChange={(e) => setTint(e.target.checked)} /> 구조색</label>
            </div>
            <div className="xraywrap">
              {xrayTab === 'drr' ? (
                drrUrl ? <img className="drrimg" src={drrUrl} alt="DRR" /> : <p className="hint">계산 중…</p>
              ) : (
                <PositioningPlaceholder vol={vol} axialK={slices.axial} yaw={yaw} pitch={pitch} sid={sid} />
              )}
            </div>
            {drrMs !== null && xrayTab === 'drr' && <p className="meta">{drrMs.toFixed(0)}ms</p>}
          </div>
          <div className="cell controls">
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} className={preset === p.name ? 'active' : ''} onClick={() => applyPreset(p)}>{p.name}</button>
              ))}
            </div>
            {curPreset && <p className="hint">{curPreset.desc}</p>}
            <label>환자 회전 <span className="val">{yaw}°</span><input type="range" min={-180} max={180} value={yaw} onChange={(e) => { setYaw(+e.target.value); setPreset(''); }} /></label>
            <label>C-arm 각도 <span className="val">{pitch}°</span><input type="range" min={-60} max={60} value={pitch} onChange={(e) => { setPitch(+e.target.value); setPreset(''); }} /></label>
            <label>검출기 회전 <span className="val">{roll}°</span><input type="range" min={-90} max={90} value={roll} onChange={(e) => { setRoll(+e.target.value); setPreset(''); }} /></label>
            <label>소스–몸 중심 거리 <span className="val">{sid}mm</span><input type="range" min={600} max={1500} step={50} value={sid} onChange={(e) => setSid(+e.target.value)} /></label>
          </div>
        </div>
      </main>
      </div>
      <footer>
        <span>{workspace==='ultrasound'?'실측 인체: SegThy · 실측 팬텀: PLUS · 전신/CT 음향 근사: 실험용':workspace==='library'?'실제 영상 표본: FracAtlas · BUS-BRA · 사례별 출처·이용 고지 확인':'데이터: BodyParts3D · TotalSegmentator CT · DRR: Beer–Lambert 근사'}</span>
        <span className="right">교육용 시뮬레이션 — 진단·치료 목적 아님</span>
      </footer>
    </div>
  );
}

// lazy import to avoid circular; simple wrapper
import PositioningView from './PositioningView';
function PositioningPlaceholder({ vol, axialK, yaw, pitch, sid }: { vol: Volume | null; axialK: number; yaw: number; pitch: number; sid: number }) {
  if (!vol) return <p className="hint">로딩…</p>;
  return <PositioningView vol={vol} axialK={axialK} yawDeg={yaw} pitchDeg={pitch} sid={sid} />;
}
