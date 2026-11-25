import assert from 'node:assert/strict';
import {planCommand} from '../src/commands.js';
import {planFleetOrder} from '../src/fleet-orders.js';
import {HarborFleet} from '../src/fleet.js';
import {makeRun,portLayout} from '../src/simulation.js';
const sample=async text=>({target:/栈|木/.test(text)?'pier':/堤/.test(text)?'wall':/西/.test(text)?'west':/东/.test(text)?'east':'unknown',confidence:1});
let p=await planCommand('先查木栈桥旁的黄标，再查防波堤内侧那座。如果哪座一直歪着，换到另一侧再拍一张。查完回东泊位',{},sample);
assert.deepEqual(p.tasks.map(t=>[t.target,t.kind,t.conditional]),[
 ['pier','approach',false],['pier','side',true],['wall','approach',false],['wall','side',true],['east','berth',false]]);
p=await planCommand('这座先别拍，先去查另一座，回来再补',{active:{target:'pier',kind:'photo'}},sample);
assert.deepEqual(p.tasks.map(t=>[t.target,t.kind]),[['wall','approach'],['pier','photo']]);
p=await planCommand('回去给刚才那座斜标补一张，把木栈桥也拍进去，最后改回西泊位',{last:'wall',lastTilt:'pier'},sample);
assert.equal(p.tasks[0].target,'pier');assert.equal(p.tasks[0].framing,true);assert.equal(p.tasks[1].target,'west');
assert.ok((await planCommand('去黄标拍照',{},sample)).error);
assert.equal((await planCommand('停船',{},sample)).op,'hold');
for(const text of ['抵近观察栈桥黄标','去栈桥黄标，只观察','去栈桥黄标，不拍照','去木栈桥旁的黄标','检查栈桥黄标',
 '巡检木栈桥','去栈桥黄标的拍照点','检查上次拍下的栈桥黄标','检查栈桥黄标的拍摄记录','确认栈桥黄标是否已经拍照',
 '不用拍照，去栈桥黄标','检查栈桥黄标但不需要拍照','全程不要拍照，检查栈桥黄标','巡检栈桥黄标，补一张巡检表',
 '检查栈桥黄标上的照相机','查看栈桥黄标旁的摄影平台','检查是否给栈桥黄标拍照','去栈桥黄标附近观察游客拍照']){
 const plan=await planCommand(text,{},sample);
 assert.deepEqual(plan.tasks.map(t=>[t.target,t.kind]),[['pier','approach']]);
}
assert.equal((await planCommand('靠近栈桥黄标拍一张全景',{},sample)).tasks[0].kind,'photo');
for(const text of ['拍下浮标门绿标','给绿标照相','给绿标留影','去绿标按下快门','识别绿标并拍照'])
 assert.deepEqual((await planCommand(text,{},sample)).tasks.map(t=>t.kind),['photo'],text);
