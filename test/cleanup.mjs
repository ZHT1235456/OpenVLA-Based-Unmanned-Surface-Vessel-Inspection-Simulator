import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as ort from 'onnxruntime-web';
import {HarborFleet} from '../src/fleet.js';
import {planFleetOrder} from '../src/fleet-orders.js';
import {intakeContact,unloadingPoint} from '../src/cleanup.js';
import {portLayout} from '../src/simulation.js';

ort.env.wasm.numThreads=1;
const pilot=await ort.InferenceSession.create(new Uint8Array(await readFile(new URL('../public/models/pilot.onnx',import.meta.url))),{executionProviders:['wasm']});
const rows=[],failures=[];
const classify=()=>{throw Error('清漂指令意外调用浮标指代模型')};
async function send(f,text){
  const order=await planFleetOrder(text,f,'A',classify);
  assert.ok(!order.error,text+' · '+order.error);f.dispatch(order,text);
}
const fresh=(layout,traffic)=>new HarborFleet(portLayout(layout),{traffic});
async function sail(f,until){
  const start=f.time;
  let calls=0;
  for(let step=0;f.time-start<190;step++){
    for(const id of f.ids()){
      const r=f.boats[id];
      if(step%6!==0)continue;
      const obs=r.observation(()=>assert.fail('清漂不应获取浮标裁片'));
      if(!obs)continue;
      assert.ok(obs.cleanupTarget);
      const geometry=new ort.Tensor('float32',obs.input.markerGeometry,[1,5]);
      const {control}=await pilot.run({geometry});
      assert.ok(r.inference(obs,{control:control.data},null,()=>assert.fail('清漂触发拍照')));
      calls++;geometry.dispose();control.dispose();
    }
    const before=f.litter.items.map(i=>i.state);
    f.tick(1/30);
    for(const [index,item] of f.litter.items.entries()){
      if(before[index]===item.state)continue;
      const r=f.boats[item.vessel],b=r.boat;
      if(item.state==='aboard'){
        assert.equal(before[index],'water');assert.ok(intakeContact(b,item),item.id+' 未通过收集口');
      }else{
        assert.deepEqual([before[index],item.state],['aboard','land']);
        const dock=unloadingPoint(r.layout[item.berth],item.vessel);
        assert.ok(Math.hypot(b.x-dock.x,b.z-dock.z)<.85&&b.speed<.32,item.id+' 未靠稳卸载');
      }
    }
    for(const id of f.ids()){
      assert.ok(f.litter.cargo(id).length<=2);assert.equal(f.boats[id].photos.length,0);
    }
    if(until(f))return calls;
  }
  assert.fail('航行超时 '+JSON.stringify(f.ids().map(id=>[id,f.boats[id].cleanup?.label,f.boats[id].boat,f.boats[id].logs.slice(-4)])));
}
const finished=f=>f.ids().every(id=>!f.boats[id].active)&&!f.outbox.some(p=>p.type==='ORDER');
async function scenario(text,layout,traffic,counts,expectedVessel,expectedBerth,delay=0){
  const f=fresh(layout,traffic);
  for(let i=0;i<delay*10;i++)f.tick(.1);
  await send(f,text);
  try{
    const pilotCalls=await sail(f,finished);
    const landed=f.litter.items.filter(i=>i.state==='land');
    assert.deepEqual(['bottle','foam'].map(k=>landed.filter(i=>i.kind===k).length),counts);
    assert.ok(f.litter.items.every(i=>i.state!=='aboard'&&!i.claim));
    if(expectedVessel)assert.ok(landed.every(i=>i.vessel===expectedVessel));
    if(expectedBerth)assert.ok(landed.every(i=>i.berth===expectedBerth));
    const contacts=f.ids().flatMap(id=>f.boats[id].logs.filter(l=>l.type==='接触').map(l=>id+' '+l.time.toFixed(1)+' '+l.text));
    assert.equal(f.contacts+f.ids().reduce((sum,id)=>sum+f.boats[id].collisionCount,0),0,'发生接触 '+contacts.join('、'));
    for(const id of f.ids()){
      const r=f.boats[id];
      if(!r.done.length)continue;
      const first=r.logs.findIndex(l=>l.type==='执行');
      assert.ok(first>0&&r.logs.slice(0,first).some(l=>l.type==='规划'));
    }
    assert.ok(pilotCalls>0);
    rows.push({text,layout,traffic,startedAt:delay,ashore:counts,water:5-landed.length,
      trips:f.ids().reduce((n,id)=>n+f.boats[id].logs.filter(l=>l.type==='卸载').length,0),pilotCalls});
  }catch(e){failures.push(text+'（布局 '+layout+'，保洁船 '+traffic+'，起始 '+delay+' 秒） '+e.message)}
}
const filters=[['塑料瓶',[3,0]],['泡沫块',[0,2]],['所有水面漂浮物',[3,2]]];
const berths=[['',null],['，装满后返回东泊位卸载','east'],['，满舱后回西泊位卸载','west']];
for(const verb of ['收集','清理','回收','打捞','捡拾','捞起']){
  for(const [type,counts] of filters)for(const [suffix,place] of berths)for(const vessel of ['A','B']){
    const i=rows.length+failures.length;
    await scenario(vessel+'艇'+verb+type+suffix,i%3,i%4!==0,counts,vessel,place||(vessel==='A'?'east':'west'),i%5*2);
  }
}
for(const layout of [0,1,2])for(const traffic of [false,true]){
  await scenario('双艇清理所有水面漂浮物',layout,traffic,[3,2]);
  await scenario('A艇只收集塑料瓶，B艇只收集泡沫块',layout,traffic,[3,2]);
}
await scenario('请把港池里的漂浮物清理干净，不要碰浮标',2,true,[3,2],'A','east',19);
await scenario('收集水面漂浮物，不要回收塑料瓶',1,true,[0,2],'A','east',12);
await scenario('只捡拾漂浮的塑料瓶，满了就回码头卸货',0,true,[3,0],'A','east',26);
await scenario('双艇清理水面漂浮物，装满后回东泊位卸载',1,true,[3,2],null,'east',15);
assert.deepEqual(failures,[]);
assert.ok(new Set(rows.map(r=>r.text)).size>=100);
const f=fresh(0,true);
await send(f,'只收集泡沫块');
await sail(f,()=>f.litter.cargo('A').length===1);
const onboard=f.litter.cargo('A')[0],original=onboard.id;
await send(f,'停船');for(let i=0;i<120;i++)f.tick(1/30);
assert.ok(f.boats.A.held&&f.boats.A.boat.speed<.05);
const pausedMission=f.boats.A.cleanup;
await send(f,'不要拍照');
assert.ok(f.boats.A.held&&f.boats.A.cleanup===pausedMission);
for(const unsupported of ['清理浮标','收集泡沫和渔网','不要收集漂浮物','只收集一个塑料瓶']){
  assert.ok((await planFleetOrder(unsupported,f,'A',classify)).error,unsupported);
}
await send(f,'继续任务');await send(f,'取消任务');
assert.ok(!f.boats.A.active&&f.litter.items.every(i=>!i.claim));assert.equal(f.litter.cargo('A')[0].id,original);
await send(f,'只收塑料瓶，不要泡沫块');await sail(f,finished);
assert.deepEqual(f.litter.items.filter(i=>i.state==='water').map(i=>i.kind),['foam']);
assert.equal(onboard.state,'land');
await send(f,'收集泡沫块');await sail(f,()=>f.litter.cargo('A').length===1);
await send(f,'返回西泊位卸载');await sail(f,finished);
assert.equal(onboard.berth,'east');assert.equal(f.litter.items.find(i=>i.kind==='foam'&&i.id!==original).berth,'west');
await send(f,'只收集泡沫块');assert.ok(!f.boats.A.active);assert.equal(f.litter.items.filter(i=>i.state==='land').length,5);
assert.equal(fresh(0,true).litter.items.filter(i=>i.state==='water').length,5);
const mixed=fresh(2,true);
await send(mixed,'穿过浮标门，再清理水面漂浮物，不要拍照');
assert.equal(mixed.boats.A.route.legs[0].target,'gate');
await sail(mixed,finished);
assert.deepEqual(mixed.boats.A.done.map(t=>t.kind),['gate','cleanup']);
assert.ok(mixed.litter.items.every(i=>i.state==='land'));
const reconnect=fresh(1,true);
await send(reconnect,'A艇收集塑料瓶，B艇收集泡沫块');
await sail(reconnect,()=>reconnect.litter.cargo('B').length===1);
const retained=reconnect.litter.cargo('B')[0];
reconnect.setDual(false);
assert.ok(reconnect.litter.items.every(i=>i.claim!=='B'));
await sail(reconnect,finished);
assert.equal(retained.state,'aboard');
await send(reconnect,'B艇只收集泡沫块');await sail(reconnect,finished);
assert.ok(reconnect.litter.items.every(i=>i.state==='land'));assert.equal(retained.berth,'west');
// Near the hull is insufficient: items aft, abeam or beyond the intake stay in the water.
const boat={x:0,z:0,yaw:0};
for(const p of [{x:0,z:2},{x:1,z:-1.7},{x:0,z:-3}])assert.equal(intakeContact(boat,p),false);
assert.equal(intakeContact(boat,{x:0,z:-1.7}),true);
await pilot.release();
const report={uniqueOrders:new Set(rows.map(r=>r.text)).size,completedRuns:rows.length,
  counterchecks:['船首触碰','航线先于执行','逐艇舱容','停稳卸载','零拍照','零碰撞','暂停与恢复','撤单保留船货','选择性改派','重复派单与重置','混合航段','离网与重新入网'],rows};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n','utf8');
console.log(report.uniqueOrders+' 条不同清漂指令，'+rows.length+' 次 ONNX 闭环回放通过。');
