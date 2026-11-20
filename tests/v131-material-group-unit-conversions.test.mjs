import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupPriceReviewV131,planMaterialConsumptionV131,validGroupFactorV131} from '../js/material-group-conversions-v131.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.31-Material-Group-Unit-Conversions.sql');
const ui=read('js/material-groups-ui-v130.js');
const api=read('js/api.js');
const colas=[
 {id:'cola',priority:1,base_unit_id:'piece',group_units_per_base_v131:1,current_stock_base:0,last_purchase_unit_cost_base:10},
 {id:'pack',priority:2,base_unit_id:'pack',group_units_per_base_v131:1,current_stock_base:2,last_purchase_unit_cost_base:10},
 {id:'mirinda',priority:3,base_unit_id:'piece',group_units_per_base_v131:1,current_stock_base:5,last_purchase_unit_cost_base:10}
];
test('1 package = 1 piece allows direct fallback without negative stock',()=>{
 const result=planMaterialConsumptionV131('cola',6,colas);
 assert.deepEqual(result,[{materialId:'pack',quantity:2},{materialId:'mirinda',quantity:4}]);
});
test('1 package = 6 pieces converts requested and issued quantities both ways',()=>{
 const rows=[
  {...colas[0],current_stock_base:0},
  {...colas[1],group_units_per_base_v131:6,current_stock_base:2},
  {...colas[2],current_stock_base:7}
 ];
 assert.deepEqual(planMaterialConsumptionV131('cola',9,rows),[
  {materialId:'pack',quantity:1.5}]);
 assert.deepEqual(planMaterialConsumptionV131('pack',2,[{...rows[1],current_stock_base:0},rows[0],rows[2].current_stock_base?{...rows[2],current_stock_base:12}:rows[2]]),[
  {materialId:'mirinda',quantity:12}]);
});
test('group conversion costs compare equal-price equivalents, not raw pack prices',()=>{
 const a={id:'a',base_unit_id:'piece',last_purchase_unit_cost_base:10,price_usd_v110:1};
 const b={id:'b',base_unit_id:'pack',last_purchase_unit_cost_base:60,price_usd_v110:6};
 let review=groupPriceReviewV131([a,b],'piece',{a:1,b:6});
 assert.equal(review.invalidFactors,false);
 assert.equal(review.needsConfirmation,false);
 review=groupPriceReviewV131([a,{...b,last_purchase_unit_cost_base:72}],'piece',{a:1,b:6});
 assert.equal(review.different,true);
 assert.equal(review.needsConfirmation,true);
});
test('conversion must be explicit, positive and same-unit factor cannot deviate from 1',()=>{
 assert.equal(validGroupFactorV131(null),false);
 assert.equal(validGroupFactorV131(''),false);
 assert.equal(validGroupFactorV131(0),false);
 assert.equal(validGroupFactorV131(1),true);
 assert.equal(validGroupFactorV131(1000001),false);
 const row={id:'c',base_unit_id:'pack',last_purchase_unit_cost_base:20};
 assert.equal(groupPriceReviewV131([row,{...row,id:'d',base_unit_id:'piece'}],'piece',{c:null,d:1}).invalidFactors,true);
 assert.equal(groupPriceReviewV131([{...row,base_unit_id:'piece'}],'piece',{c:2}).invalidFactors,true);
 assert.throws(()=>planMaterialConsumptionV131('cola',2,[{...colas[0],current_stock_base:1},{...colas[1],current_stock_base:0}]),/GROUP_STOCK_INSUFFICIENT/);
});
test('ledger-precision conversion rounds to six decimals rather than issuing inconsistent stock amounts',()=>{
 const rows=[{id:'piece',priority:1,current_stock_base:0,group_units_per_base_v131:1},
 {id:'pack',priority:2,current_stock_base:1,group_units_per_base_v131:3}];
 assert.deepEqual(planMaterialConsumptionV131('piece',1,rows),[
  {materialId:'pack',quantity:0.333333}]);
 assert.match(sql,/round\(v_left_reference\/v_row.factor,6\)/);
});
test('server migration persists manual ratios; cost and refund use real material base units',()=>{
 assert.match(sql,/reference_unit_id_v131/);
 assert.match(sql,/group_units_per_base_v131/);
 assert.match(sql,/p_reference_unit_id uuid,p_members uuid\[\]/);
 assert.match(sql,/p_factors numeric\[\]/);
 assert.match(sql,/v_left_reference:=p_quantity\*v_requested_factor/);
 assert.match(sql,/v_take_actual:=least\(greatest\(coalesce\(v_row.current_stock_base,0\),0\),/);
 assert.match(sql,/v_left_reference\/v_row.factor/);
 assert.match(sql,/unit_cost_base:=public\.get_material_cost_at\(v_row.id,p_at\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.material_group_save_v130/);
 assert.doesNotMatch(sql,/UPDATE\s+public\.inventory_movements\b/i);
 assert.doesNotMatch(sql,/UPDATE\s+public\.purchase_invoice_items\b/i);
});
test('material UI requires ratio for mismatched units and uses secure v131 server RPC',()=>{
 assert.match(ui,/data-ref-v131/);
 assert.match(ui,/data-factor-v131/);
 assert.match(ui,/groupPriceReviewV131/);
 assert.match(ui,/materialGroupSaveV131/);
 assert.match(api,/material_group_save_v131/);
 assert.match(api,/p_factors:factors/);
});
