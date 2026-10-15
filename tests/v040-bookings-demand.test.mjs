import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reservationDashboardV040,onDemandRowsV040,onDemandTotalsV040} from '../js/event-on-demand-v040.js';
import {planningTablesV039} from '../js/event-planning-v039.js';
import {eventMoneyV038,eventGuestSummaryV038} from '../js/event-v038.js';
const text=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tables=Array.from({length:25},(_,i)=>({id:`t${i}`,capacity:8,table_label:`طاولة ${i+1}`,status:'available',booking_id:i===0?'booking-1':null,planned_guest_count:i===0?7:0}));
test('v0.40: planned 200 remains unchanged after 7 reservations; available bookable seats exclude group-owned vacancies',()=>{
 const ev={planned_guest_count:200},b=[{id:'booking-1',status:'reserved',agreed_amount_original:7*2000}],balances=[{booking_id:'booking-1',paid_original:14000,balance_original:0}];
 const stat=reservationDashboardV040(ev,tables,b,balances);
 assert.equal(stat.target,200);assert.equal(stat.reserved,7);assert.equal(stat.remainingTarget,193);
 assert.equal(stat.capacity,200);assert.equal(stat.physicallyEmpty,193);assert.equal(stat.bookedTableVacancies,1);
 assert.equal(stat.openCapacity,192);assert.equal(stat.received,14000);assert.equal(stat.expected,14000);assert.equal(stat.due,0);
 assert.equal(planningTablesV039(tables,200).target,200);
});
test('v0.40: collecting one booking immediately does not change event cost projections',()=>{
 const base=reservationDashboardV040({planned_guest_count:200},tables,[],[]);
 const next=reservationDashboardV040({planned_guest_count:200},tables,[{id:'booking-1',status:'reserved',agreed_amount_original:14000}],
   [{booking_id:'booking-1',paid_original:14000,balance_original:0}]);
 assert.equal(base.target,next.target);assert.equal(next.received,14000);assert.equal(next.due,0);
 assert.equal(eventGuestSummaryV038('باسل',['باسل','مع باسل 1','مع باسل 2','مع باسل 3','مع باسل 4'],5),'باسل · 4 أشخاص مع باسل');
});
test('v0.40: plan 100 hookahs but serve only 23, leaving 77 available and costing only 23 in consumed view',()=>{
 const item={id:'h',menu_item_id:'m',maximum_servings:100,servings_per_source_unit:1,unit_label:'أركيلة'};
 const issues=[{on_demand_id:'h',servings:20},{on_demand_id:'h',servings:3},
  {on_demand_id:'h',servings:15,voided_at:'2026-01-01'}];
 const rows=onDemandRowsV040([item],issues,[{id:'m',recipe_cost_base:1000,has_missing_cost:false}],[],[]);
 assert.equal(rows[0].used,23);assert.equal(rows[0].remaining,77);assert.equal(rows[0].consumedCost,23000);
 assert.equal(rows[0].reservedCost,100000);
 assert.equal(onDemandTotalsV040(rows).planned,100000);
 assert.equal(onDemandTotalsV040(rows).delivered,23000);
});
test('v0.40: an externally purchased platter yields many portions and never creates an extra purchase',()=>{
 const d={id:'cake',purchased_quantity:1,unit_cost_base:100000};
 const rows=onDemandRowsV040([{id:'rule',external_dish_id:'cake',maximum_servings:200,unit_label:'قطعة',servings_per_source_unit:200}],
  [{on_demand_id:'rule',servings:9}],[],[],[d]);
 assert.equal(rows[0].limitUnits,1);assert.equal(rows[0].usedUnits,0.045);
 assert.equal(rows[0].reservedCost,100000);assert.equal(rows[0].consumedCost,4500);
 assert.equal(rows[0].remaining,191);assert.equal(rows[0].purchasedServings,200);
});
test('v0.40: optional provisional cost is explicit, and absent estimates do not become zero-cost food',()=>{
 const rule={id:'r',menu_item_id:'m',maximum_servings:5,servings_per_source_unit:1};
 const c=[{id:'m',has_missing_cost:true,recipe_cost_base:null}];
 const missing=onDemandRowsV040([rule],[],c,[],[]);
 assert.equal(missing[0].reservedCost,null);assert.equal(onDemandTotalsV040(missing).unknown,1);
 const estimated=onDemandRowsV040([rule],[{on_demand_id:'r',servings:2}],c,[{menu_item_id:'m',estimated_unit_cost_base:600}],[]);
 assert.equal(estimated[0].reservedCost,3000);assert.equal(estimated[0].consumedCost,1200);
 assert.equal(estimated[0].actualCostIsEstimate,true);
});
test('v0.40: zero currency outputs have no minus symbol',()=>{
 assert.equal(eventMoneyV038(0,'SYP'),'0 SYP');
 assert.equal(eventMoneyV038(-0,'SYP'),'0 SYP');
});
test('v0.40: SQL reservation transaction either books AND collects or rolls back both',()=>{
 const sql=text('database/Maria-CFO-Web-v0.40-Bookings-OnDemand.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.event_book_and_collect_v040/);
 assert.match(sql,/v_id:=public\.event_group_booking_v035/);
 assert.match(sql,/PERFORM public\.record_event_booking_payment/);
 assert.match(sql,/PERFORM public\.ensure_cashbox_session_v013/);
 assert.match(sql,/p_collected boolean DEFAULT false/);
 assert.match(sql,/EVENT_CASHBOX_INVALID/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/GRANT EXECUTE/);assert.match(sql,/REVOKE ALL ON FUNCTION/);
});
test('v0.40: SQL only posts actually delivered menu units at closing, never stock for unserved external purchases',()=>{
 const sql=text('database/Maria-CFO-Web-v0.40-Bookings-OnDemand.sql');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.complete_event_with_demand_v040/);
 assert.match(sql,/COALESCE\(SUM\(i\.servings\) FILTER\(WHERE i\.voided_at IS NULL\),0\)/);
 assert.match(sql,/IF v_item\.issued>0 THEN/);
 assert.match(sql,/public\.complete_event_safe_v034/);
 assert.match(sql,/EVENT_ON_DEMAND_EXCEEDS_PURCHASE/);
 assert.match(sql,/event_on_demand_issues_v040/);
 assert.doesNotMatch(sql,/DELETE FROM public\.event_menu_rules/);
 assert.doesNotMatch(sql,/UPDATE public\.materials/);
});
test('v0.40: pages separate planning from booking and offer instant payment + on-demand issues',()=>{
 const page=text('js/pages/events-v034.js'),routes=text('js/app.js'),hub=text('js/pages/hubs.js'),css=text('assets/styles.css');
 for(const tag of ["view==='booking'",'bookingSeatMapHtml','demandServiceHtml','demandHtml','data-add-demand-unit',
  'eventBookAndCollectV040','data-collected-v040','data-table-book','data-demand-issue','eventCompleteWithDemandV040'])assert.ok(page.includes(tag),tag);
 for(const tag of ['event-reservations','event-bookings','Web v0.40'])assert.ok(routes.includes(tag),tag);
 assert.match(hub,/#\/event-reservations/);assert.match(hub,/#\/events-list/);
 assert.match(css,/event-book-collect-checkbox-v040/);
 assert.match(text('index.html'),/app\.js\?v=0\.40/);
});
