import {chromium} from 'playwright';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(process.env.TEST_URL || 'http://127.0.0.1:4190');await p.waitForFunction(()=>document.querySelector('.atlas-status')?.textContent.includes('아틀라스'),{},{timeout:120000});
await p.getByRole('button',{name:'뼈 단독 보기'}).click();await p.screenshot({path:'/tmp/atlas-bones.png'});
for(const name of ['장기','근육','혈관','신경']){await p.getByRole('button',{name:name+' 단독 보기'}).click();if(await p.locator('.system-row input:checked').count()!==1)throw Error('selection');}
await p.getByRole('button',{name:'모두 보기',exact:true}).click();if(await p.locator('.system-row input:checked').count()!==5)throw Error('all');
await p.getByRole('button',{name:'뼈 단독 보기'}).click();const box=await p.locator('.atlas-canvas').boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2+150,box.y+box.height/2+40,{steps:10});await p.mouse.up();await p.mouse.wheel(0,-150);await p.screenshot({path:'/tmp/atlas-rotated.png'});await p.getByRole('button',{name:'전체 맞춤'}).click();
await p.getByRole('button',{name:'실제 CT · X-ray 사례'}).click();await p.getByRole('button',{name:'X-ray 촬영 방향'}).click();await p.waitForSelector('.drrimg');const src=await p.locator('.drrimg').getAttribute('src');await p.getByRole('button',{name:'RAO 45°',exact:true}).click();await p.waitForFunction(s=>document.querySelector('.drrimg').src!==s,src,{timeout:60000});
console.log({errors,overflow:await p.evaluate(()=>document.documentElement.scrollHeight>innerHeight)});if(errors.length)throw Error(errors.join(';'));await b.close();
