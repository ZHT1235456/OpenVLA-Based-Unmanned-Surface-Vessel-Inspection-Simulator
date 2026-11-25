// Playwright loads this driver before the app. Only the animation clock is advanced by the test.
// The input, worker messages, WebGL cameras, helm, radio and UI all use the running application.
(() => {
  const realNow = performance.now.bind(performance);
  let now = realNow(), nextFrame = 0;
  const frames = new Map();
  window.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperty(performance, 'now', {value: () => now, configurable: true});

  const observed = new WeakSet(), pending = new Map(), calls = {language:0, drive:0};
  const nativePost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(message, ...rest) {
    if (message && ['init','language','drive'].includes(message.type)) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener('message', e => {
          pending.get(e.data.id)?.();
          pending.delete(e.data.id);
        });
        this.addEventListener('error', () => {
          for (const done of pending.values()) done();
          pending.clear();
        });
      }
      if (message.type in calls) calls[message.type]++;
      pending.set(message.id, null);
    }
    return nativePost.call(this, message, ...rest);
  };
  const channel = new MessageChannel(), turns = [];
  channel.port1.onmessage = () => turns.shift()();
  function nextTurn() {
    return new Promise(resolve => { turns.push(resolve); channel.port2.postMessage(0); });
  }
  async function settle() {
    // Cross a browser task boundary, so the UI has applied the worker response and any chained parses.
    do {
      await nextTurn();
      if (!pending.size) return;
      await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(Error('推理线程超时')),20000);
        const done=()=>{clearTimeout(timer);resolve()};
        for (const id of pending.keys()) pending.set(id,done);
      });
    } while (true);
  }
  async function advance(steps) {
    for (let i=0;i<steps;i++) {
      now+=100;
      const batch=[...frames.values()];
      frames.clear();
      for (const fn of batch) fn(now);
      if (pending.size) await settle();
    }
    await settle();
  }

  const el=id=>document.getElementById(id);
  function change(id,value) {
    const node=el(id);
    node.value=value;
    node.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const dual=()=>el('fleet-mode').value==='dual';
  function select(id) {
    if (dual() && el('follow-boat').value!==id) change('follow-boat',id);
  }
  const rows=id=>[...el(id).children].map(row=>[row.firstElementChild.textContent,row.lastElementChild.textContent]);
  function readBoat() {
    const tasks=rows('tasks');
    return {
      done:tasks.filter(([,s])=>s==='已完成'||s==='已跳过').reverse().map(([title,s])=>title+(s==='已跳过'?'（跳过）':'')),
      pending:tasks.filter(([,s])=>s==='执行中'||s==='待执行'||s==='已暂停').map(([title])=>title),
      held:tasks.some(([,s])=>s==='已暂停'), speed:Number(el('speed').textContent),
      gallery:[...el('photos').children].map(f=>({id:f.dataset.photo,boat:f.dataset.vessel,
        caption:f.querySelector('figcaption').textContent,src:f.querySelector('img').src})),
      logs:rows('logs'),routeLabel:el('chart').getAttribute('aria-label')||''
    };
  }
  function state() {
    const followed=el('follow-boat').value;
    const byId={};
    for (const id of dual()?['A','B']:['A']) {select(id);byId[id]=readBoat()}
    select(followed);
    return byId;
  }
  function signature(byId) {
    return Object.fromEntries(Object.entries(byId).map(([id,b])=>[id,
      [b.done,b.pending,b.held,b.gallery.map(p=>p.id)]
    ]));
  }
  async function submit(text,byButton=false) {
    const input=el('command');
    input.value=text;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    if (byButton) el('send').click();
    else input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await settle();
    return el('visible-task').textContent;
  }
  function busy() {
    if (dual()) return [...el('fleet-roster').children].some(row=>
      !/待命|已撤销|任务完成|复核结束|接力已结束/.test(row.firstElementChild.textContent));
    return rows('tasks').some(([,s])=>s==='执行中'||s==='待执行'||s==='已暂停');
  }
  function insist(ok,what) { if (!ok) throw Error(what); }
  function same(actual,expected,label) {
    insist(JSON.stringify(actual)===JSON.stringify(expected),label+' 应为 '+JSON.stringify(expected)+'，实为 '+JSON.stringify(actual));
  }
  async function complete() {
    let steps=0;
    while (busy() && steps<2300) { await advance(10); steps+=10; }
    insist(!busy(),'230 仿真秒内任务未完成');
    await advance(10); // Finish the peer image transfer and refresh the visible task and gallery.
  }
  const clean=t=>t.replace('（跳过）','');
  const photographs=tasks=>tasks.filter(t=>!t.endsWith('（跳过）')&&/拍照|补拍/.test(t));
  function titleOfPhoto(task) {
    const [target,action]=task.replace('倾斜时 · ','').split(' · ');
    return [target,action==='全景拍照'?'全景':'侧面'];
  }
  async function checkPhoto(entry,task) {
    const [name,view]=titleOfPhoto(task);
    insist(entry.caption.includes(name+' · '+view+' · '),'照片对象或视角错误：'+entry.caption);
    const range=Number(entry.caption.match(/([\d.]+) m$/)?.[1]);
    insist(range>1 && range<7,'取证距离异常：'+entry.caption);
    insist(entry.src.startsWith('data:image/jpeg;base64,'),'相册中缺少 JPEG');
    const picture=new Image();
    picture.src=entry.src;
    await picture.decode();
    same([picture.naturalWidth,picture.naturalHeight],[720,405],'相机分辨率');
    const canvas=document.createElement('canvas');canvas.width=144;canvas.height=126;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(picture,288,142,144,126,0,0,144,126);
    const data=ctx.getImageData(0,0,144,126).data,counts={红:0,绿:0,黄:0};
    for(let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      if (r>g*1.75 && r>b*1.65 && r>74) counts.红++;
      if (g>r*1.45 && g>b*1.15 && g>35) counts.绿++;
      if (r>g*.97 && r>b*1.48 && g>b*1.65 && g>65) counts.黄++;
    }
    const color=name.at(-2), matches=counts[color];
    insist(matches>=220 && matches>Math.max(...Object.entries(counts).filter(([c])=>c!==color).map(([,n])=>n)),
      '船首照片中央未确认'+color+'标：'+JSON.stringify(counts)+' '+entry.caption);
    return {boat:entry.boat,title:name+' · '+view,rangeM:range,centerPixels:counts};
  }
  function inspectNoContact(byId) {
    for(const [id,b] of Object.entries(byId))
      insist(!b.logs.some(([,meta])=>meta.endsWith('· 接触')),id+'艇记录到接触');
    if (dual()) insist(!rows('fleet-messages').some(([,meta])=>meta.endsWith('· 接近')),'两艇记录到接触');
  }

  async function replay(spec,full) {
    const started=realNow(),startNow=now,startCalls={...calls},proof=[],routeChecks={};
    let observedState={},feedback='',stage='准备场景';
    try {
      el('condition').value=spec.condition;el('traffic').checked=spec.traffic;
      el('fleet-mode').value=spec.startDual?'dual':'single';
      change('layout',String(spec.layout));select(spec.selected);
      await advance(3);
      for(const [text,until] of spec.setup){
        const msg=await submit(text);
        insist(!/未派单|处理失败/.test(msg),'前置指令失败：'+text+' '+msg);
        await advance(6);
        if(until==='done') await complete();
        else insist(busy(),'前置任务未运行：'+text);
      }
      const before=signature(state());
      stage='派单';feedback=await submit(spec.text,Number(spec.id.slice(1))%2===0);
      await advance(4);
      feedback=el('visible-task').textContent;
      observedState=state();
      same(dual(),spec.dual,'双艇模式');
      if(spec.op==='reject'){
        insist(feedback.includes('本条未派单') && new RegExp(spec.reason).test(feedback),'应说明原因且拒绝派单，实为 '+feedback);
        same(signature(observedState),before,'待办、完成记录和相册');
        insist(!Object.values(observedState).some(b=>b.logs.some(([t,m])=>m.endsWith('· 指令')&&t===spec.text)),'被拒指令仍已派单');
      }else{
        insist(!/本条未派单|处理失败|启动失败/.test(feedback),'有效指令被拒：'+feedback);
        insist(Object.values(observedState).some(b=>b.logs.some(([t,m])=>m.endsWith('· 指令')&&t===spec.text)),'未收到实际派单');
      }
      const relay=/接力|等首拍|收到首拍/.test(spec.text) && spec.op==='order';
      for(const id of ['A','B']){
        const b=observedState[id], expected=spec.expected[id];
        const actual=b?[...b.done,...b.pending].map(clean):[];
        // The second boat waits for the lead boat's observation or photo over the radio.
        const receiver=relay && (!expected.length || /补拍|换侧观察/.test(expected[0]));
        same(actual,receiver?[]:expected.map(clean),id+'艇派单顺序');
        if(b?.pending.length&&spec.op!=='reject'){
          const match=b.routeLabel.match(/RRT\* 规划航线 · (\d+) 个航段 · ([\d.]+) m/);
          insist(match&&Number(match[1])===b.pending.length,id+'艇海图缺少待办的规划航段');
          const execution=b.logs.findIndex(([,m])=>m.endsWith('· 执行'));
          insist(execution>=0&&b.logs.slice(execution+1).some(([t,m])=>m.endsWith('· 规划')&&t.includes('RRT* 航线已生成')),
            id+'艇开始执行前没有已生成的航线');
          routeChecks[id]={legs:Number(match[1]),metres:Number(match[2]),plannedBeforeExecution:true};
        }
        if(spec.op==='hold' && expected.length) insist(b.held,id+'艇未暂停');
        if(spec.op==='resume' && expected.length) insist(!b.held,id+'艇未恢复');
      }
      if(spec.op==='traffic') insist(el('traffic').checked,'保洁船未启用');
      if(full){
        stage='执行';
        if(['reject','hold','cancel'].includes(spec.op)){
          await advance(spec.op==='reject'?8:35);
          const after=state();
          same(signature(after),signature(observedState),'指令生效后的任务和相册');
          if(spec.op==='hold'||spec.op==='cancel'||!spec.setup.length)
            for(const b of Object.values(after)) insist(b.speed<=.1,'停船后仍在行驶');
          observedState=after;
        }else{
          await complete();
          observedState=state();
          for(const id of ['A','B']){
            const b=observedState[id];
            same(b?.done||[],spec.expected[id],id+'艇实际完成顺序');
            same(b?.pending||[],[],id+'艇剩余待办');
          }
        }
        inspectNoContact(observedState);
        stage='相册';
        for(const [id,b] of Object.entries(observedState)){
          const expected=photographs(['reject','hold','cancel'].includes(spec.op)?b.done:spec.expected[id]);
          const shots=b.gallery.filter(p=>p.boat===id).reverse();
          same(shots.length,expected.length,id+'艇实际拍摄张数');
          for(let i=0;i<shots.length;i++)proof.push(await checkPhoto(shots[i],expected[i]));
        }
        if(dual()){
          const a=observedState.A.gallery,b=observedState.B.gallery;
          insist(a.length===b.length && a.every(p=>b.some(q=>q.id===p.id && q.src===p.src)),'两艇相册的回传影像不一致');
        }
      }
      stage='通过';
      return result(true);
    }catch(e){return result(false,e.message)}
    function result(pass,error){
      return {pass,stage,error,feedback,simSeconds:+((now-startNow)/1000).toFixed(1),realMs:Math.round(realNow()-started),
        workerCalls:{language:calls.language-startCalls.language,drive:calls.drive-startCalls.drive},
        boats:Object.fromEntries(Object.entries(observedState).map(([id,b])=>[id,
          {done:b.done,pending:b.pending,held:b.held,photos:b.gallery.filter(p=>p.boat===id).map(p=>p.caption)}])),
        routeChecks,photoChecks:proof};
    }
  }
  window.replayHarborCommand=replay;
  window.advanceHarborFrames=advance;
})();
