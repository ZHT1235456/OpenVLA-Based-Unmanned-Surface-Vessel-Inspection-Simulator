// Scene identities used by the renderer, chart and command resolver in all three layouts.
export const MARKS={
 pier:{name:'栈桥黄标',place:'pier',color:'黄',paint:'yellow'},
 wall:{name:'防波堤黄标',place:'wall',color:'黄',paint:'yellow'},
 gateRed:{name:'浮标门红标',place:'gate',color:'红',paint:'red',gateSide:'西',point:{x:-5.4,z:10.4}},
 gateGreen:{name:'浮标门绿标',place:'gate',color:'绿',paint:'green',gateSide:'东',point:{x:5.4,z:10.4}}
};
export const buoyIds=Object.keys(MARKS);
export const gateMarkIds=buoyIds.filter(id=>MARKS[id].place==='gate');
export const isGateMark=id=>MARKS[id]?.place==='gate';
export function withChartMarks(layout){
 return Object.assign(Object.fromEntries(gateMarkIds.map(id=>[id,MARKS[id].point])),layout);
}
const locations={
 pier:{name:'木栈桥',pattern:/木?栈桥|木桥|栈道|木平台|木(?:质|制|头)?码头|栈/},
 wall:{name:'防波堤',pattern:/(?:防波|消波|防浪|石)?堤|石墙|消波|防浪/},
 gate:{name:'航道浮标门',pattern:/浮标门|航标门|门标|通航门|航道|航门/},
 east:{name:'东泊位',pattern:/东(?:侧|边)?泊位/},
 west:{name:'西泊位',pattern:/西(?:侧|边)?泊位/}
};
const gateName=/(?:红绿|绿红)(?:色)?(?:浮标|航标|标)?门/g;
export const namedPlaces=text=>Object.keys(locations).filter(place=>locations[place].pattern.test(text.replace(gateName,'浮标门')));
const colors='红绿黄蓝白黑紫橙粉灰青棕银金褐';
const beforeMark=new RegExp('(['+colors+'])(?:颜?色)?(?:灯光?)?(?:的)?(?:那[座颗枚个]|这[座颗枚个])?(?:浮标|航标|门标|灯标|标体|标)','gu');
const sharedNoun=new RegExp('(['+colors+'])(?:色)?(?:和|与|或|、|及|/)?(['+colors+'])(?:色|双色)?的?(?:浮标|航标|门标|灯标|标体|标)','gu');
const afterMark=new RegExp('(?:浮标|航标|门标|灯标|标体|标)(?:的)?(?:颜色)?(?:为|是|呈)(['+colors+'])(?:色)?','gu');
const elliptical=new RegExp('(['+colors+'])(?:色的?|的)(?=那[座颗枚个]|这[座颗枚个]|拍|补拍|观察|[）)]|$)','gu');
function markerColors(text){
 const result=new Set(),clause=text.replace(gateName,'浮标门').replace(/\s/g,'');
 for(const pattern of [beforeMark,afterMark,elliptical])for(const match of clause.matchAll(pattern))result.add(match[1]);
 for(const pair of clause.matchAll(sharedNoun)){result.add(pair[1]);result.add(pair[2])}
 return [...result];
}
// Keep a color and its location together when the speaker inserts a comma between them.
export function joinMarkerDescriptions(clauses){
 const joined=[];
 for(const clause of clauses){
  const prior=joined.at(-1)||'';
  const priorPlace=namedPlaces(prior).length,place=namedPlaces(clause).length;
  const locationFragment=!/拍|观察|检查|巡检|穿|通过|经过|返航|返回|靠泊/.test(prior)||/^(?:是|颜色[为是]|目标是)/.test(clause);
  const afterLocation=priorPlace&&locationFragment&&!place&&!markerColors(prior).length&&markerColors(clause).length&&
    /旁边?|附近|边上|内侧|外侧|那边|浮标|航标/.test(prior)&&!/^(?:再|最后|然后|随后|接着)/.test(clause);
  const afterColor=place&&markerColors(prior).length&&/^(?:位置在|位于|就在|地点是|(?:它|浮标|目标|那个标)在)/.test(clause);
  if(prior&&(afterLocation||afterColor))joined[joined.length-1]=prior+' '+clause;
  else joined.push(clause);
 }
 return joined;
}
export function groundMarker(text,reference=null){
 const requested=markerColors(text);
 const places=namedPlaces(text);
 const sides=places.includes('gate')?[...new Set(Array.from(text.matchAll(/([东西])(?:侧|边|端|面)/g),m=>m[1]))]:[];
 const inspectingSide=sides.length&&!/穿过|通过|经过/.test(text)&&/观察|检查|巡检|拍|照相|抵近|靠近|看/.test(text);
 if(!requested.length&&!inspectingSide)return null;
 if(requested.length>1)return {error:'指令包含多种浮标颜色，请分别指定每个目标的位置和颜色。'};
 const color=requested[0];
 if(places.length>1)return {error:'这段指令包含多个地点，请分别写清每座浮标的位置和颜色。'};
 if(sides.length>1)return {error:'浮标门两侧各有一座门标，请分别指定东侧或西侧。'};
 if(sides.length){
   const id=gateMarkIds.find(key=>MARKS[key].gateSide===sides[0]);
   if(!color||MARKS[id].color===color)return {target:id};
   const other=gateMarkIds.find(key=>MARKS[key].color===color);
   const detail=other?color+'标在'+MARKS[other].gateSide+'侧。':'这里没有'+color+'标。';
   return {error:'浮标门'+sides[0]+'侧是'+MARKS[id].color+'标。'+detail};
 }
 let candidates=buoyIds.filter(id=>MARKS[id].color===color);
 const place=places[0];
 if(place)candidates=candidates.filter(id=>MARKS[id].place===place);
 if(!place&&reference&&/刚才|上次|先前|眼前|当前|这座|这颗/.test(text))
  candidates=candidates.filter(id=>id===reference);
 if(candidates.length===1)return {target:candidates[0]};
 if(candidates.length>1)return {error:'港池有两座黄标，请指定木栈桥旁的黄标或防波堤旁的黄标。',candidates};
 const requestedPlace=place?locations[place].name+'旁':'当前所指位置';
 const local=buoyIds.filter(id=>MARKS[id].place===place);
 const elsewhere=buoyIds.find(id=>MARKS[id].color===color);
 const detail=local.length===1?'这里的是'+MARKS[local[0]].color+'标。':'';
 const available=elsewhere?color+'标位于'+locations[MARKS[elsewhere].place].name+'。':'可巡检的浮标有黄色、红色和绿色。';
 return {error:requestedPlace+'没有'+color+'标。'+detail+available};
}

