import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {validateQuickServingV037,quickServingChoiceV037} from '../js/event-unit-quick-v037.js';
import {menuEquivalentV036,portionPreviewV036} from '../js/portion-servings-v036.js';
const read=x=>fs.readFileSync(new URL('../'+x,import.meta.url),'utf8');

test('validates per-menu conversion independent of raw material conversion',()=>{
 const base={menuItemId:'menu-kebab',name:'سيخ كباب مشوي',yieldCount:10,menuConversions:[],units:[]};
 assert.equal(validateQuickServingV037(base),null);
 assert.equal(menuEquivalentV036(2,10),0.2);
 assert.equal(portionPreviewV036({servings:2,yieldCount:10,ruleType:'per_person',guests:40,unitCost:100}).totalCost,800);
 assert.match(validateQuickServingV037({...base,yieldCount:0}),/عدد الحصص/);
 assert.match(validateQuickServingV037({...base,yieldCount:1.234567}),/منازل عشرية/);
});
test('prevents duplicate serving names even if Arabic spelling differs',()=>{
 const base={menuItemId:'a',name:'أسياخ',yieldCount:10,menuConversions:[{menu_item_id:'a',serving_label:'اسياخ'}]};
 assert.match(validateQuickServingV037(base),/محفوظة مسبقًا/);
 assert.equal(quickServingChoiceV037({servingLabel:'سيخ'}),'saved:سيخ');
 assert.equal(quickServingChoiceV037({servingLabel:'سيخ',unitId:'unit-1'}),'unit-1');
});
test('rejects raw material relation if material is outside the selected menu recipe',()=>{
 const base={menuItemId:'menu-kebab',name:'سيخ كباب مشوي',yieldCount:10,materialId:'chicken',quantityInBase:0.1,recipeMaterialIds:['beef']};
 assert.match(validateQuickServingV037(base),/وصفة هذا الصنف/);
 assert.equal(validateQuickServingV037({...base,materialId:'beef',quantityInBase:0.1}),null);
});
test('migration preserves previous groups and uses existing canonical recipe and inventory rules',()=>{
 const sql=read('database/Maria-CFO-Web-v0.37-Event-Groups-Quick-Units.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 assert.match(sql,/DROP CONSTRAINT IF EXISTS event_main_plates_v036_event_id_key/);
 assert.match(sql,/save_event_group_v037/);assert.match(sql,/delete_event_group_v037/);
 assert.match(sql,/public\.save_event_serving_v036\(/);
 assert.match(sql,/public\.save_named_unit_v018\(/);
 assert.match(sql,/public\.normalize_unit_name_v018\(/);
 assert.match(sql,/EVENT_MATERIAL_NOT_IN_RECIPE/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION/);
 assert.doesNotMatch(sql,/\bUPDATE public\.menu_item_recipe_items\b/i);
 assert.doesNotMatch(sql,/\bINSERT INTO public\.inventory_movements\b/i);
});
test('event UI offers unlimited groups, assignment/moving and in-context new unit without replacing the form',()=>{
 const ui=read('js/pages/events-v034.js');
 const api=read('js/api.js');
 assert.match(ui,/data-action="add-event-group"/);
 assert.match(ui,/data-group-edit/);assert.match(ui,/data-group-delete/);
 assert.match(ui,/name="group"/);
 assert.match(ui,/data-add-serving-unit-v037/);
 assert.match(ui,/select name="servingUnit"/);
 assert.match(ui,/state\.servingConversions\.push/);
 assert.match(ui,/syncUnit\(false\)/);
 assert.match(ui,/api\.eventCreateServingUnitV037/);
 assert.match(ui,/data-group-id/);
 assert.match(api,/eventGroupsV037/);assert.match(api,/eventSaveServingV037/);
 assert.match(api,/eventCreateServingUnitV037/);
});

test('grouping preserves the exact total cost and allocates shared dishes only once',async()=>{
 const {hospitalityGroupsV037}=await import('../js/event-groups-v037.js');
 const requirements=[
  {rule_id:'r1',unit_food_cost_base:100,estimated_food_cost_base:800},
  {rule_id:'r2',unit_food_cost_base:50,estimated_food_cost_base:100},
  {rule_id:'r3',unit_food_cost_base:30,estimated_food_cost_base:90},
 ];
 const plan=hospitalityGroupsV037({groups:[{id:'g1',name:'الصحن الرئيسي'},{id:'g2',name:'مقبلات'}],
  servingRules:[{rule_id:'r1',main_plate_id:'g1'},{rule_id:'r2',main_plate_id:'g2'}],requirements,guests:8});
 assert.equal(plan.groups.length,2);
 assert.deepEqual(plan.groups.map(g=>g.cost),[800,100]);
 assert.equal(plan.groups[1].averagePerGuest,12.5);
 assert.equal(plan.independent.cost,90);
 assert.equal(plan.grandTotal,990);
});
test('missing recipe costs remain flagged in their group and not valued as zero',async()=>{
 const {hospitalityGroupsV037}=await import('../js/event-groups-v037.js');
 const plan=hospitalityGroupsV037({groups:[{id:'g'}],servingRules:[{rule_id:'r',main_plate_id:'g'}],
  requirements:[{rule_id:'r',has_missing_cost:true,unit_food_cost_base:null,estimated_food_cost_base:null}],guests:9});
 assert.equal(plan.groups[0].missing,1);assert.equal(plan.missing,1);
 assert.equal(plan.groups[0].cost,0);
});
