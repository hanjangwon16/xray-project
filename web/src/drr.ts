import type { DrrRequest, DrrResponse } from './types';

import {computeBeam,norm} from './beam.ts';

// HU -> linear attenuation coefficient (per mm), rough educational scale.
function huToMu(hu: number): number {
  if (hu <= -900) return 0.0002;            // air
  if (hu <= -100) return 0.018 * (hu + 1000) / 800; // fat -> water ramp
  if (hu <= 300) return 0.018 + 0.004 * (hu + 100) / 400;  // soft tissue
  return 0.022 + 0.05 * Math.min(1, (hu - 300) / 1200);    // bone
}

export function renderDrr(req: DrrRequest): DrrResponse {
  const t0 = performance.now();
  const vol = new Int16Array(req.buffer);
  const lab = req.labelBuffer ? new Uint8Array(req.labelBuffer) : null;
  const [nx, ny, nz] = req.dims;
  const [sx, sy, sz] = req.spacing;
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2, cz = (nz - 1) / 2;
  const N = req.outSize;
  const step = req.stepMm;
  const {src,detC,u,v,detHalf}=computeBeam(req.dims,req.spacing,req.yawDeg,req.pitchDeg,req.rollDeg,req.sid,req.sdd);

  // trilinear sample
  const sample = (i: number, j: number, k: number): number => {
    if (i < 0 || j < 0 || k < 0 || i > nx - 1 || j > ny - 1 || k > nz - 1) return -1000;
    const i0 = Math.floor(i), j0 = Math.floor(j), k0 = Math.floor(k);
    const i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(ny - 1, j0 + 1), k1 = Math.min(nz - 1, k0 + 1);
    const fx = i - i0, fy = j - j0, fz = k - k0;
    const idx = (a: number, bb: number, c: number) => vol[a + bb * nx + c * nx * ny];
    const c00 = idx(i0, j0, k0) * (1 - fx) + idx(i1, j0, k0) * fx;
    const c01 = idx(i0, j0, k1) * (1 - fx) + idx(i1, j0, k1) * fx;
    const c10 = idx(i0, j1, k0) * (1 - fx) + idx(i1, j1, k0) * fx;
    const c11 = idx(i0, j1, k1) * (1 - fx) + idx(i1, j1, k1) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  };
  const labAt = (a: number, bb: number, c: number) => lab ? lab[a + bb * nx + c * nx * ny] : 0;

  const pixels = new Float32Array(N * N);
  const labelPix = lab ? new Uint8Array(N * N) : null;
  const half = [(nx-1)*sx/2,(ny-1)*sy/2,(nz-1)*sz/2];
  for (let r = 0; r < N; r++) {
    const dv = detHalf - (2 * detHalf * r) / (N - 1); // row 0 = +v (up)
    for (let c = 0; c < N; c++) {
      const du = -detHalf + (2 * detHalf * c) / (N - 1);
      // detector pixel world pos
      const px = detC[0] + u[0] * du + v[0] * dv;
      const py = detC[1] + u[1] * du + v[1] * dv;
      const pz = detC[2] + u[2] * du + v[2] * dv;
      const dir = norm([px - src[0], py - src[1], pz - src[2]]);
      let tEnter=0,tExit=Math.hypot(px-src[0],py-src[1],pz-src[2]);
      for(let axis=0;axis<3;axis++){
        if(Math.abs(dir[axis])<1e-9){if(Math.abs(src[axis])>half[axis])tExit=-1;}
        else{const a=(-half[axis]-src[axis])/dir[axis],b=(half[axis]-src[axis])/dir[axis];tEnter=Math.max(tEnter,Math.min(a,b));tExit=Math.min(tExit,Math.max(a,b));}
      }
      let sum = 0;
      // accumulate attenuation per label to find dominant structure along ray
      const labMu = new Map<number, number>();
      for (let t = tEnter + step/2; t < tExit; t += step) {
        const wx = src[0] + dir[0] * t;
        const wy = src[1] + dir[1] * t;
        const wz = src[2] + dir[2] * t;
        const i = wx / sx + cx;
        const j = wy / sy + cy;
        const k = wz / sz + cz;
        if (i < -0.5 || j < -0.5 || k < -0.5 || i > nx - 0.5 || j > ny - 0.5 || k > nz - 0.5) continue;
        const i0 = Math.max(0, Math.min(nx - 1, Math.round(i)));
        const j0 = Math.max(0, Math.min(ny - 1, Math.round(j)));
        const k0 = Math.max(0, Math.min(nz - 1, Math.round(k)));
        const mu = huToMu(sample(i, j, k)) * step;
        sum += mu;
        const lid = labAt(i0, j0, k0);
        if (lid !== 0) labMu.set(lid, (labMu.get(lid) ?? 0) + mu);
      }
      pixels[r * N + c] = sum; // log attenuation: avoids saturated white projection
      if (labelPix) {
        let best = 0, bestW = 0;
        for (const [lid, w] of labMu) if (w > bestW) { bestW = w; best = lid; }
        labelPix[r * N + c] = best;
      }
    }
  }

  const out = new Uint8ClampedArray(N * N);
  // A fixed log-attenuation display range keeps different poses comparable.
  // This is an educational DRR window, not a detector response calibration.
  const window = 8;
  for (let i=0;i<out.length;i++) out[i]=Math.pow(Math.min(1,Math.max(0,pixels[i]/window)),0.7)*255;
  const ms = performance.now() - t0;
  return { type: 'drr', requestId: req.requestId, caseId: req.caseId, width: N, height: N, pixels: out.buffer as ArrayBuffer, labelPix: labelPix ? labelPix.buffer as ArrayBuffer : null, ms };
}
