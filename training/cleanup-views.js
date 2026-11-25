// Simulation identities and coordinates are available to the demonstration teacher only.
import * as T from 'three';
import {HarborView} from '../src/scene.js';
import {makeRun,portLayout,clamp} from '../src/simulation.js';
import {intakeContact} from '../src/cleanup.js';

export function cleanupTeacher(seed,layoutIndex,neighbor=false){
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
  const range=(a,b)=>a+(b-a)*random(), run=makeRun(portLayout(layoutIndex));
  const view=new HarborView(document.createElement('canvas'),document.createElement('canvas'),run);
  const peer=neighbor?makeRun(run.layout,{litter:run.litter}):null;
  if(peer){run.id='A';peer.id='B';view.setMembers({A:run,B:peer},'A')}
  run.litter.used=true;
  const lights=[];view.scene.traverse(o=>{if(o.isLight)lights.push([o,o.intensity])});
  const teacherFrames=13;
  function relative(boat,item){
    const dx=item.x-boat.x,dz=item.z-boat.z,s=Math.sin(boat.yaw),c=Math.cos(boat.yaw);
    return [dx*s-dz*c,dx*c+dz*s];
  }
  function episode(){
    let start;
    do{start={x:range(-20,20),z:range(-11,24)}}while(!run.navigationMap.clear(start,start));
    const b=run.boat;Object.assign(b,start,{yaw:range(-Math.PI,Math.PI),speed:range(0,1.1),turn:0});
    run.time=range(0,140);run.traffic=random()<.7;
    for(const [light,base] of lights)light.intensity=base*range(.78,1.22);
    const target=Math.floor(random()*5),mode=random(),eligible=[];
    const ahead=range(2.8,10.5),side=range(-.72,.72)*ahead;
    if(peer){
      const f=range(2.3,10.5),l=range(-.66,.66)*f;
      Object.assign(peer.boat,{x:b.x+Math.sin(b.yaw)*f+Math.cos(b.yaw)*l,
        z:b.z-Math.cos(b.yaw)*f+Math.sin(b.yaw)*l,yaw:range(-Math.PI,Math.PI),speed:range(0,.45)});
    }
    for(const [i,item] of run.litter.items.entries()){
      // Paired distractors, isolated objects, empty water, and near-intake recovery views.
      let f=i===target?ahead:range(1.25,10), l=i===target?side:range(-.76,.76)*f;
      if(i===target&&mode>.82){f=range(1.25,3.5);l=range(-1.1,1.1)}
      if(i!==target&&mode<.25){f=ahead+range(-1,1);l=side+(i%2?1:-1)*range(.65,2.2)}
      if(mode<.08||i!==target&&random()<.50){f=-18-i;l=0}
      item.x=start.x+Math.sin(b.yaw)*f+Math.cos(b.yaw)*l;
      item.z=start.z-Math.cos(b.yaw)*f+Math.sin(b.yaw)*l;
      if(!run.navigationMap.clear(item,item)){item.x=start.x-24*Math.sin(b.yaw);item.z=start.z+24*Math.cos(b.yaw)}
      item.state='water';item.phase=range(-Math.PI,Math.PI);
      view.cleanupView.meshes.get(item.id).scale.setScalar(range(.88,1.14));
      eligible.push(item);
    }
    const frames=[], teacher=eligible[target];
    for(let step=0;step<teacherFrames;step++){
      const rgb=view.sensor.read(view,run), labels=[];
      for(const item of eligible){
        if(item.state!=='water')continue;
        const mesh=view.cleanupView.meshes.get(item.id);
        if(peer){
          const d=mesh.position.clone().sub(view.sensor.camera.position);
          const ray=new T.Raycaster(view.sensor.camera.position,d.clone().normalize(),0,d.length());
          if(ray.intersectObject(view.models.B,true).some(hit=>hit.object.visible))continue;
        }
        const p=mesh.position.clone().project(view.sensor.camera),[f,l]=relative(b,item);
        const u=(p.x+1)/2,v=(1-p.y)/2;
        if(f<1.05||f>11||u<.018||u>.982||v<.035||v>.97||p.z<0||p.z>1)continue;
        labels.push([item.kind==='foam'?1:0,u,v,f,l]);
      }
      let bytes='';for(let i=0;i<rgb.length;i+=8192)bytes+=String.fromCharCode(...rgb.subarray(i,i+8192));
      frames.push([btoa(bytes),labels]);
      const [forward,lateral]=relative(b,teacher),angle=Math.atan2(lateral,forward);
      if(teacher.state==='water'&&intakeContact(b,teacher)&&Math.abs(lateral)<.40){
        teacher.state='land';teacher.berth='east';
      }
      const dt=.48;
      const desiredSpeed=teacher.state==='land'?1.7:clamp(.32+.48*(forward-1.5),.30,2.7)*Math.max(.12,Math.cos(angle)**3);
      const desiredTurn=teacher.state==='land'?.19:clamp(1.9*angle,-1.42,1.42);
      b.turn+=(desiredTurn-b.turn)*.88;b.speed+=(desiredSpeed-b.speed)*.70;
      b.yaw+=b.turn*dt;b.x+=Math.sin(b.yaw)*b.speed*dt;b.z-=Math.cos(b.yaw)*b.speed*dt;
      run.time+=dt;
      if(peer){peer.boat.x+=Math.sin(peer.boat.yaw)*peer.boat.speed*dt;peer.boat.z-=Math.cos(peer.boat.yaw)*peer.boat.speed*dt}
      for(const item of eligible){item.x+=.019*Math.sin(item.phase+run.time*.1);item.z+=.014*Math.cos(item.phase+run.time*.09)}
    }
    return frames;
  }
  return {episode};
}
