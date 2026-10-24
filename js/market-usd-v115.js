// Maria CFO v1.0.15 — presentation and authenticated server-side quote transport.
// This module never contacts LiraScope from the browser: its public API has no
// cross-origin access guarantee. The fixed Supabase Edge Function is the bridge.
import {parseParallelUsdV114} from './market-usd-v114.js?v=1.0.14';

export const MARKET_DISPLAY_KEY_V115='maria_cfo_market_usd_denomination_v115';
export const MARKET_SIDE_KEY_V115='maria_cfo_market_usd_side_v115';
const validUnit=value=>value==='new'?'new':'old';
const validSide=value=>value==='buy'?'buy':'sell';

export function readMarketDisplayUnitV115(storage){
  try{return validUnit((storage??globalThis.localStorage)?.getItem(MARKET_DISPLAY_KEY_V115));}catch(_){return 'old';}
}
export function setMarketDisplayUnitV115(unit,{storage,notify=true}={}){
  const value=validUnit(unit);
  try{(storage??globalThis.localStorage)?.setItem(MARKET_DISPLAY_KEY_V115,value);}catch(_){}
  if(notify && typeof window!=='undefined' && typeof CustomEvent!=='undefined'){
    window.dispatchEvent(new CustomEvent('maria-market-display-unit-v115',{detail:{unit:value}}));
  }
  return value;
}
export function readMarketSideV115(storage){
  try{return validSide((storage??globalThis.localStorage)?.getItem(MARKET_SIDE_KEY_V115));}catch(_){return 'sell';}
}
export function setMarketSideV115(side,storage){
  const value=validSide(side);
  try{(storage??globalThis.localStorage)?.setItem(MARKET_SIDE_KEY_V115,value);}catch(_){}
  return value;
}
export function marketValueV115(quote,side='sell',unit='old'){
  if(!quote)return '—';
  const key=`${validSide(side)}${validUnit(unit)==='new'?'New':'Old'}`;
  const value=quote[key];
  if(!Number.isFinite(value)||value<=0)return '—';
  return Number(value).toLocaleString('en-US',{
    maximumFractionDigits:validUnit(unit)==='new'?2:0,
  });
}
export function marketProxyErrorCodeV115(error){
  const status=Number(error?.context?.status||error?.status||0);
  if(status===404)return 'MARKET_PROXY_NOT_DEPLOYED';
  if(status===401||status===403)return 'MARKET_PROXY_AUTH_REQUIRED';
  if(status===429)return 'MARKET_PROXY_RATE_LIMIT';
  const text=String(error?.message||error?.error||'');
  if(/not found|404/i.test(text))return 'MARKET_PROXY_NOT_DEPLOYED';
  if(/fetch|network|failed to send|timeout|abort/i.test(text))return 'MARKET_PROXY_CONNECTION_FAILED';
  return String(error?.code||error?.error||'MARKET_PROXY_UNAVAILABLE').slice(0,90);
}
export function marketProxyErrorTextV115(code){
  switch(code){
    case 'MARKET_PROXY_NOT_DEPLOYED':return 'وظيفة market-usd غير منشورة على Supabase. انشرها مرة واحدة من ملف الإصدار.';
    case 'MARKET_PROXY_AUTH_REQUIRED':return 'انتهت جلسة الاتصال أو لا توجد صلاحية؛ أعد تسجيل الدخول.';
    case 'MARKET_PROXY_RATE_LIMIT':return 'طلبات السعر كثيرة مؤقتًا. سيحاول النظام لاحقًا.';
    case 'PROVIDER_RATE_LIMIT':return 'وصل المصدر إلى حد الطلبات. سيحاول النظام لاحقًا.';
    case 'PROVIDER_UNAVAILABLE':return 'مصدر سعر السوق غير متاح مؤقتًا.';
    case 'PARALLEL_RATE_STALE':return 'آخر سعر أرسله المصدر قديم؛ لا يمكن اعتماده.';
    case 'PARALLEL_RATES_MISSING':
    case 'PARALLEL_USD_MISSING':
    case 'MARKET_RATES_MISSING':return 'لم يُرجع المصدر سعر الدولار في السوق الموازية.';
    case 'PARALLEL_PRICE_INVALID':
    case 'MARKET_PRICE_INVALID':
    case 'MARKET_DENOMINATION_UNEXPECTED':return 'أرقام سعر السوق غير متطابقة مع الوحدة المتوقعة؛ لم تُعتمد.';
    default:return 'تعذّر جلب سعر السوق عبر Supabase. تأكد من نشر وظيفة market-usd واتصالها بالمصدر.';
  }
}
export async function fetchParallelUsdViaSupabaseV115(client,{nowMs=Date.now()}={}){
  if(!client?.functions?.invoke)throw new Error('MARKET_PROXY_UNAVAILABLE');
  let result;
  try{result=await client.functions.invoke('market-usd',{body:{action:'latest'}});}
  catch(error){throw new Error(marketProxyErrorCodeV115(error));}
  if(result?.error){
    let code=marketProxyErrorCodeV115(result.error);
    // A deployed Function can return a useful JSON error (e.g. provider outage).
    if(code!=='MARKET_PROXY_NOT_DEPLOYED' && typeof result.error.context?.json==='function'){
      try{
        const details=await result.error.context.json();
        if(typeof details?.error==='string')code=details.error;
      }catch(_){}
    }
    throw new Error(code);
  }
  if(result?.data?.error)throw new Error(String(result.data.error));
  // No general-FX, official or effective rate is ever considered as a fallback.
  return parseParallelUsdV114(result?.data,nowMs);
}
