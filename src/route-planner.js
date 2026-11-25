import {buoyIds} from './marks.js';
import {fixturePosition} from './contacts.js';
import {isSideKind} from './commands.js';

// Bounds for the vessel centre, in the same metres as the simulator and harbor meshes.
export const waterBounds={minX:-36,maxX:36,minZ:-28,maxZ:31};
const length=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const onWater=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&
  p.x>=waterBounds.minX&&p.x<=waterBounds.maxX&&p.z>=waterBounds.minZ&&p.z<=waterBounds.maxZ;
const atBearing=(p,a,r)=>({x:p.x+Math.sin(a)*r,z:p.z+Math.cos(a)*r});
export const bearingFrom=(p,boat)=>Math.atan2(boat.x-p.x,boat.z-p.z);

function intersects(a,b,shape){
  if(shape.radius!==undefined){
    const dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz;
    const t=d2?Math.max(0,Math.min(1,((shape.x-a.x)*dx+(shape.z-a.z)*dz)/d2)):0;
    return (a.x+t*dx-shape.x)**2+(a.z+t*dz-shape.z)**2<=shape.radius**2;
  }
  let near=0,far=1;
  for(const [axis,lo,hi] of [['x',shape.minX,shape.maxX],['z',shape.minZ,shape.maxZ]]){
    const d=b[axis]-a[axis];
    if(Math.abs(d)<1e-10){if(a[axis]<lo||a[axis]>hi)return false;continue}
    const u=(lo-a[axis])/d,v=(hi-a[axis])/d;
    near=Math.max(near,Math.min(u,v));far=Math.min(far,Math.max(u,v));
    if(near>far)return false;
  }
  return true;
}

export class HarborNavigationMap {
  constructor(layout){
    this.obstacles=buoyIds.map(id=>({...layout[id],radius:3.15}));
    const rect=(x1,x2,z1,z2,pad)=>this.obstacles.push({
      minX:Math.min(x1,x2)-pad,maxX:Math.max(x1,x2)+pad,minZ:z1-pad,maxZ:z2+pad});
    for(const id of ['pier','wall']){
      const p=layout[id],side=Math.sign(p.x)||1,wood=id==='pier';
      const halfWidth=wood?1.375:2.3;
      rect(p.x+side*(wood?6.5:7.7),side*45,p.z-halfWidth,p.z+halfWidth,1.4);
      const f=fixturePosition(p,id);
      rect(f.x-1.12,f.x+1.12,f.z-.85,f.z+.85,1.05);
    }
    for(const id of ['east','west']){
      const p=layout[id],z=p.z+6.65;
      rect(p.x-3.7,p.x+3.7,z-1.875,z+1.875,1.3);
      rect(p.x-1.28,p.x+1.28,z,39,1.3);
      this.obstacles.push({...fixturePosition(p,id),radius:1.3});
    }
    this.graph=null;
  }
  clear(a,b){return onWater(a)&&onWater(b)&&!this.obstacles.some(o=>intersects(a,b,o))}
  buildGraph(){
    const candidates=[];
    for(const o of this.obstacles){
      if(o.radius!==undefined){
        for(let i=0;i<12;i++)candidates.push(atBearing(o,i*Math.PI/6,o.radius/Math.cos(Math.PI/12)+.65));
      }else{
        for(const x of [o.minX-.7,o.maxX+.7])for(const z of [o.minZ-.7,o.maxZ+.7])candidates.push({x,z});
      }
    }
    const nodes=candidates.filter(p=>this.clear(p,p));
    const edges=nodes.map(()=>[]);
    for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++){
      if(this.clear(nodes[i],nodes[j])){edges[i].push(j);edges[j].push(i)}
    }
    this.graph={nodes,edges};
  }
  // A* on a visibility graph. Start and goal are exact continuous coordinates.
  findPath(start,end){
    if(!this.clear(start,start)||!this.clear(end,end))return null;
    const origin={x:start.x,z:start.z};
    if(this.clear(origin,end))return [origin,end];
    if(!this.graph)this.buildGraph();
    const {nodes,edges}=this.graph,source=nodes.length,goal=source+1;
    const points=[...nodes,origin,end];
    const cost=points.map(()=>Infinity),parent=points.map(()=>-1),open=new Set([source]);
    cost[source]=0;
    while(open.size){
      let current=-1,best=Infinity;
      for(const i of open){
        const f=cost[i]+length(points[i],end);
        if(f<best){best=f;current=i}
      }
      if(current===goal){
        const path=[];
        for(let i=goal;i!==-1;i=parent[i])path.push(points[i]);
        return path.reverse();
      }
      open.delete(current);
      const neighbors=current===source?nodes.map((_,i)=>i).filter(i=>this.clear(origin,nodes[i])):edges[current];
      const next=current!==source&&this.clear(points[current],end)?[...neighbors,goal]:neighbors;
      for(const i of next){
        const g=cost[current]+length(points[current],points[i]);
        if(g>=cost[i])continue;
        cost[i]=g;parent[i]=current;open.add(i);
      }
    }
    return null;
  }
}

function taskPath(map,layout,start,task,side,originAngle,gateEntry){
  if(task.kind==='gate'){
    const red=layout.gateRed,green=layout.gateGreen;
    const middle={x:(red.x+green.x)/2,z:(red.z+green.z)/2};
    const sign=gateEntry?.side??(start.z>=middle.z?1:-1);
    const entry={x:middle.x,z:middle.z+sign*2.5},exit={x:middle.x,z:middle.z-sign*2.5};
    if(gateEntry?.passed)return map.findPath(start,exit);
    const approach=map.findPath(start,entry);
    return approach&&map.clear(entry,exit)?[...approach,exit]:null;
  }
  const point=layout[task.target];
  if(!point)return null;
  const origin=side?originAngle:bearingFrom(point,start);
  const radius=side?4.8:task.kind==='berth'?1.35:4.2;
  const offsets=side?[1.37,-1.37,1.77,-1.77,2.15,-2.15,Math.PI]:
    [0,.26,-.26,.52,-.52,.79,-.79,1.05,-1.05,1.57,-1.57,2.1,-2.1,2.62,-2.62,Math.PI];
  const sign=side&&point.x>0?-1:1;
  for(const offset of offsets){
    const path=map.findPath(start,atBearing(point,origin+sign*offset,radius));
    if(path)return path;
  }
  return null;
}

export function planHarborRoute(map,layout,start,tasks,firstAngles={},activeSideOrigin=null,approved=false,gateEntry=null){
  const legs=[],angles={...firstAngles};
  let from=start,total=0;
  for(const [index,task] of tasks.entries()){
    // Drifting targets acquire their own route when the preceding leg finishes.
    if(task.kind==='cleanup')break;
    const point=layout[task.target];
    const side=isSideKind(task.kind)&&(!task.conditional||(index===0&&approved));
    const origin=index===0&&activeSideOrigin!=null?activeSideOrigin:angles[task.target]??(point?bearingFrom(point,from):0);
    const points=taskPath(map,layout,from,task,side,origin,index===0?gateEntry:null);
    if(!points)return {legs:[],distance:0,blocked:task};
    for(let i=1;i<points.length;i++)total+=length(points[i-1],points[i]);
    from=points.at(-1);legs.push({target:task.target,points});
    if(task.kind==='photo'&&!task.conditional)angles[task.target]=bearingFrom(point,from);
  }
  return {legs,distance:total,blocked:null};
}
