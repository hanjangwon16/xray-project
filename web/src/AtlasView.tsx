import {useEffect,useRef,useState} from 'react';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import AnatomyPreview,{type AnatomySelection} from './AnatomyPreview';

const systems = {bones:'뼈',organs:'장기',muscles:'근육',nerves:'신경',vessels:'혈관'};
type System=keyof typeof systems;
const colors:Record<System,[number,number,number]>={bones:[.89,.86,.75],organs:[.75,.37,.37],muscles:[.7,.25,.21],nerves:[.98,.79,.24],vessels:[.85,.15,.24]};
type Group={id:System;file:string;vertices:number;structures:number};
export default function AtlasView(){
 const [selection,setSelection]=useState<AnatomySelection|null>(null);
 const host=useRef<HTMLDivElement>(null);
 const actors=useRef<Partial<Record<System,ReturnType<typeof vtkActor.newInstance>>>>({});
 const render=useRef<()=>void>(()=>{});const reset=useRef<(view?:string)=>void>(()=>{});
 const [enabled,setEnabled]=useState<System[]>(['bones','organs']);const enabledRef=useRef(enabled);enabledRef.current=enabled;
 const [opacity,setOpacity]=useState(.85);const opacityRef=useRef(opacity);opacityRef.current=opacity;
 const [status,setStatus]=useState('전신 해부 데이터 불러오는 중…');const [groups,setGroups]=useState<Group[]>([]);
 useEffect(()=>{
  const element=host.current!;const abort=new AbortController();let disposed=false;
  const grw=vtkGenericRenderWindow.newInstance({listenWindowResize:false});grw.setContainer(element);
  grw.getInteractor().unbindEvents();const renderer=grw.getRenderer();renderer.setBackground(.035,.055,.075);
  const camera=renderer.getActiveCamera();camera.setParallelProjection(true);
  const picker=vtkCellPicker.newInstance();
  const catalogs:Partial<Record<System,{name:string;end:number}[]>>={};
  let yaw=0,pitch=0,scale=920,panX=0,panZ=0;
  const draw=()=>{if(disposed)return;const cp=Math.cos(pitch);camera.setFocalPoint(panX,-90,800+panZ);camera.setPosition(panX+2400*Math.sin(yaw)*cp,-90-2400*Math.cos(yaw)*cp,800+panZ+2400*Math.sin(pitch));camera.setViewUp(0,0,1);camera.setParallelScale(scale);renderer.resetCameraClippingRange();grw.getRenderWindow().render();};
  render.current=draw;reset.current=(v='front')=>{yaw=v==='back'?Math.PI:v==='side'?Math.PI/2:0;pitch=0;scale=920;panX=panZ=0;draw();};
  let origin=[0,0],distance=0;
  let drag:{x:number;y:number;pan:boolean}|null=null;
  const down=(e:PointerEvent)=>{origin=[e.clientX,e.clientY];distance=0;element.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,pan:e.shiftKey||e.button!==0};element.style.cursor='grabbing';};
  const move=(e:PointerEvent)=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(drag.pan){panX-=dx*scale/element.clientHeight*2;panZ+=dy*scale/element.clientHeight*2;}else{yaw-=dx*.007;pitch=Math.max(-1.25,Math.min(1.25,pitch+dy*.005));}draw();};
  const up=(e:PointerEvent)=>{
   distance=Math.hypot(e.clientX-origin[0],e.clientY-origin[1]);
   if(drag && !drag.pan && distance<5 && e.type==='pointerup'){
    const rect=element.getBoundingClientRect(),size=grw.getApiSpecificRenderWindow().getSize();
    picker.pick([(e.clientX-rect.left)*size[0]/rect.width,(rect.bottom-e.clientY)*size[1]/rect.height,0],renderer);
    if(picker.getCellId()>=0){
     const actor=picker.getActors()[0];
     const group=(Object.keys(actors.current) as System[]).find(id=>actors.current[id]===actor);
     if(actor){picker.setPickFromList(true);picker.setPickList([actor]);picker.pick([(e.clientX-rect.left)*size[0]/rect.width,(rect.bottom-e.clientY)*size[1]/rect.height,0],renderer);picker.setPickFromList(false);}
     const entry=group?catalogs[group]?.find(c=>picker.getCellId()<c.end):undefined;
     const name=entry?.name ?? '선택 부위';
     const organ=/liver/i.test(name)?{name:'간',labelId:5}:/right kidney/i.test(name)?{name:'우신장',labelId:2}:/left kidney/i.test(name)?{name:'좌신장',labelId:3}:/spleen/i.test(name)?{name:'비장',labelId:1}:/stomach/i.test(name)?{name:'위',labelId:6}:null;
     setSelection({name:organ?.name??name,labelId:organ?.labelId,region:organ?'upper-abdomen':'unsupported'});
    }else setSelection(null);
   }
   drag=null;element.style.cursor='grab';
  };
  const wheel=(e:WheelEvent)=>{e.preventDefault();scale=Math.min(2200,Math.max(70,scale*Math.exp(Math.max(-120,Math.min(120,e.deltaY))*.0015)));draw();};
  const context=(e:Event)=>e.preventDefault();
  element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',up);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('contextmenu',context);
  const resize=new ResizeObserver(()=>{grw.resize();draw();});resize.observe(element);
  const owned:{delete:()=>void}[]=[];
  (async()=>{
   const response=await fetch('./atlas/manifest.json',{signal:abort.signal});if(!response.ok)throw Error('모델 목록 로드 실패');const manifest=await response.json();setGroups(manifest.groups);
   const cr=await fetch('./atlas/catalog.json',{signal:abort.signal});if(!cr.ok)throw Error('구조 목록 로드 실패');
   for(const c of await cr.json()){const list=catalogs[c.group as System]??=[];list.push({name:c.name,end:(list.at(-1)?.end??0)+c.triangles});catalogs[c.group as System]=list;}
   for(const g of manifest.groups as Group[]){
    const r=await fetch('./atlas/'+g.file,{signal:abort.signal});if(!r.ok)throw Error(g.id+' 로드 실패');const buf=await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(disposed)return;
    if(buf.byteLength!==g.vertices*12)throw Error('모델 파일 크기 불일치');
    const data=vtkPolyData.newInstance();data.getPoints().setData(new Float32Array(buf),3);
    const cells=new Uint32Array(g.vertices/3*4);for(let i=0,j=0;i<g.vertices;i+=3,j+=4){cells[j]=3;cells[j+1]=i;cells[j+2]=i+1;cells[j+3]=i+2;}data.getPolys().setData(cells);
    const mapper=vtkMapper.newInstance();mapper.setInputData(data);const actor=vtkActor.newInstance();actor.setMapper(mapper);actor.getProperty().setColor(...colors[g.id]);actor.getProperty().setOpacity(opacityRef.current);actor.getProperty().setAmbient(.3);actor.getProperty().setDiffuse(.7);actor.setVisibility(enabledRef.current.includes(g.id));renderer.addActor(actor);actors.current[g.id]=actor;owned.push(actor,mapper,data);draw();setStatus(systems[g.id]+' 로드 완료');
   }setStatus('BodyParts3D · 전신 해부 아틀라스');
  })().catch(e=>{if(!disposed)setStatus('데이터 오류: '+e.message);});
  return()=>{disposed=true;abort.abort();resize.disconnect();element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',up);element.removeEventListener('wheel',wheel);element.removeEventListener('contextmenu',context);picker.delete();grw.delete();owned.forEach(o=>o.delete());actors.current={};};
 },[]);
 useEffect(()=>{for(const [id,actor] of Object.entries(actors.current)){actor.setVisibility(enabled.includes(id as System));actor.getProperty().setOpacity(opacity);}render.current();},[enabled,opacity]);
 return <section className={'atlas-workspace'+(selection?' has-preview':'')}>
  <aside className="atlas-tools"><h2>전신 해부 탐색</h2><p>계통을 단독으로 보거나 함께 선택하세요.</p>
  {(Object.keys(systems) as System[]).map(id=><div className="system-row" key={id}><label><input type="checkbox" checked={enabled.includes(id)} onChange={()=>setEnabled(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])}/>{systems[id]}</label><button aria-label={systems[id]+' 단독 보기'} onClick={()=>setEnabled([id])}>단독</button><small>{groups.find(g=>g.id===id)?.structures ?? '…'} 구조</small></div>)}
  <div className="atlas-actions"><button onClick={()=>setEnabled(Object.keys(systems) as System[])}>모두 보기</button><button onClick={()=>setEnabled([])}>모두 숨기기</button></div>
  <label>선택 계통 투명도 {Math.round(opacity*100)}%<input aria-label="계통 투명도" type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={e=>setOpacity(+e.target.value)}/></label>
  <p>클릭: 구조 선택 · CT/X-ray 비교<br/>드래그: 회전 · Shift: 이동 · 휠: 확대</p>
  <div className="quick-anatomy"><strong>바로 영상 비교</strong>{([{name:'간',labelId:5},{name:'우신장',labelId:2},{name:'좌신장',labelId:3},{name:'비장',labelId:1},{name:'위',labelId:6}]).map(o=><button key={o.labelId} onClick={()=>setSelection({...o,region:'upper-abdomen'})}>{o.name}</button>)}</div>
  <p className="atlas-note">표준 해부 모델이며 복부 CT 사례와는 다른 인체입니다. 신경 모드는 현재 뇌·두부 구조 중심이고 전신 말초신경은 포함하지 않습니다.</p>
  <a href="./atlas/ATTRIBUTION.txt" target="_blank" rel="noreferrer">데이터 출처·라이선스</a></aside>
  <div className="atlas-scene"><div className="atlas-camera"><button onClick={()=>reset.current('front')}>정면</button><button onClick={()=>reset.current('back')}>후면</button><button onClick={()=>reset.current('side')}>측면</button><button onClick={()=>reset.current()}>전체 맞춤</button></div><div ref={host} className="atlas-canvas"/><div className="atlas-status" role="status">{status} · 선택 {enabled.length}/5</div></div>
  {selection&&<AnatomyPreview selection={selection} onClose={()=>setSelection(null)}/>}
 </section>;
}
