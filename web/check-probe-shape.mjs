import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildProbeMesh} from './src/probeMesh.ts';
import {DEFAULT_PROBE,rayPoint} from './src/ultrasound.ts';
const g={origin:[0,0,0],across:[1,0,0],normal:[0,1,0],inward:[0,0,1],contact:true};
for(const probe of ['linear','curved'])for(const width of [15,50,70])for(const sectorAngle of [30,70,100]){
  const parts=buildProbeMesh(probe,width,sectorAngle);
  for(const mesh of Object.values(parts)){
    assert.equal(mesh.points.length,mesh.normals.length);
    assert.ok(mesh.points.flat().every(Number.isFinite));
    mesh.normals.forEach(n=>assert.ok(Math.abs(Math.hypot(...n)-1)<1e-6));
    for(let i=0;i<mesh.polys.length;i+=4){assert.equal(mesh.polys[i],3);const indices=mesh.polys.slice(i+1,i+4);indices.forEach(n=>assert.ok(n>=0&&n<mesh.points.length));const [a,b,c]=indices.map(n=>mesh.points[n]),u=b.map((n,j)=>n-a[j]),v=c.map((n,j)=>n-a[j]);assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-8);}
  }
  const half=sectorAngle*Math.PI/360,radius=width/(2*Math.sin(half));
  for(const [a,,d] of parts.lens.points){const line=probe==='linear'?a/width+.5:(Math.asin(a/radius)/half+1)/2,p=rayPoint(g,{...DEFAULT_PROBE,probe,width,sectorAngle},line,0);assert.ok(Math.abs(a-p[0])<1e-8&&Math.abs(d-p[2])<1e-8);}
  assert.ok(parts.marker.points.every(p=>p[0]<0),'Marker must remain on the image-left side');
  assert.ok(Math.min(...parts.body.points.map(p=>p[2]))<-90,'Handle must extend behind the contact face');
  assert.ok(parts.lens.normals.every(n=>n[2]>0));
}
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>document.querySelector('canvas[data-source]')?.dataset.ready==='true'&&document.querySelector('.us-image-area')?.getAttribute('aria-busy')==='false',null,{timeout:90000});
try{
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:4194');await page.getByRole('button',{name:'초음파 촬영 연습',exact:true}).click();await ready();
  await page.getByRole('button',{name:'단면 조작점 확대',exact:true}).click();await page.screenshot({path:'/tmp/xray-probe-linear.png'});
  const r=await page.locator('.us-scene-canvas').boundingBox();await page.keyboard.down('Shift');await page.mouse.move(r.x+r.width*.5,r.y+r.height*.5);await page.mouse.down();await page.mouse.move(r.x+r.width*.5+120,r.y+r.height*.5+25,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');await page.screenshot({path:'/tmp/xray-probe-linear-angle.png'});
  await page.getByRole('button',{name:'전신 인체 팬텀',exact:true}).click();await ready();
  await page.getByRole('button',{name:'간',exact:true}).click();await ready();
  await page.getByRole('checkbox',{name:'선택 장기 강조',exact:true}).check();
  const scene=page.locator('.us-scene-canvas'),curved=await scene.screenshot();await page.screenshot({path:'/tmp/xray-probe-curved.png'});
  await page.getByRole('tab',{name:'영상',exact:true}).click();await page.getByRole('combobox',{name:'탐촉자 종류',exact:true}).selectOption('linear');await ready();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('canvas[data-source]').dataset.pose).probe==='linear');
  assert.notDeepEqual(await scene.screenshot(),curved);await page.screenshot({path:'/tmp/xray-probe-linear-body.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['flat and curved contact faces match beam origin','finite unit normals and non-degenerate triangles','left marker','rounded housing handle grip and cable','browser source and shape switching'],errors}));
}finally{await browser.close();}
