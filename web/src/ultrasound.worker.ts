import { renderUltrasound, type ProbeSettings, type UsVolume } from './ultrasound';

let volume: UsVolume | null = null;
self.onmessage = (event: MessageEvent<
  {type:'init';volume:UsVolume} | {type:'render';requestId:number;settings:ProbeSettings}
>) => {
  const req=event.data;
  try {
    if(req.type==='init'){volume=req.volume;return;}
    if(!volume)throw Error('초음파 볼륨이 준비되지 않았습니다.');
    const frame=renderUltrasound(volume,req.settings);
    const transfers:Transferable[]=[frame.pixels.buffer,frame.labels.buffer];if(frame.reference)transfers.push(frame.reference.buffer);
    self.postMessage({type:'frame',requestId:req.requestId,settings:req.settings,...frame}, {transfer:transfers});
  } catch(error) {
    self.postMessage({type:'error',requestId:req.type==='render'?req.requestId:0,message:error instanceof Error?error.message:String(error)});
  }
};
