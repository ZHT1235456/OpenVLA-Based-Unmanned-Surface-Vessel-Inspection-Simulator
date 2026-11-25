import * as THREE from 'three';

export const CONTACTS=['pier','wall','east','west'];
export const TILE=20;
const paint=(color,roughness=.8)=>new THREE.MeshStandardMaterial({color,roughness});
function piece(group,geo,mat,x,y,z){
  const obj=new THREE.Mesh(geo,mat); obj.position.set(x,y,z); group.add(obj); return obj;
}
function box(g,m,x,y,z,w,h,d){return piece(g,new THREE.BoxGeometry(w,h,d),m,x,y,z)}
function post(g,m,x,y,z,base,top,h,n=12){return piece(g,new THREE.CylinderGeometry(top,base,h,n),m,x,y,z)}
// Physical fixtures used both in the harbor and in the simulated camera's object crops.
export function fixture(kind){
 const g=new THREE.Group();
 if(kind==='pier'){
   const oak=paint(0x875430),dark=paint(0x563825),end=paint(0xbd9363);
   for(const x of [-.75,.75])for(const z of [-.55,.55]){
     post(g,dark,x,.58,z,.14,.13,1.7);post(g,end,x,1.45,z,.135,.135,.08);
   }
   for(let i=0;i<8;i++)box(g,i%3===0?dark:oak,-.945+i*.27,1.0,0,.255,.19,1.7);
   box(g,oak,0,.8,.58,2.3,.26,.2);box(g,oak,0,.8,-.58,2.3,.26,.2);
 }else if(kind==='wall'){
   const shades=[0x888e8d,0xa7aaa5,0x737c7f,0xb6b9b3].map(c=>paint(c));
   const points=[[-.63,.34,-.2],[.4,.38,-.45],[.04,.3,.49],[.52,.75,.23],[-.39,.84,.07]];
   points.forEach(([x,y,z],i)=>{const r=piece(g,new THREE.DodecahedronGeometry(.73),shades[i%4],x,y,z);r.scale.set(1,.8,1);r.rotation.set(.21*i,.9*i,.3*i)});
 }else{
   const signal=paint(kind==='east'?0xe76d31:0x167dc1),white=paint(0xe1e5df),steel=paint(0x293b41);
   post(g,steel,0,.2,0,.52,.48,.4);post(g,signal,0,.94,0,.36,.32,1.36);
   post(g,white,0,.77,0,.372,.362,.13);post(g,signal,0,1.75,0,.44,.42,.16);
   for(const x of [-.2,.2])box(g,steel,x,1.91,0,.07,.3,.07);
   box(g,signal,0,2.08,0,.64,.12,.22);
 }
 return g;
}
export function fixturePosition(contact,role){
 if(role==='pier'||role==='wall') return {x:contact.x+Math.sign(contact.x)*4.0,z:contact.z-.35};
 return {x:contact.x+Math.sign(contact.x)*1.6,z:contact.z+1.1};
}
export function makeOptics(renderer){
 const target=new THREE.WebGLRenderTarget(TILE,TILE,{depthBuffer:true,generateMipmaps:false});
 target.texture.colorSpace=THREE.SRGBColorSpace;
 const camera=new THREE.PerspectiveCamera(25,1,.1,35);
 const scenes=CONTACTS.map(role=>{
   const scene=new THREE.Scene();scene.background=new THREE.Color(0x798e90);
   const sky=new THREE.HemisphereLight(0xf2f6ed,0xa3b0aa,1.65);scene.add(sky);
   const sun=new THREE.DirectionalLight(0xffefd9,2.25);sun.position.set(4,7,3);scene.add(sun);
   scene.add(fixture(role));return {scene,sky,sun};
 });
 const pixels=new Uint8Array(TILE*TILE*4);
 function read(index,angle,elevation=.11,light=1){
   const {scene,sky,sun}=scenes[index];const distance=5.9;
   sun.intensity=2.25*light;sky.intensity=1.65*light;
   camera.position.set(Math.sin(angle)*distance,.88+elevation*distance,Math.cos(angle)*distance);
   camera.lookAt(0,.82,0);camera.updateMatrixWorld();
   const previous=renderer.getRenderTarget();
   renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
   renderer.readRenderTargetPixels(target,0,0,TILE,TILE,pixels);renderer.setRenderTarget(previous);
   const rgb=new Uint8Array(TILE*TILE*3);
   for(let y=0;y<TILE;y++)for(let x=0;x<TILE;x++){
     const src=((TILE-1-y)*TILE+x)*4,dst=(y*TILE+x)*3;
     rgb[dst]=pixels[src];rgb[dst+1]=pixels[src+1];rgb[dst+2]=pixels[src+2];
   }return rgb;
 }
 return {read,dispose(){target.dispose();for(const {scene} of scenes)scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose()}})}};
}
export function makeTrainingBank(n=80){
 const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:false});
 renderer.setSize(TILE,TILE);const camera=makeOptics(renderer);const result=new Uint8Array(4*n*TILE*TILE*3);
 for(let c=0;c<4;c++)for(let i=0;i<n;i++){
  const angle=(i*.61803398875%1)*Math.PI*2, elevation=.03+(i*0.381966%1)*.38;
  const crop=camera.read(c,angle,elevation,.75+(i*0.713%1)*.48);
  result.set(crop,(c*n+i)*TILE*TILE*3);
 }
 camera.dispose();renderer.dispose();return result;
}
