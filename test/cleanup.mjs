import assert from 'node:assert/strict';
import {HarborFleet} from '../src/fleet.js';
import {planFleetOrder} from '../src/fleet-orders.js';
import {HarborLitter,intakeContact} from '../src/cleanup.js';
import {portLayout} from '../src/simulation.js';

const fleet=new HarborFleet(portLayout(0),{traffic:false});
const parse=text=>planFleetOrder(text,fleet,'A',()=>assert.fail('意外调用航标指代模型'));
let cases=0;
for(const verb of ['收集','清理','回收','打捞','捡拾','捞起']){
  for(const [material,target] of [['泡沫块','foam'],['塑料瓶','bottle'],['所有水面漂浮物','litter']]){
    for(const [suffix,dock] of [['',null],['，装满后返回东泊位卸载','east'],['，满舱后回西泊位卸载','west']]){
      for(const id of ['A','B']){
        const order=await parse(id+'艇'+verb+material+suffix);
        const assignment=order.assignments.find(a=>a.id===id),task=assignment.plan.tasks[0];
        assert.equal(task.kind,'cleanup');assert.equal(task.target,target);
        if(dock)assert.equal(task.berth,dock);
        cases++;
      }
    }
  }
}
for(const invalid of ['清理浮标','收集泡沫和渔网','不要收集漂浮物','只收集一个塑料瓶']){
  assert.ok((await parse(invalid)).error);
}
const denied=await parse('收集水面漂浮物，不要回收塑料瓶');
assert.equal(denied.assignments[0].plan.tasks[0].target,'foam');
assert.match(denied.assignments[0].plan.tasks[0].words,/泡沫/);
const boat={x:0,z:0,yaw:0};
for(const p of [{x:0,z:2},{x:1,z:-1.7},{x:0,z:-3}])assert.equal(intakeContact(boat,p),false);
assert.ok(intakeContact(boat,{x:0,z:-1.7}));
const world=new HarborLitter();
Object.assign(world.items[0],{x:0,z:-1.7});
assert.equal(world.takeAtIntake({boat,id:'A'}).kind,'bottle'); // The physical gate accepts either material.
const command=await parse('只收集泡沫块');fleet.dispatch(command,'只收集泡沫块');
const run=fleet.boats.A;
const frame=new Uint8Array(128*80*3),obs=run.observation(()=>assert.fail('不应读取浮标裁片'),()=>frame);
assert.deepEqual(Object.keys(obs.input).sort(),['bowRgb','markerGeometry','words']);
assert.equal(obs.input.bowRgb,frame);assert.ok(obs.input.words.includes('泡沫'));
assert.ok(run.route.legs.length);assert.equal(run.cleanup.gate,false);
console.log(cases+' 条中文派单、收集口几何和船首观测接口检查通过。');
