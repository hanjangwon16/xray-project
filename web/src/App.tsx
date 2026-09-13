import { useEffect, useRef, useState, useCallback } from 'react';
import { loadCase, type Volume } from './volume';
import { buildImageData, createSliceView, createVolumeView, setSlicePosition, updateBeam, type SliceView, type VolumeView } from './vtkSetup';
import { computeBeam } from './beam';
import type { DrrRequest, DrrResponse, ViewName } from './types';

const CASE_ID = 'example_ct_sm';

interface Preset { name: string; yaw: number; pitch: number; roll: number; desc: string }
const PRESETS: Preset[] = [
  { name: 'PA 정면', yaw: 0, pitch: 0, roll: 0, desc: '후-전 방향, 표준 흉부 정면' },
  { name: 'AP 정면', yaw: 180, pitch: 0, roll: 0, desc: '전-후 방향, 심장 확대됨' },
  { name: '좌측면', yaw: -90, pitch: 0, roll: 0, desc: '좌측 측면 촬영' },
  { name: '우측면', yaw: 90, pitch: 0, roll: 0, desc: '우측 측면 촬영' },
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
  const [preset, setPreset] = useState<string>('PA 정면');
  const [drrUrl, setDrrUrl] = useState<string | null>(null);
  const [drrMs, setDrrMs] = useState<number | null>(null);
  const [showBeam, setShowBeam] = useState(true);

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
    loadCase(CASE_ID).then((v) => {
      if (cancelled) return;
      setVol(v);
      const imageData = buildImageData(v);
      viewsRef.current = {
        axial: createSliceView(axialRef.current!, imageData, 'axial'),
        coronal: createSliceView(coronalRef.current!, imageData, 'coronal'),
        sagittal: createSliceView(sagittalRef.current!, imageData, 'sagittal'),
      };
      volViewRef.current = createVolumeView(volRef.current!, imageData);
      const w = new Worker(new URL('./drr.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<DrrResponse>) => {
        const d = e.data;
        const canvas = document.createElement('canvas');
        canvas.width = d.width; canvas.height = d.height;
        const ctx = canvas.getContext('2d')!;
        const img = ctx.createImageData(d.width, d.height);
        const px = new Uint8ClampedArray(d.pixels);
        for (let i = 0; i < px.length; i++) {
          img.data[i * 4] = px[i]; img.data[i * 4 + 1] = px[i]; img.data[i * 4 + 2] = px[i]; img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        setDrrUrl(canvas.toDataURL('image/png'));
        setDrrMs(d.ms);
      };
      workerRef.current = w;
    });
    return () => { cancelled = true; workerRef.current?.terminate(); };
  }, []);

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
  }, [slices, vol]);

  // DRR render (debounced)
  useEffect(() => {
    if (!vol || !workerRef.current) return;
    window.clearTimeout(drrTimer.current);
    drrTimer.current = window.setTimeout(() => {
      const copy = vol.data.slice().buffer;
      const sdd = sid * 1.15;
      const req: DrrRequest = {
        type: 'render', caseId: CASE_ID, buffer: copy,
        dims: vol.meta.dims, spacing: vol.meta.spacing,
        yawDeg: yaw, pitchDeg: pitch, rollDeg: roll, sid, sdd, outSize: 200, stepMm: 2.5,
      };
      workerRef.current!.postMessage(req, [copy]);
    }, 60);
    return () => window.clearTimeout(drrTimer.current);
  }, [yaw, pitch, roll, sid, vol]);

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
        <h1>X-ray Anatomy Lab</h1>
        <p>CT 단면 · 3D 구조 · 가상 X-ray 연동 학습 (교육용 시뮬레이션)</p>
      </header>
      <main>
        <section className="grid2">
          <div className="panel"><h2>Axial (축상)</h2><div ref={axialRef} className="vpwrap" />
            <input type="range" min={0} max={(vol?.meta.dims[2] ?? 1) - 1} value={slices.axial}
              onChange={(e) => setSlices((s) => ({ ...s, axial: +e.target.value }))} /></div>
          <div className="panel"><h2>Coronal (관상)</h2><div ref={coronalRef} className="vpwrap" />
            <input type="range" min={0} max={(vol?.meta.dims[1] ?? 1) - 1} value={slices.coronal}
              onChange={(e) => setSlices((s) => ({ ...s, coronal: +e.target.value }))} /></div>
          <div className="panel"><h2>Sagittal (시상)</h2><div ref={sagittalRef} className="vpwrap" />
            <input type="range" min={0} max={(vol?.meta.dims[0] ?? 1) - 1} value={slices.sagittal}
              onChange={(e) => setSlices((s) => ({ ...s, sagittal: +e.target.value }))} /></div>
          <div className="panel">
            <h2>3D + X-ray 빔 <label className="inline"><input type="checkbox" checked={showBeam} onChange={(e) => setShowBeam(e.target.checked)} /> 빔 표시</label></h2>
            <div ref={volRef} className="vpwrap" />
            <p className="hint">노란 점 = X-ray 소스 · 파란 면 = 검출기 · 주황 선 = 빔 경로</p>
          </div>
        </section>
        <section className="panel drr">
          <h2>가상 X-ray (DRR)</h2>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.name} className={preset === p.name ? 'active' : ''} onClick={() => applyPreset(p)}>{p.name}</button>
            ))}
          </div>
          {curPreset && <p className="hint">{curPreset.desc}</p>}
          <div className="controls">
            <label>환자 회전 (yaw) {yaw}°
              <input type="range" min={-180} max={180} value={yaw} onChange={(e) => { setYaw(+e.target.value); setPreset(''); }} /></label>
            <label>C-arm 각도 (pitch) {pitch}°
              <input type="range" min={-60} max={60} value={pitch} onChange={(e) => { setPitch(+e.target.value); setPreset(''); }} /></label>
            <label>검출기 회전 (roll) {roll}°
              <input type="range" min={-90} max={90} value={roll} onChange={(e) => { setRoll(+e.target.value); setPreset(''); }} /></label>
            <label>SID {sid}mm
              <input type="range" min={600} max={1500} step={50} value={sid} onChange={(e) => setSid(+e.target.value)} /></label>
          </div>
          {drrUrl ? <img className="drrimg" src={drrUrl} alt="DRR" /> : <p>계산 중…</p>}
          {drrMs !== null && <p className="meta">렌더 {drrMs.toFixed(0)}ms · Beer–Lambert + 삼선형 보간 · 교육용</p>}
        </section>
      </main>
      <footer>
        데이터: TotalSegmentator 예제 CT (CC BY 4.0) · 본 도구는 교육용이며 진단·치료 목적이 아닙니다.
      </footer>
    </div>
  );
}
