export interface CaseMeta {
  caseId: string;
  source: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  direction: number[][];
  huRange: [number, number];
  dtype: string;
  file: string;
}

export type ViewName = 'axial' | 'coronal' | 'sagittal';

export interface DrrRequest {
  type: 'render';
  caseId: string;
  buffer: ArrayBuffer;
  dims: [number, number, number];
  spacing: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  sid: number;
  sdd: number;
  outSize: number;
  stepMm: number;
}

export interface DrrResponse {
  type: 'drr';
  caseId: string;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  ms: number;
}

export interface BeamGeometry {
  src: [number, number, number];
  detC: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  b: [number, number, number];
  detHalf: number;
}
