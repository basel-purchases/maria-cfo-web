import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventoryDecision,filterInventoryV029,liveMaterialCosts,recipeEligibility,hasPositiveWarehouseInventory} from '../js/import-policy-v029.js';
import {parseRecipesV029} from '../js/recipe-import-parser-v029.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=JSON.parse(readFileSync(join(root,'tests/fixtures/v027-recipe-rows.json'),'utf8'));
test('material requires warehouse, positive balance AND a confirmed price',()=>{
 const base={kind:'material',name:'سكر',quantity:100,warehouse:'مستودع الصالة',price:300};
 assert.equal(inventoryDecision(base).ok,true);
 assert.equal(inventoryDecision({...base,warehouse:'مستودع المطبخ'}).ok,false);
 assert.equal(inventoryDecision({...base,warehouse:''}).ok,false);
 assert.equal(inventoryDecision({...base,quantity:0}).ok,false);
 assert.equal(inventoryDecision({...base,price:0}).ok,false);
 assert.equal(inventoryDecision({...base,price:0},liveMaterialCosts([{id:'1',name:'سكر',last_purchase_unit_cost_base:750}])).ok,true);
 assert.equal(inventoryDecision({...base,price:0},liveMaterialCosts([{id:'1',name:'سكر',last_purchase_unit_cost_base:0}])).ok,false);
});
test('menu needs positive selling price; assets are based on physical quantity/warehouse',()=>{
 const rows=[
  {kind:'menu',name:'جاط',quantity:0,price:25000,warehouse:''},
  {kind:'menu',name:'غير مسعر',quantity:10,price:0,warehouse:'الصالة'},
  {kind:'asset',name:'كرسي',quantity:10,price:0,warehouse:'مستودع الصالة'},
  {kind:'asset',name:'كرسي بلا مستودع',quantity:10,price:0,warehouse:''},
 ];
 const r=filterInventoryV029(rows);
 assert.deepEqual(r.counts,{accepted:2,rejected:2,menu:1,material:0,asset:1});
});
test('recipe must match every material, priced, positive stock and a real warehouse',()=>{
 const menu={name:'جاط',manual_price_original:14000};
 const line=[{materialName:'سكر',quantityBase:10,baseUnit:'غرام'}];
 const materials=[{id:'s',name:'سكر',last_purchase_unit_cost_base:100,current_stock_base:50}];
 const warehouse=[{kind:'material',core_entity_id:'s',quantity_base:50,warehouse:'المطبخ',review_reason:null}];
 assert.equal(hasPositiveWarehouseInventory('s',warehouse),true);
 assert.equal(recipeEligibility({menuName:'جاط'},line,menu,liveMaterialCosts(materials),warehouse).eligible,true);
 assert.equal(recipeEligibility({},line,{...menu,manual_price_original:0},liveMaterialCosts(materials),warehouse).eligible,false);
 assert.equal(recipeEligibility({},line,menu,liveMaterialCosts([{...materials[0],last_purchase_unit_cost_base:0}]),warehouse).eligible,false);
 assert.equal(recipeEligibility({},line,menu,liveMaterialCosts(materials),[]).eligible,false);
});
test('the legacy 75-recipe workbook remains readable; new importer rejects unsupported data',()=>{
 const parsed=parseRecipesV029(fixture);
 assert.equal(parsed.recipes.length,75);assert.equal(parsed.lines.length,729);
 assert.equal(parsed.recipes[0].menuName,'جاط خضرة');
 assert.throws(()=>parseRecipesV029({sheets:[{name:'IMPORT_RECIPES_V029',rows:[['wrong']]},
  {name:'IMPORT_LINES_V029',rows:[['wrong']]}]}),/RECIPE_V029_INVALID_FORMAT/);
});
test('new SQL guards price and stock server-side, no unknown material auto-create',()=>{
 const sql=readFileSync(join(root,'database/Maria-CFO-Web-v0.29-Strict-Imports.sql'),'utf8');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.import_ameen_v029/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.import_menu_recipes_v029/);
 assert.match(sql,/m\.current_stock_base>0 AND m\.last_purchase_unit_cost_base>0/);
 assert.match(sql,/v_price>0 OR EXISTS/);
 assert.match(sql,/RECIPE_V029_MATERIAL_MISSING/);
 assert.doesNotMatch(sql,/INSERT INTO public\.materials\(name,code,base_unit_id\)/);
});
test('reset safe-default not confirmed and new schemas included',()=>{
 const sql=readFileSync(join(root,'database/Maria-CFO-v0.29-RESET-ALL-BUSINESS-DATA-KEEP-OWNER-DANGER.sql'),'utf8');
 assert.match(sql,/v_confirmation text := 'NOT_CONFIRMED'/);
 for(const tbl of ['ameen_inventory_rows_v024','recipe_import_backups_v027','recipe_import_backups_v028','ameen_material_cost_sources_v029'])assert.match(sql,new RegExp(tbl));
 assert.match(sql,/RESTART IDENTITY RESTRICT/);assert.doesNotMatch(sql,/\bTRUNCATE\b[^;]*\bCASCADE\b/i);
});
