import {MARKS,buoyIds as buoys,groundMarker,isGateMark,joinMarkerDescriptions} from './marks.js';
import {litterNames} from './cleanup.js';
export const names={...litterNames,...Object.fromEntries(buoys.map(id=>[id,MARKS[id].name])),east:'东泊位',west:'西泊位',gate:'浮标门'};
const hold=/^(请|先|现在|立即|马上|原地|给我|把船)?(暂停(任务|航行)?|停船|停下(来)?|停一下|等一下|等等|停车|别动|停止航行|等待)(吧|一下|。)?$/;
const resume=/^(请|现在|可以|接着)?(继续(刚才的)?(任务|航行|巡检)?|恢复(航行|任务)?|接着走|走吧)(吧|。)?$/;
export const conditional=/如果|假如|要是|若是?|只要|只有|只在|持续倾斜才|一直歪.*才/;
const tilt=/倾斜|歪|斜标|斜了/;
const sidePosition=/侧面|另(?:一|外一)侧|另一面|换[^，,。；;]{0,6}(?:面|侧|角度)|绕到|绕行观察/;
const retake=/侧拍|补拍|复拍|补(?:一?张|照)|也拍进/;
const noPhoto=/(?:不要|不用|不必|不需(?:要)?|不准|不许|不能|不得|不允许|不要求|没有要求|没要求|禁止|严禁|取消|停止|跳过|避免|无需|无须|(?<![分识区特])别|勿)(?:(?!但|改为|只要|然后|，|,|。|；|;).){0,18}(?:拍|照相|摄影|留影|合影|合照|快门|存照|留照|补一?张)|不(?:再|想|打算|主动|擅自|进行)?(?:拍|补拍|侧拍|照相|留影|摄影|按快门|存照|留照)|关闭(?:相机|快门)|免拍/;
const observe=/观察|查看|检查|巡检|复核|抵近|靠近|接近|只看|仅看|看一眼|看一下|看看/;
const photoVerb=/拍(?:照|摄|下|到|进|一|张|两|几|个|些|全景|特写|近景|侧面|水线|[红绿黄木石栈防浮航这那它]|$)|补拍|侧拍|复拍|首拍|照相|留影|合影|合照|摄影|按(?:下)?快门|(?:留|补|照|来)(?:上)?[一两几\d]?张(?=$|照片?|相片|全景|侧面|特写|近景|吧)|用照片(?:记录|取证)/;
const cameraNoun=/(?:照相|摄影)机|摄影师|(?:拍照|拍摄|摄影|首拍|补拍)(?:地点|平台|点|区|位|设备|功能|模式|记录|历史|效果|时间|情况|状态|结果|作品|人员|中的|时的)/g;
const priorPhoto=/(?:拍摄?|拍照|补拍)(?:(?:下|到)(?:了的?|的)|(?:过|完|好)(?:了)?的?|的)|(?:收到|等候|等待|等)(?:首拍|照片)(?:以?后)?/g;
const photoQuestion=/(?:是否|要不要|需不需要|能不能|可不可以)(?:(?!并|然后|接着|再给|，|,|。|；|;).){0,20}?(?:补拍|拍照|拍摄|照相|按快门)/g;
const observedPhotographer=/(?:游客|工作人员|行人|摄影师)(?:在|正在|们在)?(?:拍照|摄影|拍摄|照相)/g;
const defer=/留[到给着]|回程|回头再|回来再|稍后再|最后再|待会再/;
const targetWords=/栈|木桥|木头|木质|木制|木平台|码头|堤|石墙|防波|防浪|消波|泊|东岸|西岸|停靠点|这座|这颗|那座|另一[座颗枚个]|另一边的标|另外|浮标|黄标|航标|上一|刚才|原来|眼前|当前|标体|它|港/;
function unique(tasks){return tasks.filter((t,i)=>i===0||t.target!==tasks[i-1].target||t.kind!==tasks[i-1].kind||t.conditional!==tasks[i-1].conditional||t.berth!==tasks[i-1].berth)}
export const isPhotoKind=kind=>kind==='photo'||kind==='side';
export const isSideKind=kind=>kind==='side'||kind==='sideObserve';
export function photoIntent(clause){
 if(noPhoto.test(clause))return 'denied';
 const actions=clause.replace(observedPhotographer,' ').replace(cameraNoun,' ').replace(priorPhoto,' ').replace(photoQuestion,' ');
 return photoVerb.test(actions)?'requested':'unspecified';
}
export function cameraDenialOnly(clause){
 return photoIntent(clause)==='denied'&&!conditional.test(clause)&&!observe.test(clause)&&
   !/[,，;；。]|前往|去|驶|到达|经过|穿过|航行|返航|停船|停靠/.test(clause);
}
export function buoyAction(clause){
 const shoot=photoIntent(clause)==='requested';
 if(sidePosition.test(clause))return shoot?'side':'sideObserve';
 if(shoot)return retake.test(clause)?'side':'photo';
 return 'approach';
}
export function describe(t){if(!t)return '等待巡检指令';if(t.kind==='cleanup')return t.target==='unload'?'返港卸载':'清漂 · '+names[t.target];const verbs={photo:'全景拍照',side:t.framing?'带地标补拍':'换侧补拍',approach:'抵近观察',sideObserve:'换侧观察',berth:'返航靠泊',gate:'穿过浮标门'};return (t.conditional?'倾斜时 · ':'')+names[t.target]+' · '+verbs[t.kind]}
const collectVerb=/清漂|清(?:理|除|扫|捞)|打捞|捞(?:起|取|走)?|回收|收集|收取|捡(?:拾|起|取)|拾取|只收|仅收/;
export const cleanupWords=/清漂|清理|清除|清扫|清捞|打捞|捞起|回收|收集|捡拾|塑料瓶|瓶子|泡沫|漂浮物|漂浮垃圾|卸[货载]/;
const unloadWords=/卸[货载]/;
const typeToken=/塑料瓶(?:子)?|饮料瓶|矿泉水瓶|空瓶|瓶子|泡沫(?:塑料)?(?:块)?/g;
function cleanupClause(clause){
 if(!collectVerb.test(clause)&&!unloadWords.test(clause))return null;
 const berth=clause.includes('东泊位')?'east':clause.includes('西泊位')?'west':null;
 const specified=berth?{berth}:{};
 const error={error:'清漂可收集塑料瓶和泡沫块。请写明要收集的类别或发送“清理所有水面漂浮物”。'};
 // Reject unrecognized restrictions instead of broadening the set of items to collect.
 const exclusions=new Set(),included=new Set();
 const typeOf=name=>name.startsWith('泡沫')?'foam':'bottle';
 const positive=clause.replace(/(?:不要|不用|不必|不|别|跳过|留下|保留)(?:去)?(?:打捞|回收|收集|捞|收)?(塑料瓶(?:子)?|饮料瓶|矿泉水瓶|空瓶|瓶子|泡沫(?:塑料)?(?:块)?)/g,
   (_,name)=>{exclusions.add(typeOf(name));return ''});
 const permittedLimits=/(?:不要|不用|不|别)拍照|(?:不要|别)碰(?:浮标|航标)/g;
 if(/不要|禁止|停止|取消|别|不再|勿|[不没]收/.test(positive.replace(permittedLimits,'')))return error;
 const stripped=positive.replace(typeToken,name=>{included.add(typeOf(name));return ''})
   .replace(permittedLimits,'')
   .replace(/清理|清除|清扫|清捞|清漂|打捞|捞起|捞取|捞走|回收|收集|收取|捡拾|捡起|捡取|拾取|干净/g,'')
   .replace(/漂浮物|漂浮垃圾|水面垃圾|垃圾|漂浮着?|漂着|港池|水域|水面|海面|所有|全部|两类|两种/g,'')
   .replace(/东泊位|西泊位|自己的泊位|各自泊位|码头|泊位|靠岸|返航|回港|返回|回到|卸载|卸货|装满|满舱|满载|满了|船舱|货舱/g,'')
   .replace(/协同|协作|分头|一起|同时|帮我|请把|然后|之后|先去|前往|清空|[仅只全都也和与及、的将把先请去上下里中再就后时回至到并收捞艇舱吧]/g,'').trim();
 if(stripped||included.size&&[...included].some(t=>exclusions.has(t)))return error;
 if(!collectVerb.test(positive)&&unloadWords.test(positive))return subtask('unload','cleanup',specified);
 if(!collectVerb.test(positive)&&!included.size)return error;
 const generic=/清漂|漂浮物|垃圾/.test(positive);
 if(!generic&&!included.size)return error;
 const kinds=[...(included.size?included:['bottle','foam'])].filter(t=>!exclusions.has(t));
 return kinds.length?subtask(kinds.length===2?'litter':kinds[0],'cleanup',specified):error;
}
function subtask(target,kind,extra={}){return {target,kind,conditional:false,framing:false,...extra}}
function resolve(label,ctx,reference){
 if(buoys.includes(label)||['east','west'].includes(label))return label;
 if(label==='current')return reference||ctx.last;
 if(label==='previous')return ctx.last||reference;
 if(label==='other'&&buoys.includes(reference||ctx.last)){
   const prior=reference||ctx.last;
   return buoys.find(x=>x!==prior&&isGateMark(x)===isGateMark(prior));
 }
 return null;
}
async function identify(s,ctx,ref,classify){
 const answer=await classify(s);
 if(/刚才|刚刚|先前|上次|上一个|上一[座颗]|原来/.test(s))return /斜|歪/.test(s)&&ctx.lastTilt?ctx.lastTilt:resolve('previous',ctx,ref);
 if(/另一[座颗枚个边]|另外(?!.*(堤|栈))|别的那[座颗枚个]|对面那|剩下|余下/.test(s))return resolve('other',ctx,ref);
 if(/^(就|请|先|给|把|看看|拍|如果|若)?(它|这座|这颗|眼前|当前)/.test(s))return resolve('current',ctx,ref);
 if(!targetWords.test(s)||answer.confidence<.52||answer.target==='unknown')return null;
 // A plain yellow marker is ambiguous when both visible contacts match it.
 if(/^(去|靠近|拍|查|检查|观察|给)?(一[个座枚颗])?(黄色)?(黄标|浮标|航标)(拍照|照相|一下)?$/.test(s))return null;
 return resolve(answer.target,ctx,ref);
}
export function orderClauses(text){
 const parts=text.replace(/然后|接着再|之后再|最后|随后/g,',$&')
   .replace(/如果|假如|要是|若是?|只有|只在/g,',$&').split(/[,，。；;\n]+/);
 const clauses=parts.flatMap(part=>{
   const line=part.trim().replace(/^(?:然后|接着再|之后再|最后|随后)/,'');
   return line.replace(/再(?=去|查|到|回|给|观察|检查|拍)/g,(word,index)=>{
     const before=line.slice(0,index);
     if(!before||conditional.test(before)||/不(?:要|用|需(?:要)?|必)?|别|禁止|无需|勿|回程|回头|回来|稍后|待会/.test(before))return word;
     if(line.startsWith('再拍',index)&&sidePosition.test(before))return word;
     return ',再';
   }).split(',');
 }).filter(Boolean);
 return joinMarkerDescriptions(clauses);
}

