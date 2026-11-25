export const capacity = 2;
export const litterNames = {bottle:'塑料瓶', foam:'泡沫块', litter:'水面漂浮物', unload:'船舱卸载'};
export const intake = {near:1.35, far:2.22, halfWidth:.53};
const seeds = [
  ['P1','bottle',12,16], ['P2','bottle',-12,15], ['P3','bottle',1,-5],
  ['F1','foam',2,18], ['F2','foam',-10,2]
];
const gap = (a,b) => Math.hypot(b.x-a.x,b.z-a.z);
const matches = (item,filter) => filter==='litter'||item.kind===filter;
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
  collect(item,run){
    const id=run.id||'A';
    if(item.state!=='water'||item.claim!==id||this.cargo(id).length>=capacity||
        !intakeContact(run.boat,item))return false;
    Object.assign(item,{state:'aboard',claim:null,vessel:id});
    return true;
  }
  unload(run,berth){
    if(gap(run.boat,unloadingPoint(run.layout[berth],run.id))>.85||run.boat.speed>.32)return [];
    const cargo=this.cargo(run.id||'A');
    for(const item of cargo)Object.assign(item,{state:'land',berth});
    return cargo;
  }
}

// A collection leg follows a moving object. Each return leg ends at a fixed unloading berth.
export class CleanupMission {
  constructor(run,task){
    this.run=run;this.world=run.litter;this.world.used=true;
    this.id=run.id||'A';this.filter=task.target;this.berth=task.berth||(this.id==='A'?'east':'west');
    this.phase='';this.item=null;this.nextCheck=0;this.delivered=0;this.dwell=0;
  }
  release(){
    if(this.item?.claim===this.id)this.item.claim=null;
    this.item=null;
  }
  get label(){
    if(this.phase==='collect'&&this.item)return '驶向'+litterNames[this.item.kind]+' '+this.item.id;
    if(this.phase==='return')return '返回'+berthName(this.berth)+'卸载';
    if(this.phase==='wait')return '等候邻艇收集';
    if(this.phase==='blocked')return '等待可航路径';
    return '选择清漂目标';
  }
  routeTo(points,target,announce){
    const r=this.run, length=pathLength(points);
    r.route={legs:[{target,points}],distance:length,blocked:null};r.waypoint=1;r.revision++;
    r.act={throttle:0,turn:0};
    if(announce)r.log('规划','A* 航线已生成 · 1 个航段 · '+length.toFixed(1)+' m · '+this.label);
  }
  plan(announce=true){
    const r=this.run, water=this.world.items.filter(i=>i.state==='water'&&matches(i,this.filter));
    const cargo=this.world.cargo(this.id);
    this.nextCheck=r.time+1;this.dwell=0;
    if(this.phase==='return'||cargo.length>=capacity||(cargo.length&&(!water.length||this.filter==='unload'||water.every(i=>i.claim&&i.claim!==this.id)))){
      this.release();this.phase='return';
      const berth=r.layout[this.berth],end=unloadingPoint(berth,this.id);
      const entry={x:end.x+(this.id==='B'?1.8:-1.8),z:berth.z-3.5};
      let path;
      if(gap(r.boat,end)<5&&r.navigationMap.clear(r.boat,end))path=r.navigationMap.findPath(r.boat,end);
      else{
        const approach=r.navigationMap.findPath(r.boat,entry),alongside=r.navigationMap.findPath(entry,end);
        if(approach&&alongside)path=[...approach,...alongside.slice(1)];
      }
      if(path){this.routeTo(path,this.berth,announce);return true}
    }else if(!water.length){
      this.release();r.route=null;
      r.finish('清漂完成 · 本次卸载 '+this.delivered+' 件'+(this.filter==='unload'?'':' · 所选水面目标已清完'),null);
      return false;
    }else{
      let best=null,bestPath=null,bestLength=Infinity;
      const available=water.filter(i=>!i.claim||i.claim===this.id);
      if(!available.length){this.release();this.phase='wait';r.route=null;return false}
      for(const item of (this.item&&available.includes(this.item)?[this.item]:available)){
        const path=r.navigationMap.findPath(r.boat,{x:item.x,z:item.z});
        if(!path)continue;
        const length=pathLength(path);
        if(length<bestLength){best=item;bestPath=path;bestLength=length}
      }
      if(best){
        this.item=best;best.claim=this.id;this.phase='collect';
        // Leave enough room for the bow to turn towards an object drifting alongside the hull.
        if(bestLength<intake.near+.04&&!intakeContact(r.boat,best)){
          const angle=r.boat.yaw;
          for(const offset of [0,1.57,-1.57,Math.PI]){
            const start={x:best.x-3.5*Math.sin(angle+offset),z:best.z+3.5*Math.cos(angle+offset)};
            const path=r.navigationMap.findPath(r.boat,start);
            if(path&&r.navigationMap.clear(start,best)){bestPath=[...path,{x:best.x,z:best.z}];break}
          }
        }
        this.routeTo(bestPath,best.id,announce);return true;
      }
    }
    if(this.phase!=='blocked')r.log('规划','路径不可达 · '+this.label);
    this.release();this.phase='blocked';r.route={legs:[],distance:0,blocked:r.active};return false;
  }
  refresh(){
    const r=this.run;
    if(r.time<this.nextCheck)return;
    this.nextCheck=r.time+1;
    if(this.phase==='wait'||this.phase==='blocked'){this.plan();return}
    if(this.phase!=='collect')return;
    const end=r.route?.legs[0]?.points.at(-1);
    if(!end||gap(end,this.item)>.38||(gap(r.boat,this.item)<intake.near&&!intakeContact(r.boat,this.item)&&r.waypoint===r.route.legs[0].points.length-1))this.plan(false);
  }
  afterMove(dt){
    const r=this.run;
    if(this.phase==='collect'&&this.world.collect(this.item,r)){
      r.log('入舱',litterNames[this.item.kind]+' '+this.item.id+' 通过船首收集口 · 舱载 '+this.world.cargo(this.id).length+'/'+capacity);
      this.release();this.plan();
    }else if(this.phase==='return'){
      const atDock=gap(r.boat,unloadingPoint(r.layout[this.berth],this.id))<.85&&r.boat.speed<.32;
      this.dwell=atDock?this.dwell+dt:0;
      if(this.dwell<.7)return;
      const cargo=this.world.unload(r,this.berth);
      if(!cargo.length)return;
      this.delivered+=cargo.length;
      r.log('卸载',berthName(this.berth)+'收到 '+cargo.length+' 件 · '+cargo.map(i=>litterNames[i.kind]+' '+i.id).join('、'));
      this.phase='';this.plan();
    }
  }
}
