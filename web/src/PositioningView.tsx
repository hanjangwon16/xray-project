import { useEffect, useRef } from 'react';
import type { Volume } from './volume';

interface Props {
  vol: Volume;
  axialK: number;   // current axial slice index
  yawDeg: number;
  pitchDeg: number;
  sid: number;
}

// Patient positioning simulator: axial body cross-section with beam path
// + lateral schematic showing C-arm angulation (pitch).
export default function PositioningView({ vol, axialK, yawDeg, pitchDeg, sid }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const W = parent.clientWidth, H = parent.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);

    const [nx, ny] = vol.meta.dims;
    const k = Math.max(0, Math.min(vol.meta.dims[2] - 1, axialK));

    // ---- left: axial slice with beam ----
    const axW = Math.floor(W * 0.62);
    const scale = Math.min((axW - 60) / nx, (H - 60) / ny);
    const ox = (axW - nx * scale) / 2;
    const oy = (H - ny * scale) / 2;

    // draw CT slice (radiological convention: patient R on image left, A up)
    const img = ctx.createImageData(nx, ny);
    const Ww = 2307, L = 53, lo = L - Ww / 2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const hu = vol.data[i + j * nx + k * nx * ny];
        const g = Math.max(0, Math.min(255, ((hu - lo) / Ww) * 255));
        // image x = flipped i, image y = flipped j
        const px = (nx - 1 - i) + (ny - 1 - j) * nx;
        img.data[px * 4] = g; img.data[px * 4 + 1] = g; img.data[px * 4 + 2] = g; img.data[px * 4 + 3] = 255;
      }
    }
    const off = document.createElement('canvas');
    off.width = nx; off.height = ny;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, ox, oy, nx * scale, ny * scale);

    // beam geometry in axial plane: beam dir b = (sin yaw, cos yaw) in (x=R, y=A)
    const yaw = (yawDeg * Math.PI) / 180;
    const bx = Math.sin(yaw), by = Math.cos(yaw); // patient x, y
    const cxx = ox + (nx * scale) / 2, cyy = oy + (ny * scale) / 2;
    // canvas: patient -x -> right, patient +y -> up
    const toCanvas = (px: number, py: number): [number, number] => [cxx - px * scale, cyy - py * scale];
    const R = Math.max(nx, ny) * scale * 0.75;
    const srcPt = toCanvas(-bx * R / scale * 1.0, -by * R / scale * 1.0);
    const detPt = toCanvas(bx * R / scale * 1.0, by * R / scale * 1.0);

    // beam line
    ctx.strokeStyle = 'rgba(255,150,40,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(srcPt[0], srcPt[1]); ctx.lineTo(detPt[0], detPt[1]); ctx.stroke();
    ctx.setLineDash([]);

    // detector line (perpendicular to beam at detPt)
    const perp: [number, number] = [-(detPt[1] - srcPt[1]), detPt[0] - srcPt[0]];
    const pl = Math.hypot(perp[0], perp[1]) || 1;
    const detHalf = Math.max(nx, ny) * scale * 0.45;
    ctx.strokeStyle = 'rgba(90,170,255,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(detPt[0] - (perp[0] / pl) * detHalf, detPt[1] - (perp[1] / pl) * detHalf);
    ctx.lineTo(detPt[0] + (perp[0] / pl) * detHalf, detPt[1] + (perp[1] / pl) * detHalf);
    ctx.stroke();

    // source dot
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath(); ctx.arc(srcPt[0], srcPt[1], 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0d12';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('X', srcPt[0], srcPt[1]);

    // orientation labels
    ctx.fillStyle = '#8a919d'; ctx.font = '12px sans-serif';
    ctx.fillText('R', ox - 14, cyy);          // image left = patient R
    ctx.fillText('L', ox + nx * scale + 14, cyy);
    ctx.fillText('A', cxx, oy - 14);          // top = anterior
    ctx.fillText('P', cxx, oy + ny * scale + 14);
    ctx.fillText(`축상단면 k=${k}`, ox, oy + ny * scale + 26);

    // ---- right: lateral schematic with pitch ----
    const lx = axW + 30, lw = W - lx - 20;
    const lcy = H / 2;
    // body silhouette (standing, facing left)
    ctx.strokeStyle = '#5a6472'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(lx + lw * 0.28, lcy - H * 0.32, lw * 0.3, H * 0.64, 18);
    ctx.stroke();
    ctx.fillStyle = '#8a919d'; ctx.font = '11px sans-serif';
    ctx.fillText('A', lx + lw * 0.22, lcy);
    ctx.fillText('P', lx + lw * 0.64, lcy);
    ctx.fillText('S', lx + lw * 0.43, lcy - H * 0.36);
    ctx.fillText('I', lx + lw * 0.43, lcy + H * 0.38);

    // beam at pitch angle (cranial+/caudal-)
    const pitch = (pitchDeg * Math.PI) / 180;
    const bodyCx = lx + lw * 0.43, bodyCy = lcy;
    const beamLen = lw * 0.5;
    const s2x = bodyCx - Math.cos(pitch) * beamLen - beamLen * 0.1;
    const s2y = bodyCy + Math.sin(pitch) * beamLen;
    const d2x = bodyCx + Math.cos(pitch) * beamLen * 0.55;
    const d2y = bodyCy - Math.sin(pitch) * beamLen * 0.55;
    ctx.strokeStyle = 'rgba(255,150,40,0.9)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s2x, s2y); ctx.lineTo(d2x, d2y); ctx.stroke();
    ctx.setLineDash([]);
    // detector (vertical line)
    ctx.strokeStyle = 'rgba(90,170,255,0.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(d2x, d2y - 40); ctx.lineTo(d2x, d2y + 40); ctx.stroke();
    ctx.fillStyle = '#ffd94d';
    ctx.beginPath(); ctx.arc(s2x, s2y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0d12'; ctx.font = 'bold 9px sans-serif';
    ctx.fillText('X', s2x, s2y);
    ctx.fillStyle = '#8a919d'; ctx.font = '11px sans-serif';
    ctx.fillText(`pitch ${pitchDeg}°`, bodyCx, lcy + H * 0.44);

    // SID label
    ctx.fillText(`SID ${sid}mm`, cxx, oy - 30);
  }, [vol, axialK, yawDeg, pitchDeg, sid]);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      // trigger redraw by bumping state-free: re-run effect via canvas attr
      const ev = new Event('resize');
      ref.current?.dispatchEvent(ev);
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  return <canvas ref={ref} className="poscanvas" />;
}
