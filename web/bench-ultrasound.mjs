import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const b=await chromium.launch({channel:'chrome'}),p=await b.newPage({viewport:{width:1440,height:960}});
try{
  await p.goto(process.env.TEST_URL||'http://127.0.0.1:4194');
  const start=Date.now();await p.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('canvas[data-source="acquired"]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',{},{timeout:90000});
  const initialMs=Date.now()-start;
  const result=await p.evaluate(async()=>{
    const times=[];let previous=performance.now(),running=true;
    const tick=now=>{times.push(now-previous);previous=now;if(running)requestAnimationFrame(tick);};requestAnimationFrame(tick);
    const frames=[],canvas=document.querySelector('canvas[data-source="acquired"]');
    const observer=new MutationObserver(()=>frames.push(performance.now()));observer.observe(canvas,{attributes:true,attributeFilter:['data-pose']});
    const slider=document.querySelector('input[aria-label="탐촉자 회전"]');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    for(let i=0;i<60;i++){setter.call(slider,String(i-30));slider.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,16));}
    await new Promise(r=>setTimeout(r,200));running=false;observer.disconnect();
    times.sort((a,b)=>a-b);
    return {rafP95Ms:times[Math.floor(times.length*.95)],maxFrameMs:Math.max(...times),renderedFrames:frames.length,elapsedMs:performance.now()-frames[0],calculation:document.querySelector('.us-image-controls>span')?.textContent};
  });
  await p.getByRole('button',{name:'갑상선 중심으로 복귀',exact:true}).click();
  const bounds=await p.locator('.us-scene-canvas').boundingBox(),x=bounds.x+bounds.width*.5,y=bounds.y+bounds.height*.42;
  const dragStart=Date.now();await p.mouse.move(x,y);await p.mouse.down();
  for(let step=0;step<20;step++)await p.mouse.move(x+step,y+step*.5);
  await p.mouse.up();
  const drag20MovesMs=Date.now()-dragStart;
  assert.ok(drag20MovesMs<3000,'20 acquired-volume pointer moves must not stall the UI');
  assert.ok(result.renderedFrames>=20,'Continuous input must keep producing frames');
  console.log(JSON.stringify({initialMs,...result,drag20MovesMs}));
}finally{await b.close();}
