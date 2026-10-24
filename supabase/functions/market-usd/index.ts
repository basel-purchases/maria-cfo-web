// Maria CFO v1.0.14 — optional same-project proxy for browsers blocked by CORS.
// No provider API key. Never falls back to the official rate.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';
const PROVIDER='https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD&lang=ar';
const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
});
function clientKey(){
  const raw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'';
  if(raw){try{const keys=JSON.parse(raw);if(typeof keys.default==='string')return keys.default;
    const any=Object.values(keys).find(v=>typeof v==='string');if(any)return String(any);}catch(_){}}
  return Deno.env.get('SUPABASE_ANON_KEY')||'';
}
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'AUTH_REQUIRED'},401);
  const url=Deno.env.get('SUPABASE_URL')||'',key=clientKey();
  if(!url||!key)return json({error:'SUPABASE_CONFIGURATION_REQUIRED'},503);
  try{
    const db=createClient(url,key,{
      global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{persistSession:false,autoRefreshToken:false},
    });
    const user=await db.auth.getUser(token);
    if(user.error||!user.data.user)return json({error:'INVALID_SESSION'},401);
    const owner=await db.rpc('is_app_owner');
    if(owner.error||owner.data!==true)return json({error:'OWNER_ONLY'},403);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),9000);
    try{
      const response=await fetch(PROVIDER,{headers:{Accept:'application/json'},signal:controller.signal});
      if(!response.ok)return json({error:response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE'},502);
      const data=await response.json();
      // Return market data only; do not expose or use central bank/effective rates.
      if(!Array.isArray(data?.marketRates))return json({error:'PARALLEL_RATE_MISSING'},502);
      const usd=data.marketRates.find((x:{currency?:string})=>String(x?.currency||'').toUpperCase()==='USD');
      if(!usd)return json({error:'PARALLEL_USD_MISSING'},502);
      return json({timestampUtc:data.timestampUtc,marketRates:[usd]});
    }finally{clearTimeout(timeout);}
  }catch(e){
    console.warn('market-usd unavailable:',e instanceof Error?e.name:'error');
    return json({error:'PROVIDER_UNAVAILABLE'},503);
  }
});
