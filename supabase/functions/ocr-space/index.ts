import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const reply=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{...cors,'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'},
});
const err=(code:string,status=400)=>reply({ok:false,error:code},status);
function publishableKey(){
  const raw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'';
  if(raw){try{const values=JSON.parse(raw);if(typeof values.default==='string')return values.default;
    const first=Object.values(values).find(v=>typeof v==='string');if(first)return String(first);}catch(_){}}
  return Deno.env.get('SUPABASE_ANON_KEY')||'';
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(request.method!=='POST')return err('METHOD_NOT_ALLOWED',405);
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return err('AUTHENTICATION_REQUIRED',401);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const pub=publishableKey();
  if(!url||!pub)return err('SUPABASE_ENVIRONMENT_MISSING',500);
  const db=createClient(url,pub,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const user=await db.auth.getUser(token);
  if(user.error||!user.data.user)return err('INVALID_SESSION',401);
  const owner=await db.rpc('is_app_owner');
  if(owner.error||owner.data!==true)return err('OWNER_ONLY',403);
  const body=await request.json().catch(()=>null);
  const action=body?.action==='usage'?'usage':'recognize';
  const usage=async()=>{
    const response=await db.rpc('get_ocr_space_usage_v021');
    if(response.error)throw new Error('OCR_MIGRATION_REQUIRED');
    return response.data;
  };
  try{
    if(action==='usage')return reply({ok:true,usage:await usage()});
    const engine=Number(body?.engine);
    if(engine!==1&&engine!==3)return err('UNSUPPORTED_OCR_ENGINE',400);
    const dataUrl=String(body?.dataUrl||'');
    if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl))return err('INVALID_IMAGE_FORMAT',400);
    const base64=dataUrl.slice(dataUrl.indexOf(',')+1);
    if(base64.length>1450000)return err('IMAGE_TOO_LARGE_MAX_1_MB',413);
    const key=Deno.env.get('OCR_SPACE_API_KEY')||'';
    if(!key)return err('OCR_SPACE_API_KEY_MISSING',503);
    // The usage row is written before sending to provider to avoid losing track of ambiguous failures.
    const inserted=await db.from('ocr_space_usage_v021').insert({owner_user_id:user.data.user.id,engine,status:'attempted'}).select('id').single();
    if(inserted.error||!inserted.data)return err('OCR_USAGE_STORAGE_FAILED',500);
    const logId=inserted.data.id;
    let status='failed';
    try{
      const form=new FormData();
      form.set('base64Image',dataUrl);
      form.set('OCREngine',String(engine));
      form.set('language',engine===3?'auto':'ara');
      form.set('isTable','true');
      form.set('isOverlayRequired','false');
      form.set('detectOrientation','true');
      form.set('scale','true');
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),75000);
      let resp:Response;
      try{resp=await fetch('https://api.ocr.space/parse/image',{
        method:'POST',headers:{apikey:key},body:form,signal:controller.signal,
      });}finally{clearTimeout(timeout);}
      if(!resp.ok)return err(resp.status===429?'OCR_RATE_LIMIT':'OCR_PROVIDER_HTTP_ERROR',502);
      const result=await resp.json();
      if(result?.IsErroredOnProcessing||Number(result?.OCRExitCode)===3||Number(result?.OCRExitCode)===4){
        const message=Array.isArray(result?.ErrorMessage)?result.ErrorMessage.join('; '):String(result?.ErrorMessage||result?.ErrorDetails||'OCR_PROCESSING_ERROR');
        // Never return credentials or the original request in provider errors.
        if(engine===1 && /E201|language.+invalid/i.test(message))return err('OCR_ENGINE1_ARABIC_UNAVAILABLE_USE_ENGINE3',422);
        return err(message.slice(0,250),422);
      }
      const text=Array.isArray(result?.ParsedResults)?result.ParsedResults.map((part:{ParsedText?:string})=>part?.ParsedText||'').join('\n').trim():'';
      if(!text)return err('OCR_NO_TEXT_FOUND',422);
      status='completed';
      return reply({ok:true,text,engine,provider:'OCR.space',usage:await usage().catch(()=>null)});
    }catch(e){
      console.error('ocr-space request failed',e instanceof Error?e.name:String(e));
      return err(e instanceof DOMException&&e.name==='AbortError'?'OCR_PROVIDER_TIMEOUT':'OCR_PROVIDER_UNAVAILABLE',502);
    }finally{
      await db.from('ocr_space_usage_v021').update({status,finished_at:new Date().toISOString()}).eq('id',logId);
    }
  }catch(e){
    console.error('ocr-space internal error',e instanceof Error?e.message:String(e));
    return err('OCR_MIGRATION_REQUIRED',500);
  }
});