// Offer a location edit only for a single rejected request with one physical match for its color.
export function suggestMarkerCorrection(raw, reason) {
 const clause=raw.trim().replace(/[。！？.!?]+$/,'');
 if(/[,，;；。\n]|然后|随后|最后|再去/.test(clause)||groundMarker(clause)?.error!==reason)return '';
 const places=namedPlaces(clause),colors=markerColors(clause);
 if(places.length!==1||colors.length!==1)return '';
 const matches=buoyIds.filter(id=>MARKS[id].color===colors[0]);
 if(matches.length!==1)return '';
 const mark=MARKS[matches[0]],place=places[0];
 let proposed;
 if(place===mark.place){
   const sides=new Set(Array.from(clause.matchAll(/([东西])(?:侧|边|端|面)/g),m=>m[1]));
   if(sides.size!==1||!mark.gateSide)return '';
   proposed=raw.replace(/[东西](?=侧|边|端|面)/,mark.gateSide);
 }else{
   const landmark=new RegExp('(?:'+locations[place].pattern.source+')(?:旁边|附近|内侧|外侧|边上|旁|边)?');
   proposed=raw.replace(landmark,mark.place==='gate'?'浮标门':locations[mark.place].name);
 }
 return proposed!==raw&&groundMarker(proposed)?.target===matches[0]?proposed:'';
}
