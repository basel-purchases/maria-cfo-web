import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {
 parseParallelUsdV114,fetchParallelUsdV114,marketQuoteFreshV114,marketCachedQuoteV114,
 OLD_SYP_PER_NEW_V114,MARKET_CACHE_MS_V114,LIRASCOPE_USD_URL_V114,
} from '../js/market-usd-v114.js';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(dir,path),'utf8');
const now=Date.parse('2026-10-24T09:00:00Z');
const service=(overrides={})=>({timestampUtc:'2026-10-24T08:55:00Z',
 cbsRates:[{currency:'USD',buy:121.5,sell:122.5}],
 effectiveRates:[{currency:'USD',buy:130,sell:131}],
 marketRates:[{currency:'USD',buy:140.25,sell:141.75,timestampUtc:'2026-10-24T08:59:00Z'}],...overrides});

test('selects ONLY the Syrian parallel-market sell rate; converts new SYP x100 to old SYP',()=>{
 assert.equal(OLD_SYP_PER_NEW_V114,100);
 const q=parseParallelUsdV114(service(),now);
 assert.equal(q.sellNew,141.75);
 assert.equal(q.sellOld,14175);
 assert.equal(q.buyOld,14025);
 assert.equal(q.source,'LiraScope');
 assert.equal(q.rateSide,'sell');
 assert.equal(q.denomination,'old_SYP');
 assert.equal(q.kind,'parallel_market');
 assert.equal(marketQuoteFreshV114(q,now),true);
 assert.ok(LIRASCOPE_USD_URL_V114.includes('currencies=USD&lang=ar'));
 assert.equal(MARKET_CACHE_MS_V114,6*60*60*1000);
});

test('official-only response is rejected — no silent fallback to central bank, effective or general FX',()=>{
 assert.throws(()=>parseParallelUsdV114({cbsRates:service().cbsRates,effectiveRates:service().effectiveRates},now),/MARKET_RATES_MISSING/);
 assert.throws(()=>parseParallelUsdV114(service({marketRates:[{currency:'EUR',sell:155,buy:154}]}),now),/PARALLEL_USD_MISSING/);
});

test('invalid old-unit raw value, inverted spreads and missing timestamp are rejected',()=>{
 assert.throws(()=>parseParallelUsdV114(service({marketRates:[{currency:'USD',buy:14000,sell:14175}]}),now),/MARKET_DENOMINATION_UNEXPECTED/);
 assert.throws(()=>parseParallelUsdV114(service({marketRates:[{currency:'USD',buy:150,sell:140}]}),now),/MARKET_PRICE_INVALID/);
 assert.throws(()=>parseParallelUsdV114(service({timestampUtc:null,marketRates:[{currency:'USD',buy:140,sell:141}]}),now),/MARKET_TIMESTAMP_INVALID/);
 assert.throws(()=>parseParallelUsdV114(service({timestampUtc:'2026-10-25T10:00:00Z',marketRates:[{currency:'USD',buy:140,sell:141}]}),now),/MARKET_TIMESTAMP_INVALID/);
});

test('stale quote is display-only, not valid for rate approval',()=>{
 const oldBody=service({timestampUtc:'2026-10-21T08:59:00Z',marketRates:[{currency:'USD',buy:140,sell:141}]});
 const q=parseParallelUsdV114(oldBody,now);
 assert.equal(marketQuoteFreshV114(q,now),false);
 assert.equal(marketCachedQuoteV114({quote:q,savedAt:new Date(now).toISOString()}),null);
});

test('loads stored quotes for display but refresh on approval; no unverified approval',()=>{
 const q=parseParallelUsdV114(service(),Date.now());
 // Display-only cache may be used; approval performs a fresh authenticated fetch.
 assert.ok(marketCachedQuoteV114({quote:q,savedAt:new Date().toISOString()}));
 const app=read('js/app.js');
 assert.match(app,/const q=await refreshMarketUsdV115\(\{force:true\}\)/);
 assert.match(app,/if\(!marketQuoteFreshV114\(q\)\)/);
 assert.match(app,/await api\.materialPriceApplyExchangeV110\(rate,update\)/);
 assert.match(app,/data-market-fx-update/);
 assert.match(app,/data-market-fx-only/);
 assert.match(app,/data-market-fx-cancel/);
 assert.match(app,/disabled>✓/);
});

test('uses a single GET with a timeout and returns well-formed normalized quote',async()=>{
 let calls=0;
 const q=await fetchParallelUsdV114({nowMs:now,fetcher:async(url,opts)=>{
  calls+=1;
  assert.equal(url,LIRASCOPE_USD_URL_V114);
  assert.equal(opts.method,'GET');
  assert.equal(opts.cache,'no-store');
  return {ok:true,json:async()=>service()};
 }});
 assert.equal(calls,1);
 assert.equal(q.sellOld,14175);
 await assert.rejects(()=>fetchParallelUsdV114({fetcher:async()=>({ok:false,status:429}),nowMs:now}),/MARKET_RATE_LIMIT/);
});

test('header is adjacent to bell, has explicit approval button and no automatic writes',()=>{
 const app=read('js/app.js'),css=read('assets/styles.css'),index=read('index.html');
 const a=app.indexOf('id="ai-notify-btn"'),b=app.indexOf('id="market-usd-chip"');
 assert.ok(a>0&&b>a&&b-a<1400);
 assert.match(app,/id="market-usd-approve"/);
 assert.match(app,/marketCacheSaveV115/);
 assert.match(css,/\.market-usd-group-v115/);
 assert.match(css,/@media\(max-width:430px\)/);
 assert.equal(read('VERSION').trim(),'1.0.17');
 assert.match(index,/Web v1\.0\.17/);
 assert.match(app,/Web v1\.0\.17/);
 assert.equal(existsSync(resolve(dir,'config.js')),false);
});

test('optional Edge Function proxies one fixed LiraScope path after owner authentication',()=>{
 const edge=read('supabase/functions/market-usd/index.ts');
 assert.match(edge,/public|lirascope\.syria-cloud\.sy/);
 assert.match(edge,/is_app_owner/);
 assert.match(edge,/provider\.marketRates/);
 assert.doesNotMatch(edge,/[.\[]cbsRates|[.\[]effectiveRates/);
 assert.match(edge,/PROVIDER_UNAVAILABLE/);
});
