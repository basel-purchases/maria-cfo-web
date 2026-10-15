import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {planningTablesV039,plannedMenuRequirementsV039,externalPreviewV039,externalBudgetV039,tableExtraGroupsV039} from '../js/event-planning-v039.js';
import {eventCostQuoteV034} from '../js/event-cost-v034.js';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const tables=Array.from({length:25},(_,i)=>({id:`t${i+1}`,table_label:`طاولة ${i+1}`,status:i===0?'reserved':'available',booking_id:i===0?'booking1':null,capacity:8,planned_guest_count:i===0?5:i===1?4:8}));
const expected=planningTablesV039(tables,200);
test('v0.39: 200 planned guests stay 200 when 9 seats are booked (not 191)',()=>{
 assert.equal(expected.target,200);assert.equal(expected.assigned,200);assert.equal(expected.capacity,200);assert.equal(expected.unseated,0);
 assert.equal(expected.tables.reduce((s,t)=>s+t.planned_guest_count,0),200);
 assert.equal(tables.reduce((s,t)=>s+(t.booking_id?t.planned_guest_count:0),0),5);
});
test('v0.39: more bookings do not alter the base food budget or per-person quantity',()=>{
 const all=planningTablesV039(tables.map((t,i)=>({...t,booking_id:i<2?'reserved':null,planned_guest_count:i===0?5:i===1?4:0})),200);
 const p=plannedMenuRequirementsV039([{rule_id:'r1',menu_item_id:'menu1',rule_type:'per_person',quantity_per_rule:1,unit_food_cost_base:125,has_missing_cost:false}],all);
 assert.equal(p[0].required_quantity,200);assert.equal(p[0].estimated_food_cost_base,25000);
});
test('v0.39: external cake purchased for 100,000 yields 200 pieces, one per guest = exactly ONE cake',()=>{
 const cake={id:'cake',name:'قالب كاتو',unit_label:'قالب',purchased_quantity:1,unit_cost_base:100000,total_cost_base:100000};
 const slices={id:'slice',dish_id:'cake',serving_label:'قطعة',servings_per_purchase_unit:200};
 const rule={dish_id:'cake',rule_type:'per_person',servings_per_distribution:1,quantity_per_distribution:0.005,serving_conversion_id:'slice'};
 const p=externalPreviewV039(cake,rule,expected,slices);
 assert.equal(p.servings,200);assert.equal(p.neededUnits,1);assert.equal(p.cost,100000);assert.equal(p.shortage,0);
 const out=externalBudgetV039([cake],[rule],expected,[slices]);
 assert.equal(out.plannedCost,100000);assert.equal(out.purchasedCost,100000);assert.equal(out.shortages.length,0);
});
test('v0.39: any external dish can yield non-integer purchase units with fractional costs',()=>{
 const tray={id:'tray',purchased_quantity:2,unit_label:'جاط',unit_cost_base:9000};
 const bowls={id:'bowls',serving_label:'زبدية',servings_per_purchase_unit:6};
 const p=externalPreviewV039(tray,{rule_type:'per_table',servings_per_distribution:2},planningTablesV039(tables,200),bowls);
 assert.equal(p.servings,50);assert.ok(Math.abs(p.neededUnits-50/6)<1e-8);assert.ok(Math.abs(p.cost-75000)<1e-8);
 assert.equal(p.shortage>0,true);
});
test('v0.39: estimate is reusable for future events, but flagged and does not override complete recipes',()=>{
 const ref=[{menu_item_id:'unknown',estimated_unit_cost_base:34000}];
 const q= [{menu_item_id:'unknown',quantity_per_rule:.5,rule_type:'per_person',has_missing_cost:true,unit_food_cost_base:null}];
 for(const guest of [10,30]){
  const out=plannedMenuRequirementsV039(q,planningTablesV039([{id:1,capacity:50,status:'available'}],guest),ref);
  assert.equal(out[0].v039_cost_is_estimate,true);
  assert.equal(out[0].has_missing_cost,false);
  assert.equal(out[0].estimated_food_cost_base,guest*.5*34000);
  const budget=eventCostQuoteV034({guests:guest,menuRules:out});
  assert.equal(budget.food,guest*.5*34000);
 }
 const complete=plannedMenuRequirementsV039([{...q[0],unit_food_cost_base:30000,has_missing_cost:false}],expected,ref);
 assert.equal(complete[0].unit_food_cost_base,30000);assert.equal(complete[0].v039_cost_is_estimate,false);
});
test('v0.39: unknown menu cost remains unknown when no estimate is entered',()=>{
 const r=plannedMenuRequirementsV039([{menu_item_id:'a',rule_type:'per_person',quantity_per_rule:1,unit_food_cost_base:null,has_missing_cost:true}],expected,[]);
 assert.equal(r[0].has_missing_cost,true);assert.equal(r[0].estimated_food_cost_base,null);
});
test('v0.39: table grouping sums ONLY unpaid orders and retains paid/refunded/void items as details',()=>{
 const extras=[
 {table_id:'t1',amount_original:1000,status:'pending',description:'مياه'},
 {table_id:'t2',amount_original:1100,status:'pending',description:'كاتو'},
 {table_id:'t1',amount_original:1500,status:'pending',description:'عصائر'},
 {table_id:'t1',amount_original:200,status:'paid',description:'مقبوض'},
 {table_id:'t2',amount_original:100,status:'refunded',description:'مسترجع'},
 ];
 const groups=tableExtraGroupsV039(extras,tables);
 assert.equal(groups.length,2);
 assert.equal(groups[0].due,2500);assert.equal(groups[0].pending.length,2);assert.equal(groups[0].paid,200);
 assert.equal(groups[1].due,1100);assert.equal(groups[1].refunded,100);
});
test('v0.39: SQL applies one atomic owner-only group payment, preserving each invoice and its original refund',()=>{
 const sql=read('database/Maria-CFO-Web-v0.39-Table-Payments-External-Units-Estimates.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.pay_event_table_extras_v039/);
 assert.match(sql,/WHERE event_id=p_event_id AND table_id=p_table_id AND status='pending' ORDER BY id FOR UPDATE/);
 assert.match(sql,/PERFORM public\.pay_event_extra_v034\(v_extra\.id,p_cashbox_id\)/);
 assert.match(sql,/EVENT_TABLE_NO_UNPAID_EXTRAS/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION/);assert.match(sql,/REVOKE ALL ON FUNCTION/);
 assert.doesNotMatch(sql,/UPDATE public\.cashbox_transactions SET/);
});
test('v0.39: global provisional estimate is protected and never updates canonical recipes/materials',()=>{
 const sql=read('database/Maria-CFO-Web-v0.39-Table-Payments-External-Units-Estimates.sql');
 assert.match(sql,/event_menu_cost_estimates_v039/);
 assert.match(sql,/PRIMARY KEY REFERENCES public\.menu_items/);
 assert.match(sql,/event_save_group_serving_v039/);
 assert.doesNotMatch(sql,/UPDATE public\.menu_item_recipe_items/);
 assert.doesNotMatch(sql,/UPDATE public\.materials/);
});
test('v0.39: UI has subtotal collections, expandable details, conversion quick-add, and estimate override',()=>{
 const ui=read('js/pages/events-v034.js'),api=read('js/api.js'),css=read('assets/styles.css');
 for(const k of ['data-extra-table-pay','<details','eventPayTableExtrasV039','eventAddExternalUnitV039',
  'data-external-unit-v039','eventSaveExternalServingV039','eventSaveServingWithEstimateV039','event-estimate-field-v039',
  'planRequirements()','seating()'])assert.ok(ui.includes(k),k);
 assert.match(css,/event-table-arrow-v039/);
 assert.match(api,/eventAllExternalUnitsV039/);
 assert.match(read('index.html'),/app\.js\?v=0\.39/);
});
