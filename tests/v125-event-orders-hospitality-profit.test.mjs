import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 eventInternalPreviewV125,eventExternalPreviewV125,eventOrderLineV125,eventActualResultV125,
 eventReportRowsV125,isExternalHospitalityV125,eventOrderSourceV125
} from '../js/event-finance-v125.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.25-Event-Orders-Hospitality-Profit.sql');
const summary=()=>({
 actual_guest_count:20,earned_revenue_base:2000,included_food_cost_base:800,actual_other_expense_base:100,
 actual_labor_cost_base:100,order_food_cost_base:0,historical_cost_incomplete:false,
 revenue_base_v125:2750,cost_base_v125:1590,profit_base_v125:1160,
 extra_revenue_base_v125:750,extra_cost_base_v125:350,extra_due_original_v125:750,
 pending_extra_count_v125:2,hospitality_cost_base_v125:970,internal_revenue_base_v125:600,
 internal_cost_base_v125:300,internal_profit_base_v125:300,external_cost_base_v125:140,
 external_revenue_base_v125:150,external_sale_cost_base_v125:100,external_profit_base_v125:50,
 external_hospitality_cost_base_v125:40,additional_hospitality_cost_base_v125:50,
 unposted_hospitality_cost_base_v125:80,kitchen_hospitality_cost_base_v125:880,waste_cost_base_v125:20,
 extra_collected_base_v125:0,extra_collection_fx_base_v125:0,extra_due_currency_mismatch_v125:0,
 cost_incomplete_v125:false
});
test('v125 restaurant order: 2 x cost 30 / sale 50 adds cost 60, revenue 100 and profit 40',()=>{
 const p=eventInternalPreviewV125({quantity:2,unitCost:30,unitPrice:50,exchangeRate:1});
 assert.equal(p.totalCost,60);assert.equal(p.revenue,100);assert.equal(p.profit,40);assert.equal(p.unitProfit,20);
});
test('v125 complimentary restaurant hospitality is cost-only even when an old price remains in a disabled input',()=>{
 const p=eventInternalPreviewV125({quantity:2,unitCost:30,unitPrice:500,exchangeRate:1,billingMode:'hospitality'});
 assert.equal(p.totalCost,60);assert.equal(p.totalOriginal,0);assert.equal(p.revenue,0);assert.equal(p.profit,-60);
});
test('v125 cake purchase with 25 markup on 100 cost sells for 125 and contributes 25 profit',()=>{
 const p=eventExternalPreviewV125({quantity:1,unitCost:100,unitProfit:25,exchangeRate:1});
 assert.equal(p.totalCost,100);assert.equal(p.totalOriginal,125);assert.equal(p.revenue,125);assert.equal(p.profit,25);
});
test('v125 external markup is per purchase unit, not an accidental percentage or whole-order amount',()=>{
 const p=eventExternalPreviewV125({quantity:3,unitCost:80,unitProfit:20,exchangeRate:1});
 assert.equal(p.totalCost,240);assert.equal(p.revenue,300);assert.equal(p.profit,60);
});
test('v125 external complimentary purchase has zero sale and zero markup, and keeps its incurred cost',()=>{
 const p=eventExternalPreviewV125({quantity:2,unitCost:100,unitProfit:50,exchangeRate:1,billingMode:'hospitality'});
 assert.equal(p.revenue,0);assert.equal(p.unitProfit,0);assert.equal(p.totalCost,200);
});
test('v125 zero markup is allowed, and differs from missing markup',()=>{
 const p=eventExternalPreviewV125({quantity:1,unitCost:100,unitProfit:0,exchangeRate:1});
 assert.equal(p.profit,0);
 for(const value of [null,undefined,'',NaN,Infinity,-1]){
  assert.throws(()=>eventExternalPreviewV125({quantity:1,unitCost:100,unitProfit:value,exchangeRate:1}));
 }
});
test('v125 base and event currencies are converted before adding sale revenue and profit',()=>{
 const p=eventExternalPreviewV125({quantity:1,unitCost:100,unitProfit:25,exchangeRate:2});
 assert.equal(p.totalOriginal,62.5);assert.equal(p.revenue,125);assert.equal(p.profit,25);
 const i=eventInternalPreviewV125({quantity:2,unitCost:30,unitPrice:25,exchangeRate:2});
 assert.equal(i.totalOriginal,50);assert.equal(i.revenue,100);assert.equal(i.profit,40);
});
test('v125 a missing or invalid manual cost is never silently zero',()=>{
 for(const cost of [null,undefined,'',NaN,Infinity,-1]){
  assert.throws(()=>eventInternalPreviewV125({quantity:1,unitCost:cost,unitPrice:10,exchangeRate:1}));
 }
 assert.equal(eventInternalPreviewV125({quantity:1,unitCost:0,unitPrice:10,exchangeRate:1}).profit,10);
});
test('v125 paid revenue uses the stored sales FX rate, not cash received at a later rate',()=>{
 const p=eventOrderLineV125({status:'paid',amount_original:125,exchange_rate_to_base:1,total_cost_base:100,paid_amount_base:150});
 assert.equal(p.revenue,125);assert.equal(p.cost,100);assert.equal(p.profit,25);
});
test('v125 pending, paid, refunded and voided rows have distinct cost/revenue effects',()=>{
 const row={amount_original:125,exchange_rate_to_base:1,total_cost_base:100};
 for(const status of ['pending','paid'])assert.equal(eventOrderLineV125({...row,status}).profit,25);
 const refunded=eventOrderLineV125({...row,status:'refunded'});
 assert.equal(refunded.revenue,0);assert.equal(refunded.cost,100);assert.equal(refunded.profit,-100);
 const voided=eventOrderLineV125({...row,status:'voided'});
 assert.equal(voided.revenue,0);assert.equal(voided.cost,0);
});
test('v125 purchase remains costed when its linked sales invoice is voided',()=>{
 const h=summary();
 Object.assign(h,{revenue_base_v125:2600,profit_base_v125:1010,external_revenue_base_v125:0,external_profit_base_v125:-100});
 const a=eventActualResultV125({historical:h});
 assert.equal(a.externalCost,140);assert.equal(a.externalSaleCost,100);
 assert.equal(a.externalProfit,-100);assert.equal(a.cost,1590);assert.equal(a.profit,1010);
});
test('v125 canonical summary is mandatory; a missing migration never falls back to zero',()=>{
 assert.throws(()=>eventActualResultV125(),/V125_FINANCIAL_SUMMARY_MISSING/);
 assert.throws(()=>eventActualResultV125({historical:{...summary(),cost_base_v125:null}}),/V125_FINANCIAL_SUMMARY_MISSING/);
});
test('v125 report cost rows reconcile with the event total without adding linked external costs or hospitality twice',()=>{
 const h=summary(),a=eventActualResultV125({historical:h});
 const q={food:800,externalFood:0,others:100,labor:100,reserve:20,total:1020,revenue:2000,profit:980};
 const rows=eventReportRowsV125(q,a,h),costRows=rows.slice(0,9);
 assert.equal(costRows.reduce((s,r)=>s+r.actual,0),1590);
 assert.equal(rows.find(r=>r.label==='التكلفة الإجمالية').actual,1590);
 assert.equal(rows.at(-1).actual,2750-1590);assert.equal(a.hospitalityCost,970);
 assert.equal(a.costPerPerson,79.5);
});
test('v125 pending row count blocks closure even when a rounded monetary due would appear zero',()=>{
 const a=eventActualResultV125({historical:{...summary(),extra_due_original_v125:0,pending_extra_count_v125:1}});
 assert.equal(a.readyToClose,false);
 const b=eventActualResultV125({historical:{...summary(),extra_due_original_v125:0,pending_extra_count_v125:0}});
 assert.equal(b.readyToClose,true);
});
test('v125 hospitality selector excludes resale purchases and preserves legacy hospitality purchases',()=>{
 assert.equal(isExternalHospitalityV125({is_active:true}),true);
 assert.equal(isExternalHospitalityV125({is_active:true,billing_mode_v125:'sale'}),false);
 assert.equal(isExternalHospitalityV125({is_active:false,billing_mode_v125:'hospitality'}),false);
 assert.equal(eventOrderSourceV125({status:'complimentary',source_v125:'internal'}),'ضيافة إضافية مجانية');
 assert.equal(eventOrderSourceV125({status:'paid',source_v125:'legacy'}),'طلب إضافي سابق');
});
test('v125 SQL has atomic request keys and a unique purchase-to-sales-invoice link',()=>{
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS event_extra_request_v125/);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS event_external_request_v125/);
 assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS event_external_invoice_v125/);
 assert.match(sql,/V125_REQUEST_REUSED_WITH_DIFFERENT_DATA/);
 assert.match(sql,/v_existing_payload IS DISTINCT FROM v_payload/);
 assert.match(sql,/PERFORM public\.event_price_external_dish_v125\(v_id,p_unit_profit_base\)/);
});
test('v125 SQL summary excludes linked purchase costs from extra cost and excludes hospitality from sales',()=>{
 assert.match(sql,/sum\(x\.total_cost_base\) FILTER \(WHERE x\.status IN \('pending','paid','refunded','complimentary'\) AND x\.external_dish_id_v125 IS NULL\)/);
 assert.match(sql,/round\(x\.amount_original\*x\.exchange_rate_to_base,4\)/);
 assert.match(sql,/WHERE x\.status IN \('pending','paid'\)/);
 assert.match(sql,/d\.posted_menu_rule_id IS NULL/);
 assert.match(sql,/i\.voided_at IS NULL/);
 assert.match(sql,/revenue_base_v125-cost_base_v125 AS profit_base_v125/);
 assert.doesNotMatch(sql,/revenue_base_v125\s*\+\s*.*profit_base_v125/);
});
test('v125 SQL has owner-only writers, an invoker view, immutable costs and no historical migration DML',()=>{
 assert.match(sql,/WITH \(security_invoker=true\)/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.event_order_bucket_v125\(uuid\) FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/V125_ORDER_FINANCIAL_FIELDS_IMMUTABLE/);
 const outsideBodies=sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g,'');
 assert.doesNotMatch(outsideBodies,/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);
 assert.doesNotMatch(sql,/INSERT INTO public\.cashbox_transactions/);
});
test('v125 SQL blocks sale purchases in hospitality and protects supplier/customer settlements on cancellation',()=>{
 assert.match(sql,/V125_SALE_NOT_HOSPITALITY/);
 assert.match(sql,/V125_EXTERNAL_IN_HOSPITALITY/);
 assert.match(sql,/V125_EXTERNAL_CUSTOMER_SETTLED/);
 assert.match(sql,/event_demand_hospitality_guard_v125 BEFORE INSERT OR UPDATE/);
 assert.match(sql,/v_extra:=public\.event_lock_extra_v125\(p_extra_id\)/);
 assert.match(sql,/status IN \('planning','open','confirmed'\) FOR UPDATE/);
});
test('v125 UI, API, report export and cache bust all target the new release',()=>{
 const page=read('js/pages/events-v034.js'),api=read('js/api.js');
 assert.match(page,/eventSummaryV125\(eventId\)/);
 assert.match(page,/eventActualResultV125/);
 assert.match(page,/eventAddInternalOrderV125/);assert.match(page,/eventAddExternalDishV125/);
 assert.match(page,/eventPriceExternalDishV125/);
 assert.match(page,/eventReportRowsV125\(q,a,state\.summary\)/);
 assert.match(page,/name="unitCost"[^>]+required/);assert.doesNotMatch(page,/name="unitCost"[^>]+value="0"/);
 assert.match(page,/filter\(isExternalHospitalityV125\)/);
 assert.match(api,/p_request_key:input\.requestKey/);
 assert.match(api,/input\.unitCost===''[^\n]+null:Number\(input\.unitCost\)/);
 assert.match(read('js/app.js'),/events-v034\.js\?v=1\.0\.30/);
 assert.equal(read('VERSION').trim(),'1.0.30');
 assert.match(read('index.html'),/styles\.css\?v=1\.0\.30/);
 assert.equal(fs.existsSync(new URL('../config.js',import.meta.url)),false);
});

