import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TEST_URL||'http://127.0.0.1:4190';
const image=page.locator('canvas[aria-label="초음파 단면 영상"]');
const ready=async()=>{await image.waitFor();await page.waitForFunction(()=>document.querySelector('canvas[aria-label="초음파 단면 영상"]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',{},{timeout:90000});};
const pixels=()=>image.evaluate(c=>c.toDataURL());
const pose=async(source,rotation)=>{await ready();await page.waitForFunction(({source,rotation})=>{const c=document.querySelector('canvas[aria-label="초음파 단면 영상"]');return c?.dataset.source===source&&JSON.parse(c.dataset.pose||'{}').rotation===rotation&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false';},{source,rotation},{timeout:90000});};
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false);
try {
  await page.goto(base);
  await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  await pose('acquired',0);
  await page.getByRole('button',{name:'전신 인체 팬텀',exact:true}).click();await ready();
  await pose('anatomy',0);
  const body=await pixels();
  await page.screenshot({path:'/tmp/xray-simulator-fullbody.png'});
  const oldHeight=await page.getByRole('slider',{name:'상하 위치',exact:true}).inputValue();
  const scene=page.locator('.us-scene-canvas'),bounds=await scene.boundingBox();
  await scene.click({position:{x:bounds.width*.5,y:bounds.height*.42}});await ready();
  assert.notEqual(await page.getByRole('slider',{name:'상하 위치',exact:true}).inputValue(),oldHeight);
  await page.getByRole('button',{name:'오른쪽 신장',exact:true}).click();await ready();
  assert.equal(await page.getByRole('button',{name:'피부 보기',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'탐촉자 확대',exact:true}).click();
  await page.screenshot({path:'/tmp/xray-simulator-internal.png'});
  await page.getByRole('slider',{name:'탐촉자 회전',exact:true}).fill('90');await pose('anatomy',90);assert.notEqual(await pixels(),body);
  await page.getByRole('button',{name:'실제 복부 CT 기반',exact:true}).click();await pose('human',0);
  const original=await pixels();
  await page.getByRole('button',{name:'같은 면 CT 비교',exact:true}).click();assert.notEqual(await pixels(),original);
  await page.getByRole('button',{name:'B-mode 보기',exact:true}).click();assert.equal(await pixels(),original);
  assert.ok(await image.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((v,i)=>i%4!==3&&v>30);}));
  await page.screenshot({path:'/tmp/xray-simulator-human.png'});
  await page.getByRole('slider',{name:'탐촉자 회전',exact:true}).fill('90');
  await page.waitForFunction(s=>document.querySelector('canvas[aria-label="초음파 단면 영상"]').toDataURL()!==s,original);await ready();
  const rotated=await pixels();assert.notEqual(rotated,original);
  await page.getByRole('button',{name:'영상 정지',exact:true}).click();
  assert.equal(await page.getByRole('slider',{name:'좌우 위치',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'실측 시험 팬텀',exact:true}).isDisabled(),true);
  assert.equal(await pixels(),rotated);
  await page.getByRole('button',{name:'재생',exact:true}).click();await ready();
  await page.getByRole('button',{name:'자세·영상 설정 초기화',exact:true}).click();await ready();
  await page.waitForFunction(s=>document.querySelector('canvas[aria-label="초음파 단면 영상"]').toDataURL()===s,original);
  const before=await pixels();await page.getByRole('slider',{name:'좌우 위치',exact:true}).fill('35');await ready();
  await page.waitForFunction(s=>document.querySelector('canvas[aria-label="초음파 단면 영상"]').toDataURL()!==s,before);
  await page.getByRole('checkbox',{name:'구조 해설색'}).check();
  await page.getByRole('button',{name:'같은 위치 CT 보기 ↗',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.workspace-nav')?.textContent.includes('초음파 빔 중앙 위치'));await page.waitForSelector('.drrimg',{state:'attached',timeout:60000});
  assert.equal(await page.getByRole('combobox',{name:'CT 사례',exact:true}).inputValue(),'example_ct');
  await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  await page.getByRole('button',{name:'실측 시험 팬텀',exact:true}).click();await pose('phantom',0);
  assert.equal(await page.locator('.us-panel-heading').last().textContent(),'02 / B-MODE실측 볼륨 · 재단면');
  assert.ok(Number(await image.getAttribute('data-coverage'))>.1);
  const phantom=await pixels();await page.getByRole('slider',{name:'탐촉자 회전',exact:true}).fill('45');await pose('phantom',45);
  await page.waitForFunction(s=>document.querySelector('canvas[aria-label="초음파 단면 영상"]').toDataURL()!==s,phantom);
  await page.screenshot({path:'/tmp/xray-simulator-phantom.png'});await noOverflow();
  for(const viewport of [{width:1024,height:768},{width:390,height:844}]) {
    await page.setViewportSize(viewport);await noOverflow();
    assert.ok((await image.boundingBox()).height>20);
  }
  await page.screenshot({path:'/tmp/xray-simulator-mobile.png'});
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'실제 영상 자료',exact:true}).click();
  await page.waitForSelector('.library-image img');await page.waitForFunction(()=>document.querySelector('.library-image img')?.naturalWidth>0);
  assert.equal(await page.locator('.library-case-list button').count(),8);
  await page.screenshot({path:'/tmp/xray-library-xray.png'});
  await page.locator('.library-tools').getByRole('button',{name:'초음파',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.library-image img')?.src.includes('ultrasound-1.png')&&document.querySelector('.library-image img')?.naturalWidth>0);
  const real=await page.locator('.library-image img').getAttribute('src');
  await page.screenshot({path:'/tmp/xray-library-ultrasound.png'});
  await page.getByRole('button',{name:'병변 마스크 보기',exact:true}).click();
  assert.notEqual(await page.locator('.library-image img').getAttribute('src'),real);
  await page.waitForFunction(()=>document.querySelector('.library-image img')?.naturalWidth>0);
  await page.evaluate(async()=>{
    const catalog=await(await fetch('./learning/catalog.json')).json(),sheet=document.createElement('div');sheet.id='asset-review-sheet';sheet.style.cssText='position:fixed;inset:0;background:#fff;color:#111;z-index:10000;display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:8px;';
    const pending=[];
    for(const item of catalog.cases)for(const file of [item.image,item.mask].filter(Boolean)){
      const card=document.createElement('div'),caption=document.createElement('div'),img=document.createElement('img');caption.textContent=file;caption.style.fontSize='10px';img.style.cssText='width:100%;height:260px;object-fit:contain;';pending.push(new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;}));img.src='./learning/'+file;card.append(caption,img);sheet.append(card);
    }
    document.body.append(sheet);await Promise.all(pending);
  });
  await page.screenshot({path:'/tmp/xray-learning-assets-review.png'});await page.locator('#asset-review-sheet').evaluate(e=>e.remove());
  for(let i=0;i<2;i++) {await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();await page.getByRole('button',{name:'실제 영상 자료',exact:true}).click();await page.waitForSelector('.library-image img');}
  await noOverflow();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,errors,checks:['full body anatomical phantom and internal view','anatomical pose changes output','human pose changes output','freeze locks pose','reset deterministic','CT same-case navigation','measured 3DUS reslice','desktop/tablet/mobile overflow','real Xray/US library and masks','repeat disposal'] }));
} finally {await browser.close();}
