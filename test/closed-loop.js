import * as T from 'three';
import {makeOptics,CONTACTS,fixturePosition} from '../src/contacts.js';
import {makeRun,portLayout} from '../src/simulation.js';
import {planCommand} from '../src/commands.js';
import {loadPolicy} from '../src/policy-engine.js';

async function checkChartPilot(policy){
 const crops=new Float32Array(4800),instruction=new Float32Array([1,0,0,0]);
 let maxError=0;
 for(let i=0;i<18;i++){
  const angle=(i-9)*.32,geometry=new Float32Array(20),markerGeometry=Float32Array.from([angle/Math.PI,Math.sin(angle),Math.cos(angle),i*.11-.17,i*.037]);
  // The original graph then sees this exact geometry for every possible attention distribution.
  for(let j=0;j<4;j++)geometry.set(markerGeometry,j*5);
  const full=await policy.drive({crops,geometry,instruction}),head=await policy.drive({markerGeometry});
  for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(full.control[k]-head.control[k]));
 }
 return {id:'trained-pilot-parity',pass:maxError<1e-5,maxError};
}
export async function checkRuns(){
 const policy=await loadPolicy(new URL('./',location.origin).href);
 const r=new T.WebGLRenderer({antialias:false}),optics=makeOptics(r);
 const tests=[];
 for(let layout=0;layout<3;layout++)for(const [name,word] of [['pier','木栈桥'],['wall','防波堤']])
  tests.push({id:'single-'+layout+'-'+name,layout,condition:'normal',commands:[[0,'给'+word+'旁的黄标拍一张全景']],photos:[name+':photo'],done:[name]});
 tests.push(
  {id:'green-gate-photo',layout:0,condition:'normal',commands:[[0,'去浮标门的绿标拍照']],photos:['gateGreen:photo'],done:['gateGreen']},
  {id:'planned-detour-around-pier',layout:0,condition:'normal',start:{x:-28,z:-13,yaw:Math.PI},commands:[[0,'返回西泊位']],photos:[],done:['west']},
  {id:'red-gate-photo',layout:1,condition:'normal',commands:[[0,'去红色航标拍一张照片']],photos:['gateRed:photo'],done:['gateRed']},
  {id:'gate-transit-then-green-marker',layout:2,condition:'normal',commands:[[0,'穿过红绿浮标门，再给绿标拍照，最后返回西泊位']],photos:['gateGreen:photo'],done:['gate','gateGreen','west']},
  {id:'return-against-service-traffic',layout:2,condition:'normal',commands:[[0,'穿过浮标门，只观察浮标门的红标，最后返回东泊位']],photos:[],done:['gate','gateRed','east']},
  {id:'observe-through-gate-and-dock',layout:0,condition:'normal',commands:[[0,'穿过红绿浮标门，只观察木栈桥旁的黄标，最后返回西泊位']],photos:[],done:['gate','pier','west']},
  {id:'persistent-tilt',layout:1,condition:'tilt',commands:[[0,'先查木栈桥旁的黄标，如果它一直歪着，就换一侧补拍']],photos:['pier:side'],done:['pier','pier']},
  {id:'wave-only',layout:1,condition:'normal',commands:[[0,'先查木栈桥旁的黄标，如果它一直歪着，就换一侧补拍']],photos:[],done:['pier','pier']},
  {id:'replace-shot-with-conditional-view',layout:0,condition:'normal',commands:[[0,'给木栈桥黄标拍照'],[2.2,'如果它持续倾斜就换个角度观察']],photos:[],done:['pier']},
  {id:'replace-shot-with-conditional-retake',layout:0,condition:'tilt',commands:[[0,'给木栈桥黄标拍照'],[2.2,'如果它一直歪着就补拍']],photos:['pier:side'],done:['pier']},
  {id:'withdraw-photos-then-resume',layout:0,condition:'normal',commands:[[0,'给绿标拍照，再给红标拍照，最后回西泊位'],[1.6,'不要拍照'],[2.8,'继续任务']],photos:[],done:['gateGreen','gateRed','west']},
  {id:'withdraw-only-green-photo',layout:0,condition:'normal',commands:[[0,'给绿标拍照，再给红标拍照，最后回西泊位'],[1.6,'别拍绿标']],photos:['gateRed:photo'],done:['gateGreen','gateRed','west']},
  {id:'reassign-and-return',layout:2,condition:'tilt',commands:[[0,'去木栈桥旁的黄标拍照'],[2.2,'改去防波堤旁那座，栈桥留到回程，最后返回西泊位']],photos:[],done:['wall','pier','west']},
  {id:'pause-and-resume',layout:0,condition:'tilt',commands:[[0,'给防波堤旁的浮标拍照'],[1.6,'停船'],[3.8,'继续任务']],photos:['wall:photo'],done:['wall']},
  {id:'recall-and-frame',layout:0,condition:'tilt',commands:[[0,'先查木栈桥旁的黄标，再查防波堤旁的黄标'],[42,'回去给刚才那座斜标补一张，把木栈桥也拍进去，最后改回西泊位']],photos:['pier:side'],done:['pier','wall','pier','west'],framed:true},
  {id:'negated-destination',layout:1,condition:'normal',commands:[[0,'先不要去防波堤，查木栈桥旁的黄标']],photos:[],done:['pier']},
  {id:'full-patrol',layout:0,condition:'tilt',commands:[[0,'从东泊位出发，穿过红绿浮标门，先查木栈桥旁的黄标，再查防波堤内侧那座。每座拍一张全景，如果哪座一直歪着，换到另一侧再拍一张。查完回东泊位']],photos:['pier:photo','pier:side','wall:photo'],done:['gate','pier','pier','wall','wall','east']});
 const reports=[await checkChartPilot(policy)];
 for(const t of tests){
  const sim=makeRun(portLayout(t.layout),{condition:t.condition,traffic:true});
  if(t.start){Object.assign(sim.boat,t.start);sim.trace=[{...sim.boat}]}
  let detour=null;
  let ci=0,err='',last=null,cache={},sampleAge=-Infinity;
  for(let j=0;j<1150;j++){
   if(ci<t.commands.length&&sim.time+.001>=t.commands[ci][0]){
    const raw=t.commands[ci++][1];const plan=await planCommand(raw,{active:sim.active,queue:sim.queue,last:sim.last,lastTilt:sim.lastTilt},s=>policy.classify(s));
    if(plan.error){err=plan.error;break}sim.submit(plan,raw);
    if(t.start){
     const points=sim.route.legs[0].points;
     detour={points,directBlocked:!sim.navigationMap.clear(points[0],points.at(-1)),
      segmentsClear:points.slice(1).every((p,i)=>sim.navigationMap.clear(points[i],p))};
    }
   }
   if(sim.active&&!sim.held){
    if(sim.time-sampleAge>2){cache={};for(let i=0;i<4;i++){const k=CONTACTS[i],p=fixturePosition(sim.layout[k],k);cache[k]=optics.read(i,Math.atan2(sim.boat.x-p.x,sim.boat.z-p.z),.13)}sampleAge=sim.time}
    const obs=sim.observation(k=>cache[k]);
    if(obs){const pred=await policy.drive(obs.input);sim.inference(obs,pred,c=>sim.lean(c),()=>'',.20);last={control:pred.control,contact:obs.order[pred.focus.indexOf(Math.max(...pred.focus))],f:obs.features[pred.focus.indexOf(Math.max(...pred.focus))]}}
   }
   for(let i=0;i<6;i++)sim.tick(1/30);
   if(ci===t.commands.length&&!sim.active&&!sim.queue.length)break;
  }
  const photos=sim.photos.map(p=>p.target+':'+p.kind),done=sim.done.map(d=>d.physical);
  if(detour)detour.passedPierOnWater=sim.trace.some(p=>Math.abs(p.z-sim.layout.pier.z)<1.1&&p.x>sim.layout.pier.x-3);
  const pass=!err&&!sim.active&&sim.collisionCount===0&&JSON.stringify(photos)===JSON.stringify(t.photos)&&JSON.stringify(done)===JSON.stringify(t.done)&&(!t.framed||sim.photos.at(-1)?.framing===true)&&(!detour||(detour.directBlocked&&detour.segmentsClear&&detour.passedPierOnWater));
  reports.push({id:t.id,pass,photos,done,detour:detour||undefined,collisions:sim.collisionCount,simSeconds:+sim.time.toFixed(2),yieldEvents:sim.logs.filter(l=>l.type==='让行').length,details:pass?null:{error:err,pending:sim.active,queue:sim.queue,boat:sim.boat,last,logs:sim.logs.slice(-10)}});
 }
 optics.dispose();r.dispose();return reports;
}
