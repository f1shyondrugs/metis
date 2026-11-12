export type TourRect={left:number;top:number;width:number;height:number};
export function tourPlacement(target:TourRect|null,card:{width:number;height:number},viewport:{width:number;height:number}){
 const margin=16,gap=18,w=Math.min(card.width,viewport.width-margin*2),h=Math.min(card.height,viewport.height-margin*2);
 const clamp=(n:number,max:number)=>Math.max(margin,Math.min(max,n));
 const center={left:(viewport.width-w)/2,top:(viewport.height-h)/2};
 if(!target)return center;
 const right=target.left+target.width,bottom=target.top+target.height;
 const candidates=[
  {left:right+gap,top:target.top+(target.height-h)/2},
  {left:target.left-gap-w,top:target.top+(target.height-h)/2},
  {left:target.left+(target.width-w)/2,top:bottom+gap},
  {left:target.left+(target.width-w)/2,top:target.top-gap-h}
 ];
 const fitted=candidates.map(p=>({left:clamp(p.left,viewport.width-w-margin),top:clamp(p.top,viewport.height-h-margin)}));
 const overlap=(p:{left:number;top:number})=>Math.max(0,Math.min(p.left+w,right)-Math.max(p.left,target.left))*Math.max(0,Math.min(p.top+h,bottom)-Math.max(p.top,target.top));
 const distance=(p:{left:number;top:number})=>Math.hypot(p.left+w/2-(target.left+target.width/2),p.top+h/2-(target.top+target.height/2));
 return fitted.sort((a,b)=>overlap(a)-overlap(b)||distance(a)-distance(b))[0];
}