assert.deepEqual((await planCommand('检查绿标是否倾斜并拍照',{},sample)).tasks.map(t=>t.kind),['photo']);
assert.deepEqual((await planCommand('绕到防波堤黄标另一侧观察',{},sample)).tasks.map(t=>t.kind),['sideObserve']);
assert.ok((await planCommand('检查栈桥黄标，如果它持续倾斜',{},sample)).error);
for(const text of ['如果它持续倾斜就换个角度观察','如果它一直歪着就补拍']){
 const conditional=await planCommand(text,{active:{target:'pier',kind:'photo'}},sample);
 assert.equal(conditional.op,'replace',text);assert.ok(conditional.tasks.every(t=>t.conditional));
}
assert.equal((await planCommand('追加，如果它一直歪着就补拍',{active:{target:'pier',kind:'photo'}},sample)).op,'append');
assert.deepEqual((await planCommand('先观察栈桥黄标，再拍一张',{},sample)).tasks.map(t=>t.kind),['approach','photo']);
const framed=await planCommand('靠近防波堤黄标，把防波堤也拍进去',{},sample);
assert.equal(framed.tasks[0].kind,'photo');assert.equal(framed.tasks[0].framing,true);
const deferred=await planCommand('先观察防波堤，栈桥留到回程只观察',{},sample);
assert.deepEqual(deferred.tasks.map(t=>[t.target,t.kind]),[['wall','approach'],['pier','approach']]);
assert.deepEqual((await planCommand('穿过红绿浮标门，不拍照',{},sample)).tasks.map(t=>t.kind),['gate']);
assert.deepEqual((await planCommand('先不要去木栈桥，去防波堤旁的黄标拍照',{},sample)).tasks.map(t=>t.target),['wall']);
console.log('Chinese command composition checks passed');
const fleet=new HarborFleet(portLayout());
for(const command of ['去木栈桥旁边的绿标拍照','去木栈桥旁边，给绿色浮标拍照','给绿标拍照，它在木栈桥旁','给防波堤旁的红色航标补拍','先回东泊位，最后查木桥边的绿色浮标',
 'A艇查木栈桥黄标，B艇去防波堤旁边的绿标拍照','接力复核，A艇检查栈桥绿标，B艇接力补拍','双艇分别巡检栈桥绿标和防波堤黄标','去栈桥紫标拍照']){
 const order=await planFleetOrder(command,fleet,'A',sample);
 assert.ok(order.error,command);assert.equal(order.assignments,undefined);
}
for(const [text,id] of [['给浮标门的绿标拍照','gateGreen'],['去红色浮标拍照','gateRed'],['去木栈桥旁边的黄标拍照','pier'],['穿过红绿浮标门','gate']]){
 const order=await planFleetOrder(text,fleet,'A',sample);
 assert.deepEqual(order.assignments[0].plan.tasks.map(t=>t.target),[id]);
}
const pair=await planFleetOrder('双艇分别巡检红标和绿标',fleet,'A',sample);
assert.deepEqual((await planCommand('穿过红绿浮标门，给绿标拍照',{},sample)).tasks.map(t=>t.target),['gate','gateGreen']);
assert.ok((await planCommand('给红或绿标拍照',{},sample)).error);
assert.deepEqual(new Set(pair.assignments.map(a=>a.plan.tasks[0].target)),new Set(['gateGreen','gateRed']));
const boat=fleet.boats.A;
boat.submit({op:'replace',tasks:[{target:'pier',kind:'photo'}]},'给栈桥黄标拍照');
const obs=boat.observation(()=>new Uint8Array(1200));
const wrong=obs.order.map(id=>id==='wall'?1:0);
for(let i=0;i<12;i++)boat.inference(obs,{control:[1,1,1],focus:wrong},()=>0,()=>{throw Error('Wrong shutter')});
assert.deepEqual(boat.act,{throttle:0,turn:0});assert.equal(boat.done.length,0);assert.equal(boat.photos.length,0);
console.log('Marker identity and rejected-dispatch checks passed');

// The network can request the shutter on any frame. Only a current photographic task may fire it.
for(const predictedShutter of [0,1]){
 const run=makeRun(portLayout()),point=run.layout.gateGreen;
 Object.assign(run.boat,{x:point.x,z:point.z+4.2,yaw:0,speed:0});
 const shoot=await planCommand('给绿标拍照',{},sample);
 const observe=await planCommand('巡检绿标',{},sample);
 let shots=0;
 const capture=()=>{shots++;return 'test exposure'};
 const predict=shutter=>({focus:[1],control:[-1,0,shutter]});
 run.submit(shoot,'给绿标拍照');
 const stale=run.observation();
 run.submit(observe,'巡检绿标');
 assert.equal(run.shutterEnabled,false);
 assert.equal(run.inference(stale,predict(1),()=>0,capture),false);
 const frame=run.observation();
 for(let i=0;i<3;i++)run.inference(frame,predict(predictedShutter),()=>0,capture,.2);
 assert.equal(run.done[0]?.kind,'approach');assert.equal(shots,0);
 run.submit(shoot,'给绿标拍照');
 const authorized=run.observation();
 for(let i=0;i<5;i++)run.inference(authorized,predict(0),()=>0,capture,.2);
 assert.equal(shots,0);
 for(let i=0;i<4;i++)run.inference(authorized,predict(1),()=>0,capture,.2);
 assert.equal(shots,1);assert.equal(run.photos.length,1);
}
console.log('Shutter authorization and stale prediction checks passed');

