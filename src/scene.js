import * as T from 'three';
import {buildHarbor} from './harbor.js';
import {makeVessel,makeBuoy,makeServiceBoat} from './vessels.js';
import {CONTACTS,fixture,fixturePosition,makeOptics} from './contacts.js';
import {distance} from './simulation.js';
import {MARKS,buoyIds,isGateMark} from './marks.js';
import {CleanupView} from './cleanup-scene.js';
import {BowSensor} from './bow-sensor.js';

function makeWake(){
 const geo=new T.PlaneGeometry(1,1);geo.rotateX(-Math.PI/2);
 return new T.Mesh(geo,new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,
  uniforms:{intensity:{value:0},seconds:{value:0}},
  vertexShader:'varying vec2 st; void main(){st=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'varying vec2 st;uniform float intensity;uniform float seconds;void main(){float y=st.y;float edge=abs(abs(st.x-.5)-(.14+.26*(1.-y)));float a=exp(-48.*edge)*sin(3.14*y)*(.62+.28*sin(65.*y+seconds*8.));gl_FragColor=vec4(.78,.94,.94,.58*a*intensity);}'
 }));
}

export class HarborView {
 constructor(world,bow,run){
  this.main=new T.WebGLRenderer({canvas:world,antialias:true,alpha:false,powerPreference:'high-performance'});
  this.bow=new T.WebGLRenderer({canvas:bow,antialias:true,alpha:false});
  this.camera=new T.PerspectiveCamera(49,1,.12,520);
  this.lens=new T.PerspectiveCamera(67,1,.12,520);
  this.sensor=new BowSensor();
  this.photoLens=new T.PerspectiveCamera(49,720/405,.12,520);
  this.photoTarget=new T.WebGLRenderTarget(720,405);this.photoTarget.texture.colorSpace=T.SRGBColorSpace;
  this.print=document.createElement('canvas');this.print.width=720;this.print.height=405;
  this.printCtx=this.print.getContext('2d');this.printImage=this.printCtx.createImageData(720,405);
  this.printPixels=new Uint8Array(720*405*4);
  this.scene=new T.Scene();this.scene.background=new T.Color(0xa9ccd5);
  this.models={A:makeVessel(T,'A')};this.wakes={A:makeWake()};
  this.service=makeServiceBoat(T);this.scene.add(this.models.A,this.wakes.A,this.service);
  this.markers=Object.fromEntries(buoyIds.map(id=>[id,makeBuoy(T,MARKS[id].paint)]));this.scene.add(...Object.values(this.markers));
  this.parts=Object.fromEntries(CONTACTS.map(k=>[k,fixture(k)]));this.scene.add(...Object.values(this.parts));
  this.cleanupView=new CleanupView(this.scene,run.litter.items);
  this.optics=makeOptics(this.bow);this.view=0;this.orbit=.29;this.height=3.35;this.radius=8.25;this.setRun(run);
  let drag=null;world.addEventListener('pointerdown',e=>{if(e.button!==0||this.view!==0||this.shore)return;drag=[e.clientX,e.clientY];world.setPointerCapture(e.pointerId)});
  world.addEventListener('pointermove',e=>{
   if(!drag||this.view!==0||this.shore)return;
   this.orbit+=(e.clientX-drag[0])*.008;
   this.height=Math.max(1.5,Math.min(10,this.height+(e.clientY-drag[1])*.035));
   drag=[e.clientX,e.clientY];
  });
  world.addEventListener('pointerup',()=>{drag=null});world.addEventListener('pointercancel',()=>{drag=null});
  world.addEventListener('wheel',e=>{e.preventDefault();this.radius=Math.max(5.5,Math.min(19,this.radius+e.deltaY*.012))},{passive:false});
 }
 setRun(run){
  this.shore=false;
  this.env?.dispose();this.env=buildHarbor(T,this.scene,run.layout);
  for(const c of CONTACTS){
   const p=run.layout[c],q=fixturePosition(p,c);this.parts[c].position.set(q.x,0,q.z);
  }
  for(const [id,mesh] of Object.entries(this.markers)){const p=run.layout[id];mesh.position.set(p.x,0,p.z)}
  this.cropCache=new WeakMap();this.setMembers({A:run},'A');
 }
 setMembers(boats,follow){
  this.boats=boats;this.run=boats[follow];this.follow=follow;this.lastBow=-Infinity;
  if(boats.B&&!this.models.B){this.models.B=makeVessel(T,'B');this.wakes.B=makeWake();this.scene.add(this.models.B,this.wakes.B)}
  for(const id of Object.keys(this.models)){this.models[id].visible=this.wakes[id].visible=!!boats[id]}
 }
 updateObjects(){
  const r=this.run,t=r.time;
  this.env.update(t,1);
  this.cleanupView.update(r,this.boats,this.models);
  for(const [id,run] of Object.entries(this.boats)){
   const b=run.boat,v=this.models[id],w=this.wakes[id],phase=id==='B'?.52:0;
   const swell=run.litter.isMoored(id)?0:1;
   v.position.set(b.x,swell*.045*Math.sin(t*1.72+phase),b.z);
   v.rotation.set(swell*.012*Math.sin(t*1.32+phase),-b.yaw,swell*.017*Math.sin(t*1.78+phase),'YXZ');
   const len=3.4+b.speed*1.8;
   w.position.set(b.x-Math.sin(b.yaw)*(1.15+len/2),.024,b.z+Math.cos(b.yaw)*(1.15+len/2));w.rotation.y=-b.yaw;
   w.scale.set(2.1+b.speed*.41,1,len);w.material.uniforms.intensity.value=Math.min(1,b.speed/.8);w.material.uniforms.seconds.value=t;
  }
  const s=r.service();this.service.visible=r.traffic;this.service.position.set(s.x,.03*Math.sin(t*1.75),s.z);
  this.service.rotation.y=-Math.atan2(s.vx,-s.vz);
  for(const c of ['pier','wall']){const m=this.markers[c];m.position.y=.07*Math.sin(t*1.8+(c==='wall'?2:0));m.rotation.z=r.lean(c)}
 }
 cameraPose(cam,run){
  const b=run.boat;
  if(run.cleanup){this.sensor.pose(cam,b);return}
  cam.position.set(b.x+Math.sin(b.yaw)*.72,1.39+.04*Math.sin(run.time*1.72),b.z-Math.cos(b.yaw)*.72);
  const reach=run.cleanup?4.5:20, height=run.cleanup ? .12 : .94;
  cam.up.set(0,1,0);cam.lookAt(b.x+Math.sin(b.yaw)*reach,height,b.z-Math.cos(b.yaw)*reach);
 }
 fit(renderer,camera){
  const el=renderer.domElement,w=el.clientWidth,h=el.clientHeight;
  if(!w||!h)return false;
  const scale=Math.min(window.devicePixelRatio||1,1.45);
  if(el.width===Math.floor(w*scale)&&el.height===Math.floor(h*scale)&&Math.abs(camera.aspect-w/h)<.00001)return false;
  renderer.setDrawingBufferSize(w,h,scale);camera.aspect=w/h;
  if(camera===this.lens)camera.fov=Math.min(67,T.MathUtils.radToDeg(2*Math.atan(Math.tan(T.MathUtils.degToRad(56))/camera.aspect)));
  camera.updateProjectionMatrix();return true;
 }
 render(){
  const r=this.run,b=r.boat;this.updateObjects();
  this.fit(this.main,this.camera);
  if(this.shore){
   const berth=r.layout[this.shoreStation().berth],s=this.follow==='A'?-1:1;
   const zoom=Math.max(1,1.45/this.camera.aspect);
   this.camera.up.set(0,1,0);
   this.camera.position.set(berth.x+s*8.4*zoom,2.4+3.2*zoom,berth.z+4.7-7.9*zoom);
   this.camera.lookAt(berth.x+s*.45,2.4,berth.z+4.7);
  }else if(this.view===0){
   const a=b.yaw+this.orbit;
   this.camera.up.set(0,1,0);this.camera.position.set(b.x-Math.sin(a)*this.radius,this.height,b.z+Math.cos(a)*this.radius);
   this.camera.lookAt(b.x+Math.sin(b.yaw)*3,.82,b.z-Math.cos(b.yaw)*3);
  }else if(this.view===1){this.camera.up.set(0,1,0);this.camera.position.set(1,52,35);this.camera.lookAt(0,0,1)}
  else this.cameraPose(this.camera,r);
  const hull=this.models[this.follow];hull.visible=this.shore||this.view!==2;this.main.render(this.scene,this.camera);hull.visible=true;
  const resized=this.fit(this.bow,this.lens);
  if(resized||r.time-this.lastBow>=.2){
   this.cameraPose(this.lens,r);hull.visible=false;this.bow.render(this.scene,this.lens);hull.visible=true;this.lastBow=r.time;
  }
 }
 photo(photo,run=this.run){
  this.updateObjects();
  const lens=this.photoLens,p=run.layout[photo.target],gate=isGateMark(photo.target);
  const ref=gate?p:fixturePosition(p,photo.target),k=photo.framing?.38:0;
  this.cameraPose(lens,run);lens.lookAt(p.x*(1-k)+ref.x*k,gate?.72:1.06,p.z*(1-k)+ref.z*k);
  lens.fov=photo.framing?70:49;lens.updateProjectionMatrix();
  const hull=this.models[run.id||'A'],previous=this.bow.getRenderTarget(),wasVisible=hull.visible;
  try{
   hull.visible=false;this.bow.setRenderTarget(this.photoTarget);this.bow.render(this.scene,lens);
   this.bow.readRenderTargetPixels(this.photoTarget,0,0,720,405,this.printPixels);
  }finally{this.bow.setRenderTarget(previous);hull.visible=wasVisible}
  const stride=720*4;
  for(let y=0;y<405;y++)this.printImage.data.set(this.printPixels.subarray((404-y)*stride,(405-y)*stride),y*stride);
  this.printCtx.putImageData(this.printImage,0,0);return this.print.toDataURL('image/jpeg',.89);
 }
 measureLean(c){
  const m=this.markers[c];if(!m)return 0;
  const upright=new T.Vector3(0,1,0).applyQuaternion(m.quaternion);
  return Math.atan2(-upright.x,upright.y);
 }
 cropFor(c,run=this.run){
  let entry=this.cropCache.get(run);
  if(!entry||run.time-entry.time>.8){
   const b=run.boat;entry={time:run.time,crops:{}};this.cropCache.set(run,entry);
   for(let i=0;i<4;i++){const role=CONTACTS[i],p=this.parts[role].position;
    entry.crops[role]=this.optics.read(i,Math.atan2(b.x-p.x,b.z-p.z),Math.max(.03,Math.min(.4,.65/(distance(b,p)+.01))),1+.04*Math.sin(run.time*.3))}
  }
  return entry.crops[c];
 }
 shoreStation(){
  const r=this.run,arms=r.litter.arms;
  const active=Object.values(arms).find(arm=>arm.moors(this.follow));
  const recent=r.done.findLast(task=>task.kind==='cleanup');
  return active||arms[r.cleanup?.berth||recent?.berth||(this.follow==='A'?'east':'west')];
 }
 get viewName(){return this.shore?'岸端接应':['随艇视角','港池鸟瞰','船首视角'][this.view]}
 nextView(){if(this.shore)this.shore=false;else this.view=(this.view+1)%3;return this.viewName}
}
