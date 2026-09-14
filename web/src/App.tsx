import { useEffect, useRef, useState, useCallback } from 'react';
import { loadCase, type Volume } from './volume';
import { buildImageData, buildLabelData, createSliceView, createVolumeView, setSlicePosition, updateBeam, updateCrosshair, setSliceWindow, updateSlicePlanes, type SliceView, type VolumeView } from './vtkSetup';
import { computeBeam } from './beam';
import { labelColor } from './labels';
import type { DrrRequest, DrrResponse, ViewName } from './types';

const CASES = [{ id: 'example_ct', name: '전체 흉·복부 CT' }, { id: 'example_ct_sm', name: '상복부 CT (라벨)' }];

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
  const [vol, setVol] = useState<Volume | null>(null);
  const [slices, setSlices] = useState<Record<ViewName, number>>({ axial: 15, coronal: 50, sagittal: 61 });
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [sid, setSid] = useState(1000);
  const [preset, setPreset] = useState<string>('PA');
  const [drrUrl, setDrrUrl] = useState<string | null>(null);
  const [drrMs, setDrrMs] = useState<number | null>(null);
  const [showBeam, setShowBeam] = useState(true);
  const [tint, setTint] = useState(true);
  const [xrayTab, setXrayTab] = useState<'drr' | 'pos'>('drr');
  const [winPreset, setWinPreset] = useState<string>('기본');
  const [caseId, setCaseId] = useState('example_ct');

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

  const applyPreset = useCallback((p: Preset) => {
    setPreset(p.name);
    setYaw(p.yaw); setPitch(p.pitch); setRoll(p.roll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // clear previous views
    for (const el of [axialRef.current, coronalRef.current, sagittalRef.current, volRef.current]) {
      if (el) el.innerHTML = '';
    }
    viewsRef.current = null; volViewRef.current = null;
    workerRef.current?.terminate();
    loadCase(caseId).then((v) => {
      if (cancelled) return;
      setVol(v);
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
        const canvas = document.createElement('canvas');
        canvas.width = d.width; canvas.height = d.height;
        const ctx = canvas.getContext('2d')!;
        const img = ctx.createImageData(d.width, d.height);
        const px = new Uint8ClampedArray(d.pixels);
        const lp = d.labelPix ? new Uint8Array(d.labelPix) : null;
        for (let i = 0; i < px.length; i++) {
          const g = px[i];
          let r = g, gg = g, b = g;
          if (tint && lp && lp[i] !== 0) {
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
    });
    return () => { cancelled = true; workerRef.current?.terminate(); };
  }, [caseId]);

  // re-render tint when toggled (worker holds last result; just re-request)
  useEffect(() => {
    if (!vol) return;
    const copy = vol.data.slice().buffer;
    const lcopy = vol.labels ? vol.labels.slice().buffer : null;
    const sdd = sid * 1.15;
    const req: DrrRequest = {
      type: 'render', caseId: caseId, buffer: copy, labelBuffer: lcopy,
      dims: vol.meta.dims, spacing: vol.meta.spacing,
      yawDeg: yaw, pitchDeg: pitch, rollDeg: roll, sid, sdd, outSize: 200, stepMm: 2.5,
    };
    window.clearTimeout(drrTimer.current);
    drrTimer.current = window.setTimeout(() => {
      const transfers: Transferable[] = [copy];
      if (lcopy) transfers.push(lcopy);
      workerRef.current?.postMessage(req, transfers);
    }, 60);
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
  }, [winPreset]);

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

  const curPreset = PRESETS.find((p) => p.name === preset);

  return (
    <div className="app">
      <header>
        <h1>X-ray <span className="accent">Anatomy Lab</span></h1>
        <span className="sub">CT 단면 · 3D 구조 · 가상 X-ray 연동 학습 시뮬레이터</span>
        <select className="winsel" value={caseId} onChange={(e) => setCaseId(e.target.value)}>{CASES.map((cs) => <option key={cs.id} value={cs.id}>{cs.name}</option>)}</select><span className="badge">교육용 · 비진단</span>
      </header>
      <main className="layout">
        {/* left: 3 CT slices */}
        <div className="col slices">
          <div className="cell">
            <div className="cellhead"><span>Axial</span><select className="winsel" value={winPreset} onChange={(e) => setWinPreset(e.target.value)}>{Object.keys(WINDOWS).map((k) => <option key={k} value={k}>{k}</option>)}</select><input type="range" min={0} max={(vol?.meta.dims[2] ?? 1) - 1} value={slices.axial} onChange={(e) => setSlices((s) => ({ ...s, axial: +e.target.value }))} /></div>
            <div ref={axialRef} className="vpwrap" />
          </div>
          <div className="cell">
            <div className="cellhead"><span>Coronal</span><input type="range" min={0} max={(vol?.meta.dims[1] ?? 1) - 1} value={slices.coronal} onChange={(e) => setSlices((s) => ({ ...s, coronal: +e.target.value }))} /></div>
            <div ref={coronalRef} className="vpwrap" />
          </div>
          <div className="cell">
            <div className="cellhead"><span>Sagittal</span><input type="range" min={0} max={(vol?.meta.dims[0] ?? 1) - 1} value={slices.sagittal} onChange={(e) => setSlices((s) => ({ ...s, sagittal: +e.target.value }))} /></div>
            <div ref={sagittalRef} className="vpwrap" />
          </div>
        </div>

        {/* center: 3D */}
        <div className="col center">
          <div className="cell fill">
            <div className="cellhead">
              <span>3D + X-ray 빔</span>
              <label className="inline"><input type="checkbox" checked={showBeam} onChange={(e) => setShowBeam(e.target.checked)} /> 빔</label>
            </div>
            <div ref={volRef} className="vpwrap" />
            <div className="legend">
              <span><i style={{ background: '#e6404d' }} />심장</span>
              <span><i style={{ background: '#8cb3f2' }} />폐</span>
              <span><i style={{ background: '#f24d4d' }} />대동맥</span>
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
                <button className={xrayTab === 'drr' ? 'active' : ''} onClick={() => setXrayTab('drr')}>X-ray</button>
                <button className={xrayTab === 'pos' ? 'active' : ''} onClick={() => setXrayTab('pos')}>포지셔닝</button>
              </div>
              <label className="inline"><input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} /> 구조색</label>
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
            <label>SID <span className="val">{sid}mm</span><input type="range" min={600} max={1500} step={50} value={sid} onChange={(e) => setSid(+e.target.value)} /></label>
          </div>
        </div>
      </main>
      <footer>
        <span>데이터: TotalSegmentator 예제 CT (CC BY 4.0) · 라벨맵: total task · DRR: Beer–Lambert 근사</span>
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
