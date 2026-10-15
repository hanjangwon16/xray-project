import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync(new URL('./public/learning/organ-sources.json',import.meta.url)));
assert.deepEqual(manifest.map(r=>r.sourceImageCount),[9416,10507]);
assert.equal(manifest.reduce((n,r)=>n+r.exports.length,0),44);
for(const source of manifest)for(const item of source.exports)assert.equal(createHash('sha256').update(readFileSync(new URL('./public/learning/'+item.file,import.meta.url))).digest('hex'),item.sha256);
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const canvas=page.locator('canvas[aria-label="초음파 단면 영상"]');
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[aria-label="초음파 단면 영상"]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',null,{timeout:90000});
const pixels=()=>canvas.evaluate(c=>c.toDataURL());
const setting=async(name,value)=>{await page.getByRole('slider',{name,exact:true}).fill(String(value));await page.waitForFunction(({key,value})=>{const c=document.querySelector('canvas[aria-label="초음파 단면 영상"]');return JSON.parse(c?.dataset.pose||'{}')[key]===value&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false';},{key:({'좌우 위치':'lateral','프로브 폭':'width','시야각':'sectorAngle','주파수':'frequency','젤 스탠드오프 거리':'standoff'})[name],value});};
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:4194');
  await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  await page.getByRole('button',{name:'전신 인체 팬텀',exact:true}).click();await ready();
  assert.equal(await page.getByRole('button',{name:'피부 보기',exact:true}).isVisible(),true);
  for(const organ of ['간','담낭','췌장','방광']){
    await page.getByRole('button',{name:organ,exact:true}).click();await ready();
    assert.ok(Number(await canvas.getAttribute('data-coverage'))>.1,organ+' scan coverage');
  }
  await page.getByRole('button',{name:'간',exact:true}).click();await ready();
  await page.screenshot({path:'/tmp/xray-expanded-liver.png'});
  const before=await pixels(),old=Number(await page.getByRole('slider',{name:'좌우 위치',exact:true}).inputValue());
  await setting('좌우 위치',Math.round((old+2)*2)/2);assert.notEqual(await pixels(),before);
  const moved=await pixels();await setting('프로브 폭',25);assert.notEqual(await pixels(),moved);
  const narrow=await pixels();await setting('시야각',45);assert.notEqual(await pixels(),narrow);
  const low=await pixels();await setting('주파수',12);assert.notEqual(await pixels(),low);
  const touching=await pixels();await setting('젤 스탠드오프 거리',20);assert.notEqual(await pixels(),touching);
  await page.getByRole('button',{name:'간',exact:true}).click();await ready();
  await page.getByRole('button',{name:'실제 간 참고 영상 ↗',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.library-image img')?.naturalWidth>0);
  assert.equal(await page.locator('.library-case-list button').count(),28);
  await page.getByRole('button',{name:'담낭',exact:true}).click();assert.equal(await page.locator('.library-case-list button').count(),4);
  await page.getByRole('button',{name:'장기 마스크 보기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.library-image img')?.src.includes('-mask.png')&&document.querySelector('.library-image img')?.naturalWidth>0);
  await page.screenshot({path:'/tmp/xray-real-gallbladder-mask.png'});
  await page.getByRole('button',{name:'신장',exact:true}).click();assert.equal(await page.locator('.library-case-list button').count(),16);
  await page.waitForFunction(()=>document.querySelector('.library-image img')?.src.includes('kidney-real-')&&document.querySelector('.library-image img')?.naturalWidth>0);
  for(const viewport of [{width:1024,height:768},{width:390,height:844}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1440,height:960});await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  assert.equal(await canvas.getAttribute('data-source'),'anatomy');assert.ok((await page.locator('.us-readout').textContent()).startsWith('간'));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,exports:44,errors,checks:['eight anatomical organs','default internal display','lateral output update','width/sector/frequency/standoff output changes','organ-linked real images','source hashes','gallbladder mask','responsive library']}));
}finally{await browser.close();}
