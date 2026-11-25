import * as T from 'three';
import {makeOptics,CONTACTS,fixturePosition} from '../src/contacts.js';
import {portLayout,wrap} from '../src/simulation.js';
import {HarborFleet} from '../src/fleet.js';
import {planFleetOrder} from '../src/fleet-orders.js';
import {loadPolicy} from '../src/policy-engine.js';

const split='双艇协作，分别给木栈桥和防波堤旁的黄标拍照';
const relay='接力复核，A艇拍摄栈桥黄标，B艇接力补拍';
const assigned='A艇给栈桥黄标拍照，B艇给防波堤旁的黄标拍照';
const cases=[
 ...[0,1,2].map(layout=>({id:'split-layout-'+layout,layout,command:split,mode:'split'})),
 {id:'split-by-callsigns',layout:1,command:'A艇和B艇分别巡检木栈桥与防波堤的黄标',mode:'observe'},
 {id:'return-to-own-berths',command:split+'，最后返回各自泊位',mode:'return'},
 {id:'addressed-from-berths',command:assigned,mode:'assigned'},
 {id:'crossing-addressed-orders',command:assigned,mode:'cross',
  start:{A:{x:7,z:6,yaw:-1},B:{x:-6,z:7,yaw:.86}}},
 {id:'two-boat-observation-only',command:'A艇只观察栈桥黄标，B艇只观察防波堤黄标',mode:'observe'},
 {id:'split-without-photos',command:'双艇分别观察栈桥和防波堤的黄标，不用拍照',mode:'observe'},
 {id:'withdraw-fleet-photos-in-flight',command:split,mode:'withdraw-both'},
 {id:'two-gate-mark-colors',command:'双艇分别给红标和绿标拍照',mode:'gate-colors'},
 {id:'relay-opposite-view',command:relay,mode:'relay'},
 {id:'reverse-relay',command:'接力，B艇先拍摄防波堤的黄标，A艇接力补拍',mode:'reverse'},
 {id:'observation-report-before-photo',command:'接力，A艇检查栈桥黄标，B艇换侧补拍',mode:'report'},
 {id:'cancel-relay-after-report',command:'接力，A艇检查栈桥黄标，B艇换侧补拍',mode:'withdraw'},
 {id:'conditional-normal',command:relay+'，如果发现倾斜才补拍',condition:'normal',mode:'skip'},
 {id:'conditional-tilt',command:relay+'，如果发现倾斜才补拍',mode:'relay'},
 {id:'cancel-photo-in-flight',command:relay,mode:'cancel'},
 {id:'hold-resume-both',command:split,mode:'hold'},
 {id:'reassign-pending-order',command:split,mode:'supersede'}
];
export async function checkFleet(){
 const policy=await loadPolicy(new URL('./',location.origin).href);
 const renderer=new T.WebGLRenderer(),optics=makeOptics(renderer),rows=[];
 const classify=s=>policy.classify(s);
 for(const spec of cases){
  const fleet=new HarborFleet(portLayout(spec.layout||0),{condition:spec.condition||'tilt',traffic:true});
  const {A,B}=fleet.boats,receivedAt=[],angles={},runs={A:0,B:0},cache={};
  // These two clear approach legs cross in open water even if the berth departure routes change.
  if(spec.start)for(const run of [A,B]){
   Object.assign(run.boat,spec.start[run.id]);run.trace=[{...run.boat}];
  }
  const order=async text=>{const o=await planFleetOrder(text,fleet,'A',classify);if(o.error)throw Error(o.error);fleet.dispatch(o,text);return o};
  const initial=await order(spec.command);
  const waited=!A.active&&!B.active&&fleet.outbox.some(p=>p.type==='ORDER');
  const expected=fleet.pairTargets();let held=false,resumed=false,cancelled=false,violation=false,firstSide=0,lastInbox=0;
  if(spec.mode==='supersede')await order('B艇返回西泊位');
  if(spec.mode==='withdraw-both')await order('双艇都不要拍照');
  for(let j=0;j<1150;j++){
   if(spec.mode==='hold'&&!held&&fleet.time>2.2){await order('双艇暂停');held=true}
   if(spec.mode==='hold'&&held&&!resumed&&fleet.time>4){
    if(!A.held||!B.held)violation=true;await order('双艇继续任务');resumed=true;
   }
   for(const run of [A,B]){
    if(!run.active||run.held)continue;
    const id=run.id;
    if(!cache[id]||fleet.time-cache[id].t>1.5){
     const tiles={};
     for(let i=0;i<4;i++){
      const c=CONTACTS[i],p=fixturePosition(run.layout[c],c);
      tiles[c]=optics.read(i,Math.atan2(run.boat.x-p.x,run.boat.z-p.z),.13);
     }
     cache[id]={t:fleet.time,tiles};
    }
    const obs=run.observation(c=>cache[id].tiles[c]);
    if(obs){const pred=await policy.drive(obs.input);runs[id]++;run.inference(obs,pred,c=>run.lean(c),p=>id+'|'+p.target+'|'+p.time,.2);fleet.sync()}
   }
   if(spec.mode==='cancel'&&A.photos.length&&!cancelled){await order('B艇取消任务');cancelled=true}
   if(spec.mode==='withdraw'&&B.active?.kind==='side'&&!cancelled){await order('A艇返回东泊位');cancelled=true}
   for(let i=0;i<6;i++){
    fleet.tick(1/30);
    if(initial.kind==='relay'){
     const dst=initial.receiver,src=initial.source,box=fleet.inbox[dst];
     if(box.size!==lastInbox){receivedAt.push(fleet.time);lastInbox=box.size}
     if(fleet.boats[dst].active?.kind==='side'){
      if(!firstSide)firstSide=fleet.time;
      if(['report','withdraw'].includes(spec.mode)){
       if(!fleet.events.some(e=>e.from===src&&e.to===dst&&e.type==='进度'&&e.text.includes('观察已完成')))violation=true;
      }else if(![...box.values()].some(p=>p.boatId===src&&p.target===initial.target))violation=true;
     }
    }
   }
   if(!A.active&&!B.active&&!fleet.relay&&!fleet.outbox.some(p=>p.type!=='STATE')&&fleet.time>1.2)break;
  }
  const photos={A:A.photos.map(p=>p.target+':'+p.kind),B:B.photos.map(p=>p.target+':'+p.kind)};
  const sameGallery=fleet.inbox.A.size===B.photos.length&&fleet.inbox.B.size===A.photos.length&&
   [...fleet.inbox.A.values()].every(p=>p.src===B.photos.find(local=>local.id===p.id)?.src)&&
   [...fleet.inbox.B.values()].every(p=>p.src===A.photos.find(local=>local.id===p.id)?.src);
  const first=(id,target,kind='photo')=>photos[id].includes(target+':'+kind);
  let correct=false;
  if(['split','return','hold'].includes(spec.mode)){
   correct=first('A',expected.A)&&first('B',expected.B)&&expected.A!==expected.B;
   if(spec.mode==='return')correct=correct&&A.done.at(-1)?.physical==='east'&&B.done.at(-1)?.physical==='west';
   if(spec.mode==='hold')correct=correct&&resumed;
  }else if(['assigned','cross'].includes(spec.mode)){
   correct=first('A','pier')&&first('B','wall');
   if(spec.mode==='cross')correct=correct&&[...A.logs,...B.logs].some(x=>x.text.includes('邻艇位置'));
  }
  else if(spec.mode==='gate-colors'){
   const captured=new Set([...A.photos,...B.photos].map(p=>p.target));
   correct=captured.has('gateRed')&&captured.has('gateGreen')&&initial.assignments.every(a=>first(a.id,a.plan.tasks[0].target));
  }
  else if(spec.mode==='observe'||spec.mode==='withdraw-both'){
   const targets=initial.kind==='split'?expected:{A:'pier',B:'wall'};
   correct=[A,B].every(run=>run.done[0]?.kind==='approach'&&run.done[0].physical===targets[run.id]&&!run.photos.length);
  }
  else if(spec.mode==='supersede'){correct=first('A',expected.A)&&!B.photos.length&&B.done.at(-1)?.physical==='west'}
  else if(['report','withdraw'].includes(spec.mode)){
   correct=A.done[0]?.kind==='approach'&&A.done[0].physical===initial.target&&firstSide>A.done[0].time&&!A.photos.length&&
    (spec.mode==='report'?B.photos.length===1&&first('B',initial.target,'side'):cancelled&&!B.photos.length);
  }
  else{
   const s=fleet.boats[initial.source],r=fleet.boats[initial.receiver],target=initial.target;
   const a=s.photos[0],b=r.photos[0],pt=fleet.layout[target];
   if(a&&b){
    for(const p of [a,b])angles[p.boatId]=Math.atan2(p.x-pt.x,p.z-pt.z);
    angles.deltaDeg=Math.abs(wrap(angles.A-angles.B))*180/Math.PI;
   }
   correct=first(s.id,target)&&receivedAt[0]>a?.time;
   if(spec.mode==='skip'||spec.mode==='cancel')correct=correct&&!firstSide&&!r.photos.length;
   else correct=correct&&first(r.id,target,'side')&&angles.deltaDeg>45&&firstSide>=receivedAt[0];
  }
  const pass=!!(waited&&correct&&sameGallery&&fleet.linkFresh&&!violation&&!fleet.relay&&!A.active&&!B.active&&!A.collisionCount&&!B.collisionCount&&!fleet.contacts);
  rows.push({id:spec.id,pass,photos,peerCopies:{A:fleet.inbox.A.size,B:fleet.inbox.B.size},sameGallery,simSeconds:+fleet.time.toFixed(1),minDistanceM:+fleet.closest.toFixed(2),
   contactEvents:fleet.contacts+A.collisionCount+B.collisionCount,orderQueuedBeforeDelivery:waited,firstSideAfterReceipt:firstSide||null,receiptAt:receivedAt[0]||null,angles,policyCalls:runs,
   details:pass?undefined:{correct,violation,orders:initial,logs:{A:A.logs.slice(-8),B:B.logs.slice(-8)},events:fleet.events.slice(-12),state:{A:A.active,B:B.active},pos:{A:A.boat,B:B.boat}}});
 }
 optics.dispose();renderer.dispose();return rows;
}
