import {useEffect,useRef,useState} from 'react';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import {add,probeGeometry,rayPoint,type ProbeSettings,type UsVolume,type Vec3} from './ultrasound';

type Manipulation='slide'|'rotate'|'tilt'|'rock'|'camera';
const MODES:[Manipulation,string][]=[['slide','밀기'],['rotate','회전'],['tilt','앞뒤 기울임'],['rock','좌우 기울임'],['camera','화면 회전']];
export default function UltrasoundScene({volume,settings,onChange,frozen}: {
  volume:UsVolume;settings:ProbeSettings;onChange:(patch:Partial<ProbeSettings>)=>void;frozen:boolean;
}) {
  const host=useRef<HTMLDivElement>(null),update=useRef<(s:ProbeSettings)=>void>(()=>{});
  const reset=useRef<()=>void>(()=>{}),callback=useRef(onChange);callback.current=onChange;
  const [mode,setMode]=useState<Manipulation>('slide');
  const interaction=useRef({mode,settings,frozen});interaction.current={mode,settings,frozen};
  const focus=useRef<()=>void>(()=>{}),skinOpacity=useRef<(inside:boolean)=>void>(()=>{});
  const [inside,setInside]=useState(false);
  useEffect(()=>{
    const element=host.current!;
    const owned:{delete:()=>void}[]=[];
    // vtkImageMarchingCubes' declaration omits the inherited vtkObject.delete().
    const own=<T,>(o:T):T=>{owned.push(o as T & {delete:()=>void});return o;};
    const grw=vtkGenericRenderWindow.newInstance({listenWindowResize:false});grw.setContainer(element);grw.getInteractor().unbindEvents();
    const renderer=grw.getRenderer();renderer.setBackground(.035,.055,.075);
    const image=own(vtkImageData.newInstance({origin:volume.origin,spacing:volume.spacing}));image.setDimensions(volume.dims);
    image.getPointData().setScalars(own(vtkDataArray.newInstance({values:volume.data,numberOfComponents:1})));
    const surface=(input:typeof image,value:number,color:Vec3,opacity:number)=>{
      const mc=own(vtkImageMarchingCubes.newInstance({contourValue:value,computeNormals:true,mergePoints:true}));mc.setInputData(input);
      const mapper=own(vtkMapper.newInstance());mapper.setInputConnection(mc.getOutputPort());
      const actor=own(vtkActor.newInstance());actor.setMapper(mapper);actor.getProperty().setColor(...color);actor.getProperty().setOpacity(opacity);actor.getProperty().setAmbient(.3);renderer.addActor(actor);return actor;
    };
    let skin:ReturnType<typeof vtkActor.newInstance>;
    if(volume.skinPoints) {
      const poly=own(vtkPolyData.newInstance());poly.getPoints().setData(volume.skinPoints,3);
      const faces=new Uint32Array(volume.skinPoints.length/9*4);
      for(let i=0;i<faces.length/4;i++)faces.set([3,i*3,i*3+1,i*3+2],i*4);
      poly.getPolys().setData(faces);
      const mapper=own(vtkMapper.newInstance());mapper.setInputData(poly);
      skin=own(vtkActor.newInstance());skin.setMapper(mapper);skin.getProperty().setColor(.72,.58,.47);skin.getProperty().setAmbient(.25);skin.getProperty().setDiffuse(.75);skin.getProperty().setSpecular(.15);skin.getProperty().setSpecularPower(20);renderer.addActor(skin);
    } else if(volume.kind==='acquired') {
      const support=own(vtkImageData.newInstance({origin:volume.origin,spacing:volume.spacing}));support.setDimensions(volume.dims);
      support.getPointData().setScalars(own(vtkDataArray.newInstance({values:Uint8Array.from(volume.data,x=>x>0?1:0),numberOfComponents:1})));
      skin=surface(support,.5,[.66,.76,.8],.08);
    } else skin=surface(image,volume.kind==='human'?-300:50,[.66,.76,.8],volume.kind==='human'?.13:.5);
    const internal:ReturnType<typeof vtkActor.newInstance>[]=[];
    if(volume.kind!=='phantom') {
      if(volume.kind!=='acquired')internal.push(surface(image,350,[.89,.86,.75],.9));
      const structures:[number,Vec3][]=volume.kind==='acquired'?[[1,[.94,.46,.38]],[2,[.3,.85,.82]],[3,[.68,.5,.95]]]:[[5,[.78,.35,.32]],[2,[1,.64,.35]],[3,[1,.78,.4]],[1,[.65,.45,.85]],[6,[.84,.65,.43]]];
      if(volume.labels)for(const [id,color] of structures) {
        const mask=own(vtkImageData.newInstance({origin:volume.origin,spacing:volume.spacing}));mask.setDimensions(volume.dims);
        mask.getPointData().setScalars(own(vtkDataArray.newInstance({values:Uint8Array.from(volume.labels,x=>x===id?1:0),numberOfComponents:1})));
        internal.push(surface(mask,.5,color,.8));
      }
    }
    const mesh=(color:Vec3,opacity:number)=>{
      const poly=own(vtkPolyData.newInstance()),mapper=own(vtkMapper.newInstance()),actor=own(vtkActor.newInstance());
      mapper.setInputData(poly);actor.setMapper(mapper);actor.setPickable(false);actor.getProperty().setColor(...color);actor.getProperty().setOpacity(opacity);renderer.addActor(actor);return {poly,actor};
    };
    const fan=mesh([.27,.86,.77],.22),edges=mesh([.4,1,.88],1),probe=mesh([.88,.93,.95],1),marker=mesh([1,.78,.23],1);
    const setMesh=(poly:ReturnType<typeof vtkPolyData.newInstance>,points:Vec3[],triangles:number[])=>{
      poly.getPoints().setData(new Float32Array(points.flat()),3);poly.getPolys().setData(new Uint32Array(triangles));poly.modified();
    };
    const picker=own(vtkCellPicker.newInstance());picker.setPickFromList(true);picker.setPickList([skin]);
    const center=volume.origin.map((x,i)=>x+(volume.dims[i]-1)*volume.spacing[i]/2) as Vec3;
    const span=Math.max(...volume.dims.map((x,i)=>x*volume.spacing[i]));
    let yaw=.15,pitch=.04,scale=span*.56,panX=0,panZ=0,disposed=false,probeOrigin=center;
    const draw=()=>{
      if(disposed)return;
      const c=add(center,[panX,0,panZ]),camera=renderer.getActiveCamera();camera.setParallelProjection(true);camera.setFocalPoint(...c);
      camera.setPosition(c[0]+span*4*Math.sin(yaw)*Math.cos(pitch),c[1]+span*4*Math.cos(yaw)*Math.cos(pitch),c[2]+span*4*Math.sin(pitch));camera.setViewUp(0,0,1);camera.setParallelScale(scale);renderer.resetCameraClippingRange();grw.getRenderWindow().render();
    };
    reset.current=()=>{yaw=.15;pitch=.04;scale=span*.56;panX=panZ=0;draw();};
    focus.current=()=>{scale=Math.min(span*.56,170);panX=probeOrigin[0]-center[0];panZ=probeOrigin[2]-center[2];draw();};
    skinOpacity.current=value=>{skin.getProperty().setOpacity(volume.kind==='acquired'?(value?.02:.08):volume.kind==='anatomy'?(value ? .13 : 1):volume.kind==='human'?(value ? .04 : .13):.5);internal.forEach(actor=>actor.setVisibility(volume.kind!=='anatomy'||value));draw();};
    update.current=s=>{
      const g=probeGeometry(volume,s);probeOrigin=g.origin;fan.actor.setVisibility(g.contact);probe.actor.setVisibility(g.contact||!!s.lifted);edges.actor.setVisibility(g.contact);marker.actor.setVisibility(g.contact||!!s.lifted);
      const pts:Vec3[]=s.probe==='linear'?[rayPoint(g,s,0,0),rayPoint(g,s,1,0),rayPoint(g,s,1,s.depth),rayPoint(g,s,0,s.depth)]:[g.origin,...Array.from({length:41},(_,i)=>rayPoint(g,s,i/40,s.depth))];
      const triangles:number[]=[];
      if(s.probe==='linear')triangles.push(3,0,1,2,3,0,2,3);else for(let i=1;i<41;i++)triangles.push(3,0,i,i+1);
      setMesh(fan.poly,pts,triangles);
      edges.poly.getPoints().setData(new Float32Array(pts.flat()),3);
      const boundary=s.probe==='linear'?[0,1,2,3,0]:[0,...Array.from({length:41},(_,i)=>i+1),0];
      edges.poly.getLines().setData(new Uint32Array([boundary.length,...boundary]));edges.poly.modified();
      const glyphScale=volume.kind==='acquired'?.2:1;
      const box=(offset:number,width:number,thickness:number,length:number):Vec3[]=>[-1,1].flatMap(d=>[-1,1].flatMap(n=>[-1,1].map(a=>add(add(add(g.origin,g.inward,(offset+d*length)*glyphScale),g.normal,n*thickness*glyphScale),g.across,a*width*glyphScale))));
      const faces=[3,0,1,3,3,0,3,2,3,4,6,7,3,4,7,5,3,0,4,5,3,0,5,1,3,2,3,7,3,2,7,6,3,0,2,6,3,0,6,4,3,1,5,7,3,1,7,3];
      setMesh(probe.poly,box(-14,s.probe==='linear'?27:17,6,13),faces);
      setMesh(marker.poly,box(-27,3,6.5,1).map(p=>add(p,g.across,-13*glyphScale)),faces);draw();
    };
    const pick=(x:number,y:number)=>{
      if(interaction.current.frozen)return;
      const r=element.getBoundingClientRect(),size=grw.getApiSpecificRenderWindow().getSize();
      if(x<r.left||x>r.right||y<r.top||y>r.bottom){callback.current({lifted:true});return;}
      picker.pick([(x-r.left)*size[0]/r.width,(r.bottom-y)*size[1]/r.height,0],renderer);
      const cell=picker.getCellId();
      if(cell<0){if(!interaction.current.settings.lifted)callback.current({lifted:true});return;}
      const mapper=skin.getMapper();if(!mapper)return;
      const data=mapper.getInputData() as ReturnType<typeof vtkPolyData.newInstance>,points=data.getPoints().getData(),cells=data.getPolys().getData();
      const a=cells[cell*4+1]*3,b=cells[cell*4+2]*3,c=cells[cell*4+3]*3;
      const u=[points[b]-points[a],points[b+1]-points[a+1],points[b+2]-points[a+2]],v=[points[c]-points[a],points[c+1]-points[a+1],points[c+2]-points[a+2]];
      const normal:Vec3=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal);
      if(!Number.isFinite(length)||length<1e-8)return;
      const p=[...picker.getPickPosition()] as Vec3,camera=renderer.getActiveCamera().getPosition();
      const sign=normal.reduce((sum,n,i)=>sum+n*(camera[i]-p[i]),0)>0?-1:1;
      callback.current({lateral:Math.max(0,Math.min(100,(p[0]-volume.origin[0])/((volume.dims[0]-1)*volume.spacing[0])*100)),height:Math.max(0,Math.min(100,(p[2]-volume.origin[2])/((volume.dims[2]-1)*volume.spacing[2])*100)),contact:{point:p,inward:normal.map(n=>n/length*sign) as Vec3},lifted:false});
    };
    let drag:{id:number;x:number;y:number;ox:number;oy:number;mode:Manipulation;pan:boolean;settings:ProbeSettings}|null=null;
    let pending:{x:number;y:number}|null=null,animation=0;
    const flush=()=>{animation=0;if(pending){const p=pending;pending=null;pick(p.x,p.y);}};
    const down=(e:PointerEvent)=>{
      if(drag)return;
      const selected=e.shiftKey||e.button!==0?'camera':interaction.current.mode;
      if(interaction.current.frozen&&selected!=='camera')return;
      e.preventDefault();element.setPointerCapture(e.pointerId);
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY,mode:selected,pan:e.button===1||e.altKey,settings:interaction.current.settings};
      if(selected==='slide')pick(e.clientX,e.clientY);
    };
    const move=(e:PointerEvent)=>{
      if(!drag||drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
      if(drag.mode==='camera'){
        if(drag.pan){panX-=dx*scale/element.clientHeight*2;panZ+=dy*scale/element.clientHeight*2;}
        else{yaw-=dx*.007;pitch=Math.max(-1.1,Math.min(1.1,pitch+dy*.005));}draw();return;
      }
      if(interaction.current.frozen)return;
      if(drag.mode==='slide'){pending={x:e.clientX,y:e.clientY};if(!animation)animation=requestAnimationFrame(flush);return;}
      const totalX=e.clientX-drag.ox,totalY=e.clientY-drag.oy;
      if(drag.mode==='rotate')callback.current({rotation:((drag.settings.rotation+totalX*.5+180)%360+360)%360-180});
      if(drag.mode==='tilt')callback.current({tilt:Math.max(-35,Math.min(35,drag.settings.tilt-totalY*.3))});
      if(drag.mode==='rock')callback.current({rock:Math.max(-35,Math.min(35,drag.settings.rock+totalX*.3))});
    };
    const up=(e:PointerEvent)=>{
      if(!drag||drag.id!==e.pointerId)return;
      cancelAnimationFrame(animation);animation=0;
      if(e.type==='pointerup'&&drag.mode==='slide')pick(e.clientX,e.clientY);
      pending=null;drag=null;
    };
    const wheel=(e:WheelEvent)=>{e.preventDefault();scale=Math.max(Math.min(span*.2,70),Math.min(span*2,scale*Math.exp(Math.max(-100,Math.min(100,e.deltaY))*.0015)));draw();};
    const context=(e:Event)=>e.preventDefault();
    element.addEventListener('pointerdown',down);element.addEventListener('pointermove',move);element.addEventListener('pointerup',up);element.addEventListener('pointercancel',up);element.addEventListener('lostpointercapture',up);element.addEventListener('wheel',wheel,{passive:false});element.addEventListener('contextmenu',context);
    const observer=new ResizeObserver(()=>{grw.resize();draw();});observer.observe(element);grw.resize();draw();
    return()=>{
      disposed=true;cancelAnimationFrame(animation);observer.disconnect();element.removeEventListener('pointerdown',down);element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',up);element.removeEventListener('pointercancel',up);element.removeEventListener('lostpointercapture',up);element.removeEventListener('wheel',wheel);element.removeEventListener('contextmenu',context);
      update.current=()=>{};reset.current=()=>{};focus.current=()=>{};skinOpacity.current=()=>{};grw.delete();owned.reverse().forEach(o=>o.delete());
    };
  },[volume]);
  useEffect(()=>update.current(settings),[volume,settings]);
  useEffect(()=>skinOpacity.current(inside),[volume,inside]);
  return <div className="us-scene">
    <div className="us-scene-viewport">
      <div ref={host} className="us-scene-canvas" data-manipulation={mode} aria-label="3D 인체와 초음파 탐촉자"/>
      <div className="us-scene-actions"><button onClick={()=>reset.current()}>{volume.kind==='anatomy'?'전신 보기':'시점 복귀'}</button><button onClick={()=>focus.current()}>{volume.kind==='acquired'?'단면 조작점 확대':'탐촉자 확대'}</button>{volume.kind!=='phantom'&&<button className={inside?'active':''} onClick={()=>setInside(s=>!s)}>{volume.kind==='acquired'?(inside?'촬영 범위 보기':'분할 강조'):inside?'피부 보기':'내부 장기 보기'}</button>}</div>
    </div>
    <div className="us-hand-modes" role="group" aria-label="탐촉자 손동작">{MODES.map(([id,title])=><button key={id} aria-pressed={mode===id} disabled={frozen&&id!=='camera'} onClick={()=>setMode(id)}>{title}</button>)}</div>
    <div className="us-scene-caption">{mode==='slide'?(volume.kind==='acquired'?'실측 촬영 범위를 눌러 단면 이동 · 실제 피부 표면이 아닙니다.':'피부를 누른 채 밀어 이동 · 몸 밖으로 빼면 접촉 해제'):mode==='rotate'?'좌우 드래그: 탐촉자 축 회전':mode==='tilt'?'상하 드래그: 앞뒤로 기울이기':mode==='rock'?'좌우 드래그: 좌우로 기울이기':'드래그: 시점 회전 · Alt 드래그: 화면 이동'}<br/>Shift 또는 우클릭 드래그: 화면 회전 · 휠: 확대</div>
  </div>;
}
