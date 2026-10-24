// Maria CFO Web v1.0.15 — authenticated read-only bridge for LiraScope.
// Deploy as a Supabase Edge Function named "market-usd". The browser never
// contacts the provider directly, so a missing provider CORS header is harmless.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';

const PROVIDER_URL='https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD&lang=ar';
const HEADERS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-supabase-client-platform, x-supabase-client-platform-version',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const CACHE_TTL_MS=5*60*1000;
let cached:{data:{timestampUtc:string,marketRates:unknown[]},savedAt:number}|null=null;

function publishableKey():string{
  const raw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'';
  if(raw){try{
    const keys=JSON.parse(raw);
    if(typeof keys.default==='string')return keys.default;
    const first=Object.values(keys).find(v=>typeof v==='string');
    if(first)return String(first);
  }catch(_){/* Use legacy anon key. */}}
  return Deno.env.get('SUPABASE_ANON_KEY')||'';
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  // No API keys or credentials are exposed to the caller. The function only
  // permits the same authenticated owner who is permitted to use Maria CFO.
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'AUTH_REQUIRED'},401);
  const projectUrl=Deno.env.get('SUPABASE_URL')||'';
  const anonKey=publishableKey();
  if(!projectUrl||!anonKey)return json({error:'PROXY_CONFIGURATION_MISSING'},503);
  try{
    const db=createClient(projectUrl,anonKey,{
      global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{persistSession:false,autoRefreshToken:false},
    });
    const {data:user,error:userError}=await db.auth.getUser(token);
    if(userError||!user.user)return json({error:'AUTH_REQUIRED'},401);
    const {data:isOwner,error:ownerError}=await db.rpc('is_app_owner');
    if(ownerError||isOwner!==true)return json({error:'OWNER_ONLY'},403);

    const now=Date.now();
    if(cached&&now-cached.savedAt<CACHE_TTL_MS)return json(cached.data);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),9000);
    let response:Response;
    try{response=await fetch(PROVIDER_URL,{
      method:'GET',headers:{Accept:'application/json'},signal:controller.signal,
    });}
    catch(_){return json({error:'PROVIDER_UNAVAILABLE'},502);}
    finally{clearTimeout(timer);}
    if(!response.ok)return json({error:response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE'},response.status===429?429:502);
    let payload:unknown;
    try{payload=await response.json();}catch(_){return json({error:'INVALID_PROVIDER_JSON'},502);}
    const provider=payload as {timestampUtc?:string,marketRates?:Array<{currency?:string,buy?:number,sell?:number,timestampUtc?:string}>};
    if(!Array.isArray(provider?.marketRates))return json({error:'PARALLEL_RATES_MISSING'},502);
    const usd=provider.marketRates.find(row=>String(row?.currency||'').toUpperCase()==='USD');
    if(!usd)return json({error:'PARALLEL_USD_MISSING'},502);
    const buy=Number(usd.buy),sell=Number(usd.sell);
    if(!Number.isFinite(buy)||!Number.isFinite(sell)||buy<=0||sell<buy||buy<10||sell>1000)
      return json({error:'PARALLEL_PRICE_INVALID'},502);
    const timestamp=String(usd.timestampUtc||provider.timestampUtc||'');
    const ts=Date.parse(timestamp);
    if(!Number.isFinite(ts)||ts>now+10*60*1000||now-ts>24*60*60*1000)
      return json({error:'PARALLEL_RATE_STALE'},502);
    const quote={timestampUtc:timestamp,marketRates:[{
      currency:'USD',buy,sell,timestampUtc:timestamp,
    }]};
    cached={data:quote,savedAt:now};
    return json(quote);
  }catch(_){return json({error:'PROVIDER_UNAVAILABLE'},502);}
});
