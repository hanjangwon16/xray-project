import type { BeamGeometry } from './types';

// Shared C-arm geometry (must match drr.worker.ts).
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

export function computeBeam(
  dims: [number, number, number],
  spacing: [number, number, number],
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number,
  sid: number,
  sdd: number,
): BeamGeometry {
  const [nx, ny, nz] = dims;
  const [sx, sy, sz] = spacing;
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const roll = (rollDeg * Math.PI) / 180;

  let b: [number, number, number] = [0, 1, 0];
  let v: [number, number, number] = [0, 0, 1];
  b = rotZ(b, yaw); v = rotZ(v, yaw);
  let u = norm(cross(v, b));
  b = norm(rotAxis(b, u, pitch));
  v = norm(rotAxis(v, u, pitch));
  u = norm(cross(v, b));
  const u2 = norm(rotAxis(u, b, roll));
  const v2 = norm(rotAxis(v, b, roll));
  u = u2; v = v2;

  const diag = Math.sqrt((nx * sx) ** 2 + (ny * sy) ** 2 + (nz * sz) ** 2);
  const detHalf = (diag / 2) * (sdd / sid);
  const src: [number, number, number] = [-b[0] * sid, -b[1] * sid, -b[2] * sid];
  const detC: [number, number, number] = [b[0] * (sdd - sid), b[1] * (sdd - sid), b[2] * (sdd - sid)];
  return { src, detC, u, v, b, detHalf };
}
