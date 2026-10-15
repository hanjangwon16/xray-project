import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {DEFAULT_PROBE,probeGeometry,renderUltrasound} from './src/ultrasound.ts';
import {assessThyroidPose} from './src/thyroidAssessment.ts';

const dir=new URL('./public/ultrasound/segthy/',import.meta.url),meta=JSON.parse(readFileSync(new URL('case.json',dir)));
const volume={kind:'acquired',dims:meta.dims,spacing:meta.spacing,origin:meta.origin,data:new Uint8Array(gunzipSync(readFileSync(new URL(meta.file,dir)))),labels:new Uint8Array(gunzipSync(readFileSync(new URL(meta.labels,dir))))};
let x=0,z=0,n=0;volume.labels.forEach((id,i)=>{if(id===1){x+=i%meta.dims[0];z+=Math.floor(i/(meta.dims[0]*meta.dims[1]));n++;}});
const goal={...DEFAULT_PROBE,probe:'linear',depth:55,frequency:12,lateral:x/n/(meta.dims[0]-1)*100,height:z/n/(meta.dims[2]-1)*100},geometry=probeGeometry(volume,goal);
assert.equal(assessThyroidPose(geometry,geometry,goal,goal).passed,true);
for(const patch of [{lateral:goal.lateral+10},{rotation:180},{tilt:15},{rock:15},{lifted:true},{width:20},{probe:'curved'},{depth:80}]){const pose={...goal,...patch};assert.equal(assessThyroidPose(probeGeometry(volume,pose),geometry,pose,goal).passed,false,JSON.stringify(patch));}
assert.equal(assessThyroidPose({...geometry,origin:[NaN,0,0]},geometry,goal,goal).passed,false);
assert.equal(assessThyroidPose(probeGeometry(volume,{...goal,rotation:-180}),probeGeometry(volume,{...goal,rotation:180}),goal,goal).passed,true);

const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:960},hasTouch:true}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const image=page.locator('canvas[aria-label="초음파 단면 영상"]');
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-source="acquired"]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',null,{timeout:90000});
const fill=async(name,value,key)=>{await page.getByRole('slider',{name,exact:true}).fill(String(value));await page.waitForFunction(({key,value})=>JSON.parse(document.querySelector('canvas[data-source="acquired"]').dataset.pose)[key]===value&&document.querySelector('.us-image-area').getAttribute('aria-busy')==='false',{key,value});};
const referenceMatches=async(rotation)=>{
  const frame=renderUltrasound(volume,{...goal,rotation}),rgba=Buffer.alloc(frame.pixels.length*4);
  frame.pixels.forEach((g,i)=>{rgba[i*4]=rgba[i*4+1]=rgba[i*4+2]=g;rgba[i*4+3]=255;});
  const actual=await page.locator('.us-practice figure canvas').evaluate(async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))).map(x=>x.toString(16).padStart(2,'0')).join(''));
  assert.equal(actual,createHash('sha256').update(rgba).digest('hex'),'Reference canvas must contain actual same-case signal');
};
const identify=async(mode='keyboard')=>{
  const pose=JSON.parse(await image.getAttribute('data-pose')),frame=renderUltrasound(volume,pose),points=[];
  for(let j=1;j<39;j++)for(let i=1;i<39;i++){const col=Math.round(i*.025*(frame.width-1)),row=Math.round(j*.025*(frame.height-1));if(frame.labels[row*frame.width+col]===1)points.push([i,j]);}
  assert.ok(points.length>0,'Actual current slice must contain thyroid');
  const [col,row]=points[Math.floor(points.length/2)];
  if(mode==='touch'){const r=await image.boundingBox();await page.touchscreen.tap(r.x+col*.025*r.width,r.y+row*.025*r.height);return;}
  await image.focus();
  for(let i=0;i<Math.abs(col-20);i++)await page.keyboard.press(col>20?'ArrowRight':'ArrowLeft');
  for(let j=0;j<Math.abs(row-20);j++)await page.keyboard.press(row>20?'ArrowDown':'ArrowUp');
  await page.keyboard.press('Enter');
};
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:4194');
  await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  await page.getByRole('button',{name:'갑상선 가이드 연습 · 3단계 시작 →',exact:true}).click();
  await page.getByRole('button',{name:'3단계 연습 시작',exact:true}).click();
  await page.waitForFunction(lateral=>JSON.parse(document.querySelector('canvas[data-source="acquired"]').dataset.pose).lateral===lateral,goal.lateral+12);await ready();
  await referenceMatches(0);
  await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'다음 단계',exact:true}).count(),0);
  await identify();await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();
  await page.getByRole('button',{name:'다음 단계',exact:true}).waitFor();
  await page.screenshot({path:'/tmp/xray-thyroid-practice-identify.png'});
  await fill('좌우 위치',40,'lateral');
  assert.equal(await page.getByRole('button',{name:'다음 단계',exact:true}).count(),0,'Moving must invalidate old identification');
  await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();
  assert.ok((await page.locator('.us-practice-result').textContent()).includes('선택'));
  await page.getByRole('button',{name:'연습 다시 시작',exact:true}).click();await ready();
  await page.waitForFunction(lateral=>JSON.parse(document.querySelector('canvas[data-source="acquired"]').dataset.pose).lateral===lateral,goal.lateral+12);
  await identify('touch');await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();await page.getByRole('button',{name:'다음 단계',exact:true}).click();
  await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();assert.equal(await page.getByRole('button',{name:'다음 단계',exact:true}).count(),0);
  await fill('좌우 위치',Math.round(goal.lateral*2)/2,'lateral');await fill('상하 위치',Math.round(goal.height*2)/2,'height');
  await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();await page.getByRole('button',{name:'다음 단계',exact:true}).click();
  await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();assert.equal(await page.getByRole('button',{name:'연습 결과 보기',exact:true}).count(),0);
  await fill('탐촉자 회전',90,'rotation');await page.getByRole('button',{name:'현재 단면 확인',exact:true}).click();
  await referenceMatches(90);
  await page.screenshot({path:'/tmp/xray-thyroid-practice-compare.png'});
  for(const viewport of [{width:1024,height:768},{width:390,height:844}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false);assert.ok((await image.boundingBox()).height>20);assert.ok((await page.locator('.us-scene-canvas').boundingBox()).height>20);}
  await page.screenshot({path:'/tmp/xray-thyroid-practice-mobile.png'});
  await page.getByRole('button',{name:'연습 결과 보기',exact:true}).click();
  await page.getByRole('heading',{name:'3단계 연습 완료',exact:true}).waitFor();assert.equal(await page.locator('.us-practice ol li').count(),3);
  await page.getByRole('button',{name:'처음부터 다시 연습',exact:true}).click();await ready();
  assert.equal(await page.getByRole('button',{name:'다음 단계',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'1. 갑상선 찾기',exact:true}).isVisible(),true);
  await page.getByRole('tab',{name:'위치',exact:true}).click();assert.equal(await page.getByRole('button',{name:'실측 시험 팬텀',exact:true}).isVisible(),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,errors,checks:['actual-data identification with keyboard','stale selection rejected','position and orientation assessment','90-degree reference comparison','three-step completion and restart','responsive practice and return to exploration']}));
}finally{await browser.close();}
