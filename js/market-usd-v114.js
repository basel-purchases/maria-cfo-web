// Maria CFO v1.0.14 — parallel-market USD quote, informational until explicitly approved.
// LiraScope reports NEW Syrian pounds. Maria CFO's historical base amounts are OLD SYP.
// 1 new SYP = 100 old SYP (2026 redenomination). Never use official/FX aggregator rates.
export const LIRASCOPE_USD_URL_V114 = 'https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD&lang=ar';
export const OLD_SYP_PER_NEW_V114 = 100;
export const MARKET_CACHE_MS_V114 = 6 * 60 * 60 * 1000;
export const MARKET_APPROVAL_MAX_AGE_MS_V114 = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;

function safeNumber(value){
  if(typeof value!=='number'&&typeof value!=='string')return NaN;
  if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return NaN;
  return Number(value);
}
const roundTwo = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function parseParallelUsdV114(body, nowMs=Date.now()){
  // The official source is cbsRates, whereas only marketRates is valid for this feature.
  if(!body || !Array.isArray(body.marketRates))throw new Error('MARKET_RATES_MISSING');
  const row=body.marketRates.find(r=>String(r?.currency||'').toUpperCase()==='USD');
  if(!row)throw new Error('PARALLEL_USD_MISSING');
  const buyNew=safeNumber(row.buy),sellNew=safeNumber(row.sell);
  if(!Number.isFinite(buyNew)||!Number.isFinite(sellNew)||buyNew<=0||sellNew<buyNew)
    throw new Error('MARKET_PRICE_INVALID');
  // Explicit safety barrier for the old/new unit mix-up; never automatically guess units.
  // The documented post-2026 API gives ~100–200 NEW SYP per dollar, not ~10,000–20,000.
  if(buyNew<10||sellNew>1000)throw new Error('MARKET_DENOMINATION_UNEXPECTED');
  const sourceDate=row.timestampUtc||body.timestampUtc;
  const updatedAtMs=Date.parse(sourceDate);
  if(!Number.isFinite(updatedAtMs)||updatedAtMs>nowMs+MAX_FUTURE_MS)
    throw new Error('MARKET_TIMESTAMP_INVALID');
  return Object.freeze({
    source:'LiraScope',kind:'parallel_market',rateSide:'sell',denomination:'old_SYP',
    buyNew,sellNew,buyOld:roundTwo(buyNew*OLD_SYP_PER_NEW_V114),
    sellOld:roundTwo(sellNew*OLD_SYP_PER_NEW_V114),
    updatedAt:new Date(updatedAtMs).toISOString(),fetchedAt:new Date(nowMs).toISOString(),
  });
}

export function marketQuoteFreshV114(quote,nowMs=Date.now(),maxAgeMs=MARKET_APPROVAL_MAX_AGE_MS_V114){
  if(!quote||quote.source!=='LiraScope'||quote.kind!=='parallel_market'||
     quote.denomination!=='old_SYP'||quote.rateSide!=='sell'||
     !(Number.isFinite(quote.sellOld)&&quote.sellOld>0) ||
     !(Number.isFinite(quote.buyOld)&&quote.buyOld>0&&quote.sellOld>=quote.buyOld))return false;
  const time=Date.parse(quote.updatedAt);
  return Number.isFinite(time)&&time<=nowMs+MAX_FUTURE_MS&&nowMs-time<=maxAgeMs;
}

export async function fetchParallelUsdV114({fetcher=fetch,nowMs=Date.now(),timeoutMs=9000}={}){
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),timeoutMs);
  try{
    const response=await fetcher(LIRASCOPE_USD_URL_V114,{method:'GET',mode:'cors',headers:{Accept:'application/json'},cache:'no-store',signal:abort.signal});
    if(!response.ok)throw new Error(response.status===429?'MARKET_RATE_LIMIT':'MARKET_PROVIDER_UNAVAILABLE');
    return parseParallelUsdV114(await response.json(),nowMs);
  }finally{clearTimeout(timeout);}
}

// A cached quote is for display only; adoption always requires a successful new fetch.
export function marketCachedQuoteV114(raw){
  if(!raw||typeof raw!=='object'||!raw.quote)return null;
  const q=raw.quote;
  if(!marketQuoteFreshV114(q,Date.now(),48*60*60*1000))return null;
  const fetched=Date.parse(raw.savedAt);
  if(!Number.isFinite(fetched)||fetched>Date.now()+MAX_FUTURE_MS)return null;
  return {quote:q,savedAt:fetched};
}
