import {useEffect,useState} from 'react';
type TeachingCase={id:string;modality:'xray'|'ultrasound';organIds?:number[];image:string;mask?:string;title:string;view:string;note:string;source:string;citation:string;license:string;changes:string};
export default function ImagingLibrary({initialOrgan}: {initialOrgan?:number}){
  const [cases,setCases]=useState<TeachingCase[]>([]),[modality,setModality]=useState<'xray'|'ultrasound'>(initialOrgan?'ultrasound':'xray'),[selected,setSelected]=useState(''),[mask,setMask]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [organ,setOrgan]=useState(initialOrgan??0);
  useEffect(()=>{const abort=new AbortController();setError('');fetch('./learning/catalog.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('자료 목록을 불러오지 못했습니다.');return r.json();}).then(d=>setCases(d.cases)).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[retry]);
  const list=cases.filter(c=>c.modality===modality&&(!organ||modality==='xray'||c.organIds?.includes(organ))),current=list.find(c=>c.id===selected)??list[0];
  return <section className="library-workspace">
    <aside className="library-tools">
      <span className="us-eyebrow">REAL IMAGE COLLECTION</span><h2>실제 영상으로<br/>형태를 확인하세요.</h2>
      <p className="us-muted">실제 촬영 사례입니다. 시뮬레이터의 인체와는 다른 사람의 영상입니다. 정지 영상은 탐촉자 움직임과 연동되지 않습니다.</p>
      <div className="us-source-tabs"><button className={modality==='xray'?'active':''} onClick={()=>{setModality('xray');setMask(false);}}>X-ray</button><button className={modality==='ultrasound'?'active':''} onClick={()=>{setModality('ultrasound');setMask(false);}}>초음파</button></div>
      {modality==='ultrasound'&&<div className="us-organ-presets" aria-label="실측 영상 장기 선택">{([[0,'전체'],[2,'신장'],[5,'간'],[8,'담낭']] as const).map(([id,name])=><button key={id} className={organ===id?'active':''} onClick={()=>{setOrgan(id);setSelected('');setMask(false);}}>{name}</button>)}</div>}
      <p className="us-muted">현재 {list.length}개 사례</p>
      <div className="library-case-list">{list.map((c,i)=><button key={c.id} className={current?.id===c.id?'active':''} onClick={()=>{setSelected(c.id);setMask(false);}}><span>{String(i+1).padStart(2,'0')} / {c.title}</span><small>{c.view}</small></button>)}</div>
    </aside>
    <main className="library-main">{error?<div role="alert">{error}<button onClick={()=>setRetry(s=>s+1)}>다시 불러오기</button></div>:current?<>
      <div className="us-session-heading"><div><span className="us-eyebrow">{modality==='xray'?'ACQUIRED RADIOGRAPH':'ACQUIRED B-MODE'}</span><h2>{current.title}</h2></div><span className="library-real-badge">실제 촬영 영상</span></div>
      <div className="library-image"><img key={current.id+mask} src={'./learning/'+(mask?current.mask:current.image)} alt={mask?'초음파 분할 마스크':current.title+' 실제 촬영 영상'} onError={()=>setError('영상 파일을 불러오지 못했습니다.')}/></div>
      <div className="library-caption"><div><strong>{current.view}</strong><p>{current.note}</p></div>{current.mask&&<button className={mask?'active':''} onClick={()=>setMask(s=>!s)}>{mask?'원영상 보기':current.organIds?'장기 마스크 보기':'병변 마스크 보기'}</button>}</div>
      <details className="library-attribution"><summary>데이터 출처·이용 조건</summary><p>{current.citation}<br/>{current.license}<br/>{current.changes}</p><a href={current.source} target="_blank" rel="noreferrer">원 데이터 페이지 ↗</a>{current.source.includes('busbra')&&<a href="./learning/BUSBRA-LICENSE.txt" target="_blank" rel="noreferrer"> · 원본 이용 고지</a>}</details>
    </>:<p role="status">{cases.length?'선택한 장기의 자료가 없습니다. 전체를 선택하세요.':'영상 목록을 불러오고 있습니다…'}</p>}</main>
  </section>;
}
