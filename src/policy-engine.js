const CLASSES=['pier','wall','east','west','current','other','previous','unknown'];
export async function loadPolicy(base){
  const absolute=new URL(base);
  const runtime=new URL('runtime/ort.wasm.min.mjs',absolute).href;
  const ort=await import(/* @vite-ignore */runtime);
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('runtime/',absolute).href;
  const read=async name=>{const response=await fetch(new URL('models/'+name,absolute));if(!response.ok)throw Error('无法加载 '+name);return response};
  const binary=async name=>(await read(name)).arrayBuffer();
  const [langBuf,navBuf,pilotBuf,cleanupBuf,lexicon,vocab]=await Promise.all([binary('language.onnx'),binary('navigation.onnx'),binary('pilot.onnx'),binary('cleanup.onnx'),read('cleanup-lexicon.json').then(r=>r.json()),read('vocab.txt').then(r=>r.text())]);
  const options={executionProviders:['wasm'],graphOptimizationLevel:'all'};
  const language=await ort.InferenceSession.create(langBuf,options), navigation=await ort.InferenceSession.create(navBuf,options);
  const pilot=await ort.InferenceSession.create(pilotBuf,options);
  const cleanup=await ort.InferenceSession.create(cleanupBuf,options);
  const dictionary=new Map(vocab.trimEnd().split(/\r?\n/).map((v,i)=>[v,i]));
  const cache=new Map();
  function rawTensor(arr,dims){return new ort.Tensor('float32',arr,dims)}
  return {
    async classify(text){
      if(cache.has(text))return cache.get(text);
      const core=Array.from(text.toLowerCase()).filter(c=>c.trim().length>0).slice(0,38);
      const list=[dictionary.get('[CLS]'),...core.map(c=>dictionary.get(c)??dictionary.get('[UNK]')),dictionary.get('[SEP]')];
      const ids=new BigInt64Array(40);list.forEach((v,i)=>{ids[i]=BigInt(v)});
      const input=new ort.Tensor('int64',ids,[1,40]);const out=await language.run({ids:input});
      const values=Array.from(out.logits.data);const top=Math.max(...values);
      const result={target:CLASSES[values.indexOf(top)],confidence:1/values.reduce((s,x)=>s+Math.exp(x-top),0)};
      input.dispose();out.logits.dispose();if(cache.size>250)cache.clear();cache.set(text,result);return result;
    },
    async drive({crops,geometry,instruction,markerGeometry,bowRgb,words}){
      if(bowRgb){
        const plane=80*128, rgb=new Float32Array(3*plane);
        for(let i=0;i<plane;i++)for(let k=0;k<3;k++)rgb[k*plane+i]=bowRgb[i*3+k]/255;
        const language=Float32Array.from(lexicon.characters,c=>Number(words.includes(c)));
        const inputs={rgb:rawTensor(rgb,[1,3,80,128]),words:rawTensor(language,[1,language.length])};
        let visual={},waypoint={};
        try{
          visual=await cleanup.run(inputs);
          if(markerGeometry){
            inputs.geometry=rawTensor(markerGeometry,[1,5]);waypoint=await pilot.run({geometry:inputs.geometry});
          }
          return {visualControl:Array.from(visual.control.data),visualFocus:Array.from(visual.focus.data),
            control:waypoint.control?Array.from(waypoint.control.data):[0,0,-1],focus:[]};
        }finally{for(const t of [...Object.values(inputs),...Object.values(visual),...Object.values(waypoint)])t.dispose()}
      }
      const inputs=markerGeometry?{geometry:rawTensor(markerGeometry,[1,5])}:
       {crops:rawTensor(crops,[1,4,3,20,20]),geometry:rawTensor(geometry,[1,4,5]),instruction:rawTensor(instruction,[1,4])};
      let out={};
      try{
       out=await (markerGeometry?pilot:navigation).run(inputs);
       return {control:Array.from(out.control.data),focus:out.focus?Array.from(out.focus.data):[1]};
      }finally{for(const t of [...Object.values(inputs),...Object.values(out)])t.dispose()}
    }
  };
}
