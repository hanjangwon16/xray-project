import type {ProbeGeometry,ProbeSettings} from './ultrasound';

export function assessThyroidPose(current:ProbeGeometry,goal:ProbeGeometry,settings:ProbeSettings,target:ProbeSettings) {
  const delta=current.origin.map((n,i)=>goal.origin[i]-n);
  const distance=Math.hypot(...delta);
  const angle=Math.max(...(['across','inward'] as const).map(axis=>Math.acos(Math.max(-1,Math.min(1,current[axis].reduce((n,x,i)=>n+x*goal[axis][i],0))))*180/Math.PI));
  const framing=settings.probe==='linear'&&Math.abs(settings.depth-target.depth)<=5&&Math.abs((settings.width??50)-(target.width??50))<=5;
  // shortcut: These are exercise tolerances; expert validation is required before clinical assessment.
  return {distance,angle,delta,framing,passed:current.contact&&distance<=3&&angle<=8&&framing};
}
