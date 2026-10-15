import type { CaseMeta } from './types';

export interface Volume {
  meta: CaseMeta;
  data: Int16Array;
  labels: Uint8Array | null;
  center: [number, number, number];
}

export async function loadCase(caseId: string, signal?: AbortSignal): Promise<Volume> {
  const base = `./cases/${caseId}`;
  const response = await fetch(`${base}/case.json`,{signal});
  if(!response.ok)throw Error('CT 사례 정보를 불러오지 못했습니다.');
  const meta = await response.json() as CaseMeta;
  if(meta.dims.length!==3||meta.spacing.length!==3||meta.dims.some(n=>!Number.isInteger(n)||n<2)||meta.spacing.some(n=>!Number.isFinite(n)||n<=0))throw Error('CT 격자 정보가 올바르지 않습니다.');
  const raw = await fetch(`${base}/${meta.file}`,{signal});
  if(!raw.ok)throw Error('CT 볼륨을 불러오지 못했습니다.');
  const buf = await raw.arrayBuffer();
  if(buf.byteLength!==meta.dims.reduce((a,b)=>a*b,1)*2)throw Error('CT 파일 크기가 격자와 일치하지 않습니다.');
  const data = new Int16Array(buf);
  let labels: Uint8Array | null = null;
  const labelResponse = await fetch(`${base}/labels_u8.bin`,{signal});
  if(labelResponse.ok) {
    const lbuf=await labelResponse.arrayBuffer();
    if(lbuf.byteLength!==data.length)throw Error('CT 분할 파일 크기가 격자와 일치하지 않습니다.');
    labels=new Uint8Array(lbuf);
  } else if(labelResponse.status!==404)throw Error('CT 분할을 불러오지 못했습니다.');
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
