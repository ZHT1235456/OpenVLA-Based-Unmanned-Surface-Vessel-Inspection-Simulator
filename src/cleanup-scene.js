import * as T from 'three';
import {intake} from './cleanup.js';
import {cargoDepth,binCenter,binSlotPoint} from './shore-arm.js';
import {makeShoreArm} from './shore-arm-view.js';

const steel=new T.MeshStandardMaterial({color:0x507274,metalness:.48,roughness:.42});
const orange=new T.MeshStandardMaterial({color:0xffad43,roughness:.6});
const canvas=new T.MeshStandardMaterial({color:0x244b50,roughness:.91});
const box=new T.BoxGeometry();
function block(group,material,x,y,z,w,h,d){
  const part=new T.Mesh(box,material);
  part.scale.set(w,h,d);part.position.set(x,y,z);group.add(part);return part;
}
function litterMesh(kind){
  const group=new T.Group();
  if(kind==='bottle'){
    const profile=[[.075,-.32],[.13,-.29],[.142,-.25],[.134,-.20],[.143,-.17],
      [.143,.105],[.133,.14],[.14,.16],[.121,.20],[.061,.255],[.05,.27],[.05,.31]];
    const body=new T.Mesh(new T.LatheGeometry(profile.map(([x,y])=>new T.Vector2(x,y)),12),
      new T.MeshStandardMaterial({color:0x80d9e4,metalness:.14,roughness:.23,flatShading:true}));
    body.rotation.z=Math.PI/2;group.add(body);
    const band=new T.Mesh(new T.CylinderGeometry(.145,.145,.16,12),
      new T.MeshStandardMaterial({color:0xf3ede2,roughness:.72}));
    band.rotation.z=Math.PI/2;group.add(band);
    const cap=new T.Mesh(new T.CylinderGeometry(.064,.064,.065,12),orange);
    cap.rotation.z=Math.PI/2;cap.position.x=-.321;group.add(cap);
  }else{
    const outline=new T.Shape();
    const xy=[[-.25,-.14],[-.09,-.19],[.07,-.145],[.19,-.17],[.27,-.05],[.20,.03],[.235,.13],[.05,.185],[-.12,.15],[-.23,.08]];
    xy.forEach(([x,y],i)=>i?outline.lineTo(x,y):outline.moveTo(x,y));outline.closePath();
    const geo=new T.ExtrudeGeometry(outline,{depth:.13,bevelEnabled:true,bevelThickness:.025,bevelSize:.022,bevelSegments:1});
    geo.rotateX(-Math.PI/2);geo.translate(0,-.057,0);
    group.add(new T.Mesh(geo,new T.MeshStandardMaterial({color:0xf5edcf,roughness:1,flatShading:true})));
    const pores=new T.MeshStandardMaterial({color:0xd0c9ac,roughness:1});
    for(const [x,z] of [[.16,.06],[-.13,-.03],[.06,-.1],[-.04,.08]])
      block(group,pores,x,.099,z,.022,.002,.017);
  }
  return group;
}
function bowIntake(){
  const group=new T.Group(),center=-(intake.near+intake.far)/2;
  block(group,canvas,0,.035,center,.74,.055,intake.far-intake.near);
  for(let i=0;i<7;i++)block(group,steel,0,.072,-intake.near-i*.12,.77,.042,.037);
  for(const side of [-1,1]){
    const boom=block(group,orange,side*.50,.13,center,.088,.12,1.06);
    boom.rotation.y=-side*.23;
    block(group,steel,side*.38,.15,-1.17,.06,.22,.47);
  }
  return group;
}
function dockBin(){
  const group=new T.Group();
  block(group,canvas,0,.055,0,2.55,.11,1.35);
  block(group,steel,0,.32,.66,2.55,.50,.06);
  block(group,orange,0,.59,.66,2.58,.045,.08);
  for(const x of [-1.25,1.25]){
    block(group,steel,x,.27,0,.064,.40,1.34);
    block(group,orange,x,.48,0,.078,.038,1.36);
  }
  // The low water-facing lip leaves the landed material visible from the quay camera.
  block(group,steel,0,.15,-.66,2.55,.18,.06);
  return group;
}

export class CleanupView {
  constructor(scene,items){
    this.scene=scene;
    this.meshes=new Map(items.map(i=>[i.id,litterMesh(i.kind)]));
    this.intakes={};this.bins={east:dockBin(),west:dockBin()};
    this.arms={east:makeShoreArm(),west:makeShoreArm()};
    scene.add(...this.meshes.values(),...Object.values(this.bins));
    for(const arm of Object.values(this.arms))scene.add(arm.root);
  }
  update(run,boats,hulls){
    const world=run.litter,t=run.time;
    for(const [id,boat] of Object.entries(boats)){
      if(!this.intakes[id]){this.intakes[id]=bowIntake();hulls[id].add(this.intakes[id])}
      this.intakes[id].visible=!!boat.cleanup||world.cargo(id).length>0;
    }
    for(const [key,bin] of Object.entries(this.bins)){
      const berth=run.layout[key],arm=this.arms[key];
      bin.position.set(berth.x+binCenter.x,binCenter.y,berth.z+binCenter.z);
      arm.root.position.set(berth.x,0,berth.z);arm.update(world.arms[key]);
    }
    const slots={east:0,west:0};
    for(const item of world.items){
      const mesh=this.meshes.get(item.id);
      const afloat=item.state==='water', aboard=item.state==='aboard',gripped=item.state==='gripped';
      const parent=afloat?this.scene:aboard?hulls[item.vessel]:gripped?this.arms[item.berth].root:this.bins[item.berth];
      if(parent&&mesh.parent!==parent)parent.add(mesh);
      mesh.visible=!aboard||!!boats[item.vessel];
      if(afloat){
        mesh.position.set(item.x,.073+.029*Math.sin(1.9*t+item.phase),item.z);
        mesh.rotation.set(.085*Math.sin(t+item.phase),item.phase+.27*Math.sin(t*.17),.1*Math.cos(1.6*t+item.phase));
      }else if(aboard){
        mesh.position.set(0,.18,-cargoDepth(item.slot??0));
        mesh.rotation.set(0,item.phase*.09,0);
      }else if(gripped){
        const {tip,yaw}=world.arms[item.berth].pose;
        mesh.position.set(tip.x,tip.y,tip.z);mesh.rotation.set(0,yaw,0);
      }else{
        const ordinal=slots[item.berth]++,p=binSlotPoint(item.binSlot??ordinal);
        mesh.position.set(p.x-binCenter.x,p.y-binCenter.y,p.z-binCenter.z);mesh.rotation.set(0,0,0);
      }
    }
  }
}
