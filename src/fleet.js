import {makeRun, distance, clamp, wrap} from './simulation.js';
import {describe,names,isPhotoKind} from './commands.js';
import {otherBoat} from './fleet-orders.js';
import {withChartMarks} from './marks.js';

const radioDelay=.12, heartbeat=.75;
const velocity=b=>({x:Math.sin(b.yaw)*b.speed,z:-Math.cos(b.yaw)*b.speed});
const role=id=>id==='岸'?'岸台':id+'艇';

export class HarborFleet {
 constructor(layout,settings={}){
  this.layout=withChartMarks(layout);
  this.boats={A:makeRun(layout,settings),B:makeRun(layout,settings)};
  for(const [id,run] of Object.entries(this.boats))run.id=id;
  const b=this.boats.B;
  Object.assign(b.boat,{x:layout.west.x+2,z:layout.west.z-1,yaw:.48});
  b.trace=[{...b.boat}];
  this.dual=false;this.telemetry={A:null,B:null};this.inbox={A:new Map(),B:new Map()};
  this.outbox=[];this.events=[];this.eventId=0;this.packetId=0;this.ticket=0;
  this.photosRead={A:0,B:0};this.doneRead={A:0,B:0};this.generation={A:0,B:0};
  this.peerYield={A:false,B:false};this.lastOrder={A:'',B:''};this.relay=null;
  this.lastHeartbeat=-Infinity;this.rtt=null;this.closest=Infinity;this.contacts=0;this.touching=false;
 }
 get time(){return this.boats.A.time}
 ids(){return this.dual?['A','B']:['A']}
 event(from,to,type,text){
  this.events.push({id:++this.eventId,time:this.time,from,to,type,text});
  if(this.events.length>52)this.events.shift();
 }
 setDual(on){
  if(this.dual===on)return;
  this.dual=on;this.outbox=[];this.telemetry={A:null,B:null};this.lastHeartbeat=-Infinity;this.rtt=null;
  this.peerYield={A:false,B:false};this.touching=false;
  for(const run of Object.values(this.boats))run.awaitingOrder=false;
  const b=this.boats.B;b.revision++;b.act={throttle:0,turn:0};b.boat.speed=0;b.boat.turn=0;b.time=this.time;
  if(on){
   this.event('岸','AB','组网','A、B 两艇已加入港池通信');this.sendStates();
  }else{
   this.relay=null;b.active=null;b.queue=[];b.route=null;b.held=false;this.lastOrder.B='';
   this.event('岸','B','离网','B艇退出协作，结束当前派单');
  }
 }
 pairTargets([first,second]=['pier','wall']){
  const a=this.boats.A.boat,b=this.telemetry.A||this.boats.B.boat;
  const p=this.layout[first],q=this.layout[second];
  return distance(a,p)+distance(b,q)<=distance(a,q)+distance(b,p)
   ?{A:first,B:second}:{A:second,B:first};
 }
 send(from,to,type,data,extraDelay=0){
  const p={id:++this.packetId,from,to,type,data,sent:this.time,due:this.time+radioDelay+extraDelay};
  this.outbox.push(p);return p;
 }
 sendStates(){
  for(const id of ['A','B']){
   const run=this.boats[id];
   this.send(id,otherBoat(id),'STATE',{...run.boat,active:!!run.active,held:run.held,task:describe(run.active)});
  }
  this.lastHeartbeat=this.time;
 }
 get linkAge(){
  const packets=Object.values(this.telemetry);
  return packets.every(Boolean)?Math.max(...packets.map(p=>this.time-p.time)):Infinity;
 }
 get linkFresh(){return this.dual&&this.linkAge<heartbeat*3}
 dispatch(order,raw){
  if(order.needsDual)this.setDual(true);
  const n=++this.ticket;
  const destructive=order.assignments.some(({plan})=>['cancel','replace','standby'].includes(plan.op));
  if(destructive&&this.relay){
   const {id,receiver}=this.relay,run=this.boats[receiver];this.relay=null;
   if(run.active?.relay===id){run.log('协作','原接力已撤销');run.advance();this.lastOrder[receiver]=run.active?describe(run.active):'接力已结束'}
   else if(this.lastOrder[receiver].startsWith('等候首艇'))this.lastOrder[receiver]='接力已结束';
  }
  if(order.kind==='relay'){
   const lead=order.assignments.find(a=>a.id===order.source).plan.tasks.find(t=>t.handoffSource);
   this.relay={id:n,source:order.source,receiver:order.receiver,target:order.target,conditional:order.conditional,
    followKind:order.followKind,photoEvidence:isPhotoKind(lead.kind),phase:'waiting'};
  }
  if(order.kind==='split')this.event('岸','AB','分工',order.assignments.map(a=>a.id+'艇 → '+names[a.plan.tasks[0].target]).join('　'));
  if(order.kind==='relay')this.event(order.source,order.receiver,'接力','等待'+names[order.target]+(this.relay.photoEvidence?'的首张照片':'的观测回报'));
  for(const {id,plan} of order.assignments){
   // Replacements supersede orders in flight. Hold, resume and append retain their FIFO predecessors.
   if(['replace','cancel','standby'].includes(plan.op)){
    this.generation[id]++;
    if(this.dual){this.boats[id].awaitingOrder=true;this.boats[id].revision++}
   }
   const data={plan,raw,ticket:n,generation:this.generation[id],relay:order.kind==='relay'?n:null};
   if(this.dual)this.send(id==='A'?'岸':'A',id,'ORDER',data);
   else this.applyOrder(id,data);
  }
  return n;
 }
 applyOrder(id,data){
  const {plan,raw}=data,run=this.boats[id];
  if(data.generation!==this.generation[id])return false;
  run.orderTicket=data.ticket;
  if(plan.op==='standby'){
   run.submit({op:'cancel'},raw);
   this.lastOrder[id]=this.relay?.id!==data.relay?'接力已结束':this.relay.photoEvidence?'等候首艇回传':'等候首艇观测回报';
   run.log('协作',this.lastOrder[id]);return true;
  }
  if(plan.tasks&&data.relay){
   const tasks=plan.tasks.map(t=>t.handoffSource?{...t,relay:data.relay}:t);
   run.submit({...plan,tasks},raw);
  }else run.submit(plan,raw);
  this.lastOrder[id]=plan.op==='hold'?'原地等候':plan.op==='cancel'?'已撤销':run.active?describe(run.active):'待命';
  return true;
 }
 receive(p){
  const d=p.data,id=p.to,run=this.boats[id];
  switch(p.type){
   case 'STATE':
    this.telemetry[id]={...d,time:p.sent,received:this.time};break;
   case 'ORDER':
    if(this.applyOrder(id,d)){
     this.event(p.from,id,'派单',this.lastOrder[id]);
     this.send(id,p.from,'ACK',{sent:p.sent,description:'已接收派单 #'+d.ticket});
    }break;
   case 'ACK':
    this.rtt=(this.time-d.sent)*1000;
    this.event(p.from,id,'回执',d.description);break;
   case 'DONE':
    this.event(p.from,id,'进度',d.reason);
    if(d.observation)this.acceptHandoff(p,d.observation);
    break;
   case 'PHOTO':{
    const photo=d.photo;
    if(this.inbox[id].has(photo.id))break;
    this.inbox[id].set(photo.id,photo);
    this.event(p.from,id,'影像',names[photo.target]+' · '+(photo.kind==='side'?'侧面':'全景')+'已收妥');
    this.acceptHandoff(p,photo);break;
   }
  }
 }
 acceptHandoff(packet,report){
  const handoff=this.relay,id=packet.to;
  if(!handoff||report.relay!==handoff.id||id!==handoff.receiver||packet.from!==handoff.source||
     report.target!==handoff.target||handoff.phase!=='waiting')return;
  if(!report.skipped&&handoff.photoEvidence!==(packet.type==='PHOTO'))return;
  const run=this.boats[id];
  if(report.skipped||(handoff.conditional&&!report.tilted)){
   this.lastOrder[id]='条件未成立，复核结束';run.log('协作',this.lastOrder[id]);
   this.event(id,packet.from,'复核','倾斜条件未成立，结束接力');this.relay=null;return;
  }
  handoff.phase='received';
  const point=this.layout[report.target],held=run.held;
  run.firstAngle[report.target]=Math.atan2(report.x-point.x,report.z-point.z);
  const task={kind:handoff.followKind,target:report.target,framing:false,conditional:false,relay:handoff.id};
  const evidence=handoff.photoEvidence?'首拍':'观测回报';
  run.submit({op:'replace',tasks:[task]},'收到'+role(packet.from)+evidence+'，执行'+describe(task));
  run.held=held;this.lastOrder[id]=describe(task);
  const action=isPhotoKind(task.kind)?'侧拍':'换侧观察';
  this.event(id,packet.from,'复核','已根据'+evidence+'方位派发'+action);
  this.send(id,packet.from,'ACK',{sent:packet.sent,description:'已接收'+evidence+'方位'});
 }
 sync(){
  for(const id of this.ids()){
   const run=this.boats[id],other=otherBoat(id);
   while(this.photosRead[id]<run.photos.length){
    const photo=run.photos[this.photosRead[id]++];photo.id=id+'-'+this.photosRead[id];photo.boatId=id;
    if(this.dual)this.send(id,other,'PHOTO',{photo:{...photo}},(photo.src?.length||0)*.75/500000);
   }
   while(this.doneRead[id]<run.done.length){
    const task=run.done[this.doneRead[id]++];
    this.lastOrder[id]=run.active?describe(run.active):'任务完成';
    if(this.dual){
     const data={reason:task.reason};
     if(task.handoffSource&&task.relay&&(!isPhotoKind(task.kind)||task.skipped)){
      data.observation={relay:task.relay,target:task.physical,x:task.x,z:task.z,tilted:task.tilted,skipped:task.skipped};
     }
     this.send(id,other,'DONE',data);
    }
    if(this.relay?.receiver===id&&task.relay===this.relay.id)this.relay=null;
   }
  }
 }
 gallery(id){
  const local=this.boats[id].photos;
  return (this.dual?[...local,...this.inbox[id].values()]:[...local]).sort((a,b)=>b.time-a.time||a.boatId.localeCompare(b.boatId));
 }
 avoidance(id){
  const run=this.boats[id],peer=this.telemetry[id],b=run.boat;
  if(!peer||this.time-peer.time>2.4||!run.nextWaypoint||run.awaitingOrder||run.held)return null;
  const q=velocity(peer),age=this.time-peer.time;
  const dx=peer.x+q.x*age-b.x,dz=peer.z+q.z*age-b.z,range=Math.hypot(dx,dz);
  if(range>15)return null;
  const v=velocity({...b,speed:Math.max(b.speed,run.act.throttle*3.8)}),rx=q.x-v.x,rz=q.z-v.z;
  const seconds=clamp(-(dx*rx+dz*rz)/(rx*rx+rz*rz+.01),0,3);
  const miss=Math.hypot(dx+seconds*rx,dz+seconds*rz);
  const stationary=peer.speed<.32&&(!peer.active||peer.held);
  const bearing=wrap(Math.atan2(dx,-dz)-b.yaw);
  if(stationary&&range<9&&miss<4.0&&Math.abs(bearing)<1.35)
   return {speed:1.55,turn:(bearing>=0?-1:1)*.95};
  if(!stationary&&(id==='B'||range<3.5)&&miss<(this.peerYield[id]?5.5:4.4)&&
    (seconds>.06||range<4.1)&&Math.abs(bearing)<1.75)return {speed:0,turn:0};
  return null;
 }
 tick(dt){
  for(const id of this.ids()){
   const peer=this.dual?this.avoidance(id):null;
   if(!!peer!==this.peerYield[id]){
    this.peerYield[id]=!!peer;
    this.boats[id].log('协作',peer?'收到邻艇位置，调整航行避让':'邻艇航线已清，恢复巡检');
   }
   this.boats[id].tick(dt,peer);
  }
  if(!this.dual){this.sync();return}
  if(this.time-this.lastHeartbeat>=heartbeat)this.sendStates();
  // Stable sorting preserves the order of equally timed control packets.
  const due=this.outbox.filter(p=>p.due<=this.time+1e-8).sort((a,b)=>a.due-b.due||a.id-b.id);
  this.outbox=this.outbox.filter(p=>p.due>this.time+1e-8);
  for(const packet of due)this.receive(packet);
  this.sync();
  const separation=distance(this.boats.A.boat,this.boats.B.boat);
  this.closest=Math.min(this.closest,separation);
  if(separation<2.2&&!this.touching){this.contacts++;this.touching=true;this.event('A','B','接近','艇间距离低于 2.2 m')}
  if(separation>2.8)this.touching=false;
 }
}
