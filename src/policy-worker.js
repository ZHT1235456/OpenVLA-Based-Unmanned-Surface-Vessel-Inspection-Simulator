import {loadPolicy} from './policy-engine.js';
let policy;
self.addEventListener('message',async({data})=>{
 const start=performance.now();
 try{
   let result;
   if(data.type==='init'){policy=await loadPolicy(data.base);result=true}
   else if(data.type==='language')result=await policy.classify(data.payload);
   else result=await policy.drive(data.payload);
   self.postMessage({id:data.id,result,ms:performance.now()-start});
 }catch(error){self.postMessage({id:data.id,error:String(error?.message||error)})}
});
