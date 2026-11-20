import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {supplierPriceTrendsV124} from '../js/supplier-price-trends-v124.js';
import {validateCashboxOverviewV124} from '../js/cashbox-continuity-v124.js';
import {expectedCashboxBalanceV116,cashboxQuickEntriesV116} from '../js/cashbox-summary-v116.js';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(resolve(base,file),'utf8');
const invoice=(id,date,currency='SYP',status='posted',other={})=>({id,invoice_date:date,currency_code:currency,status,...other});
const line=(invoice_id,price,quantity=1,discount=0,unit='kg',material='m')=>({id:invoice_id,invoice_id,material_id:material,
  material_name:'قهوة',purchase_unit_id:unit,unit_name:unit,quantity_purchase_unit:quantity,unit_price_original:price,line_discount_original:discount});

test('price trend shows exact same material/unit/currency net unit change only',()=>{
 const a={invoices:[invoice('a','2026-11-11'),invoice('b','2026-11-14'),invoice('c','2026-11-15','USD'),invoice('d','2026-11-16','SYP','draft'),invoice('e','2026-11-17','SYP','posted',{is_voided:true})],
  items:[line('a',100,2),line('b',120,2,10),line('c',5),line('d',1),line('e',1)]};
 const result=supplierPriceTrendsV124(a);
 assert.equal(result.length,2);
 const syp=result.find(x=>x.currency==='SYP'),usd=result.find(x=>x.currency==='USD');
 assert.equal(syp.previousPrice,100);
 assert.equal(syp.lastPrice,115);
 assert.equal(syp.percentChange,15);
 assert.equal(syp.sampleCount,2);
 assert.equal(usd.previousPrice,null);
 assert.equal(usd.percentChange,null);
});

test('never compare different purchase units or use cancelled/referenced invoices',()=>{
 const activity={invoices:[invoice('a','2026-01-01'),invoice('b','2026-01-03'),invoice('c','2026-01-04','SYP','posted',{is_ameen_legacy_v029:true}),invoice('d','2026-01-05','SYP','posted',{archived_at_v122:'2026-01-05'})],
 items:[line('a',50,1,0,'box'),line('b',70,1,0,'kg'),line('c',100,1,0,'box'),line('d',800,1,0,'box')]};
 const r=supplierPriceTrendsV124(activity);
 assert.equal(r.length,2);
 assert.ok(r.every(x=>x.percentChange===null));
 assert.equal(r.find(x=>x.unitName==='box').lastPrice,50);
});

test('same material lines in the same invoice count as one weighted purchase',()=>{
 const a={invoices:[invoice('inv','2026-11-11')],items:[line('inv',100,1),{...line('inv',200,3),id:'second'}]};
 const r=supplierPriceTrendsV124(a);
 assert.equal(r.length,1);
 assert.equal(r[0].sampleCount,1);
 assert.equal(r[0].lastPrice,175);
 assert.equal(r[0].percentChange,null);
});

test('new-day session with zero summary cannot hide persistent cashbox balance',()=>{
 const o=[{cashbox:{id:'a',name:'الصندوق العام'},session:{business_date:'2026-11-20'},summary:{expected_balance_base:0,live_balance_base_v124:4143919.29}},
  {cashbox:{id:'b',name:'صندوق 1'},summary:{expected_balance_base:0,live_balance_base_v124:142987}}];
 assert.deepEqual(validateCashboxOverviewV124(o),o);
 assert.equal(expectedCashboxBalanceV116(o[0].summary),4143919.29);
 assert.equal(cashboxQuickEntriesV116(o)[0].balance,4143919.29);
 assert.throws(()=>validateCashboxOverviewV124([{cashbox:{id:'a'},summary:{expected_balance_base:0}}]),/V124_CASHBOX_BALANCE_MISSING/);
 assert.throws(()=>validateCashboxOverviewV124([{cashbox:{id:'a'},summary:{live_balance_base_v124:'invalid'}}]),/V124_CASHBOX_BALANCE_MISSING/);
});

test('SQL carries unsettled open-day cash and uses business timezone without mutating historical sessions',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.24-Cashbox-Continuity.sql');
 for(const fn of ['cashbox_live_balance_base_v124','get_or_create_cashbox_session','ensure_cashbox_day_v013','cashbox_business_today_v124','get_cashbox_overview_v124'])
  assert.match(sql,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+fn+'\\('));
 assert.match(sql,/AND t\.is_void = FALSE/);
 assert.match(sql,/s\.status = 'closed'/);
 assert.match(sql,/s\.business_date > v_checkpoint_date/);
 assert.match(sql,/v_today - 1/);
 assert.match(sql,/now\(\) AT TIME ZONE COALESCE\(v_timezone,'UTC'\)/);
 assert.doesNotMatch(sql,/\bTRUNCATE\s+TABLE\b|\bDELETE\s+FROM\s+public\.cashbox|\bUPDATE\s+public\.cashbox/i);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/COMMIT;/);
});

test('all cashbox presentations use the v124 balance, and navigation exposes supplier analytics',()=>{
 const api=read('js/api.js'),app=read('js/app.js'),cash=read('js/pages/daily.js');
 const dash=read('js/pages/dashboard.js'),suppliers=read('js/pages/suppliers.js'),css=read('assets/styles.css');
 assert.match(api,/rpc\('cashbox_business_today_v124'\)/);
 assert.match(api,/rpc\('get_cashbox_overview_v124'/);
 assert.doesNotMatch(api.slice(api.indexOf('export async function cashboxOverview'),api.indexOf('export async function cashboxManualTransactions')),/catch\s*\(/);
 assert.match(app,/\['#\/suppliers', 'الموردون وإحصائياتهم'\]/);
 assert.match(dash,/cashOverviewRows/);
 assert.match(cash,/الرصيد المستمر حتى الآن/);
 assert.match(suppliers,/data-supplier-tab="prices"/);
 assert.match(suppliers,/supplierPriceTrendsV124\(activity\)/);
 assert.match(css,/\.staff-profile-insights\[data-employee-insights\]\{display:flex;flex-direction:column/);
 assert.match(css,/\.staff-v124-history-wrap\{width:100%/);
 assert.equal(read('VERSION').trim(),'1.0.27');
 assert.match(read('index.html'),/v=1\.0\.27/);
});
