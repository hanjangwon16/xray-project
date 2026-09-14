import type { CaseMeta } from './types';

export interface Volume {
  meta: CaseMeta;
  data: Int16Array;
  labels: Uint8Array | null;
  center: [number, number, number];
}

export async function loadCase(caseId: string): Promise<Volume> {
  const base = `./cases/${caseId}`;
  const meta = (await (await fetch(`${base}/case.json`)).json()) as CaseMeta;
  const buf = await (await fetch(`${base}/${meta.file}`)).arrayBuffer();
  const data = new Int16Array(buf);
  let labels: Uint8Array | null = null;
  try {
    const lbuf = await (await fetch(`${base}/labels_u8.bin`)).arrayBuffer();
    if (lbuf.byteLength === data.length) labels = new Uint8Array(lbuf);
  } catch { /* no labels */ }
  const [nx, ny, nz] = meta.dims;
  const [sx, sy, sz] = meta.spacing;
  const [ox, oy, oz] = meta.origin;
  const center: [number, number, number] = [
    ox + ((nx - 1) / 2) * sx,
    oy + ((ny - 1) / 2) * sy,
    oz + ((nz - 1) / 2) * sz,
  ];
  return { meta, data, labels, center };
}
