import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const image=page.locator('canvas[aria-label="초음파 단면 영상"]');
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-source="acquired"]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',{},{timeout:90000});
try {
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:4192');
  await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  assert.equal(await page.getByRole('slider',{name:'주파수',exact:true}).count(),0);
  assert.ok(Number(await image.getAttribute('data-coverage'))>.5);
  const original=await image.evaluate(c=>c.toDataURL());
  await page.screenshot({path:'/tmp/xray-acquired-thyroid.png'});
  await page.getByRole('checkbox',{name:'구조 해설색'}).check();
  await page.waitForFunction(()=>{const c=document.querySelector('canvas[data-source="acquired"]'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((v,i)=>i%4===0&&v>d[i+1]+20);});
  await page.screenshot({path:'/tmp/xray-acquired-thyroid-labels.png'});
  await page.getByRole('checkbox',{name:'구조 해설색'}).uncheck();
  await page.getByRole('slider',{name:'상하 위치',exact:true}).fill('40');await ready();
  await page.waitForFunction(s=>document.querySelector('canvas[data-source="acquired"]').toDataURL()!==s,original);
  await page.getByRole('button',{name:'갑상선 중심으로 복귀',exact:true}).click();await ready();
  await page.getByRole('slider',{name:'탐촉자 회전',exact:true}).fill('45');await ready();
  await page.waitForFunction(s=>document.querySelector('canvas[data-source="acquired"]').toDataURL()!==s,original);
  await page.getByRole('button',{name:'영상 정지',exact:true}).click();
  assert.equal(await page.getByRole('slider',{name:'상하 위치',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'재생',exact:true}).click();
  await page.getByRole('button',{name:'갑상선 중심으로 복귀',exact:true}).click();await ready();
  await page.waitForFunction(s=>document.querySelector('canvas[data-source="acquired"]').toDataURL()===s,original);
  for(const viewport of [{width:1024,height:768},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false);
    assert.ok((await image.boundingBox()).height>20);
  }
  await page.screenshot({path:'/tmp/xray-acquired-thyroid-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['measured human source by default','source intensity and anatomy visible','same-case segmentation colors','rotation changes acquired slice','freeze/reset','desktop tablet mobile'],errors}));
}finally{await browser.close();}
