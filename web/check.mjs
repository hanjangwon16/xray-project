import {chromium} from 'playwright';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(process.env.TEST_URL || 'http://127.0.0.1:4190');
// switch to case workspace
await p.getByRole('button',{name:'실제 CT · X-ray 사례',exact:true}).click();
await p.waitForSelector('.drrimg',{state:'attached',timeout:60000});
await p.getByRole('button',{name:'우신장',exact:true}).click();await p.waitForTimeout(600);await p.screenshot({path:'/tmp/repaired.png'});
await p.getByRole('button',{name:'앞뒤 단면',exact:true}).click();await p.waitForTimeout(300);
await p.getByRole('button',{name:'X-ray 촬영 방향',exact:true}).click();await p.waitForSelector('.drrimg');
const before=await p.locator('.drrimg').getAttribute('src');await p.getByRole('button',{name:'RAO 45°',exact:true}).click();await p.waitForFunction(old=>document.querySelector('.drrimg').src!==old,before);
await p.locator('header select').selectOption('example_ct');await p.waitForTimeout(4000);
await p.locator('header select').selectOption('example_ct_sm');await p.waitForTimeout(3000);
console.log({errors,overflow:await p.evaluate(()=>document.documentElement.scrollHeight>innerHeight),canvases:await p.locator('.vp canvas').count()});if(errors.length)throw Error(errors.join('\n'));await b.close();
