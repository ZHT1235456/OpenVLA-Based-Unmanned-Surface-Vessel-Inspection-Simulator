import {HarborFleet} from '../src/fleet.js';
import {HarborView} from '../src/scene.js';
import {portLayout} from '../src/simulation.js';
import {planFleetOrder} from '../src/fleet-orders.js';
import {loadPolicy} from '../src/policy-engine.js';
import {intakeContact,unloadingPoint} from '../src/cleanup.js';

export async function cameraTrials(){
  const policy=await loadPolicy(new URL('/',location.href).href);
  let view=null,layoutId=null;
  return async function trial({text,layout=0,traffic=true,delay=0,placements=null,exercise=null,debug=false}){
    const f=new HarborFleet(portLayout(layout),{traffic});
    if(!view)view=new HarborView(document.createElement('canvas'),document.createElement('canvas'),f.boats.A);
    else if(layout!==layoutId)view.setRun(f.boats.A);
    layoutId=layout;
    if(placements)f.litter.items.forEach((item,i)=>{
      const [x,z]=placements[i];Object.assign(item,{x,z,origin:{x,z}});
    });
    for(let i=0;i<delay*10;i++)f.tick(.1);
    const parse=sentence=>planFleetOrder(sentence,f,'A',s=>policy.classify(s));
    const send=async sentence=>{
      const plan=await parse(sentence);if(plan.error)throw Error(plan.error);
      f.dispatch(plan,sentence);view.setMembers(f.dual?f.boats:{A:f.boats.A},'A');
    };
    const order=await parse(text);
    if(order.error)return {error:order.error};
    f.dispatch(order,text);view.setMembers(f.dual?f.boats:{A:f.boats.A},'A');
    const counts={frames:0,locks:0,gates:0},trace=[],transitions=[],states=f.litter.items.map(i=>i.state);
    const applied={},checks=[];let phase=0,retained=null;
    let badContact=false,badUnload=false,overcapacity=false,planned=true;
    for(let step=0;step<30*650;step++){
      if(step%6===0)for(const id of f.ids()){
        const r=f.boats[id],obs=r.observation(c=>view.cropFor(c,r),()=>view.sensor.read(view,r));
        if(!obs)continue;
        if(!applied[id]){
          const start=r.logs.findIndex(l=>l.type==='执行');
          planned=planned&&start>0&&r.logs.slice(0,start).some(l=>l.type==='规划');applied[id]=true;
        }
        const pred=await policy.drive(obs.input);
        r.inference(obs,pred,c=>view.measureLean(c),()=>{throw Error('清漂触发拍照')});
        if(pred.visualFocus){
          counts.frames++;if(r.cleanup?.track)counts.locks++;
          if(r.cleanup?.gate)counts.gates++;
        }
        if(debug&&step%90===0)trace.push([id,Math.round(f.time),r.cleanup?.label,[r.boat.x,r.boat.z,r.boat.yaw].map(n=>+n.toFixed(1)),pred.visualFocus?.map(n=>+n.toFixed(2))]);
      }
      f.tick(1/30);
      for(const [i,item] of f.litter.items.entries()){
        if(states[i]===item.state)continue;
        const r=f.boats[item.vessel];
        if(item.state==='aboard'&&!intakeContact(r.boat,item))badContact=true;
        if(item.state==='land'){
          const dock=unloadingPoint(r.layout[item.berth],r.id);
          if(Math.hypot(r.boat.x-dock.x,r.boat.z-dock.z)>=.85||r.boat.speed>.32)badUnload=true;
        }
        transitions.push([item.id,item.kind,item.vessel,item.state,item.berth,Math.round(f.time)]);
        states[i]=item.state;
      }
      if(f.ids().some(id=>f.litter.cargo(id).length>2))overcapacity=true;
      const done=f.ids().every(id=>!f.boats[id].active)&&!f.outbox.some(p=>p.type==='ORDER');
      if(exercise==='reassign'){
        const r=f.boats.A;
        if(phase===0&&f.litter.cargo('A').length===1){
          retained=f.litter.cargo('A')[0];await send('停船');
          const mission=r.cleanup;
          for(let i=0;i<90;i++)f.tick(1/30);
          await send('不要拍照');
          if(!r.held||r.boat.speed>.05||r.cleanup!==mission)throw Error('停船或快门约束异常');
          await send('继续任务');await send('取消任务');
          if(r.active||retained.state!=='aboard')throw Error('撤单时船舱异常');
          await send('只收塑料瓶，不要泡沫块');phase++;checks.push('暂停、继续、撤单保留船货与改派');
        }else if(phase===1&&done){await send('收集泡沫块');phase++}
        else if(phase===2&&f.litter.cargo('A').length){await send('返回西泊位卸载');phase++;checks.push('途中单独返港卸载')}
        else if(phase===3&&done)break;
      }else if(exercise==='reconnect'){
        if(phase===0&&f.litter.cargo('B').length){
          retained=f.litter.cargo('B')[0];f.setDual(false);view.setMembers({A:f.boats.A},'A');phase++;
        }else if(phase===1&&done){
          if(retained.state!=='aboard')throw Error('离网后船货丢失');
          await send('B艇只收集泡沫块');phase++;checks.push('离网保留船货与重新入网');
        }else if(phase===2&&done)break;
      }else if(done)break;
    }
    const done=f.ids().every(id=>!f.boats[id].active), photos=f.ids().reduce((n,id)=>n+f.boats[id].photos.length,0);
    const collisions=f.contacts+f.ids().reduce((n,id)=>n+f.boats[id].collisionCount,0);
    return {text,layout,traffic,done,photos,collisions,counts,transitions,checks,badContact,badUnload,overcapacity,planned,
      time:Math.round(f.time),remaining:f.litter.items.filter(i=>i.state==='water').map(i=>i.id),
      ...(debug?{trace,logs:f.ids().map(id=>f.boats[id].logs)}:{})};
  };
}
