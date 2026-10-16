import type {Vec3} from './ultrasound';

type Mesh={points:Vec3[];polys:number[];normals:Vec3[]};
type Ring={depth:number;width:number;thickness:number;lean:number;curve?:number};
export function buildProbeMesh(kind:'linear'|'curved',width:number,sectorAngle=70) {
  const half=width/2,angle=sectorAngle*Math.PI/360,radius=half/Math.sin(angle);
  const front=(x:number)=>kind==='curved'?Math.sqrt(Math.max(0,radius*radius-x*x))-radius:0;
  const finish=(points:Vec3[],polys:number[]):Mesh=>{
    const normals:Vec3[]=points.map(()=>[0,0,0]);
    for(let i=0;i<polys.length;i+=4){const a=polys[i+1],b=polys[i+2],c=polys[i+3],u=points[b].map((n,j)=>n-points[a][j]),v=points[c].map((n,j)=>n-points[a][j]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const index of [a,b,c])for(let j=0;j<3;j++)normals[index][j]+=n[j];}
    return {points,polys,normals:normals.map(n=>{const length=Math.hypot(...n);return n.map(x=>x/(length||1)) as Vec3;})};
  };
  const loft=(rings:Ring[],rounded=true)=>{
    const segments=32,points:Vec3[]=[],polys:number[]=[];
    for(const ring of rings)for(let i=0;i<segments;i++){const t=i/segments*Math.PI*2,c=Math.cos(t),s=Math.sin(t),power=rounded?.45:1,x=Math.sign(c)*Math.abs(c)**power*ring.width;points.push([x,ring.lean+Math.sign(s)*Math.abs(s)**power*ring.thickness,ring.depth+front(x)*(ring.curve??0)]);}
    for(let r=0;r<rings.length-1;r++)for(let i=0;i<segments;i++){const a=r*segments+i,b=r*segments+(i+1)%segments,c=a+segments,d=b+segments;polys.push(3,a,c,b,3,b,c,d);}
    for(const [r,reverse] of [[0,false],[rings.length-1,true]] as const){const center=points.length;points.push([0,rings[r].lean,rings[r].depth]);for(let i=0;i<segments;i++){const a=r*segments+i,b=r*segments+(i+1)%segments;polys.push(3,center,reverse?b:a,reverse?a:b);}}
    return finish(points,polys);
  };
  const body=loft([
    {depth:-1,width:half+1,thickness:7,lean:0,curve:1},
    {depth:-12,width:half*.94+1,thickness:9,lean:-1,curve:.6},
    {depth:-28,width:Math.min(14,half*.65),thickness:11,lean:-4},
    {depth:-42,width:11,thickness:11,lean:-8},
    {depth:-66,width:10,thickness:9,lean:-16},
    {depth:-84,width:8,thickness:7,lean:-21},
    {depth:-94,width:5,thickness:5,lean:-24},
  ]);
  const grip=loft([{depth:-42,width:11.3,thickness:11.3,lean:-8},{depth:-66,width:10.3,thickness:9.3,lean:-16},{depth:-81,width:8.7,thickness:7.7,lean:-20.2}]);
  const cable=loft([{depth:-94,width:2.4,thickness:2.4,lean:-24},{depth:-102,width:2.4,thickness:2.4,lean:-27},{depth:-114,width:2.2,thickness:2.2,lean:-29},{depth:-128,width:2,thickness:2,lean:-26}],false);
  const points:Vec3[]=[],polys:number[]=[];
  for(let i=0;i<=32;i++){const x=(i/16-1)*half,t=5*Math.sqrt(Math.max(.03,1-(x/half)**8));points.push([x,-t,front(x)],[x,t,front(x)]);if(i<32){const a=i*2;polys.push(3,a,a+2,a+1,3,a+1,a+2,a+3);}}
  const marker=loft([{depth:-9,width:2.4,thickness:1.1,lean:-9},{depth:-6,width:2.4,thickness:1.1,lean:-9}],false);
  marker.points.forEach(p=>{p[0]-=half+1;p[2]+=front(-half)*.6;});
  return {body,grip,cable,lens:finish(points,polys),marker};
}
