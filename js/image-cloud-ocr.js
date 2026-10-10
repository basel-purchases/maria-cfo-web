// OCR.space through the authenticated Supabase Edge Function.
// No OCR API key is ever shipped to the browser. Images are NOT stored in Supabase.
import {supabase} from './supabase.js?v=0.27';

import {OCR_ENGINES,normalizedCrop} from './image-cloud-rules.js?v=0.27';
async function edge(body){
  if(!supabase)throw new Error('SUPABASE_NOT_CONFIGURED');
  const {data,error}=await supabase.functions.invoke('ocr-space',{body});
  if(error){
    let message=error.message||'OCR_FUNCTION_ERROR';
    try{const remote=await error.context?.json?.();message=remote?.error||message;}catch(_){}
    if(message==='OCR_ENGINE1_ARABIC_UNAVAILABLE_USE_ENGINE3')message='\u0645\u062d\u0631\u0643 OCR \u0627\u0644\u0633\u0631\u064a\u0639 \u0644\u0645 \u064a\u0642\u0628\u0644 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u062d\u0627\u0644\u064a\u064b\u0627. \u0627\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0645\u062d\u0631\u0643 \u0627\u0644\u0642\u0648\u064a Engine 3.';
    throw new Error(message);
  }
  if(!data?.ok){
    if(data?.error==='OCR_ENGINE1_ARABIC_UNAVAILABLE_USE_ENGINE3')throw new Error('\u0645\u062d\u0631\u0643 OCR \u0627\u0644\u0633\u0631\u064a\u0639 \u0644\u0645 \u064a\u0642\u0628\u0644 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u062d\u0627\u0644\u064a\u064b\u0627. \u0627\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0645\u062d\u0631\u0643 \u0627\u0644\u0642\u0648\u064a Engine 3.');
    throw new Error(String(data?.error||'OCR_FUNCTION_ERROR'));
  }
  return data;
}
export async function fetchOcrUsage(){
  return (await edge({action:'usage'})).usage;
}
const blobToDataUrl=blob=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result||''));
  reader.onerror=()=>reject(new Error('IMAGE_READ_FAILED'));
  reader.readAsDataURL(blob);
});
async function decode(file){
  if(typeof createImageBitmap==='function'){
    const bmp=await createImageBitmap(file);
    return {image:bmp,width:bmp.width,height:bmp.height,release:()=>bmp.close()};
  }
  const url=URL.createObjectURL(file);
  const img=new Image();
  try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('IMAGE_DECODE_FAILED'));img.src=url;});
    return {image:img,width:img.naturalWidth,height:img.naturalHeight,release:()=>URL.revokeObjectURL(url)};
  }catch(e){URL.revokeObjectURL(url);throw e;}
}
export async function prepareImageForCloud(blob,{crop=null,onProgress}={}){
  const progress=(label,pct)=>onProgress?.(label,pct);
  const area=normalizedCrop(crop);
  progress('Preparing image',6);
  if(!area&&['image/jpeg','image/png'].includes(blob.type)&&blob.size<=950000){
    progress('Image ready',32);
    return blobToDataUrl(blob);
  }
  const decoded=await decode(blob);
  try{
    const box=area||{x:0,y:0,w:1,h:1};
    const sx=box.x*decoded.width,sy=box.y*decoded.height,sw=box.w*decoded.width,sh=box.h*decoded.height;
    let limit=2800;
    for(let cycle=0;cycle<7;cycle++){
      const ratio=Math.min(1,limit/Math.max(sw,sh));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(sw*ratio));
      canvas.height=Math.max(1,Math.round(sh*ratio));
      const ctx=canvas.getContext('2d');
      if(!ctx)throw new Error('IMAGE_CANVAS_UNAVAILABLE');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(decoded.image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
      for(const quality of [.90,.82,.72,.60,.48]){
        const data=canvas.toDataURL('image/jpeg',quality);
        if(data.length<=1280000){progress('Image ready',32);return data;}
      }
      limit=Math.round(limit*.78);
    }
    throw new Error('IMAGE_TOO_LARGE_MAX_1_MB');
  }finally{decoded.release();}
}
export async function recognizeCloudImage(blob,{engine=3,crop=null,onProgress}={}){
  const mode=Number(engine);
  if(!OCR_ENGINES[mode])throw new Error('UNSUPPORTED_OCR_ENGINE');
  const progress=(label,pct)=>onProgress?.(label,pct);
  const dataUrl=await prepareImageForCloud(blob,{crop,onProgress:progress});
  progress('Waiting for OCR.space response',38);
  const result=await edge({action:'recognize',engine:mode,dataUrl});
  progress('OCR.space returned text',100);
  return {text:String(result.text||''),confidence:null,engine:mode,
    quality:{uncertain:!String(result.text||'').trim(),reason:'Always review OCR output'},
    usage:result.usage||null};
}
