export const OCR_ENGINES=Object.freeze({1:{id:1,monthlyLimit:25000,legacy:true},3:{id:3,monthlyLimit:1000,legacy:false}});
export function normalizedCrop(c){
  if(!c)return null;
  const {x,y,w,h}=c;
  if(![x,y,w,h].every(v=>Number.isFinite(Number(v))))return null;
  if(x<0||y<0||w<0.035||h<0.035||x+w>1.001||y+h>1.001)return null;
  return {x:Number(x),y:Number(y),w:Number(w),h:Number(h)};
}
export function usageSummary(usage,engine){
  const u=usage?.[String(engine)];
  if(!u)return {day:null,month:null,monthLimit:OCR_ENGINES[engine].monthlyLimit};
  return {day:Number(u.day)||0,month:Number(u.month)||0,monthLimit:OCR_ENGINES[engine].monthlyLimit};
}
