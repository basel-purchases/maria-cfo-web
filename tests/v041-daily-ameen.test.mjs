import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dailyMetrics,dailyCashboxes,dailyPriceDifferences,summarizeOrderPreview} from '../js/ameen-daily-v041.js';
import {parseAmeenRows} from '../js/ameen-import-parser.js';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const header=['رقم الطلب','التاريخ','صافي الطلب','اسم المادة','الكمية','السعر','صافي القلم','الصندوق','ليرة سورية'];
test('v0.41: eight cashier orders are eight records; 89 item lines stay distinct',()=>{
 const rows=[header];
 for(let i=0;i<8;i++)for(let j=0;j<(i===7?12:11);j++)rows.push([
  String(100+i),'2026-10-15 10:00:00',1000,'وجبة '+j,1,100,100,'صندوق 1',1000
 ]);
 const data=parseAmeenRows('orders',rows);
 assert.equal(data.records.length,8);
 assert.equal(data.records.reduce((n,r)=>n+r.items.length,0),89);
 assert.equal(data.records[0].cashbox,'صندوق 1');
 assert.equal(summarizeOrderPreview(data.records).orders,8);
 assert.equal(summarizeOrderPreview(data.records).lines,89);
});
test('v0.41: unknown costs never become zero or fake full-day profit',()=>{
 const orders=[{id:'a',net:6000},{id:'b',net:4000}];
 const lines=[
  {orderId:'a',qty:2,lineNet:6000,cost:1000,costKind:'recipe'},
  {orderId:'b',qty:1,lineNet:4000,cost:null,costKind:'missing'},
 ];
 const r=dailyMetrics(orders,lines);
 assert.equal(r.revenue,10000);
 assert.equal(r.knownCost,2000);
 assert.equal(r.unknownLines,1);
 assert.equal(r.partialMargin,4000);
 assert.equal(r.projectedMargin,null);
 assert.equal(r.complete,false);
});
test('v0.41: optional menu estimate contributes without pretending to be actual recipe',()=>{
 const orders=[{id:'a',net:1500}];
 const lines=[{orderId:'a',qty:3,lineNet:1500,cost:200,costKind:'estimate'}];
 const s=dailyMetrics(orders,lines);
 assert.equal(s.complete,true);assert.equal(s.estimatedLines,1);
 assert.equal(s.knownCost,600);assert.equal(s.projectedMargin,900);
});
test('v0.41: source price differences are informational and NOT added twice',()=>{
 const line=[{orderId:'a',qty:2,referencePrice:400,unitPrice:500,lineNet:1000,cost:100,costKind:'recipe'}];
 const r=dailyMetrics([{id:'a',net:1000}],line);
 const d=dailyPriceDifferences(line);
 assert.equal(r.revenue,1000);assert.equal(d.increase,200);assert.equal(r.projectedMargin,800);
 assert.equal(d.decrease,0);
});
test('v0.41: negative unit price difference is distinguished from order-level net discount',()=>{
 const l=[{orderId:'a',qty:1,referencePrice:600,unitPrice:400,lineNet:400,cost:150,costKind:'recipe'}];
 const r=dailyMetrics([{id:'a',net:380}],l);
 assert.equal(dailyPriceDifferences(l).decrease,200);
 assert.equal(r.discounts,-20);
 assert.equal(r.projectedMargin,230);
});
test('v0.41: cashier grouping never claims unknown cashbox to be the general box',()=>{
 const r=dailyCashboxes([{cashbox:'غير محدد في التقرير',net:3000},{cashbox:'صندوق 1',net:2000},{cashbox:'صندوق 1',net:800}]);
 assert.equal(r.find(x=>x.name==='صندوق 1').total,2800);
 assert.equal(r.find(x=>x.name==='غير محدد في التقرير').total,3000);
});
test('v0.41: protected importer is atomic, idempotent, and does not post cash twice',()=>{
 const sql=read('database/Maria-CFO-Web-v0.41-Daily-Ameen-Orders.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 for(const fn of ['ameen_import_daily_v041','ameen_price_preview_v041','ameen_price_undo_v041','ameen_daily_report_v041','ameen_daily_days_v041','menu_set_estimate_v041'])
  assert.match(sql,new RegExp('FUNCTION public\\.'+fn+'\\('));
 assert.match(sql,/UNIQUE\(business_date,external_number\)/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/source_fingerprint=|source_fingerprint INTO/);
 assert.match(sql,/v_conflicts:=v_conflicts\+1/);
 assert.match(sql,/v_effective/);
 assert.match(sql,/CREATE TRIGGER menu_price_audit_v041_trg/);
 assert.match(sql,/PRICE_CHANGED_SINCE_AUDIT/);
 assert.match(sql,/cost_is_missing/);
 assert.doesNotMatch(sql,/PERFORM public\.record_cashbox_transaction|INSERT INTO public\.cashbox_transactions|PERFORM public\.post_order/);
});
test('v0.41: independent sidebar, daily preview, order audit and menu missing-cost route are wired',()=>{
 const a=read('js/app.js'),d=read('js/pages/ameen-daily-v041.js'),m=read('js/pages/menu.js'),e=read('js/pages/events-v034.js');
 for(const tag of ['#/daily-orders','renderAmeenDailyV041','Web v1.0','case \'ameen-daily\''])assert.ok(a.includes(tag),tag);
 for(const tag of ['readAmeenWorkbook','parseAmeenRows','ameenPricePreviewV041','ameenImportDailyV041','data-price-index','ameenPriceUndoV041','menu/unpriced','duplicateFile','conflicts','source'])assert.ok(d.includes(tag),tag);
 assert.match(m,/menuMissingCostPageV041/);assert.match(m,/estimatedCost/);
 assert.doesNotMatch(e,/<a class="mini-btn event-action-v035 primary" href="#\/event-bookings/);
 assert.match(read('index.html'),/app\.js\?v=1\.0/);
});
