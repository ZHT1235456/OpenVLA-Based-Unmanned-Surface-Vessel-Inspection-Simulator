// Positions are relative to the berth marker, with metres measured from the waterline.
export const armBase={x:0,y:2.12,z:5.55};
export const armLinks={upper:3.70,fore:3.55,tool:.58};
export const binCenter={x:.95,y:1.13,z:7.30};
const home={x:-.75,y:2.75,z:7.15};
const clearance=2.9;
const openGap=.86;
const stages=[
  ['reach','移向船舱',.85],['lower','下探',.66],['close','夹取',.38],
  ['lift','提起',.72],['swing','转向收集箱',1.05],['place','放入收集箱',.65],
  ['open','松爪',.34],['stow','复位',.68]
];
const resting=()=>({tip:{...home},gap:openGap,yaw:0});
export const cargoDepth=slot=>1.52+.37*slot;
export function binSlotPoint(slot){
  return {x:binCenter.x+(slot%3-1)*.74,y:binCenter.y+.20,
    z:binCenter.z+(Math.floor(slot/3)-.5)*.46};
}
const lerp=(a,b,k)=>a+(b-a)*k;
const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const above=p=>({...p,y:clearance});

// Analytic elbow-up IK in the vertical plane above the turntable bearing.
export function armJoints(tip){
  const dx=tip.x-armBase.x,dz=tip.z-armBase.z,radial=Math.hypot(dx,dz);
  const wristY=tip.y+armLinks.tool,dy=wristY-armBase.y;
  const d=Math.hypot(radial,dy),a=armLinks.upper,b=armLinks.fore;
  const along=(a*a-b*b+d*d)/(2*d),height=Math.sqrt(Math.max(0,a*a-along*along));
  return {yaw:Math.atan2(dx,dz),radius:radial,wristY,
    elbowR:(along*radial-height*dy)/d,elbowY:armBase.y+(along*dy+height*radial)/d};
}

export class ShoreArm{
  constructor(berth){
    this.berth=berth;this.queue=[];this.job=null;this.pose=resting();this.stage='idle';
  }
  get label(){return this.job?this.stepLabel:'待命'}
  request(run,items){
    const job={run,vessel:run.id||'A',items:[...items],delivered:[],cancelled:false,done:false};
    this.queue.push(job);return job;
  }
  moors(id){return this.job?.vessel===id||this.queue.some(j=>j.vessel===id)}
  cancel(job){
    if(!job||job.done)return;
    job.cancelled=true;
    if(job!==this.job){
      this.queue=this.queue.filter(j=>j!==job);job.done=true;
    }else if(this.item?.state!=='gripped'&&this.stage!=='stow'&&this.stage!=='retreat'){
      this.begin('retreat','收回夹爪',.55,above(this.pose.tip),openGap,this.pose.yaw);
    }
  }
  begin(stage,label,duration,tip,gap,yaw){
    this.stage=stage;this.stepLabel=label;this.duration=duration;this.elapsed=0;
    this.start=this.pose;this.end={tip,gap,yaw};
  }
  nextItem(allItems){
    const job=this.job,run=job.run;
    this.item=job.items.find(i=>i.state==='aboard'&&i.vessel===job.vessel);
    if(job.cancelled||!this.item){this.finish();return}
    const berth=run.layout[this.berth],b=run.boat,depth=cargoDepth(this.item.slot);
    this.pick={x:b.x-berth.x+depth*Math.sin(b.yaw),y:.18,z:b.z-berth.z-depth*Math.cos(b.yaw)};
    this.pickYaw=-b.yaw+this.item.phase*.09;
    this.binSlot=allItems.filter(i=>i.state==='land'&&i.berth===this.berth).length;
    this.drop=binSlotPoint(this.binSlot);
    this.closedGap=this.item.kind==='foam'?.35:.275;
    this.setStage(0);
  }
  setStage(index){
    this.index=index;
    const [stage,label,seconds]=stages[index];
    const targets=[above(this.pick),this.pick,this.pick,above(this.pick),
      above(this.drop),this.drop,this.drop,home];
    const closed=index>=2&&index<6;
    this.begin(stage,label,seconds,targets[index],closed?this.closedGap:openGap,index<4?this.pickYaw:0);
  }
  move(k){
    const a=this.start.tip,b=this.end.tip;
    k=k*k*(3-2*k);
    let x=lerp(a.x,b.x,k),z=lerp(a.z,b.z,k);
    if(this.stage==='swing'){
      const start=Math.atan2(a.x-armBase.x,a.z-armBase.z),end=Math.atan2(b.x-armBase.x,b.z-armBase.z);
      const yaw=start+angleDelta(start,end)*k;
      const radius=lerp(Math.hypot(a.x-armBase.x,a.z-armBase.z),Math.hypot(b.x-armBase.x,b.z-armBase.z),k);
      x=armBase.x+Math.sin(yaw)*radius;z=armBase.z+Math.cos(yaw)*radius;
    }
    this.pose={tip:{x,y:lerp(a.y,b.y,k),z},gap:lerp(this.start.gap,this.end.gap,k),
      yaw:this.start.yaw+angleDelta(this.start.yaw,this.end.yaw)*k};
  }
  finish(){
    const j=this.job,landed=j.delivered;
    if(landed.length)j.run.log('卸载',(this.berth==='east'?'东':'西')+'泊位收到 '+landed.length+' 件 · '+
      landed.map(i=>(i.kind==='foam'?'泡沫块 ':'塑料瓶 ')+i.id).join('、'));
    j.done=true;this.job=null;this.item=null;this.pose=resting();this.stage='idle';
  }
  step(dt,items){
    while(dt>1e-9){
      if(!this.job){
        const first=this.queue.findIndex(j=>!j.run.held&&!j.run.awaitingOrder);
        if(first<0)return;
        this.job=this.queue.splice(first,1)[0];this.nextItem(items);
        if(!this.job)continue;
      }
      if(!this.job.cancelled&&(this.job.run.held||this.job.run.awaitingOrder))return;
      const slice=Math.min(dt,this.duration-this.elapsed);
      this.elapsed+=slice;dt-=slice;this.move(Math.min(1,this.elapsed/this.duration));
      if(this.elapsed+1e-9<this.duration)return;
      const j=this.job,item=this.item;
      if(this.stage==='close'){
        item.state='gripped';item.berth=this.berth;
        j.run.log('抓取',(this.berth==='east'?'东':'西')+'泊位机械臂已夹起 '+item.id);
      }else if(this.stage==='open'){
        item.state='land';item.binSlot=this.binSlot;j.delivered.push(item);
        j.run.log('入箱',item.id+' 已放入岸端收集箱');
      }else if(this.stage==='retreat'){this.setStage(7);continue}
      else if(this.stage==='stow'){this.nextItem(items);continue}
      this.setStage(this.index+1);
    }
  }
}
