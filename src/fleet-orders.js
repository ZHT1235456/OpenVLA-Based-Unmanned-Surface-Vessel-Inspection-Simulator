import {buoyAction,cameraDenialOnly,cleanupWords,conditional,conditionalAction,isPhotoKind,isSideKind,orderClauses,photoIntent,planCommand,tiltConsequence} from './commands.js';
import {MARKS,groundMarker,namedPlaces} from './marks.js';

export const otherBoat = id => id === 'A' ? 'B' : 'A';
export const homeBerth = id => id === 'A' ? 'east' : 'west';
const inspect = (target,kind) => ({target,kind,conditional:false,framing:false});
const berth = id => ({target:homeBerth(id), kind:'berth', conditional:false, framing:false});
const replace = tasks => ({op:'replace',tasks});
function normalized(raw){
 return raw.trim().replace(/[Ａａ]/g,'A').replace(/[Ｂｂ]/g,'B')
   .replace(/(?:一|1|壹)号(?:无人)?[艇船]|甲艇/g,'A艇')
   .replace(/(?:二|2|贰)号(?:无人)?[艇船]|乙艇/g,'B艇')
   .replace(/([ab])\s*(?:号)?\s*(?:无人)?[艇船]/gi,(_,s)=>s.toUpperCase()+'艇')
   .replace(/(?:A艇\s*(?:和|与|及|、)\s*B艇|B艇\s*(?:和|与|及|、)\s*A艇)/g,'双艇');
}
const team = /双艇|两(?:艘)?(?:无人)?[艇船]|全队|编队|协作|协同|分头|分别巡检|接力/;
const onlyStops=/^(?:请)?(?:所有|双艇|两艇|全队|编队)?(?:都|一起|同时)?(?:先)?(停船|暂停(?:任务|航行)?|停止航行|继续(?:任务|航行|巡检)?|恢复(?:任务|航行)?|取消任务)$/;
function fleetReturn(s){
 return /返航|回港|回泊位|(?:返回|回到|回)各自.*泊位/.test(s)&&!/栈|堤|查|拍|先|标|巡检|观察/.test(s);
}
function partsByVessel(text){
 const matches=[...text.matchAll(/([AB])艇\s*(?:负责|请)?/g)];
 return matches.map((m,i)=>({id:m[1],text:text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).replace(/^[，,、；;：:\s]+|[，,、；;和与\s]+$/g,'')}));
}
function contextFor(fleet,id){
 const r=fleet.boats[id];
 if(!r)return {};
 const received=[...fleet.inbox[id].values()],latest=received.at(-1);
 const ownLast=r.done.findLast(t=>MARKS[t.physical]);
 const last=latest&&latest.time>(ownLast?.time??-1)?latest.target:r.last;
 return {active:r.active,queue:r.queue,last,lastTilt:r.lastTilt||received.findLast(p=>p.tilted)?.target};
}
function planFor(fleet,id,text,classify){
 // Resolve an unqualified return against the launch berth of the addressed vessel.
 const own=homeBerth(id)==='west'?'西泊位':'东泊位';
 const expanded=text.replace(/(?:回到|返回|回)(?:各自|自己|自己的|本艇)泊位|(?:返航|回港|回家|回起点)(?![东西]|至|到)/g,'返回'+own);
 const ctx=contextFor(fleet,id);
 if(cameraDenialOnly(expanded)){
   // An amendment may reach the shore station before the previous order reaches the vessel.
   let stops=[ctx.active,...ctx.queue].filter(Boolean);
   for(const p of fleet.outbox){
     if(p.type!=='ORDER'||p.to!==id||p.data.generation!==fleet.generation[id])continue;
     const plan=p.data.plan;
     if(plan.op==='replace')stops=plan.tasks;
     if(plan.op==='append')stops=[...stops,...plan.tasks];
     if(plan.op==='cancel'||plan.op==='standby')stops=[];
   }
   ctx.active=stops[0];ctx.queue=stops.slice(1);
 }
 return planCommand(expanded,ctx,classify);
}
function teamMarkerIds(part,all){
 const mark=groundMarker(part);
 if(mark?.error)return all&&mark.candidates?{ids:mark.candidates}:{error:mark.error};
 if(mark)return {ids:[mark.target]};
 return {ids:namedPlaces(part).filter(place=>place==='pier'||place==='wall')};
}
function teamMarkers(text){
 const actions=new Map(),branches=new Map();
 let pending=null;
 for(const clause of orderClauses(text)){
   if(pending||conditional.test(clause)){
     const consequence=pending?clause:tiltConsequence(clause);
     if(consequence===null)return {error:'请写明可判断的持续倾斜条件。'};
     const mark=groundMarker(clause);
     if(mark?.error)return {error:mark.error};
     const targets=pending||(mark?[mark.target]:[...actions.keys()]);
     if(!targets.length||targets.some(id=>!actions.has(id)))return {error:'请先指定分工巡检的两座浮标。'};
     const kind=conditionalAction(consequence);
     if(kind){for(const id of targets)branches.set(id,kind);pending=null}else pending=targets;
     continue;
   }
   const all=/两[座枚个处颗]|所有|两边|两处|每[座颗个]/.test(clause);
   const parts=clause.split(/[、和与及]/).filter(Boolean).map(part=>({part,...teamMarkerIds(part,all)}));
   const invalid=parts.find(p=>p.error);
   if(invalid)return {error:invalid.error};
   // A shared verb applies to a list (“给红标和绿标拍照”). Separately phrased actions keep their own scope.
   const hasVerb=part=>photoIntent(part)!=='unspecified'||/巡检|检查|观察|查看|复核/.test(part);
   const separate=parts.filter(p=>p.ids.length&&hasVerb(p.part)).length>1;
   const ids=parts.flatMap(p=>p.ids);
   if(!ids.length){
     if(all&&!actions.size){actions.set('pier','approach');actions.set('wall','approach')}
     if(hasVerb(clause))for(const id of actions.keys())actions.set(id,buoyAction(clause));
     continue;
   }
   if(/只(?:给|拍摄?|对).*标/.test(clause)&&photoIntent(clause)==='requested'){
     for(const [id,kind] of actions)if(!ids.includes(id)&&isPhotoKind(kind))actions.set(id,isSideKind(kind)?'sideObserve':'approach');
   }
   for(const {part,ids:targets} of parts){
     const kind=buoyAction(separate?part:clause);
     for(const id of targets)actions.set(id,kind);
   }
 }
 if(pending)return {error:'请说明满足倾斜条件时要观察还是拍照。'};
 return actions.size===2?{ids:[...actions.keys()],actions,branches}:{error:'分工巡检请指定两座浮标。同查一座可选“接力复核”，也可用艇号单独派单。'};
}
export async function planFleetOrder(raw,fleet,selected,classify){
 const s=normalized(raw),direct=partsByVessel(s);
 const cooperative=team.test(s);
 const needsDual=cooperative||direct.some(c=>c.id==='B');
 const follow=direct[1]?.text;
 const implicitHandoff=direct.length===2&&/^(?:等首拍后|收到.*后)?(?:补拍|侧拍|换侧复核)/.test(follow)&&
   !groundMarker(follow)&&!namedPlaces(follow).length;
 if(implicitHandoff||cooperative&&/接力|转交.*补拍|另(?:一艘|一条)艇.*补拍/.test(s)){
   const first=direct.find(part=>/先(?:查|检查|拍|观察|巡检)|负责首拍/.test(part.text))||direct[0];
   const source=first?.id||'A',receiver=otherBoat(source);
   if(direct.length>1&&new Set(direct.map(part=>part.id)).size<2)return {error:'接力复核需要两艘不同的艇。'};
   const roles=s.split(/另(?:一艘|一条|一[艇船])(?:无人)?[艇船]?|第二艘(?:无人)?[艇船]|后艇|接力艇/);
   const subject=first?.text||orderClauses(roles[0]).find(t=>namedPlaces(t).length||/浮标|[红绿黄]标/.test(t))||roles[0];
   const planned=await planCommand(subject,contextFor(fleet,source),classify);
   if(planned.error)return planned;
   const lead=planned.tasks?.findLast(t=>MARKS[t.target]);
   if(!lead)return {error:'请指定首艇要巡检的浮标。'};
   const target=lead.target;
   for(const fragment of s.split(/[，,；;。]/)){
     const mark=groundMarker(fragment,target);
     if(mark?.error)return {error:mark.error};
     if(mark&&mark.target!==target)return {error:'接力两艇需要复核同一座浮标，请确认颜色和位置。'};
   }
   const followText=direct.find(part=>part.id===receiver)?.text??roles[1]??'复核';
   if(/(?:等(?:候)?|收到)(?:首拍|照片|影像)/.test(followText)&&!isPhotoKind(lead.kind))
     return {error:'接力指令要求收到照片，首艇当前只观察。请明确要求首艇拍照，或改为收到观测回报后复核。'};
   const followClauses=orderClauses(followText);
   const branch=followClauses.findIndex(c=>conditional.test(c));
   let followAction=buoyAction(followText);
   if(branch>=0){
     const consequence=tiltConsequence(followClauses[branch]);
     followAction=consequence===null?null:conditionalAction(consequence)||conditionalAction(followClauses[branch+1]||'');
     if(!followAction)return {error:'请说明接力复核的倾斜条件和后续动作。'};
   }
   const followKind=isPhotoKind(followAction)?'side':'sideObserve';
   const tasks=planned.tasks.map(t=>t===lead?{...t,handoffSource:true}:t);
   if(!tasks.some(t=>t.kind==='berth'))tasks.push(berth(source));
   return {kind:'relay',needsDual:true,source,receiver,target,followKind,conditional:branch>=0,
     assignments:[{id:source,plan:replace(tasks)},{id:receiver,plan:{op:'standby'}}]};
 }
 if(direct.length){
   const assignments=[];
   for(const chunk of direct){
     if(!chunk.text){return {error:'请在艇号后写明任务。'}}
     const plan=await planFor(fleet,chunk.id,chunk.text,classify);
     if(plan.error)return plan;
     assignments.push({id:chunk.id,plan});
   }
   return {kind:'addressed',needsDual,assignments};
 }
 if(cooperative){
   const short=s.replace(/[，,。、；;\s]/g,'').replace(/协作|协同/g,'').replace(/两(?:艘)?(?:无人)?[艇船]/g,'双艇');
   const action=short.match(onlyStops);
   if(action){const op=/停|暂停/.test(action[1])?'hold':/取消/.test(action[1])?'cancel':'resume';
     return {kind:'team',needsDual:true,assignments:['A','B'].map(id=>({id,plan:{op}}))};}
   const request=s.replace(/^(?:请)?(?:双艇|两(?:艘)?(?:无人)?[艇船]|全队|编队)(?:都|同时|一起)?/,'').replace(/[。！？!]+$/,'');
   if(cameraDenialOnly(request)||cleanupWords.test(request)){
     const assignments=[];
     for(const id of ['A','B']){
       const plan=await planFor(fleet,id,request,classify);
       if(plan.error)return plan;
       assignments.push({id,plan});
     }
     return {kind:'team',needsDual:true,assignments};
   }
   if(fleetReturn(short))return {kind:'team',needsDual:true,assignments:['A','B'].map(id=>({id,plan:replace([berth(id)])}))};
   if(/(?:不要|跳过|不用|暂缓|先别)(?:去|前往|检查|巡检|靠近)/.test(s)){
     const suggestion='双艇暂停';
     return {error:'请用艇号分别说明保留的任务，或发送“'+suggestion+'”。',suggestion};
   }
   const targets=teamMarkers(s);
   if(targets.error)return targets;
   const pairing=fleet.pairTargets(targets.ids);
   return {kind:'split',needsDual:true,assignments:['A','B'].map(id=>{
     const target=pairing[id],tasks=[inspect(target,targets.actions.get(target))];
     if(targets.branches.has(target))tasks.push({...inspect(target,targets.branches.get(target)),conditional:true});
     if(/返航|回港|各自.*泊位/.test(s))tasks.push(berth(id));
     return {id,plan:replace(tasks)};
   })};
 }
 const plan=await planFor(fleet,selected,s,classify);
 return plan.error?plan:{kind:'individual',needsDual:false,assignments:[{id:selected,plan}]};
}
