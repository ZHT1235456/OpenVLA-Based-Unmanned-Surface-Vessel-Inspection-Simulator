import {CONTACTS} from './contacts.js';
import {names,describe,isPhotoKind,isSideKind} from './commands.js';
import {MARKS,buoyIds,isGateMark,withChartMarks} from './marks.js';
import {HarborNavigationMap,planHarborRoute,bearingFrom,waterBounds} from './route-planner.js';
import {HarborLitter,CleanupMission} from './cleanup.js';

export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const direction=(a,b)=>Math.atan2(b.x-a.x,a.z-b.z);
export function portLayout(version=0){
 return [
  {pier:{x:-13,z:-7},wall:{x:14,z:-10},east:{x:17,z:24},west:{x:-18,z:24}},
  {pier:{x:14,z:-8},wall:{x:-15,z:-9},east:{x:17,z:24},west:{x:-18,z:24}},
  {pier:{x:-9,z:-14},wall:{x:17,z:-2},east:{x:18,z:26},west:{x:-16,z:22}}
 ][Number(version)%3];
}
export function makeRun(layout,settings={}){
 return new HarborRun(layout,settings);
}
export class HarborRun {
 constructor(layout,{condition='tilt',traffic=true,litter=new HarborLitter()}={}){
  this.layout=withChartMarks(layout);this.condition=condition;this.traffic=traffic;
  this.litter=litter;this.cleanup=null;
  this.navigationMap=new HarborNavigationMap(this.layout);
  this.route=null;this.waypoint=1;this.sideOrigin=null;this.gateEntry=null;
  this.boat={x:layout.east.x-2,z:layout.east.z-1,yaw:-.48,speed:0,turn:0};
  this.time=0;this.revision=0;this.queue=[];this.active=null;this.done=[];this.photos=[];this.logs=[];
  this.last=null;this.lastTilt=null;this.firstAngle={};this.lastPicture={};this.resetSamples();
  this.lastTrace=-1;this.trace=[{...this.boat}];this.held=false;this.yielding=false;this.unverifiedTarget=false;this.awaitingOrder=false;
  this.act={throttle:0,turn:0};this.contact=null;this.stable=0;this.approved=false;
  this.collisionCount=0;this.touches=new Set();this.log('系统','港池就绪，可以发送中文指令。');
 }
 log(type,text){this.logs.push({time:this.time,type,text});if(this.logs.length>180)this.logs.shift()}
 resetSamples(){this.samples=Object.fromEntries(buoyIds.map(id=>[id,[]]));this.lastSample=-1}
 submit(plan,original){
  this.revision++;this.act={throttle:0,turn:0};this.stable=0;this.unverifiedTarget=false;this.awaitingOrder=false;
  this.log('指令',original);
  if(plan.op==='hold'){this.held=true;return}
  if(plan.op==='resume'){this.held=false;if(this.active)this.planRoute();return}
  if(plan.op==='cancel'){this.endCleanup();this.active=null;this.queue=[];this.route=null;this.held=false;this.log('任务','已清空待办');return}
  if(plan.op==='traffic'){this.traffic=true;return}
  if(plan.preserveHold&&this.cleanup&&plan.tasks?.[0]?.kind==='cleanup'&&
     plan.tasks[0].target===this.active.target&&plan.tasks[0].berth===this.active.berth){
    this.queue=plan.tasks.slice(1);return;
  }
  if(!plan.preserveHold)this.held=false;
  if(plan.waitTraffic)this.traffic=true;
  if(plan.op==='replace'){this.endCleanup();this.active=null;this.queue=[]}
  this.queue.push(...plan.tasks.map(x=>({...x})));
  if(this.active)this.planRoute();else this.advance();
 }
 endCleanup(){this.cleanup?.release();this.cleanup=null}
 advance(){
  this.endCleanup();
  this.active=this.queue.shift()||null;this.revision++;this.stable=0;this.contact=null;this.unverifiedTarget=false;
  this.approved=!this.active?.conditional;this.act={throttle:0,turn:0};
  this.route=null;this.gateEntry=null;
  if(!this.active)return;
  if(this.active.kind==='cleanup')this.cleanup=new CleanupMission(this,this.active);
  const target=this.active.target,p=this.layout[target];
  this.sideOrigin=p?(this.firstAngle[target]??bearingFrom(p,this.boat)):null;
  if(this.active.kind==='gate'){
   const mid=(this.layout.gateRed.z+this.layout.gateGreen.z)/2;
   this.gateEntry={side:this.boat.z>=mid?1:-1,passed:false};
  }
  if(this.planRoute())this.log('执行',describe(this.active));
 }
 planRoute(){
  if(this.cleanup)return this.cleanup.plan();
  this.route=planHarborRoute(this.navigationMap,this.layout,this.boat,[this.active,...this.queue],
    this.firstAngle,this.sideOrigin,this.approved,this.gateEntry);
  this.waypoint=1;this.stable=0;this.act={throttle:0,turn:0};this.revision++;
  if(this.route.blocked){
   this.boat.speed=0;this.boat.turn=0;
   this.log('规划','路径不可达 · '+describe(this.route.blocked));return false;
  }
  this.log('规划','A* 航线已生成 · '+this.route.legs.length+' 个航段 · '+this.route.distance.toFixed(1)+' m');
  return true;
 }
 get nextWaypoint(){return this.route?.legs[0]?.points[this.waypoint]}
 get plannedTrack(){
  if(!this.nextWaypoint||this.awaitingOrder)return [];
  return [this.boat,...this.route.legs.flatMap((leg,i)=>leg.points.slice(i===0?this.waypoint:1))];
 }
 get shutterEnabled(){
  return isPhotoKind(this.active?.kind)&&this.approved&&!!this.nextWaypoint&&!this.held&&!this.unverifiedTarget&&!this.awaitingOrder&&
    this.waypoint===this.route.legs[0].points.length-1&&distance(this.boat,this.nextWaypoint)<1;
 }
 finish(reason,physical,tilted=false,skipped=false){
  this.done.push({...this.active,time:this.time,reason,physical,tilted,skipped,x:this.boat.x,z:this.boat.z});
  this.log('任务',reason);if(MARKS[physical])this.last=physical;
  this.advance();
 }
 lean(c){
  if(c!=='pier'&&c!=='wall')return 0;
  const wave=.075*Math.sin(this.time*1.87+(c==='wall'?1.8:.1))+.035*Math.sin(this.time*3.34);
  return wave+(this.condition==='tilt'&&c==='pier'?.295:0);
 }
 service(time=this.time){
  const phase=time*.14-.65;return {x:23*Math.sin(phase),z:7.8+.8*Math.sin(phase*2),vx:3.22*Math.cos(phase),vz:.224*Math.cos(phase*2)};
 }
 shouldYieldToService(speed){
  const b=this.boat;
  if(!this.traffic||!this.nextWaypoint||this.held||this.awaitingOrder||distance(b,this.service())>23)return false;
  // Compare continuing and braking over the actual crossing boat's curved track.
  // Braking in its path can have less clearance than finishing the crossing.
  const sx=Math.sin(b.yaw),sz=-Math.cos(b.yaw);
  let continuing=Infinity,braking=Infinity;
  for(let t=.3;t<=5.41;t+=.3){
   const ship=this.service(this.time+t),coast=.5*(1-Math.exp(-t/.5));
   const run=speed*t+(b.speed-speed)*coast,stop=b.speed*coast;
   continuing=Math.min(continuing,Math.hypot(b.x+run*sx-ship.x,b.z+run*sz-ship.z));
   braking=Math.min(braking,Math.hypot(b.x+stop*sx-ship.x,b.z+stop*sz-ship.z));
  }
  return continuing<(this.yielding?5.0:4.5)&&braking>continuing+.15;
 }
 features(c){
  const b=this.boat,point=this.layout[c];
  let margin=distance(b,point)-(['east','west'].includes(c)?1.35:4.2),aim=point,final=false;
  if(c===this.active?.target&&this.nextWaypoint){
   const goal=this.nextWaypoint,d=distance(b,goal);
   final=this.waypoint===this.route.legs[0].points.length-1&&d<1.0;
   aim=final?point:goal;margin=final?0:d;
  }
  const err=wrap(direction(b,aim)-b.yaw);
  return {values:[err/Math.PI,Math.sin(err),Math.cos(err),clamp(margin/16,-.6,2.8),b.speed/4],margin,err,final};
 }
 observation(cropFor){
  if(!this.nextWaypoint||this.held||this.awaitingOrder||this.active.kind==='gate')return null;
  if(this.cleanup){
    const b=this.boat,goal=this.nextWaypoint,err=wrap(direction(b,goal)-b.yaw),d=distance(b,goal);
    const geometry=new Float32Array([err/Math.PI,Math.sin(err),Math.cos(err),clamp(d/16,0,2.8),b.speed/4]);
    return {cleanupTarget:this.cleanup.label,input:{markerGeometry:geometry},revision:this.revision};
  }
  if(isGateMark(this.active.target)){
    const target=this.active.target,feature=this.features(target);
    return {chartTarget:target,input:{markerGeometry:new Float32Array(feature.values)},order:[target],features:[feature],revision:this.revision};
  }
  const order=[...CONTACTS].sort((a,b)=>direction(this.boat,this.layout[a])-direction(this.boat,this.layout[b]));
  const geometry=new Float32Array(20),crops=new Float32Array(4*3*400);
  const features=order.map(c=>this.features(c));
  for(let i=0;i<4;i++){
    geometry.set(features[i].values,i*5);const tile=cropFor(order[i]);
    for(let p=0;p<400;p++)for(let k=0;k<3;k++)crops[i*1200+k*400+p]=tile[p*3+k]/255;
  }
  const instruction=new Float32Array(4);instruction[CONTACTS.indexOf(this.active.target)]=1;
  return {input:{crops,geometry,instruction},order,features,revision:this.revision};
 }
 inference(obs,result,evidence,capture,dt=.2){
  if(!this.nextWaypoint||this.held||this.awaitingOrder||obs.revision!==this.revision)return false;
  if(obs.cleanupTarget&&this.cleanup){
    const [throttle,turn]=result.control;
    if(!Number.isFinite(throttle)||!Number.isFinite(turn))throw Error('清漂艇控输出无效');
    this.act={throttle:clamp((throttle+1)/2,0,1),turn:clamp(turn,-1,1)};
    return true;
  }
  const chosen=result.focus.indexOf(Math.max(...result.focus));const c=obs.order[chosen],f=obs.features[chosen];
  if(!c||!result.control.every(Number.isFinite))throw Error('推理输出无效');
  if(c!==this.active.target){
    if(!this.unverifiedTarget)this.log('复核','观测目标与派单不一致，减速等候重新确认');
    this.unverifiedTarget=true;this.contact=null;this.stable=0;this.act={throttle:0,turn:0};return false;
  }
  this.unverifiedTarget=false;
  this.contact=c;const [throttle,turn,shutter]=result.control;
  this.act={throttle:clamp((throttle+1)/2,0,1),turn:clamp(turn,-1,1)};
  if(this.act.throttle<.035)this.act.throttle=0;
  if(MARKS[c]){
    if(this.time-this.lastSample>=.085&&distance(this.boat,this.layout[c])<8.7&&Math.abs(wrap(direction(this.boat,this.layout[c])-this.boat.yaw))<.68){
      this.lastSample=this.time;const a=this.samples[c];
      a.push({t:this.time,angle:evidence(c)});while(a.length&&a[0].t<this.time-3.0)a.shift();
    }
  }
  if(this.active.conditional&&!this.approved){
    if(!f.final)return true;
    const window=(this.samples[c]||[]).filter(x=>x.t>=this.time-1.9);
    if(window.length>=5&&window.at(-1).t-window[0].t>=1.1){
      const tilt=window.filter(x=>Math.abs(x.angle)>.16).length/window.length;
      if(tilt<.75){this.finish(names[c]+'随浪回正，已跳过条件任务',c,false,true);return true}
      this.lastTilt=c;this.approved=true;this.log('观察',names[c]+'持续倾斜，执行条件任务');
      if(isSideKind(this.active.kind))this.sideOrigin=this.firstAngle[c]??bearingFrom(this.layout[c],this.boat);
      this.planRoute();return true;
    }
    return true;
  }
  const inPlace=f.final&&Math.abs(f.margin)<1.18&&Math.abs(f.err)<.25&&this.boat.speed<.87;
  const captureEnabled=this.shutterEnabled;
  this.stable=inPlace&&(!isPhotoKind(this.active.kind)||(captureEnabled&&shutter>.40))?this.stable+Math.min(dt,.35):0;
  if(this.stable<.55)return true;
  const t=this.active;
  const near=(this.samples[c]||[]).filter(x=>x.t>this.time-1.8);
  const tilted=near.length>=4&&near.filter(x=>Math.abs(x.angle)>.16).length/near.length>.75;
  if(tilted)this.lastTilt=c;
  if(captureEnabled){
    const p=this.layout[c],a=Math.atan2(this.boat.x-p.x,this.boat.z-p.z);
    if(t.kind==='photo'||this.firstAngle[c]===undefined)this.firstAngle[c]=a;
    this.lastPicture[c]=a;
    const photo={target:c,requested:t.target,kind:t.kind,framing:t.framing,tilted,relay:t.relay,boatId:this.id||'A',time:this.time,x:this.boat.x,z:this.boat.z,yaw:this.boat.yaw,range:distance(this.boat,p)};
    photo.src=capture(photo);this.photos.push(photo);
  }
  this.finish(describe(t)+'已完成',c,tilted);return true;
 }
 tick(dt,peer=null){
  this.time+=dt;const b=this.boat;let speed=0,turn=0;
  this.litter.drift(this.time);
  if(!this.held&&!this.awaitingOrder)this.cleanup?.refresh();
  if(this.nextWaypoint&&!this.held&&!this.awaitingOrder){
   const points=this.route.legs[0].points;
   if(this.waypoint<points.length-1&&distance(b,this.nextWaypoint)<.85&&this.navigationMap.clear(b,points[this.waypoint+1])){
    if(this.gateEntry&&this.waypoint===points.length-2)this.gateEntry.passed=true;
    this.waypoint++;this.revision++;this.stable=0;this.act={throttle:0,turn:0};
   }
   if(this.cleanup){
    const d=distance(b,this.nextWaypoint);
    const docking=this.cleanup.phase==='return'&&this.waypoint===points.length-1;
    speed=Math.min(3,this.act.throttle*3.8,d*(docking ? .9 : 1.25));turn=this.act.turn*1.42;
    if(Math.abs(wrap(direction(b,this.nextWaypoint)-b.yaw))>.65)speed=0;
    if(docking&&d<.48){speed=0;turn=0}
   }else if(this.active.kind==='gate'){
    const g=this.nextWaypoint,d=distance(b,g),e=wrap(direction(b,g)-b.yaw);
    speed=Math.min(3,d)*Math.max(0,Math.cos(e));turn=clamp(1.8*e,-1.42,1.42);
    if(this.waypoint===points.length-1&&d<.85){this.finish('已通过红绿浮标门','gate');speed=0;turn=0}
   }else{speed=this.act.throttle*3.8;turn=this.act.turn*1.42}
  }
  if(peer&&this.nextWaypoint&&!this.awaitingOrder&&!this.held){speed=Math.min(speed,peer.speed);turn=peer.turn??turn}
  const service=this.service(),near=this.shouldYieldToService(speed);
  if(near&&!this.yielding)this.log('让行','保洁船接近航线，减速等候');
  if(!near&&this.yielding)this.log('让行','通道恢复，继续当前任务');
  this.yielding=near;if(near){speed=0;if(!this.cleanup)turn=0}
  // A short-range collision layer steers away from unrelated channel markers.
  for(const key of buoyIds){
   const obstacle=this.layout[key];
   const d=distance(b,obstacle),a=wrap(direction(b,obstacle)-b.yaw);
   if(d<3.1&&Math.abs(a)<.90&&speed>.25){turn=(a>=0?-1:1)*1.2;speed=Math.min(speed,.8)}
  }
  b.speed+=(speed-b.speed)*(1-Math.exp(-dt/.5));b.turn+=(turn-b.turn)*(1-Math.exp(-dt/.20));
  b.yaw=wrap(b.yaw+b.turn*dt);
  const next={x:clamp(b.x+Math.sin(b.yaw)*b.speed*dt,waterBounds.minX,waterBounds.maxX),
   z:clamp(b.z-Math.cos(b.yaw)*b.speed*dt,waterBounds.minZ,waterBounds.maxZ)};
  if(this.navigationMap.clear(b,next)){b.x=next.x;b.z=next.z}
  else if(b.speed>0){
   b.speed=0;
   if(this.nextWaypoint&&!this.held&&!this.awaitingOrder){
    if(!this.cleanup)this.planRoute();
    else if(this.time>=(this.cleanup.nextRecovery||0)&&!this.navigationMap.clear(b,this.nextWaypoint)){
     this.cleanup.nextRecovery=this.time+.65;this.planRoute();
    }
   }
  }
  if(!this.held&&!this.awaitingOrder)this.cleanup?.afterMove(dt);
  const hazards=buoyIds.map(id=>[names[id],this.layout[id],isGateMark(id)?1.05:1.12]);
  if(this.traffic)hazards.push(['保洁船',service,2]);
  for(const [key,p,r] of hazards){const d=distance(b,p);if(d<r&&!this.touches.has(key)){this.collisionCount++;this.touches.add(key);this.log('接触','与'+key+'距离过近')}if(d>r+.35)this.touches.delete(key)}
  if(this.time-this.lastTrace>.29){this.lastTrace=this.time;const prev=this.trace.at(-1);if(distance(b,prev)>.18){this.trace.push({x:b.x,z:b.z});if(this.trace.length>4000)this.trace.splice(1,1)}}
 }
}
