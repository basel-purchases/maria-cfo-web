import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planMaterialConsumptionV130,groupPriceReviewV130} from '../js/material-merge-v130.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.30-Material-Groups-Ordered-Consumption.sql');
const page=read('js/pages/materials.js');
const management=read('js/material-groups-ui-v130.js');
const api=read('js/api.js');
const stock=[
 {id:'cola',priority:2,current_stock_base:0},
 {id:'pepsi',priority:1,current_stock_base:2},
 {id:'mirinda',priority:3,current_stock_base:5}
];

test('preferred material consumes first even if group position is later',()=>{
 const filled=stock.map(x=>({...x,current_stock_base:x.id==='cola'?4:5}));
 assert.deepEqual(planMaterialConsumptionV130('cola',3,filled),[{materialId:'cola',quantity:3}]);
 assert.deepEqual(planMaterialConsumptionV130('mirinda',3,filled),[{materialId:'mirinda',quantity:3}]);
});
test('when requested material depleted, fallback respects accountant group priority',()=>{
 assert.deepEqual(planMaterialConsumptionV130('cola',6,stock),[
  {materialId:'pepsi',quantity:2},{materialId:'mirinda',quantity:4}
 ]);
 assert.deepEqual(planMaterialConsumptionV130('mirinda',6,stock),[
  {materialId:'mirinda',quantity:5},{materialId:'pepsi',quantity:1}
 ]);
});
test('insufficient group inventory throws rather than inventing negative stock',()=>{
 assert.throws(()=>planMaterialConsumptionV130('cola',8,stock),/GROUP_STOCK_INSUFFICIENT/);
 assert.throws(()=>planMaterialConsumptionV130('cola',1,[]),/GROUP_STOCK_INSUFFICIENT/);
 assert.throws(()=>planMaterialConsumptionV130('cola',0,stock),/GROUP_INVALID_CONSUMPTION_QUANTITY/);
});
test('price mismatch, missing prices and incompatible base units require explicit review',()=>{
 const a={base_unit_id:'pieces',last_purchase_unit_cost_base:20,price_usd_v110:0.5};
 assert.deepEqual(groupPriceReviewV130([a,{...a}]).needsConfirmation,false);
 assert.equal(groupPriceReviewV130([a,{...a,last_purchase_unit_cost_base:25}]).different,true);
 assert.equal(groupPriceReviewV130([a,{...a,last_purchase_unit_cost_base:null}]).missing,true);
 assert.equal(groupPriceReviewV130([a,{...a,price_usd_v110:0.7}]).differentUsd,true);
 assert.equal(groupPriceReviewV130([a,{...a,base_unit_id:'kg'}]).unitMismatch,true);
});
test('SQL uses owner-controlled separate group identity with ordered priority and non-destructive members',()=>{
 assert.match(sql,/material_groups_v130/);
 assert.match(sql,/material_group_members_v130/);
 assert.match(sql,/UNIQUE\(material_id\)/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/GROUP_UNITS_MUST_MATCH/);
 assert.match(sql,/GROUP_PRICE_WARNING_CONFIRMATION_REQUIRED/);
 assert.match(sql,/p_accept_price_warning/);
 assert.match(sql,/ORDER BY CASE WHEN m\.id=p_requested THEN 0 ELSE 1 END,gm\.priority/);
 assert.match(sql,/FOR UPDATE OF m/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/GROUP_STOCK_INSUFFICIENT/);
 assert.doesNotMatch(sql,/UPDATE\s+public\.purchase_invoice_items\b/i);
 assert.doesNotMatch(sql,/DELETE\s+FROM\s+public\.inventory_movements\b/i);
});
test('order and event consumptions each snapshot every actual issued material and own prices',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.post_order\(/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.post_event_food_consumption\(/);
 assert.equal((sql.match(/select \* from public\.material_consumption_plan_v130\(/g)||[]).length,2);
 assert.equal((sql.match(/requested_material_id_v130\s*\n\s*\)/g)||[]).length,2);
 assert.match(sql,/v_alloc\.issued_base \* v_material_cost/);
 assert.match(sql,/v_alloc\.actual_material_id, 'sale'/);
 assert.match(sql,/v_alloc\.actual_material_id, 'event'/);
 assert.match(sql,/DROP CONSTRAINT IF EXISTS order_item_material_unique/);
 assert.match(sql,/DROP CONSTRAINT IF EXISTS event_food_posting_material_unique/);
 assert.match(sql,/order_item_materials\s*\n\s*set inventory_movement_id/);
 assert.match(sql,/event_food_posting_materials\s*\n\s*set inventory_movement_id/);
});
test('materials UI and API wire accountant ordering, confirmation and cancellation',()=>{
 assert.match(page,/data-manage-material-groups-v130/);
 assert.match(management,/data-move-v130/);
 assert.match(management,/data-remove-v130/);
 assert.match(management,/price_accept/);
 assert.match(management,/onChanged/);
 assert.match(management,/GROUP/mi);
 assert.match(api,/material_group_save_v130/);
 assert.match(api,/material_group_delete_v130/);
 assert.match(api,/material_group_members_v130/);
});
