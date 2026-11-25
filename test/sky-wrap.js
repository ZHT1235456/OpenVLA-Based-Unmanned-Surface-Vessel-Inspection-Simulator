import * as T from 'three';
import {buildHarbor} from '../src/harbor.js';
import {portLayout} from '../src/simulation.js';

// Sample two rays a fraction of a texel apart on the production sky mesh, with the photo loaded.
export async function checkSkyWrap(){
 const renderer=new T.WebGLRenderer();
 const scene=new T.Scene(),harbor=buildHarbor(T,scene,portLayout());
 const dome=harbor.group.getObjectByName('远岸与雨后云层');
 const isolated=new T.Scene();isolated.add(dome.clone());
 const w=96,h=16,target=new T.WebGLRenderTarget(w,h);
 target.texture.colorSpace=T.SRGBColorSpace;
 const camera=new T.PerspectiveCamera(.010,w/h,.1,4);
 const strip=new Uint8Array(8*4),reports=[],colors=new Set();
 try{
  const deadline=performance.now()+15000;
  while(!dome.material.uniforms.hasPhoto.value){
   if(performance.now()>deadline)throw Error('Sky photo failed to load');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  renderer.setRenderTarget(target);
  for(let azimuth=0;azimuth<360;azimuth+=15){
   let maxDelta=0;
   for(const elevation of [.035,.10,.18,.24,.30,.39,.52]){
    const a=T.MathUtils.degToRad(azimuth);
    camera.lookAt(Math.sin(a)*Math.cos(elevation),Math.sin(elevation),-Math.cos(a)*Math.cos(elevation));
    renderer.render(isolated,camera);
    renderer.readRenderTargetPixels(target,w/2-4,h/2,8,1,strip);
    colors.add(Array.from(strip.subarray(0,3)).join(','));
    for(let i=0;i<3;i++)maxDelta=Math.max(maxDelta,Math.abs(strip[i]-strip[7*4+i]));
   }
   reports.push({id:'sky-'+azimuth,azimuth,maxDelta,pass:maxDelta<=6});
  }
 }finally{renderer.setRenderTarget(null);harbor.dispose();target.dispose();renderer.dispose()}
 if(colors.size<24)throw Error('Sky render lacks the expected photographic detail');
 return reports;
}
