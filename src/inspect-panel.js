import {MARKS} from './marks.js';
export function mountInspector(){
 const active=document.querySelector('.active-mission');
 const utterance=document.createElement('small');utterance.className='utterance';utterance.hidden=true;
 active.querySelector('div').append(utterance);
 const panel=document.createElement('details');panel.className='model-inspector';
 panel.innerHTML='<summary>模型观测与动作</summary><div class="optical-contacts" aria-label="实际送入艇控模型的四个视觉裁片"></div><p class="actuator-readout">执行任务后显示最新控制量。</p>';
 active.after(panel);const crops=panel.querySelector('.optical-contacts'),out=panel.querySelector('p');
 const camera=document.createElement('canvas');camera.width=128;camera.height=80;
 camera.className='inspection-camera';camera.hidden=true;camera.setAttribute('aria-label','清漂模型船首输入与视觉锁定位置');
 out.before(camera);
 const cx=camera.getContext('2d'),cameraFrame=cx.createImageData(128,80);
 const shutter=document.createElement('span');
 let predictedReady=false;
 function updateShutter(enabled){
   const label='  ·  快门 '+(enabled?(predictedReady?'就绪':'等待'):'关闭');
   if(shutter.textContent!==label)shutter.textContent=label;
 }
 const slots=Array.from({length:4},(_,i)=>{
  const group=document.createElement('figure'),cn=document.createElement('canvas'),caption=document.createElement('figcaption');
  cn.width=cn.height=20;caption.textContent='候选 '+(i+1);group.append(cn,caption);crops.append(group);
  return {group,ctx:cn.getContext('2d'),image:new ImageData(20,20)};
 });
 return {
  setText(text){utterance.hidden=!text;utterance.textContent=text?'指令 · '+text:''},
  cleaning(){crops.hidden=true;camera.hidden=true;out.textContent='等候船首相机采样，收集口关闭。'},
  waitForTarget(name){crops.hidden=true;camera.hidden=true;out.textContent='等候确认'+name+'，航速指令为 0，快门关闭。'},
  reset(){crops.hidden=false;camera.hidden=true;utterance.hidden=true;utterance.textContent='';out.textContent='执行任务后显示最新控制量。';for(const s of slots){s.ctx.clearRect(0,0,20,20);s.group.classList.remove('focus')}},
  updateShutter,
  update(obs,pred,enabled){
   crops.hidden=!!(obs.chartTarget||obs.cleanupTarget);
   camera.hidden=!obs.input.bowRgb;
   if(obs.input.bowRgb){
     const [confidence,u,v,kind]=pred.visualFocus,[speed,turn,gate]=pred.visualControl;
     const found=confidence>=.55;
     out.textContent=found?('视觉候选 · '+(kind>.5?'泡沫块':'塑料瓶')+' '+Math.round(confidence*100)+'% · 策略航速 '+(speed*3.8).toFixed(2)+' m/s · 转向 '+Math.round(turn*1.42*180/Math.PI)+' °/s · 收集请求'+(gate>=.5?'开启':'关闭')):
       '搜索航线 · 船首尚未锁定匹配物，收集口关闭';
     if(panel.open){
       const rgb=obs.input.bowRgb,data=cameraFrame.data;
       for(let i=0;i<128*80;i++){data[i*4]=rgb[3*i];data[i*4+1]=rgb[3*i+1];data[i*4+2]=rgb[3*i+2];data[i*4+3]=255}
       cx.putImageData(cameraFrame,0,0);
       if(found){cx.strokeStyle='#48ff9b';cx.lineWidth=1;cx.strokeRect(Math.round(u*128)-5.5,Math.round(v*80)-4.5,11,9)}
     }
     return;
   }
   const source=obs.cleanupTarget?'清漂航点 · '+obs.cleanupTarget+' · 艇控 ONNX · ':obs.chartTarget?'海图定位'+MARKS[obs.chartTarget].name+' · 艇控 ONNX · ':'';
   const [v,t,s]=pred.control;predictedReady=s>.4;
   out.textContent=source+'目标航速 '+((v+1)*1.9).toFixed(2)+' m/s  ·  转向 '+(t*1.42*180/Math.PI).toFixed(0)+' °/s';
   updateShutter(enabled);out.append(shutter);
   if(!panel.open||crops.hidden)return;
   const best=pred.focus.indexOf(Math.max(...pred.focus));
   slots.forEach((slot,i)=>{const img=slot.image.data;
    for(let j=0;j<400;j++){for(let k=0;k<3;k++)img[j*4+k]=obs.input.crops[i*1200+k*400+j]*255;img[j*4+3]=255}
    slot.ctx.putImageData(slot.image,0,0);slot.group.classList.toggle('focus',i===best);
   });
  }
 };
}
