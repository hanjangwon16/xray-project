import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {probeGeometry,renderUltrasound,type ProbeSettings,type UsVolume,type UsFrame} from './ultrasound';
import {assessThyroidPose} from './thyroidAssessment';

const STEPS=['갑상선 찾기','기준 0° 맞추기','90° 방향 비교'];
type DisplayFrame=UsFrame & {settings:ProbeSettings};
export default function ThyroidPractice({volume,baseline,frame,busy,pick,controls,onPose,onExplain}: {
  volume:UsVolume;baseline:ProbeSettings;frame:DisplayFrame|null;busy:boolean;
  pick:{frame:DisplayFrame;label:number}|null;controls:ReactNode;
  onPose:(settings:ProbeSettings)=>void;onExplain:()=>void;
}) {
  const [started,setStarted]=useState(false),[step,setStep]=useState(0),[result,setResult]=useState<{passed:boolean;text:string;frame:DisplayFrame;pick:typeof pick}|null>(null),[records,setRecords]=useState<string[]>([]);
  const reference=useRef<HTMLCanvasElement>(null);
  const rotation=step===2?90:0;
  const target=useMemo(()=>({...baseline,rotation}),[baseline,rotation]);
  const expected=useMemo(()=>started?renderUltrasound(volume,target):null,[volume,target,started]);
  const assessment=frame?assessThyroidPose(probeGeometry(volume,frame.settings),probeGeometry(volume,target),frame.settings,target):null;
  const visibleResult=result?.frame===frame&&result?.pick===pick&&!busy?result:null;
  useEffect(()=>setResult(null),[frame,pick]);
  useEffect(()=>{
    const c=reference.current;if(!c||!expected)return;
    c.width=expected.width;c.height=expected.height;
    const ctx=c.getContext('2d')!,image=ctx.createImageData(c.width,c.height);
    expected.pixels.forEach((value,i)=>{image.data[i*4]=image.data[i*4+1]=image.data[i*4+2]=value;image.data[i*4+3]=255;});
    ctx.putImageData(image,0,0);
  },[expected]);
  const start=()=>{setStarted(true);setStep(0);setRecords([]);setResult(null);onPose({...baseline,lateral:Math.min(95,baseline.lateral+12),height:Math.max(5,baseline.height-10)});};
  const check=()=>{
    if(busy||!frame||!assessment)return;
    if(step===0){
      const selected=pick?.frame===frame?pick.label:null;
      setResult({frame,pick,passed:selected===1,text:selected===1?'선택한 위치는 같은 사례의 갑상선 분할과 일치합니다.':selected===null?'오른쪽 실제 영상에서 갑상선이라고 생각하는 위치를 선택하세요.':selected===2||selected===3?'혈관 분할을 선택했습니다. 해설색과 3D를 비교해 갑상선을 찾아보세요.':'갑상선 분할 밖입니다. 위치를 옮기거나 해설색을 확인해 보세요.'});
    } else setResult({frame,pick,passed:assessment.passed,text:assessment.passed?`기준과 위치 ${assessment.distance.toFixed(1)}mm · 방향 ${assessment.angle.toFixed(1)}° 차이로 맞췄습니다.`:!probeGeometry(volume,frame.settings).contact?'촬영 범위를 벗어났습니다. 위치를 안쪽으로 옮기세요.':`위치 차이 ${assessment.distance.toFixed(1)}mm · 방향 차이 ${assessment.angle.toFixed(1)}°. ${!assessment.framing?'선형 표시 · 폭 50mm · 깊이 55mm로 복귀하세요.':assessment.distance>3?'좌우·상하 위치부터 맞추세요.':'회전과 기울임을 기준 방향에 맞추세요.'}`});
  };
  if(!started)return <div className="us-practice"><h3>갑상선 단면 가이드</h3><p id="us-practice-help">같은 사례의 실제 영상과 3D 분할을 연결하며 세 단계를 연습합니다.</p><ol>{STEPS.map(name=><li key={name}>{name}</li>)}</ol><button disabled={busy||!frame} onClick={start}>3단계 연습 시작</button><p className="us-practice-note">사례별 단면 학습입니다. 임상 표준 단면이나 술기 평가로 검증되지 않았습니다.</p></div>;
  if(records.length===3)return <div className="us-practice" role="status"><h3>3단계 연습 완료</h3><ol>{records.map((text,i)=><li key={i}>{text}</li>)}</ol><p id="us-practice-help">같은 장기도 단면 방향을 바꾸면 영상에서 보이는 형태가 달라집니다. 원신호는 같은 사례의 실측 볼륨입니다.</p><button onClick={start}>처음부터 다시 연습</button><p className="us-practice-note">완료 기록은 현재 세션에만 유지됩니다. 임상 숙련도를 뜻하지 않습니다.</p></div>;
  return <div className="us-practice">
    <div className="us-practice-progress" aria-label="연습 진행">{STEPS.map((name,i)=><span key={name} aria-current={i===step?'step':undefined}>{i<step?'✓':i+1} {name}</span>)}</div>
    <h3>{step+1}. {STEPS[step]}</h3>
    <p id="us-practice-help">{step===0?'오른쪽 실측 영상에서 갑상선을 선택하세요. 위치를 바꿔 찾거나 해설색 힌트를 이용할 수 있습니다.':`기준 영상과 비교해 회전을 ${rotation}°로 맞추세요. 좌우 ${baseline.lateral.toFixed(1)}% · 상하 ${baseline.height.toFixed(1)}%, 기울임 0°가 이 사례의 기준입니다.`}</p>
    {step===0&&<details><summary>키보드 선택 안내</summary>영상에 Tab으로 이동한 뒤 방향키로 표시점을 옮기고 Enter로 선택하세요.</details>}
    <figure><canvas ref={reference} aria-label={`같은 사례 기준 초음파 ${rotation}도`} data-rotation={rotation}/><figcaption>동일 실측 볼륨 · 연습 기준 {rotation}°</figcaption></figure>
    {controls}
    <div className="us-practice-actions"><button onClick={onExplain}>해설색 힌트</button><button disabled={busy||!frame} onClick={check}>현재 단면 확인</button></div>
    {visibleResult&&<p className={visibleResult.passed?'us-practice-result passed':'us-practice-result'} role="status">{visibleResult.text}</p>}
    {visibleResult?.passed&&<button onClick={()=>{setRecords(r=>[...r,`${STEPS[step]}: ${visibleResult.text}`]);setStep(n=>Math.min(2,n+1));setResult(null);}}>{step===2?'연습 결과 보기':'다음 단계'}</button>}
    <button className="us-practice-restart" onClick={start}>연습 다시 시작</button>
    <p className="us-practice-note">기준 허용 차이: 위치 3mm · 방향 8°. 이 연습의 안내 범위이며 임상 허용 오차가 아닙니다.</p>
  </div>;
}
