import assert from 'node:assert/strict';
import {HarborFleet} from '../src/fleet.js';
import {portLayout} from '../src/simulation.js';
import {unloadingPoint} from '../src/cleanup.js';
import {armBase,armJoints,armLinks,binSlotPoint,cargoDepth} from '../src/shore-arm.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function until(fleet,predicate){
  for(let n=0;n<1200;n++){if(predicate())return;fleet.tick(1/30)}
  assert.fail('未抵达指定的交接状态');
}
function seed(fleet,id,berth,ids){
  const r=fleet.boats[id];
  Object.assign(r.boat,unloadingPoint(r.layout[berth],id),{yaw:Math.PI,speed:0,turn:0});
  ids.forEach((key,slot)=>Object.assign(fleet.litter.items.find(i=>i.id===key),{vessel:id,state:'aboard',slot}));
  r.submit({op:'replace',tasks:[{kind:'cleanup',target:'unload',berth}]},'返港卸载');
  return r;
}
function setup(dual=false){
  const f=new HarborFleet(portLayout(0),{traffic:false});f.setDual(dual);return f;
}
function kinematics(arm){
  const {tip}=arm.pose,j=armJoints(tip);
  near(Math.hypot(j.elbowR,j.elbowY-armBase.y),armLinks.upper);
  near(Math.hypot(j.radius-j.elbowR,j.wristY-j.elbowY),armLinks.fore);
  near(armBase.x+Math.sin(j.yaw)*j.radius,tip.x);
  near(armBase.z+Math.cos(j.yaw)*j.radius,tip.z);
  near(j.wristY-armLinks.tool,tip.y);
}

// Every slot is reachable throughout the admissible mooring circle, including a reversed approach.
for(const id of ['A','B'])for(let angle=0;angle<360;angle+=12)for(let yaw=0;yaw<360;yaw+=15){
  const berth={x:0,z:0},p=unloadingPoint(berth,id),a=angle*Math.PI/180,h=yaw*Math.PI/180;
  for(const y of [.18,2.9])kinematics({pose:{tip:{x:p.x+.85*Math.cos(a)+cargoDepth(1)*Math.sin(h),
    z:p.z+.85*Math.sin(a)-cargoDepth(1)*Math.cos(h),y}}});
}

{
  const f=setup(),r=seed(f,'A','east',['P1','F1']),arm=f.litter.arms.east;
  const [bottle,foam]=[f.litter.items[0],f.litter.items[3]];
  until(f,()=>arm.stage==='lower');assert.equal(bottle.state,'aboard');
  const berthPose={...r.boat};
  until(f,()=>arm.stage==='close');assert.equal(bottle.state,'aboard');
  until(f,()=>arm.stage==='lift');
  assert.equal(bottle.state,'gripped');assert.equal(foam.slot,1);
  near(arm.pick.x,berthPose.x-r.layout.east.x+cargoDepth(0)*Math.sin(berthPose.yaw));
  near(arm.pick.z,berthPose.z-r.layout.east.z-cargoDepth(0)*Math.cos(berthPose.yaw));
  r.submit({op:'hold'},'停船');const pose=structuredClone(arm.pose);
  for(let i=0;i<50;i++)f.tick(1/30);
  assert.deepEqual(arm.pose,pose);assert.deepEqual(r.boat,berthPose);assert.equal(bottle.state,'gripped');
  r.submit({op:'resume'},'继续任务');
  until(f,()=>arm.stage==='open');assert.equal(bottle.state,'gripped');
  for(const axis of ['x','y','z'])near(arm.pose.tip[axis],binSlotPoint(0)[axis]);
  until(f,()=>bottle.state==='land');assert.equal(bottle.binSlot,0);
  assert.equal(foam.state,'aboard');assert.equal(foam.slot,1);
  until(f,()=>!r.active);
  assert.equal(foam.binSlot,1);assert.equal(foam.state,'land');assert.equal(r.photos.length,0);
  assert.equal(r.logs.filter(l=>l.type==='卸载').length,1);assert.equal(r.logs.filter(l=>l.type==='入箱').length,2);
  assert.equal(f.litter.isMoored('A'),false);assert.equal(arm.stage,'idle');
}
for(const cancelAt of ['lower','close','lift','swing','open','stow']){
  const f=setup(),r=seed(f,'A','west',['P1','F1']),arm=f.litter.arms.west;
  until(f,()=>arm.stage===cancelAt);r.submit({op:'cancel'},'取消任务');
  until(f,()=>!arm.moors('A'));
  const beforeGrasp=['lower','close'].includes(cancelAt);
  assert.equal(f.litter.items[0].state,beforeGrasp?'aboard':'land');
  assert.equal(f.litter.items[3].state,'aboard');
  r.submit({op:'replace',tasks:[{kind:'cleanup',target:'unload',berth:'west'}]},'返回西泊位卸载');
  until(f,()=>!r.active);assert.equal(r.logs.filter(l=>l.type==='入箱').length,2);
}
for(const sameBerth of [true,false]){
  const f=setup(true),a=seed(f,'A','east',['P1','P2']),b=seed(f,'B',sameBerth?'east':'west',['F1','F2']);
  const arms=Object.values(f.litter.arms),order=[],seen=new Set();let concurrent=false;
  until(f,()=>{
    for(const arm of arms)kinematics(arm);
    const gripped=f.litter.items.filter(i=>i.state==='gripped');
    concurrent||=gripped.length===2;
    for(const i of gripped)if(!seen.has(i.id)){order.push(i.vessel);seen.add(i.id)}
    return !a.active&&!b.active;
  });
  assert.equal(seen.size,4);assert.equal(concurrent,!sameBerth);
  if(sameBerth)assert.deepEqual(order,['A','A','B','B']);
  const land=f.litter.items.filter(i=>i.state==='land');
  assert.equal(new Set(land.map(i=>i.berth+'/'+i.binSlot)).size,4);
}
{
  const f=setup(true),b=seed(f,'B','west',['F1','F2']);
  until(f,()=>f.litter.arms.west.stage==='swing');f.setDual(false);
  until(f,()=>!f.litter.arms.west.moors('B'));
  assert.equal(f.litter.items[3].state,'land');assert.equal(f.litter.items[4].state,'aboard');
  f.setDual(true);b.submit({op:'replace',tasks:[{kind:'cleanup',target:'unload',berth:'west'}]},'返港卸载');
  until(f,()=>!b.active);assert.equal(f.litter.items[4].state,'land');
}
console.log('岸臂两段连杆、真实货位、靠泊、暂停、六种撤单时机、同泊排队、异泊并行、离网续卸检查通过。');
