import {waterPoint} from './bow-sensor.js';
import {ShoreArm} from './shore-arm.js';

export const capacity = 2;
export const litterNames = {bottle:'塑料瓶', foam:'泡沫块', litter:'水面漂浮物', unload:'船舱卸载'};
export const intake = {near:1.35, far:2.22, halfWidth:.53};
const seeds = [
  ['P1','bottle',12,16], ['P2','bottle',-12,15], ['P3','bottle',1,-5],
  ['F1','foam',2,18], ['F2','foam',-10,2]
];
const gap = (a,b) => Math.hypot(b.x-a.x,b.z-a.z);
const berthName = id => id==='east'?'东泊位':'西泊位';
const pathLength = points => points.slice(1).reduce((sum,p,i)=>sum+gap(points[i],p),0);
export const unloadingPoint = (berth,id) => ({x:berth.x+(id==='B'?3.35:-3.35),z:berth.z+2.9});

export function intakeContact(boat,item){
  const dx=item.x-boat.x, dz=item.z-boat.z;
  const forward=dx*Math.sin(boat.yaw)-dz*Math.cos(boat.yaw);
  const lateral=dx*Math.cos(boat.yaw)+dz*Math.sin(boat.yaw);
  return forward>=intake.near && forward<=intake.far && Math.abs(lateral)<=intake.halfWidth;
}

export class HarborLitter {
  constructor(){
    this.used=false;
    this.arms={east:new ShoreArm('east'),west:new ShoreArm('west')};
    this.items=seeds.map(([id,kind,x,z],i)=>({id,kind,x,z,origin:{x,z},phase:i*1.72,
      state:'water',claim:null,vessel:null,berth:null}));
  }
  drift(time){
    if(time===this.lastTime)return;
    this.lastTime=time;
    for(const item of this.items){
      if(item.state!=='water')continue;
      const a=item.phase;
      item.x=item.origin.x+.96*(Math.sin(.11*time+a)-Math.sin(a));
      item.z=item.origin.z+.64*(Math.sin(.085*time-a)+Math.sin(a));
    }
  }
  cargo(id){return this.items.filter(item=>item.state==='aboard'&&item.vessel===id)}
  isMoored(id){return this.arms.east.moors(id)||this.arms.west.moors(id)}
  tickArms(dt){for(const arm of Object.values(this.arms))arm.step(dt,this.items)}
  takeAtIntake(run){
    const id=run.id||'A';
    const cargo=this.cargo(id);
    if(cargo.length>=capacity)return null;
    // A physical contact can pick up either material, including a policy mistake.
    const item=this.items.find(i=>i.state==='water'&&intakeContact(run.boat,i));
    if(item)Object.assign(item,{state:'aboard',vessel:id,slot:cargo.some(i=>i.slot===0)?1:0});
    return item;
  }
}

// Each strip covers the charted cleanup basin. Its coordinates are independent of litter placement.
function surveyPoints(run){
  const left=-19,right=19,rows=[21,14.8,3.9,-2,-8];
  const fromWest=run.id==='B';
  const passes=fromWest?[...rows].reverse():rows;
  const targets=[];
  let east=fromWest;
  for(const z of passes){
    if(targets.length)targets.push({x:east?left:right,z});
    targets.push({x:east?right:left,z});east=!east;
  }
  // Cross the first transects at right angles to observe gaps left by diversions and unloading.
  const columns=fromWest?[-12,0,12]:[12,0,-12];
  for(const [i,x] of columns.entries()){
    const near=(i%2===0)===fromWest?22:-8,far=near===22?-8:22;
    for(const z of [near,far]){
      for(const offset of [0,2,-2,4,-4]){
        const p={x:x+offset,z};
        if(run.navigationMap.clear(p,p)){targets.push(p);break}
      }
    }
  }
  return targets.filter(p=>run.navigationMap.clear(p,p));
}

