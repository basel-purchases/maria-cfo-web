import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {menuEquivalentV036,portionPreviewV036,plannedDistributionsV036,conversionHintsV036,platePerGuestV036} from '../js/portion-servings-v036.js';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('two skewers per guest from a 10-skewer kilogram use .2 KG and 16 KG for 80',()=>{
 assert.equal(menuEquivalentV036(2,10),.2);
 assert.deepEqual(portionPreviewV036({servings:2,yieldCount:10,ruleType:'per_person',guests:80,unitCost:1300,tables:[]}),{
  menuQuantity:.2,distributions:80,totalMenuUnits:16,unitCost:260,totalCost:20800,
 });
});
test('a multi-person plate is rounded separately at each table',()=>{
 assert.equal(plannedDistributionsV036({ruleType:'per_n_people',people:4,tables:[{planned_guest_count:3},{planned_guest_count:5}],guestCount:8}),3);
 assert.equal(portionPreviewV036({servings:1,yieldCount:1,ruleType:'per_n_people',people:4,tables:[{planned_guest_count:3},{planned_guest_count:5}],guests:8,unitCost:10}).totalCost,30);
});
test('do not count cancelled tables in shared-bowl demand',()=>{
 const tables=[{status:'cancelled',planned_guest_count:10},{status:'available',planned_guest_count:3}];
 assert.equal(plannedDistributionsV036({ruleType:'per_table',tables,guestCount:13}),1);
 assert.equal(plannedDistributionsV036({ruleType:'per_n_people',people:4,tables,guestCount:13}),1);
});
test('a menu unit can be a fractional serving without altering the recipe',()=>{
 assert.equal(menuEquivalentV036(1,8),0.125);
 assert.equal(menuEquivalentV036(1,3),0.3333);
 assert.equal(menuEquivalentV036(2,8),0.25);
});
test('unknown and excessive conversions fail instead of creating fake food costs',()=>{
 for(const [servings,yieldCount] of [[0,10],[2,0],[2,NaN],[-1,10],[1,100000]]){
  assert.throws(()=>menuEquivalentV036(servings,yieldCount),/EVENT_(SERVING_AMOUNT_INVALID|PORTION_PRECISION)/);
 }
});
test('plate combines multiple recipes once at the correct fraction per person',()=>{
 const items=[{menu_item_id:'kibbeh',quantity_per_rule:1},{menu_item_id:'kebab',quantity_per_rule:0.2},{menu_item_id:'shish',quantity_per_rule:0.1}];
 const menu=[{id:'kibbeh',recipe_cost_base:9},{id:'kebab',recipe_cost_base:30},{id:'shish',recipe_cost_base:40}];
 assert.deepEqual(platePerGuestV036(items,menu),{total:19,missing:0});
});
test('missing recipe costs remain missing rather than being counted as zero',()=>{
 const res=platePerGuestV036([{menu_item_id:'a',quantity_per_rule:1},{menu_item_id:'b',quantity_per_rule:.2}],
  [{id:'a',recipe_cost_base:12},{id:'b',recipe_cost_base:null}]);
 assert.equal(res.total,12);assert.equal(res.missing,1);
});
test('existing global KG to skewer conversion can be suggested, not guessed',()=>{
 const units=[{id:'kg',code:'KG',name:'كيلو'},{id:'skewer',code:'U_SKEWER',name:'سيخ كباب'}];
 const res=conversionHintsV036({saleUnit:'كيلو',units,conversions:[{from_unit_id:'kg',to_unit_id:'skewer',factor:10}]});
 assert.equal(res[0].ratio,10);assert.match(res[0].source,/تحويل/);
});
test('reversed global conversion is used in the right direction',()=>{
 const units=[{id:'kg',code:'KG'},{id:'skewer',code:'U_SKEWER'}];
 const res=conversionHintsV036({saleUnit:'kg',units,conversions:[{from_unit_id:'skewer',to_unit_id:'kg',factor:.08}]});
 assert.equal(res[0].ratio,12.5);
});
test('material-specific named units are suggestions only for a recipe ingredient with matching base KG',()=>{
 const units=[{id:'kg',code:'KG'},{id:'skewer',code:'U_SKEWER'}];
 const res=conversionHintsV036({saleUnit:'كيلو',units,materials:[{id:'meat',name:'لحم',base_unit_id:'kg'}],recipeLines:[{material_id:'meat'}],
   materialLinks:[{material_id:'meat',unit_id:'skewer',quantity_in_base:.1}]});
 assert.equal(res[0].ratio,10);assert.match(res[0].source,/راجع/);
});
test('conflicting material conversions do not silently choose a weight',()=>{
 const units=[{id:'kg',code:'KG'},{id:'skewer',code:'U_SKEWER'}];
 const res=conversionHintsV036({saleUnit:'كيلو',units,materials:[{id:'a',base_unit_id:'kg'},{id:'b',base_unit_id:'kg'}],
   recipeLines:[{material_id:'a'},{material_id:'b'}],materialLinks:[{material_id:'a',unit_id:'skewer',quantity_in_base:.1},{material_id:'b',unit_id:'skewer',quantity_in_base:.08}]});
 assert.equal(res.length,0);
});
test('migration uses canonical event rule for recipe pricing and inventory and protects owner',()=>{
 const sql=read('database/Maria-CFO-Web-v0.36-Event-Servings-Main-Plate.sql');
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);assert.match(sql,/public\.save_event_rule_v034\(/);
 assert.match(sql,/p_servings\s*\/\s*p_servings_per_menu_item/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/ON DELETE CASCADE/);assert.match(sql,/UNIQUE\(menu_item_id,serving_label\)/);
 assert.doesNotMatch(sql,/INSERT INTO public\.inventory_movements/);
});
test('legacy main plate is preserved and becomes one of multiple named groups',()=>{
 const ui=read('js/pages/events-v034.js');
 assert.match(ui,/data-action="add-event-group/);
 assert.match(ui,/data-group-add/);assert.match(ui,/data-group-edit/);assert.match(ui,/data-group-delete/);
 assert.match(ui,/eventSaveServingV037/);
 assert.match(ui,/إجمالي وجبات المنيو اللازمة/);
 assert.match(ui,/كم نقدم في كل مرة؟/);
});
