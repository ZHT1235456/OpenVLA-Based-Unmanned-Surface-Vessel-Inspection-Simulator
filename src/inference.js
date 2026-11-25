export class OnboardPolicy{
 constructor(){
  this.worker=new Worker(new URL('./policy-worker.js',import.meta.url),{type:'module'});
  this.waiting=new Map();this.sequence=0;
  this.worker.onmessage=({data})=>{const p=this.waiting.get(data.id);if(!p)return;this.waiting.delete(data.id);if(data.error)p.reject(Error(data.error));else p.resolve(data)};
  this.worker.onerror=event=>{for(const p of this.waiting.values())p.reject(Error(event.message||'推理线程中断'));this.waiting.clear()};
 }
 request(type,payload){return new Promise((resolve,reject)=>{const id=++this.sequence;this.waiting.set(id,{resolve,reject});this.worker.postMessage({id,type,payload,base:new URL('./',document.baseURI).href})})}
 init(){return this.request('init')}
 async classify(text){return (await this.request('language',text)).result}
 drive(input){return this.request('drive',input)}
}