export class CleanupMission {
  constructor(run,task){
    this.run=run;this.world=run.litter;this.world.used=true;
    this.id=run.id||'A';this.filter=task.target;this.words=task.words||('收集'+litterNames[task.target]);
    this.berth=task.berth||(this.id==='A'?'east':'west');
    this.survey=task.target==='unload'?[]:surveyPoints(run);this.index=0;
    this.phase='survey';this.delivered=0;this.dwell=0;this.gate=false;
    this.track=null;this.candidate=null;this.lastSeen=-Infinity;
    this.map=run.navigationMap;this.moored=null;
  }
  release(){this.track=null;this.candidate=null;this.gate=false}
  detach(){this.world.arms[this.berth].cancel(this.handoff);this.release()}
  get label(){
    if(this.phase==='handoff'){
      const arm=this.world.arms[this.berth];
      return arm.job===this.handoff?'靠泊交接':'等候岸臂';
    }
    if(this.phase==='collect')return '船首视觉对准'+litterNames[this.track?.kind||this.filter];
    if(this.phase==='return')return '返回'+berthName(this.berth)+'卸载';
    if(this.phase==='blocked')return '等待可航路径';
    return '视觉搜索'+litterNames[this.filter]+' · 航线 '+(this.index+1)+'/'+this.survey.length;
  }
  routeTo(points,target,announce){
    const r=this.run,length=pathLength(points);
    this.progress=null;
    r.route={legs:[{target,points}],distance:length,blocked:null};r.waypoint=1;r.revision++;
    r.act={throttle:0,turn:0};
    if(announce)r.log('规划','A* 航线已生成 · 1 个航段 · '+length.toFixed(1)+' m · '+this.label);
  }
  pathBetween(from,to){
    if(!this.moored||this.map.clear(from,from))return this.map.findPath(from,to);
    // Leave a neighbor's clearance perimeter if its last reported stop put us just inside it.
    const m=this.moored,angle=Math.atan2(from.z-m.z,from.x-m.x);
    for(const offset of [0,.45,-.45,.9,-.9]){
      const exit={x:m.x+5.3*Math.cos(angle+offset),z:m.z+5.3*Math.sin(angle+offset)};
      if(!this.run.navigationMap.clear(from,exit))continue;
      const path=this.map.findPath(exit,to);
      if(path)return [{x:from.x,z:from.z},...path];
    }
    return null;
  }
  plan(announce=true){
    const r=this.run,cargo=this.world.cargo(this.id);
    if(this.handoff)return true;
    this.release();this.dwell=0;
    if(this.phase==='return'||cargo.length>=capacity||this.index>=this.survey.length&&(cargo.length||this.survey.length)){
      this.phase='return';
      const berth=r.layout[this.berth],end=unloadingPoint(berth,this.id);
      const entry={x:end.x+(this.id==='B'?1.8:-1.8),z:berth.z-3.5};
      let path=this.pathBetween(r.boat,end);
      if(gap(r.boat,end)>=5){
        const a=this.pathBetween(r.boat,entry),b=this.map.findPath(entry,end);
        if(a&&b)path=[...a,...b.slice(1)];
      }
      if(path){this.routeTo(path,this.berth,announce);return true}
      this.phase='blocked';r.route={legs:[],distance:0,blocked:r.active};
      r.log('规划','路径不可达 · 卸载泊位');this.retry=r.time+1;return false;
    }
    this.phase='survey';
    while(this.index<this.survey.length){
      const path=this.pathBetween(r.boat,this.survey[this.index]);
      if(path){this.routeTo(path,'survey',announce);return true}
      this.index++;
    }
    if(this.survey.length||cargo.length){this.phase='return';return this.plan(announce)}
    r.finish('清漂完成 · 本次卸载 '+this.delivered+' 件'+(this.filter==='unload'?'':' · 已完成作业区目视搜索'),null);
    return false;
  }
  applyVision(obs,result){
    const r=this.run;
    const [confidence,u,v,material]=result.visualFocus;
    const [throttle,turn,gate]=result.visualControl;
    if(![confidence,u,v,material,throttle,turn,gate].every(Number.isFinite))throw Error('船首视觉策略输出无效');
    const p=waterPoint(obs.pose,u,v),kind=material>.5?'foam':'bottle',peer=r.peerVisualClaim;
    const forbidden=peer&&r.time-peer.received<1.8&&p&&peer.kind===kind&&gap(peer,p)<1.6&&
      (!this.track||this.id==='B');
    const visible=confidence>=.55&&p&&gap(obs.pose,p)<10.5&&Math.abs(p.x)<=21&&p.z>=-11&&p.z<=24&&
      !forbidden&&(!this.rejected||r.time>this.rejected.until||gap(this.rejected,p)>1.7)&&this.map.clear(r.boat,p);
    this.gate=false;
    if(visible){
      const confirmed=this.track&&this.track.kind===kind&&gap(this.track,p)<2||
        this.candidate&&this.candidate.kind===kind&&gap(this.candidate,p)<1.65;
      this.candidate={...p,kind};
      if(confirmed){
        if(this.phase!=='collect'){
          const path=this.map.findPath(r.boat,p);
          if(!path)return false;
          this.phase='collect';this.track=this.candidate;this.started=r.time;
          this.routeTo(path,'visual',false);
          r.log('视觉','船首锁定'+litterNames[kind]+' · 规划抵近航段');
        }else{
          const points=r.route.legs[0].points;points[points.length-1]=p;
        }
        this.track=this.candidate;this.lastSeen=r.time;
        this.gate=gate>=.5;
        r.act={throttle,turn};return true;
      }
    }else this.candidate=null;
    if(this.phase==='collect'){
      r.act={throttle:0,turn:0};
      return true;
    }
    return false;
  }
  refresh(){
    const r=this.run;
    if(this.handoff)return;
    const peer=r.peerVessel,stationary=peer&&r.time-peer.time<2.4&&(!peer.active||peer.held)&&peer.speed<.25;
    if(stationary&&gap(r.boat,peer)>4.65&&(!this.moored||gap(this.moored,peer)>.8)){
      this.moored={x:peer.x,z:peer.z};this.map=r.navigationMap.withMooredVessel(this.moored);this.plan(false);return;
    }
    if(!stationary&&this.moored){this.moored=null;this.map=r.navigationMap;this.plan(false);return}
    if(this.phase==='blocked'&&r.time>=this.retry){this.phase='return';this.plan();return}
    if(this.phase==='survey'&&r.nextWaypoint){
      const d=gap(r.boat,r.nextWaypoint),key=this.index+':'+r.waypoint;
      if(!this.progress||this.progress.key!==key||d<this.progress.best-.45){
        this.progress={key,best:d,at:r.time};
      }else if(r.time-this.progress.at>12){
        // At a blocked survey vantage the perpendicular transects still cover the same water.
        // Never advance a delivery leg until cargo has physically been unloaded.
        this.progress=null;
        if(this.retriedIndex===this.index){
          r.log('规划','搜索航点持续受阻，从交叉航线继续观测');this.index++;
        }else this.retriedIndex=this.index;
        this.plan(false);return;
      }
    }
    if(this.phase==='collect'&&(r.time-this.lastSeen>.85||r.time-this.started>13)){
      if(r.time-this.started>13)this.rejected={...this.track,until:r.time+12};
      this.plan(false);
    }
  }
  afterMove(dt){
    const r=this.run;
    if(this.handoff){
      if(!this.handoff.done)return;
      this.delivered+=this.handoff.delivered.length;this.handoff=null;this.leaveDock();return;
    }
    if(this.phase==='collect'&&this.gate){
      const picked=this.world.takeAtIntake(r);
      if(picked){
        r.log('入舱',litterNames[picked.kind]+' '+picked.id+' 通过船首收集口 · 舱载 '+this.world.cargo(this.id).length+'/'+capacity);
        this.plan();return;
      }
    }
    const peer=r.peerVessel,goal=r.nextWaypoint;
    const occupied=goal&&peer&&r.time-peer.time<2.4&&peer.speed<.5&&gap(peer,goal)<6&&gap(r.boat,goal)<8;
    if(this.phase==='survey'&&goal&&r.waypoint===r.route.legs[0].points.length-1&&(gap(r.boat,goal)<.83||occupied)){
      this.index++;this.plan(false);
    }else if(this.phase==='return'){
      const atDock=gap(r.boat,unloadingPoint(r.layout[this.berth],this.id))<.85&&r.boat.speed<.32;
      this.dwell=atDock?this.dwell+dt:0;
      if(this.dwell<.7)return;
      const cargo=this.world.cargo(this.id);
      if(cargo.length){
        r.boat.speed=0;r.boat.turn=0;r.act={throttle:0,turn:0};r.revision++;
        this.phase='handoff';this.handoff=this.world.arms[this.berth].request(r,cargo);
        r.log('交接',berthName(this.berth)+'已靠稳 · 等候机械臂接收 '+cargo.length+' 件');
      }else{
        this.leaveDock();
      }
    }
  }
  leaveDock(){
    if(this.index>=this.survey.length){
      this.run.finish('清漂完成 · 本次卸载 '+this.delivered+' 件'+(this.filter==='unload'?'':' · 已完成作业区目视搜索并靠泊'),null);
    }else{this.phase='survey';this.plan()}
  }
}
