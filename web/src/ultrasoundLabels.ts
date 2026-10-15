import {labelColor} from './labels';
import type {UsVolume,Vec3} from './ultrasound';

export const ORGAN_NAMES:Record<number,string>={1:'비장',2:'오른쪽 신장',3:'왼쪽 신장',5:'간',6:'위',7:'췌장',8:'담낭',9:'방광'};
const ANATOMY_COLORS:Record<number,Vec3>={1:[166,115,217],2:[255,163,89],3:[255,199,102],5:[204,97,89],6:[230,191,102],7:[230,179,115],8:[102,204,102],9:[128,166,242],11:[227,219,191]};
const ACQUIRED_COLORS:Record<number,Vec3>={1:[240,117,97],2:[77,217,209],3:[173,128,242]};
export function ultrasoundColor(kind:UsVolume['kind'],id:number):Vec3|null {
  if(!id)return null;
  if(kind==='acquired')return ACQUIRED_COLORS[id]??null;
  if(kind==='anatomy')return ANATOMY_COLORS[id]??null;
  return labelColor(id);
}
