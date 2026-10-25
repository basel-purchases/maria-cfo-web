import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {
  MARKET_DISPLAY_KEY_V115,MARKET_SIDE_KEY_V115,
  marketValueV115,readMarketDisplayUnitV115,setMarketDisplayUnitV115,
  readMarketSideV115,setMarketSideV115,
  marketProxyErrorCodeV115,marketProxyErrorTextV115,fetchParallelUsdViaSupabaseV115,
} from '../js/market-usd-v115.js';

const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(dir,p),'utf8');
const now=Date.parse('2026-10-24T12:00:00Z');
const payload={timestampUtc:'2026-10-24T11:59:00Z',marketRates:[{
  currency:'USD',buy:140,sell:141.75,timestampUtc:'2026-10-24T11:59:00Z',
}],cbsRates:[{currency:'USD',buy:115,sell:120}]};
const storage=()=>{
  const entries=new Map();return {getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)};
};

test('compact header formats market sell or buy using old/new SYP with no unit label',async()=>{
  let calls=0;
  const q=await fetchParallelUsdViaSupabaseV115({functions:{invoke:async(name,args)=>{
    assert.equal(name,'market-usd');
    assert.deepEqual(args,{body:{action:'latest'}});
    calls++;return {data:payload,error:null};
  }}},{nowMs:now});
  assert.equal(calls,1);
  assert.equal(q.sellNew,141.75);
  assert.equal(marketValueV115(q,'sell','new'),'141.75');
  assert.equal(marketValueV115(q,'sell','old'),'14,175');
  assert.equal(marketValueV115(q,'buy','new'),'140');
  assert.equal(marketValueV115(q,'buy','old'),'14,000');
  assert.equal(marketValueV115(null,'buy','old'),'—');
});

test('display denomination and buy/sell choice persist without database writes',()=>{
  const mem=storage();
  assert.equal(readMarketDisplayUnitV115(mem),'old');
  assert.equal(setMarketDisplayUnitV115('new',{storage:mem,notify:false}),'new');
  assert.equal(readMarketDisplayUnitV115(mem),'new');
  assert.equal(mem.getItem(MARKET_DISPLAY_KEY_V115),'new');
  assert.equal(setMarketDisplayUnitV115('invalid',{storage:mem,notify:false}),'old');
  assert.equal(readMarketSideV115(mem),'sell');
  assert.equal(setMarketSideV115('buy',mem),'buy');
  assert.equal(readMarketSideV115(mem),'buy');
  assert.equal(mem.getItem(MARKET_SIDE_KEY_V115),'buy');
});

test('proxy 404 and auth errors are actionable; no official/general-FX fallback',async()=>{
  assert.equal(marketProxyErrorCodeV115({context:{status:404}}),'MARKET_PROXY_NOT_DEPLOYED');
  assert.equal(marketProxyErrorCodeV115({context:{status:401}}),'MARKET_PROXY_AUTH_REQUIRED');
  assert.match(marketProxyErrorTextV115('MARKET_PROXY_NOT_DEPLOYED'),/Supabase/);
  await assert.rejects(()=>fetchParallelUsdViaSupabaseV115({functions:{invoke:async()=>({error:{context:{status:404}}})}}),/MARKET_PROXY_NOT_DEPLOYED/);
  await assert.rejects(()=>fetchParallelUsdViaSupabaseV115({functions:{invoke:async()=>({data:{cbsRates:payload.cbsRates}})}}),/MARKET_RATES_MISSING/);
  await assert.rejects(()=>fetchParallelUsdViaSupabaseV115({functions:{invoke:async()=>({error:{context:{status:502,json:async()=>({error:'PROVIDER_UNAVAILABLE'})}}})}}),/PROVIDER_UNAVAILABLE/);
  await assert.rejects(()=>fetchParallelUsdViaSupabaseV115(null),/MARKET_PROXY_UNAVAILABLE/);
});

test('the shell uses one server-side path and a numeric-only chip with side/approve controls',()=>{
  const app=read('js/app.js');
  const markup=app.split('<div class="market-usd-group-v115"')[1].split('</header>')[0];
  assert.ok(markup);
  assert.match(markup,/id="market-usd-value"/);
  assert.match(markup,/id="market-usd-side"/);
  assert.match(markup,/id="market-usd-approve"/);
  assert.doesNotMatch(markup,/دولار السوق ·|ل\.س قديمة|جارٍ التحديث/);
  assert.match(app,/marketStateV115\.side=setMarketSideV115/);
  assert.match(app,/side==='buy'\?q\.buyOld:q\.sellOld/);
  assert.match(app,/fetchParallelUsdViaSupabaseV115\(supabase\)/);
  assert.doesNotMatch(app,/await fetchParallelUsdV114\(/);
  assert.match(app,/MARKET_CACHE_KEY_V115/);
  assert.match(app,/Web v1\.0\.17/);
  assert.equal(read('VERSION').trim(),'1.0.17');
  assert.equal(existsSync(resolve(dir,'config.js')),false);
});

test('settings offer old or new pound presentation without changing financial records',()=>{
  const settings=read('js/pages/settings.js');
  assert.match(settings,/id="usd-market-unit-v115"/);
  assert.match(settings,/ليرة قديمة \(14,000\)/);
  assert.match(settings,/ليرة جديدة \(140\)/);
  assert.match(settings,/setMarketDisplayUnitV115\(e\.target\.value\)/);
  const css=read('assets/styles.css');
  assert.match(css,/\.market-usd-chip-v115/);
  assert.match(css,/\.market-usd-side-v115/);
  assert.match(css,/@media\(max-width:430px\)/);
  assert.match(read('index.html'),/v=1\.0\.17/);
});

test('Edge Function checks logged-in owner, uses a fixed provider URL, responds with CORS and only market prices',()=>{
  const edge=read('supabase/functions/market-usd/index.ts');
  assert.match(edge,/Access-Control-Allow-Origin/);
  assert.match(edge,/req\.method==='OPTIONS'/);
  assert.match(edge,/getUser\(token\)/);
  assert.match(edge,/rpc\('is_app_owner'\)/);
  assert.match(edge,/lirascope\.syria-cloud\.sy\/api\/v1\/rates\/latest/);
  assert.match(edge,/provider\.marketRates\.find/);
  assert.match(edge,/CACHE_TTL_MS/);
  assert.doesNotMatch(edge,/provider\.cbsRates|provider\.effectiveRates/);
});