export function tiltConsequence(clause){
 const predicate=clause.match(/倾斜|歪(?:斜|着|了)?|斜标|斜了/);
 if(!predicate||/(?:未|没(?:有)?|不再|不)(?:发生|持续)?(?:倾斜|歪)/.test(clause))return null;
 return clause.slice(predicate.index+predicate[0].length);
}

export function conditionalAction(consequence){
 return photoIntent(consequence)!=='unspecified'||sidePosition.test(consequence)||observe.test(consequence)||/报告|汇报|上报/.test(consequence)
   ?buoyAction(consequence):null;
}

function addConditionalTask(tasks,condition,kind){
 if(!condition.all){tasks.push(subtask(condition.target,kind,{conditional:true}));return}
 const added=new Set();
 for(let i=tasks.length-1;i>=0;i--){
   const t=tasks[i];
   if(!MARKS[t.target]||t.conditional||added.has(t.target))continue;
   tasks.splice(i+1,0,subtask(t.target,kind,{conditional:true}));added.add(t.target);
 }
}

export async function planCommand(raw,ctx,classify){
 const text=raw.trim().replace(/[！!？?]+$/,'').replaceAll('，',',').replaceAll('。',';').replace(/[;,.]+$/,'');
 if(!text)return {error:'请输入一条巡检指令。'};
 if(hold.test(text))return {op:'hold'};
 if(resume.test(text))return {op:'resume'};
 if(/^(取消|清空|终止)(当前|全部|所有)?(巡检)?任务$/.test(text))return {op:'cancel'};
 if(/采水|取样|测温|抓取|起飞|钻入|天气|写诗|订餐/.test(text))return {error:'艇载设备支持航行、观察、拍照和水面清漂，请换成其中一项。'};
 let reference=(ctx.active?.kind!=='cleanup'&&ctx.active?.target)||ctx.last||null;
 const initial=reference,deferred=[],tasks=[];
 const appendPrefix=/^(?:追加(?:一项(?:任务)?)?|加一项(?:任务)?|接下来再|完成后再|拍完后再)[,、：:\s]*/;
 const append=appendPrefix.test(text);
 let pendingCondition=null,waitTraffic=false;
 const clauses=orderClauses(text.replace(appendPrefix,'').replace(/[,;；]\s*(?=(?:不要|不用|不|别|跳过|留下|保留)(?:收集|打捞|回收|收|捞)?(?:塑料瓶|瓶子|泡沫))/g,''));
 const protectedStops=new Set();
 const noPhotosThroughout=clauses.some(c=>/全程|整个(?:航程|任务)|所有(?:目标|浮标)/.test(c)&&photoIntent(c)==='denied');
 for(const clause of clauses){
   if(/^从.+(出发|起航)$/.test(clause))continue;
   const previous=tasks.at(-1),intent=photoIntent(clause);
   if(previous?.kind==='cleanup'&&/^(?:不要|别)碰(?:浮标|航标)$/.test(clause))continue;
   const clean=cleanupClause(clause);
   if(clean){
     if(clean.error)return clean;
     if(previous?.kind==='cleanup'&&clean.target==='unload'){
       if(clean.berth)previous.berth=clean.berth;
     }else tasks.push(clean);
     continue;
   }
   if(cleanupWords.test(clause))return {error:'请写明清漂动作，例如“只收集泡沫块”。'};
   const group=/每[座颗个处]|两座都|全程|每个标/.test(clause);
   const grounded=groundMarker(clause,reference);
   if(clauses.length===1&&cameraDenialOnly(clause)){
     if(grounded?.error)return {error:grounded.error};
     const scoped=grounded?.target||(targetWords.test(clause)?await identify(clause,ctx,reference,classify):null);
     const pending=[ctx.active,...(ctx.queue||[])].filter(Boolean);
     if(!pending.length)return {op:'cancel'};
     const tasks=pending.map(t=>isPhotoKind(t.kind)&&(!scoped||scoped===t.target)
       ?{...t,kind:isSideKind(t.kind)?'sideObserve':'approach',framing:false}:t);
     return {op:'replace',tasks:unique(tasks),preserveHold:true};
   }
   if(clauses.length>1&&!pendingCondition&&intent==='denied'&&!previous&&!grounded&&!targetWords.test(clause))continue;
   if(!pendingCondition&&!conditional.test(clause)&&!group&&/^(?:请)?(?:先)?(?:不要|别|不用|暂缓|跳过)(?:去|给|检查|查|拍|靠近|巡检)/.test(clause)){
     if(clauses.length===1)return {op:'hold'};
     if(previous&&MARKS[previous.target]&&intent==='denied'&&(grounded?.target===previous.target||/给它|拍它/.test(clause))){
       previous.kind=isSideKind(previous.kind)?'sideObserve':'approach';previous.framing=false;protectedStops.add(previous);continue;
     }
     if(!(previous&&intent==='denied'&&!targetWords.test(clause)&&!/[标艇]/.test(clause)))continue;
   }
   if(grounded?.error)return {error:grounded.error};
   const marker=grounded?.target;
   if(pendingCondition){
     if(marker&&!pendingCondition.all&&marker!==pendingCondition.target)return {error:'条件中提到的浮标和执行目标不同，请分别说明。'};
     const kind=conditionalAction(clause);
     if(!kind)return {error:'请说明满足倾斜条件时要观察还是拍照。'};
     addConditionalTask(tasks,pendingCondition,kind);pendingCondition=null;continue;
   }
   if(conditional.test(clause)){
     const consequence=tiltConsequence(clause);
     if(consequence===null)return {error:'目前可判断浮标是否持续倾斜，请写明巡检条件和动作。'};
     const specific=marker||(/栈|堤|石墙|木桥/.test(clause)?await identify(clause,ctx,reference,classify):null);
     const all=!specific&&(group||/哪[座个颗]|任何|有.*标/.test(clause));
     const target=specific||reference;
     if(all?!tasks.some(t=>MARKS[t.target]):!MARKS[target])return {error:'请指定要测量倾斜的浮标。'};
     const condition={all,target},kind=conditionalAction(consequence);
     if(kind)addConditionalTask(tasks,condition,kind);else pendingCondition=condition;
     continue;
   }
   if(group&&tasks.length){
     const kind=buoyAction(clause);
     if(intent!=='unspecified'||observe.test(clause)){
       for(const stop of [...tasks,...deferred]){
         if(!MARKS[stop.target]||stop.conditional||(isPhotoKind(kind)&&protectedStops.has(stop)))continue;
         stop.kind=kind;stop.framing=false;
         if(intent==='denied')protectedStops.add(stop);
       }
     }
     continue;
   }
   if(previous&&!targetWords.test(clause)&&!/[标艇]/.test(clause)&&
      (intent==='denied'||/(?:只|仅)(?:需|要)?(?:观察|靠近|看)/.test(clause))){
     if(MARKS[previous.target]){
       previous.kind=isSideKind(previous.kind)?'sideObserve':'approach';previous.framing=false;protectedStops.add(previous);
     }
     continue;
   }
   if(/(保洁船|作业船|来船|让行|让船)/.test(clause)&&!/栈|堤/.test(clause)){waitTraffic=true;continue}
   if(/带上|带进|也拍进|同框|拍进去/.test(clause)&&previous&&MARKS[previous.target]){
     if(intent!=='denied'&&(isPhotoKind(previous.kind)||intent==='requested')){
       if(!isPhotoKind(previous.kind))previous.kind=isSideKind(previous.kind)?'side':'photo';
       previous.framing=true;
     }
     continue;
   }
   if(!marker&&/浮标门|航标门|红绿.*门/.test(clause)){
     if((intent==='requested'||observe.test(clause))&&!/穿|通过|经过/.test(clause))return {error:'浮标门有红标和绿标，请指定要巡检的颜色。'};
     tasks.push(subtask('gate','gate'));continue;
   }
   if(initial&&clauses.length>1&&/先别拍|暂时别拍|先不拍|先缓一缓/.test(clause)&&!marker&&!/栈|堤/.test(clause))continue;
   if(initial&&/^(?:回来|回程|回头|稍后)再补$/.test(clause)){
     const postponed=isPhotoKind(ctx.active?.kind)&&/先别拍|先不拍|暂时别拍/.test(text);
     deferred.push(subtask(initial,postponed?ctx.active.kind:'approach'));continue;
   }
   if(defer.test(clause)&&!/回[东西]|返航/.test(clause)){
     const target=marker||(targetWords.test(clause)?await identify(clause,ctx,initial,classify):initial);
     if(target)deferred.push(subtask(target,MARKS[target]?buoyAction(clause):'berth'));
     continue;
   }
   let target=marker||(targetWords.test(clause)?await identify(clause,ctx,reference,classify):null);
   if(!target&&reference&&(intent!=='unspecified'||observe.test(clause)||sidePosition.test(clause)||/停稳/.test(clause)))target=reference;
   if(!target&&/(返航|回港|回家|回起点)/.test(clause))target='east';
   if(!target)return {error:'这句指令的目标不明确，请指定木栈桥、防波堤、东泊位或西泊位。'};
   const kind=MARKS[target]?buoyAction(clause):'berth';
   const stop=subtask(target,kind,{framing:isPhotoKind(kind)&&/同框|拍进去/.test(clause)});
   if(intent==='denied'||/(?:只|仅)(?:需|要)?(?:观察|看)/.test(clause))protectedStops.add(stop);
   tasks.push(stop);reference=target;
 }
 if(pendingCondition)return {error:'请说明满足倾斜条件时要观察还是拍照。'};
 if(!tasks.length&&!deferred.length){if(waitTraffic)return {op:'traffic'};return {error:'请指定要巡检的浮标或返航泊位。'}}
 const returning=tasks.findIndex(t=>t.kind==='berth');
 if(returning>=0)tasks.splice(returning,0,...deferred);else tasks.push(...deferred);
 if(noPhotosThroughout)for(const t of tasks)if(isPhotoKind(t.kind)){t.kind=isSideKind(t.kind)?'sideObserve':'approach';t.framing=false}
 const extendObservation=tasks[0]?.conditional&&ctx.active?.target===tasks[0].target&&
   !isPhotoKind(ctx.active.kind)&&!/只有|只在|才拍|才补拍/.test(text);
 return {op:append||extendObservation?'append':'replace',tasks:unique(tasks),waitTraffic};
}