const pausedRun=makeRun(portLayout());
pausedRun.submit(await planCommand('给绿标拍照，再给红标拍照，最后回西泊位',{},sample),'分段拍照');
pausedRun.submit({op:'hold'},'停船');
const retract=await planCommand('别拍绿标',{active:pausedRun.active,queue:pausedRun.queue},sample);
pausedRun.submit(retract,'别拍绿标');
assert.equal(pausedRun.held,true);
pausedRun.submit({op:'resume'},'继续任务');
assert.deepEqual([pausedRun.active,...pausedRun.queue].map(t=>[t.target,t.kind]),[
 ['gateGreen','approach'],['gateRed','photo'],['west','berth']]);
assert.equal(pausedRun.shutterEnabled,false);

const routing=makeRun(portLayout()),map=routing.navigationMap;
const start={x:-28,z:-13},end={x:-28,z:5};
assert.equal(map.clear(start,end),false);
const detour=map.findPath(start,end);
assert.ok(detour.length>2);
assert.ok(detour.slice(1).every((p,i)=>map.clear(detour[i],p)));
assert.deepEqual(map.findPath({x:0,z:20},{x:0,z:-14}),[{x:0,z:20},{x:0,z:-14}]);
assert.equal(map.findPath(start,{x:99,z:0}),null);
routing.submit({op:'replace',tasks:[{target:'pier',kind:'photo'},{target:'west',kind:'berth'}]},'给栈桥黄标拍照，再回西泊位');
assert.deepEqual(routing.route.legs.map(leg=>leg.target),['pier','west']);
assert.deepEqual(routing.route.legs[0].points[0],{x:routing.boat.x,z:routing.boat.z});
assert.ok(routing.route.legs[0].points.length>2);
assert.equal(routing.shutterEnabled,false);
assert.ok(routing.logs.findIndex(l=>l.type==='规划')<routing.logs.findIndex(l=>l.type==='执行'));
assert.equal(routing.boat.speed,0);
const oldFrame=routing.observation(()=>new Uint8Array(1200));
assert.equal(oldFrame.features[oldFrame.order.indexOf('pier')].final,false);
const waypointBearing=Math.atan2(routing.nextWaypoint.x-routing.boat.x,routing.boat.z-routing.nextWaypoint.z);
assert.ok(Math.abs(oldFrame.features[oldFrame.order.indexOf('pier')].err-(waypointBearing-routing.boat.yaw))<1e-8);
routing.submit({op:'replace',tasks:[{target:'gateGreen',kind:'approach'}]},'改查绿标');
assert.equal(routing.inference(oldFrame,{focus:[1],control:[1,1,1]},()=>0,()=>{throw Error('过期航线触发了快门')}),false);
routing.submit({op:'cancel'},'取消任务');assert.deepEqual(routing.plannedTrack,[]);
const blocked=makeRun(portLayout());
blocked.navigationMap.obstacles.push({x:blocked.layout.west.x,z:blocked.layout.west.z,radius:4});
blocked.submit({op:'replace',tasks:[{target:'gateGreen',kind:'photo'},{target:'west',kind:'berth'}]},'给绿标拍照，再回西泊位');
assert.equal(blocked.route.blocked.target,'west');assert.equal(blocked.observation(),null);
blocked.tick(.2);assert.equal(blocked.boat.speed,0);assert.equal(blocked.shutterEnabled,false);
console.log('Pre-departure planning, detour, replacement and unreachable route checks passed');
