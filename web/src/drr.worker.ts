import type { DrrRequest, DrrResponse } from './types';

// Beer-Lambert ray-casting DRR with trilinear interpolation.
// Patient space: RAS canonical (x=R, y=A, z=S).
// Geometry: C-arm convention.
//   yaw   - rotation about patient S (z) axis: 0=PA, +-45 oblique, +-90 lateral
//   pitch - C-arm angulation about detector-right axis: + cranial / - caudal
//   roll  - detector in-plane rotation

function rotZ(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
}
function rotAxis(p: [number, number, number], ax: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const [x, y, z] = p, [u, v, w] = ax;
  return [
    (t * u * u + c) * x + (t * u * v - s * w) * y + (t * u * w + s * v) * z,
    (t * u * v + s * w) * x + (t * v * v + c) * y + (t * v * w - s * u) * z,
    (t * u * w - s * v) * x + (t * v * w + s * u) * y + (t * w * w + c) * z,
  ];
}
const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// HU -> linear attenuation coefficient (per mm), rough educational scale.
function huToMu(hu: number): number {
  if (hu <= -900) return 0.0002;            // air
  if (hu <= -100) return 0.018 * (hu + 1000) / 800; // fat -> water ramp
  if (hu <= 300) return 0.018 + 0.004 * (hu + 100) / 400;  // soft tissue
  return 0.022 + 0.05 * Math.min(1, (hu - 300) / 1200);    // bone
}

function render(req: DrrRequest): DrrResponse {
  const t0 = performance.now();
  const vol = new Int16Array(req.buffer);
  const lab = req.labelBuffer ? new Uint8Array(req.labelBuffer) : null;
  const [nx, ny, nz] = req.dims;
  const [sx, sy, sz] = req.spacing;
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2, cz = (nz - 1) / 2;
  const yaw = (req.yawDeg * Math.PI) / 180;
  const pitch = (req.pitchDeg * Math.PI) / 180;
  const roll = ((req.rollDeg ?? 0) * Math.PI) / 180;
  const N = req.outSize;
  const step = req.stepMm;
  const sid = req.sid;
  const sdd = req.sdd ?? sid * 1.15; // source-detector distance

  // C-arm basis in patient space. Start PA: beam +A, det right -R? -> use +x so image
  // left = patient right (viewed as facing patient). up = +S.
  let b: [number, number, number] = [0, 1, 0];
  let v: [number, number, number] = [0, 0, 1];
  // yaw about z
  b = rotZ(b, yaw); v = rotZ(v, yaw);
  // pitch about detector-right axis (u = v x b)
  let u = norm(cross(v, b));
  b = norm(rotAxis(b, u, pitch));
  v = norm(rotAxis(v, u, pitch));
  u = norm(cross(v, b));
  // roll about beam axis
  const u2 = norm(rotAxis(u, b, roll));
  const v2 = norm(rotAxis(v, b, roll));
  u = u2; v = v2;

  // detector plane size ~ volume diagonal projected; use diag for coverage
  const diag = Math.sqrt((nx * sx) ** 2 + (ny * sy) ** 2 + (nz * sz) ** 2);
  const detHalf = (diag / 2) * (sdd / sid); // account for magnification

  const src: [number, number, number] = [-b[0] * sid, -b[1] * sid, -b[2] * sid];
  const detC: [number, number, number] = [b[0] * (sdd - sid), b[1] * (sdd - sid), b[2] * (sdd - sid)];

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
  const tEnter = Math.max(0, sid - diag);
  const tExit = sid + diag;
  for (let r = 0; r < N; r++) {
    const dv = detHalf - (2 * detHalf * r) / (N - 1); // row 0 = +v (up)
    for (let c = 0; c < N; c++) {
      const du = -detHalf + (2 * detHalf * c) / (N - 1);
      // detector pixel world pos
      const px = detC[0] + u[0] * du + v[0] * dv;
      const py = detC[1] + u[1] * du + v[1] * dv;
      const pz = detC[2] + u[2] * du + v[2] * dv;
      const dir = norm([px - src[0], py - src[1], pz - src[2]]);
      let sum = 0;
      // accumulate attenuation per label to find dominant structure along ray
      const labMu = new Map<number, number>();
      for (let t = tEnter; t < tExit; t += step) {
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
  let mn = Infinity, mx = -Infinity;
  for (const p of pixels) { if (p < mn) mn = p; if (p > mx) mx = p; }
  const rng = mx - mn || 1;
  // gamma lift so mid-density soft tissue is visible like a real radiograph
  const gamma = 0.55;
  for (let i = 0; i < out.length; i++) {
    const t = (pixels[i] - mn) / rng;
    out[i] = Math.pow(t, gamma) * 255;
  }
  const ms = performance.now() - t0;
  return { type: 'drr', caseId: req.caseId, width: N, height: N, pixels: out.buffer as ArrayBuffer, labelPix: labelPix ? labelPix.buffer as ArrayBuffer : null, ms };
}

self.onmessage = (e: MessageEvent<DrrRequest>) => {
  const res = render(e.data);
  const transfers: Transferable[] = [res.pixels];
  if (res.labelPix) transfers.push(res.labelPix);
  (self as unknown as Worker).postMessage(res, transfers);
};
