import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {armBase,armLinks,armJoints} from './shore-arm.js';

const amber=0xde8735, enamel=0xe6a44e, iron=0x334348, rubber=0x233237, steel=0xa4b2af;
const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.52,metalness:.27});
const quarter=Math.PI/2;

// Each rigid assembly is one mesh. Only the joints and the two jaws move.
function assembly(build){
  const parts=[];
  function part(geometry,color,x,y,z,rx=0,rz=0){
    geometry.rotateX(rx);geometry.rotateZ(rz);geometry.translate(x,y,z);
    const shade=new T.Color(color),colors=new Float32Array(geometry.attributes.position.count*3);
    for(let j=0;j<colors.length;j+=3)shade.toArray(colors,j);
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));parts.push(geometry);
  }
  const box=(c,x,y,z,w,h,d)=>part(new T.BoxGeometry(w,h,d),c,x,y,z);
  const cylinder=(c,x,y,z,top,bottom,length,rx=0,rz=0,n=20)=>
    part(new T.CylinderGeometry(top,bottom,length,n),c,x,y,z,rx,rz);
  build(box,cylinder);
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
  const mesh=new T.Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;return mesh;
}

function boom(length,width){
  return assembly((box,cyl)=>{
    cyl(amber,0,0,length*.49,width*.46,width*.66,length*.86,quarter,0,8);
    for(const side of [-1,1]){
      box(enamel,side*width*.40,0,length*.43,width*.17,width*.67,length*.65);
      cyl(iron,side*width*.28,-width*.41,length*.39,.082,.082,length*.47,quarter);
      cyl(steel,side*width*.28,-width*.41,length*.72,.046,.046,length*.23,quarter);
    }
    cyl(iron,0,0,0,width*.66,width*.66,width*1.22,0,quarter);
    for(const side of [-1,1]){
      cyl(enamel,side*width*.63,0,0,width*.48,width*.48,.055,0,quarter);
      cyl(steel,side*width*.69,0,0,width*.20,width*.20,.065,0,quarter,8);
    }
  });
}

export function makeShoreArm(){
  const root=new T.Group(),turntable=new T.Group();
  const base=assembly((box,cyl)=>{
    box(iron,0,1.19,0,1.16,.14,1.12);
    for(const x of [-.46,.46])for(const z of [-.43,.43])cyl(steel,x,1.28,z,.064,.064,.09,0,0,6);
    cyl(amber,0,1.49,0,.41,.53,.43);
    cyl(rubber,0,1.72,0,.45,.45,.095);
    cyl(steel,0,1.79,0,.42,.43,.065);
  });
  base.position.set(armBase.x,0,armBase.z);root.add(base,turntable);
  turntable.position.set(armBase.x,0,armBase.z);
  turntable.add(assembly((box,cyl)=>{
    cyl(amber,0,1.86,0,.40,.43,.13);
    for(const s of [-1,1])box(amber,s*.31,2.01,0,.17,.34,.54);
  }));
  const upper=boom(armLinks.upper,.58),fore=boom(armLinks.fore,.40);
  turntable.add(upper,fore);upper.position.y=armBase.y;
  const tool=new T.Group();root.add(tool);
  tool.add(assembly((box,cyl)=>{
    cyl(iron,0,armLinks.tool,0,.19,.19,.43,0,quarter);
    cyl(steel,0,.425,0,.105,.125,.24);
    box(iron,0,.28,0,.26,.19,.76);
    box(enamel,0,.38,0,.25,.045,.50);
    box(steel,0,.19,0,.11,.06,.82);
  }));
  const jaws=[-1,1].map(side=>{
    const jaw=assembly((box)=>{
      box(iron,0,.17,side*.045,.165,.19,.17);
      box(enamel,0,.046,side*.064,.155,.20,.075);
      box(rubber,0,.013,side*.016,.166,.135,.032);
    });
    tool.add(jaw);return jaw;
  });
  return {root,update(arm){
    const {tip,gap,yaw}=arm.pose,j=armJoints(tip);
    turntable.rotation.y=j.yaw;
    upper.rotation.x=-Math.atan2(j.elbowY-armBase.y,j.elbowR);
    fore.position.set(0,j.elbowY,j.elbowR);
    fore.rotation.x=-Math.atan2(j.wristY-j.elbowY,j.radius-j.elbowR);
    tool.position.set(tip.x,tip.y,tip.z);tool.rotation.y=yaw;
    jaws[0].position.z=-gap/2;jaws[1].position.z=gap/2;
  }};
}
