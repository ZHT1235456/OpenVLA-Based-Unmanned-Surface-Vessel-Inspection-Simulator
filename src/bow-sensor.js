import * as T from 'three';

// Fixed optics for the forward water-facing camera, independent of window dimensions.
export const sensorWidth=128, sensorHeight=80, sensorPitch=.52, sensorFov=60;
const mount=.36, altitude=1.24;
const focal=sensorHeight/(2*Math.tan(T.MathUtils.degToRad(sensorFov/2)));

export function waterPoint(boat,u,v){
  const ray=(v-.5)*sensorHeight/focal, down=Math.sin(sensorPitch)+ray*Math.cos(sensorPitch);
  if(down<=.02)return null;
  const depth=(altitude-.09)/down;
  const ahead=mount+depth*(Math.cos(sensorPitch)-ray*Math.sin(sensorPitch));
  const side=(u-.5)*sensorWidth/focal*depth;
  return {x:boat.x+ahead*Math.sin(boat.yaw)+side*Math.cos(boat.yaw),
    z:boat.z-ahead*Math.cos(boat.yaw)+side*Math.sin(boat.yaw)};
}

export class BowSensor{
  constructor(){
    this.camera=new T.PerspectiveCamera(sensorFov,sensorWidth/sensorHeight,.10,520);
    this.target=new T.WebGLRenderTarget(sensorWidth,sensorHeight);
    this.target.texture.colorSpace=T.SRGBColorSpace;
    this.buffer=new Uint8Array(sensorWidth*sensorHeight*4);
  }
  pose(cam,boat){
    const s=Math.sin(boat.yaw),c=Math.cos(boat.yaw);
    cam.position.set(boat.x+mount*s,altitude,boat.z-mount*c);
    cam.up.set(0,1,0);cam.lookAt(cam.position.x+s,altitude-Math.tan(sensorPitch),cam.position.z-c);
    cam.updateMatrixWorld();
  }
  read(view,run){
    view.updateObjects();this.pose(this.camera,run.boat);
    const renderer=view.bow, previous=renderer.getRenderTarget(),hull=view.models[run.id||'A'];
    const visible=hull.visible;
    try{
      hull.visible=false;renderer.setRenderTarget(this.target);renderer.render(view.scene,this.camera);
      renderer.readRenderTargetPixels(this.target,0,0,sensorWidth,sensorHeight,this.buffer);
    }finally{renderer.setRenderTarget(previous);hull.visible=visible}
    const rgb=new Uint8Array(sensorWidth*sensorHeight*3);
    for(let y=0;y<sensorHeight;y++)for(let x=0;x<sensorWidth;x++){
      const src=((sensorHeight-1-y)*sensorWidth+x)*4,dst=(y*sensorWidth+x)*3;
      rgb[dst]=this.buffer[src];rgb[dst+1]=this.buffer[src+1];rgb[dst+2]=this.buffer[src+2];
    }
    return rgb;
  }
}
