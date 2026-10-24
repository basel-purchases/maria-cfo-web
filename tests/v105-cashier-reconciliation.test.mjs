import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileCashierV105,cashierMoneyV105,detectCashierHeaderDateV105,prioritizeMenuByCashierPriceV105} from '../js/cashier-reconciliation-v105.js';
import {parseAmeenRows} from '../js/ameen-import-parser.js';
import {dailyPriceDifferences} from '../js/ameen-daily-v041.js';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const sourceTotals=[
  ['4535',500,552.50,552.50],
  ['4536',51160,56531.80,0],
  ['4533',1670,1845.35,1845.35],
  ['4538',3830,4088.50,4088.50],
  ['4537',3630,3922.75,3922.75],
  ['4539',16580,18320.90,0],
  ['4540',47510,52498.55,0],
  ['4534',4790,5226.65,5226.65],
];
const records=sourceTotals.map(([number,gross,net,reportedSyp])=>({number,date:'2026-10-11',netTotal:net,reportedSyp,
  items:[{lineNet:gross,quantity:1,unitPrice:gross,name:'اختبار'}]}));
test('cashier source report reconciles 8 orders and retains exact monetary amounts',()=>{
  const r=reconcileCashierV105(records);
  assert.equal(r.orders,8);
  assert.equal(r.gross,129670);
  assert.equal(r.net,142987);
  assert.equal(r.difference,13317);
  assert.equal(r.sypZeroOrders,3);
  assert.equal(r.sypZeroNet,127351.25);
  assert.equal(r.taxDirectlyReported,false);
  assert.equal(cashierMoneyV105(4088.4999999999995),'4,088.5 ل.س');
  assert.equal(cashierMoneyV105(552.5),'552.5 ل.س');
});
test('10.5% is a hypothetical model, never treated as source-proven tax',()=>{
  const r=reconcileCashierV105(records,10.5);
  assert.equal(r.assumed.ratePercent,10.5);
  assert.equal(r.assumed.coherent,true);
  assert.equal(r.assumed.discounts,270);
  assert.equal(r.assumed.additional,13587);
  assert.equal(r.taxDirectlyReported,false);
});
test('the actual parser treats original order net as income, not line sums or SYP cashbox column',()=>{
  const rows=[['رقم الطلب','التاريخ','صافي الطلب','ليرة سورية','اسم المادة','الوحدة','الكمية','السعر','صافي القلم'],
   ['4536',new Date('2026-10-11T11:30:00Z'),56531.8,0,'1 كغ كباب حلبي','كغ',1,4500,4500]];
  const parsed=parseAmeenRows('orders',rows);
  assert.equal(parsed.records[0].netTotal,56531.8);
  assert.equal(parsed.records[0].reportedSyp,0);
  assert.equal(parsed.records[0].items[0].unitPrice,4500);
  assert.equal(parsed.records[0].items[0].lineNet,4500);
  assert.equal(reconcileCashierV105(parsed.records).sypZeroOrders,1);
});
test('1 kilogram is not compared directly with 200g portion price',()=>{
 const vals=dailyPriceDifferences([{unitPrice:4500,referencePrice:900,qty:1,matchKind:'unit_prefix'},
   {unitPrice:450,referencePrice:400,qty:2,matchKind:'canonical'}]);
 assert.equal(vals.increase,100);
 assert.equal(vals.unitVariations,1);
});
test('date conflict is exposed to user without silently changing business day',()=>{
  const book={sheets:[{name:'رأسية التقرير',rows:[['اعتباراً من 10-10-2026 ولغاية 10-10-2026']]}]};
  const result=detectCashierHeaderDateV105(book,['2026-10-11']);
  assert.deepEqual(result.headerDates,['2026-10-10']);
  assert.equal(result.mismatch,true);
});
test('alternative menu picks show exact price matches first, not forced or silently selected',()=>{
 const values=[{name:'زيتون',menu_price:300},{name:'بيض',menu_price:200},{name:'بيض آخر',menu_price:200},{name:'كباب',menu_price:null}];
 const sorted=prioritizeMenuByCashierPriceV105(values,200);
 assert.deepEqual(sorted.slice(0,2).map(x=>x.name),['بيض','بيض آخر']);
 assert.equal(values[0].name,'زيتون');
});
test('new backend posts only newly imported orders into cashier transaction exactly once',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.5-Cashier-Receipts.sql');
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
 assert.match(sql,/daily_order_id uuid NOT NULL UNIQUE/);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS ameen_daily_cashbox_source_unique_v105/);
 assert.match(sql,/v_result:=public\.ameen_import_daily_v041/);
 assert.match(sql,/duplicateFile/);
 assert.match(sql,/WHERE import_id=v_import_id/);
 assert.match(sql,/record_cashbox_transaction\(/);
 assert.match(sql,/v_order\.source_net,'SYP'/);
 assert.match(sql,/DAILY_V105_MENU_PRICE_UPDATE_DISALLOWED/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.ameen_import_daily_v041/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDELETE FROM\b/);
 assert.doesNotMatch(sql,/UPDATE\s+public\.menu_items/i);
});
test('daily import UI keeps file prices, shows cashbox, monetary warnings and exact preview',()=>{
 const ui=read('js/pages/ameen-daily-v041.js');
 const api=read('js/api.js');
 assert.match(ui,/reconcileCashierV105\(records/);
 assert.match(ui,/صافي ملف الكاشير/);
 assert.match(ui,/صندوق قبض الكاشير/);
 assert.match(ui,/تنبيه سعر مختلف/);
 assert.match(ui,/cashPostedOrders/);
 assert.match(ui,/cashPostedSyp/);
 assert.match(ui,/sypZeroOrders/);
 assert.doesNotMatch(ui,/mode:'update'/);
 assert.match(api,/rpc\('ameen_import_daily_v105'/);
 assert.match(read('assets/styles.css'),/74vh/);
 assert.match(read('js/pages/payroll-v034.js'),/payroll-total-v105/);
 assert.match(read('index.html'),/config\.js/);
 assert.equal(read('VERSION').trim(),'1.0.14');
});
