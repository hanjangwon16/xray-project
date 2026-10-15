import {renderDrr} from './drr';
import type {DrrRequest} from './types';

self.onmessage = (e: MessageEvent<DrrRequest>) => {
  const res=renderDrr(e.data);
  const transfers:Transferable[]=[res.pixels];
  if(res.labelPix)transfers.push(res.labelPix);
  self.postMessage(res,{transfer:transfers});
};