test('v125 fixed hospitality is charged even in orders-only events without double-counting closed on-demand rules',()=>{
 assert.match(sql,/CASE WHEN h\.revenue_mode='orders'[\s\S]*?estimated_actual_included_food_cost_base/);
 assert.match(sql,/h\.orders_mode_hospitality_base_v125\+coalesce\(d\.unposted_cost,0\) AS kitchen_hospitality_cost_base_v125/);
 assert.match(sql,/WHERE d\.menu_item_id IS NOT NULL AND d\.posted_menu_rule_id IS NULL/);
 assert.doesNotMatch(sql,/d\.posted_menu_rule_id IS NULL OR e\.revenue_mode='orders'/);
 const h={...summary(),included_food_cost_base:0,kitchen_hospitality_cost_base_v125:880,revenue_mode:'orders'};
 const a=eventActualResultV125({historical:h});
 const rows=eventReportRowsV125({food:0,externalFood:0},a,h);
 assert.equal(rows[0].actual,880);
 assert.equal(rows.slice(0,9).reduce((s,r)=>s+r.actual,0),1590);
});
test('v125 a zero-cost zero-markup external item must use hospitality rather than a zero-value sale',()=>{
 assert.throws(()=>eventExternalPreviewV125({quantity:1,unitCost:0,unitProfit:0,exchangeRate:1}),/V125_SALE_PRICE_REQUIRED/);
 assert.equal(eventExternalPreviewV125({quantity:1,unitCost:0,exchangeRate:1,billingMode:'hospitality'}).totalCost,0);
});
