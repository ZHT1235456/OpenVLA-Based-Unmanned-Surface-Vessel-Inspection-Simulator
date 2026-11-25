import {mountShell,bindCommandInput} from './shell.js';
import {OnboardPolicy} from './inference.js';
import {HarborView} from './scene.js';
import {portLayout} from './simulation.js';
import {HarborFleet} from './fleet.js';
import {planFleetOrder} from './fleet-orders.js';
import {describe,names} from './commands.js';
import {suggestMarkerCorrection} from './marks.js';
import {drawChart} from './chart.js';
import {mountInspector} from './inspect-panel.js';
import './inspect.css';

const $=id=>document.getElementById(id);
mountShell($('app'));
const composer=bindCommandInput($('app'),send);
const timeText=t=>[Math.floor(t/60),Math.floor(t)%60].map(v=>String(v).padStart(2,'0')).join(':');
const inspector=mountInspector(),policy=new OnboardPolicy(),pastRoutes=new Map();
const makeMeter=()=>({last:0,rate:0,ms:0,first:null,prediction:null,raw:''});
let fleet,view,follow='A',meters,ready=false,failed=false,paused=false,pending=false,parsing=false;
let compare=false,cmdSerial=0,nextPoll=0,lastRender=0,lastUi=0,recordKey='',eventKey=-1,feedback='',feedbackUntil=0;
let commandQueue=Promise.resolve();
const current=()=>fleet.boats[follow];
const historyKey=(id,layout)=>id+':'+JSON.stringify(layout);
function message(text,sticky=false){feedback=text;feedbackUntil=sticky?Infinity:performance.now()+6500;updateUi(true)}
function updateFollow(id){
 composer.clearCorrection();
 follow=fleet.dual?id:'A';
 const dual=fleet.dual;
 $('fleet-mode').value=dual?'dual':'single';$('fleet-panel').hidden=!dual;
 $('follow-boat').disabled=!dual;$('follow-boat').value=follow;
 document.querySelector('.station').dataset.fleet=dual?'dual':'single';
 const title=$('bow-title');title.lastChild.textContent=dual?'船首画面 · '+follow+' 艇':'船首画面';
 $('world').setAttribute('aria-label',dual?follow+'艇港池三维实时视图':'港池三维实时视图');
 $('bow').setAttribute('aria-label',follow+'艇船首相机实时画面');
 view.setMembers(dual?fleet.boats:{A:fleet.boats.A},follow);
 inspector.reset();inspector.setText(meters[follow].raw);
 const cached=meters[follow].prediction;if(cached)inspector.update(cached.obs,cached.result,!paused&&current().shutterEnabled&&cached.obs.revision===current().revision);
 if(current().unverifiedTarget)inspector.waitForTarget(names[current().active.target]);
 recordKey='';eventKey=-1;view.render();updateUi(true);
}
function reset(layoutChanged=false){
 if(fleet)for(const [id,r] of Object.entries(fleet.boats))if(r.trace.length>1)pastRoutes.set(historyKey(id,r.layout),r.trace.slice());
 if(layoutChanged)compare=false;
 cmdSerial++;parsing=false;nextPoll=0;paused=false;feedback='';feedbackUntil=0;meters={A:makeMeter(),B:makeMeter()};
 const dual=$('fleet-mode').value==='dual';
 fleet=new HarborFleet(portLayout($('layout').value),{condition:$('condition').value,traffic:$('traffic').checked});
 fleet.setDual(dual);
 if(!pastRoutes.has(historyKey(follow,fleet.layout)))compare=false;
 if(view)view.setRun(fleet.boats.A);else view=new HarborView($('world'),$('bow'),fleet.boats.A);
 $('pause').setAttribute('aria-pressed','false');$('pause').textContent='暂停';
 $('compare').setAttribute('aria-pressed',String(compare));$('compare').textContent=compare?'隐藏对比':'对比航迹';
 updateFollow(follow);
}
function addRow(container,title,meta){
 const row=document.createElement('div'),main=document.createElement('span'),sub=document.createElement('small');
 main.textContent=title;sub.textContent=meta;row.append(main,sub);container.append(row);return row;
}
function updateFleet(){
 if(!fleet.dual)return;
 const link=$('link-status'),fresh=fleet.linkFresh;
 link.textContent=fresh?'链路在线'+(fleet.rtt==null?'':' · '+Math.round(fleet.rtt)+' ms'):'建立链路中';
 link.dataset.state=fresh?'online':'connecting';
 link.title=fresh?'最近位置报文距今 '+fleet.linkAge.toFixed(1)+' 仿真秒，显示最近一次往返回执耗时':'等待两艇交换位置报文';
 const roster=$('fleet-roster');
 if(roster.children.length!==2){roster.replaceChildren();for(const id of fleet.ids())addRow(roster,'','').dataset.vessel=id}
 for(const row of roster.children){
  const id=row.dataset.vessel,r=fleet.boats[id];row.dataset.selected=String(id===follow);
  const task=r.held?'原地等候':fleet.peerYield[id]?'邻艇让行':r.yielding?'保洁船让行':r.active?describe(r.active):fleet.lastOrder[id]||'泊位待命';
  row.firstElementChild.textContent=task;row.lastElementChild.textContent=r.boat.speed.toFixed(1)+' m/s · '+r.photos.length+' 张';
 }
 if(eventKey!==fleet.eventId){
  eventKey=fleet.eventId;const box=$('fleet-messages');box.replaceChildren();
  for(const e of fleet.events.slice(-16).reverse())addRow(box,e.text,timeText(e.time)+'　'+e.from+' → '+e.to+' · '+e.type);
 }
}
function updateUi(force=false){
 if(!fleet)return;
 const r=current(),b=r.boat,m=meters[follow];
 const blocked=r.route?.blocked;
 inspector.updateShutter(!paused&&!failed&&r.shutterEnabled&&m.prediction?.obs.revision===r.revision);
 composer.setDefault(r.held?'继续任务':undefined);
 $('clock').textContent=timeText(fleet.time);$('speed').textContent=b.speed.toFixed(1);
 $('heading').textContent=String(Math.round((b.yaw*180/Math.PI+360)%360)).padStart(3,'0');
 $('latency').textContent=m.ms?m.ms.toFixed(1):'—';$('policy-rate').textContent=m.rate?m.rate.toFixed(1):'—';
 const mode=failed?'推理故障':!ready?'载入模型':parsing?'理解指令':paused?'仿真暂停':r.held?'原地等候':r.unverifiedTarget?'复核目标':fleet.peerYield[follow]?'邻艇让行':r.yielding?'避让保洁船':r.active?'巡检中':fleet.relay?.receiver===follow?(fleet.relay.photoEvidence?'等候首拍':'等候观测回报'):'模型就绪';
 $('mode').textContent=blocked&&!paused&&!parsing?'规划受阻':mode;$('mode').dataset.state=failed||blocked?'error':ready?'ready':'loading';
 $('visible-task').textContent=performance.now()<feedbackUntil?feedback:r.held?'原地等候 · 可输入“继续任务”':r.yielding?'保洁船横穿 · 暂缓前进':r.active?describe(r.active):fleet.dual&&fleet.lastOrder[follow]?fleet.lastOrder[follow]:describe(null);
 if(blocked&&performance.now()>=feedbackUntil)$('visible-task').textContent='路径不可达 · '+describe(blocked);
 for(const btn of [$('send'),$('fleet-order'),...document.querySelectorAll('[data-fleet-command]')])btn.disabled=!ready||failed;
 const key=[follow,fleet.dual,r.revision,r.logs.length,r.photos.length,r.done.length,fleet.inbox[follow].size,r.logs.at(-1)?.text].join('|');
 if(force||key!==recordKey){
  recordKey=key;const tasks=$('tasks');tasks.replaceChildren();
  if(r.active)addRow(tasks,describe(r.active),blocked?'等待规划':r.held?'已暂停':'执行中');
  const chartLabel=r.nextWaypoint&&!r.awaitingOrder?follow+'艇 A* 规划航线 · '+r.route.legs.length+' 个航段 · '+r.route.distance.toFixed(1)+' m':'港池航迹俯视图';
  $('chart').setAttribute('aria-label',chartLabel);$('chart').title=chartLabel;
  r.queue.forEach(t=>addRow(tasks,describe(t),'待执行'));
  r.done.slice(-5).reverse().forEach(t=>addRow(tasks,describe(t),t.reason.includes('跳过')?'已跳过':'已完成'));
  const logs=$('logs');logs.replaceChildren();r.logs.slice(-35).reverse().forEach(item=>addRow(logs,item.text,timeText(item.time)+' · '+item.type));
  const gallery=$('photos'),photos=fleet.gallery(follow);gallery.replaceChildren();
  for(const p of photos){
   const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption');
   const source=fleet.dual?p.boatId+'艇'+(p.boatId===follow?'拍摄':'回传')+' · ':'';
   img.src=p.src;img.alt=source+names[p.target]+'巡检照片';img.tabIndex=0;fig.dataset.vessel=p.boatId;fig.dataset.photo=p.id;
   cap.textContent=source+timeText(p.time)+' · '+names[p.target]+(p.kind==='side'?' · 侧面':' · 全景')+' · '+p.range.toFixed(1)+' m';fig.append(img,cap);gallery.append(fig);
  }
  $('photo-tab').textContent=photos.length?'巡检照片 ('+photos.length+')':'巡检照片';
 }
 updateFleet();
 drawChart($('chart'),r,compare?(pastRoutes.get(historyKey(follow,r.layout))||[]):[],fleet.dual?{boats:fleet.boats,follow,linkFresh:fleet.linkFresh}:null);
}
function send(text){
 if(!ready||failed)return;
 const value=text.trim();if(!value){message('请输入一条中文巡检指令。');$('command').focus();return}
 const identity=cmdSerial,f=fleet,selected=follow,start=performance.now();
 commandQueue=commandQueue.then(()=>applyCommand(value,f,selected,identity,start));return commandQueue;
}
async function applyCommand(value,f,selected,identity,start){
 if(identity!==cmdSerial||f!==fleet||failed)return;
 parsing=true;updateUi();
 try{
  const order=await planFleetOrder(value,f,selected,s=>policy.classify(s));if(identity!==cmdSerial||f!==fleet)return;
  parsing=false;
  if(order.error){
   const boat=f.boats[selected];
   if(follow===selected)composer.offer(value,order.suggestion||suggestMarkerCorrection(value,order.error));
   const notice=order.error+' 本条未派单。'+(boat.active?' '+selected+'艇原任务为'+describe(boat.active)+'。':'');
   boat.log('待澄清',notice);message(notice,true);return;
  }
  feedbackUntil=0;const wasDual=f.dual,ticket=f.dispatch(order,value);
  for(const {id,plan} of order.assignments){
   const m=meters[id];m.raw=value;m.last=0;
   m.first=['replace','append','resume'].includes(plan.op)?{start,ticket}:null;
   if(plan.waitTraffic||plan.op==='traffic'){$('traffic').checked=true;for(const r of Object.values(f.boats))r.traffic=true}
  }
  if(!wasDual&&f.dual)updateFollow(follow);else inspector.setText(meters[follow].raw);
  nextPoll=0;if($('command').value.trim()===value)composer.setValue('');
  updateUi(true);if(!f.dual&&current().held)message('已停船等候，发送“继续任务”可恢复。');
 }catch(e){if(identity===cmdSerial){parsing=false;message('指令处理失败 · '+e.message)}}
}
async function poll(){
 if(pending||!ready||failed||paused||parsing)return;
 const f=fleet;pending=true;
 try{
  for(const id of f.ids()){
   if(f!==fleet||paused||parsing||(!f.dual&&id==='B'))break;
   const r=f.boats[id],obs=r.observation(c=>view.cropFor(c,r));if(!obs)continue;
   const data=await policy.drive(obs.input);
   if(f!==fleet||paused||parsing||(!f.dual&&id==='B')||obs.revision!==r.revision)continue;
   const now=performance.now(),m=meters[id],diff=m.last?now-m.last:200;
   m.rate=1000/Math.max(diff,1);m.ms=data.ms;m.last=now;
   const applied=r.inference(obs,data.result,c=>view.measureLean(c),p=>view.photo(p,r),Math.min(.32,diff/1000));
   if(applied){m.prediction={obs,result:data.result};if(follow===id)inspector.update(obs,data.result,r.shutterEnabled&&obs.revision===r.revision);f.sync()}
   else if(r.unverifiedTarget){m.prediction=null;if(follow===id)inspector.waitForTarget(names[r.active.target])}
   if(applied&&m.first&&m.first.ticket===r.orderTicket){r.log('推理','改派至首条控制量 '+Math.round(now-m.first.start)+' ms');m.first=null}
  }
 }catch(e){
  if(f===fleet){failed=true;for(const r of Object.values(f.boats)){r.held=true;r.act={turn:0,throttle:0};r.log('故障',e.message)}message('本地推理中断 · '+e.message)}
 }finally{pending=false}
}
let lastFrame=performance.now();
function frame(now){
 const dt=Math.min(.14,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
 if(!paused&&ready&&!failed){let remaining=dt;while(remaining>1e-6){const step=Math.min(remaining,1/30);fleet.tick(step);remaining-=step}}
 if(now-lastRender>=30){view.render();lastRender=now}
 if(now>=nextPoll&&!pending){nextPoll=now+185;void poll()}
 if(now-lastUi>145){updateUi();lastUi=now}
 requestAnimationFrame(frame);
}
const desktop=Boolean(window.__TAURI_INTERNALS__);
async function setWindowButton(){
 let full=!!document.fullscreenElement;
 if(desktop){const {getCurrentWindow}=await import('@tauri-apps/api/window');full=await getCurrentWindow().isFullscreen()}
 $('fullscreen').textContent=full?'窗口模式':'进入全屏';$('fullscreen').setAttribute('aria-pressed',String(full));
}
$('fullscreen').addEventListener('click',async()=>{
 try{
  if(desktop){
   const {getCurrentWindow,LogicalSize}=await import('@tauri-apps/api/window');
   const windowRef=getCurrentWindow(),full=await windowRef.isFullscreen();
   await windowRef.setFullscreen(!full);
   if(full){await windowRef.setSize(new LogicalSize(Math.round(Math.min(1280,screen.availWidth*.86)),Math.round(Math.min(820,screen.availHeight*.86))));await windowRef.center()}
  }
  else if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();
  await setWindowButton();
 }catch(e){message('窗口切换失败 · '+e.message)}
});
document.addEventListener('fullscreenchange',()=>void setWindowButton());
$('send').addEventListener('click',()=>send($('command').value));
$('examples').addEventListener('click',e=>{const b=e.target.closest('[data-command]');if(b){composer.setValue(b.dataset.command);void send(b.dataset.command)}});
$('fleet-order').addEventListener('click',()=>send('双艇协作，分别巡检木栈桥和防波堤旁的黄标'));
for(const b of document.querySelectorAll('[data-fleet-command]'))b.addEventListener('click',()=>send(b.dataset.fleetCommand));
$('fleet-mode').addEventListener('change',()=>{
 cmdSerial++;parsing=false;const on=$('fleet-mode').value==='dual';fleet.setDual(on);if(!on)meters.B=makeMeter();
 feedbackUntil=0;updateFollow(on?follow:'A');
});
$('follow-boat').addEventListener('change',()=>{feedbackUntil=0;updateFollow($('follow-boat').value)});
$('pause').addEventListener('click',()=>{
 paused=!paused;for(const id of fleet.ids()){fleet.boats[id].revision++;meters[id].first=null;meters[id].last=0}
 nextPoll=0;$('pause').setAttribute('aria-pressed',String(paused));$('pause').textContent=paused?'继续':'暂停';updateUi();
});
$('view').addEventListener('click',()=>{const s=view.nextView();$('view').textContent=s;view.render()});
$('reset').addEventListener('click',()=>reset());$('layout').addEventListener('change',()=>reset(true));
$('condition').addEventListener('change',()=>{for(const r of Object.values(fleet.boats)){r.condition=$('condition').value;r.resetSamples();r.log('试验','浮标状态已切换')}updateUi()});
$('traffic').addEventListener('change',()=>{for(const r of Object.values(fleet.boats)){r.traffic=$('traffic').checked;r.log('试验',r.traffic?'已启用保洁船穿行':'已关闭保洁船穿行')}updateUi()});
$('compare').addEventListener('click',()=>{if(!pastRoutes.has(historyKey(follow,fleet.layout))){message('先执行一段航行，再重置场景。上次航迹会保留作对照。');return}
 compare=!compare;$('compare').setAttribute('aria-pressed',String(compare));$('compare').textContent=compare?'隐藏对比':'对比航迹';updateUi()});
try{
 reset();void setWindowButton();requestAnimationFrame(frame);
 await policy.init();ready=true;fleet.boats.A.log('模型','中文与艇控 ONNX 已在本机加载');updateUi(true);
}catch(e){failed=true;$('mode').textContent='启动失败';$('visible-task').textContent='启动失败 · '+(e.message||e);console.error(e)}
