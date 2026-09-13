import type { CaseMeta } from './types';

export interface Volume {
  meta: CaseMeta;
  data: Int16Array;
  center: [number, number, number];
}

export async function loadCase(caseId: string): Promise<Volume> {
  const base = `./cases/${caseId}`;
  const meta = (await (await fetch(`${base}/case.json`)).json()) as CaseMeta;
  const buf = await (await fetch(`${base}/${meta.file}`)).arrayBuffer();
  const data = new Int16Array(buf);
  const [nx, ny, nz] = meta.dims;
  const [sx, sy, sz] = meta.spacing;
  const [ox, oy, oz] = meta.origin;
  const center: [number, number, number] = [
    ox + ((nx - 1) / 2) * sx,
    oy + ((ny - 1) / 2) * sy,
    oz + ((nz - 1) / 2) * sz,
  ];
  return { meta, data, center };
}

export function voxelToWorld(v: Volume, i: number, j: number, k: number): [number, number, number] {
  const { spacing, origin } = v.meta;
  return [origin[0] + i * spacing[0], origin[1] + j * spacing[1], origin[2] + k * spacing[2]];
}
