import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRecipesV027} from '../js/recipe-import-parser-v027.js';
import {alignRecipeLinesToCatalog} from '../js/recipe-unit-match-v0272.js';
import {liveBaseUnitPrice,summarizeRecipeMaterialPrices} from '../js/recipe-cost-coverage-v028.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=JSON.parse(readFileSync(join(root,'tests/fixtures/v027-recipe-rows.json'),'utf8'));
const source=parseRecipesV027(fixture);

// The actual approved workbook has 75 menu recipes and 729 ingredient lines.
test('approval workbook is still parsed without changing amounts',()=>{
 assert.equal(source.recipes.length,75);
 assert.equal(source.lines.length,729);
 const base=[...source.lines].map(l=>l.quantityBase);
 const mMap=new Map();
 for(const line of source.lines){if(!mMap.has(line.materialName))mMap.set(line.materialName,line.baseUnit);}
 const materials=[...mMap].map(([name],i)=>({id:`m${i}`,name,base_unit_id:`u${i}`,last_purchase_unit_cost_base:i===0?2500:null}));
 const units=[...mMap].map(([,name],i)=>({id:`u${i}`,name,code:`X${i}`}));
 const aligned=alignRecipeLinesToCatalog(source.lines,materials,units);
 assert.equal(aligned.unitMismatch.length,0);
 assert.deepEqual(aligned.canonicalLines.map(l=>l.quantityBase),base);
 const coverage=summarizeRecipeMaterialPrices(source.recipes,aligned.canonicalLines,materials);
 assert.equal(coverage.totalLines,729);
 assert.equal(coverage.pricedLines+coverage.missingLines,729);
 assert.equal(coverage.recipes.length,75);
 assert.ok(coverage.missingLines>0);
 assert.ok(coverage.fullyPricedRecipes<75);
});

test('known catalog prices are used and Excel prices are NEVER trusted',()=>{
 const recipes=[{key:'R1',menuName:'صحن اختبار'}];
 const lines=[
  {recipeKey:'R1',materialName:'سكر',baseUnit:'غرام',quantityBase:100,price:99999},
  {recipeKey:'R1',materialName:'رز',baseUnit:'كغ',quantityBase:2,sourcePrice:13},
 ];
 const materials=[
  {id:'sugar',name:'سكر',last_purchase_unit_cost_base:50},
  {id:'rice',name:'رز',last_purchase_unit_cost_base:1000},
 ];
 const r=summarizeRecipeMaterialPrices(recipes,lines,materials);
 assert.equal(r.pricedLines,2);
 assert.equal(r.fullyPricedRecipes,1);
 assert.equal(r.recipes[0].knownSubtotal,100*50+2*1000);
 assert.equal(r.missingLines,0);
 assert.equal(liveBaseUnitPrice(materials[0]),50);
});

test('missing catalog price is NOT incorrectly converted to free/zero',()=>{
 assert.equal(liveBaseUnitPrice({last_purchase_unit_cost_base:null}),null);
 assert.equal(liveBaseUnitPrice({last_purchase_unit_cost_base:''}),null);
 assert.equal(liveBaseUnitPrice({last_purchase_unit_cost_base:0}),0);
 assert.equal(liveBaseUnitPrice({last_purchase_unit_cost_base:'bad'}),null);
 const r=summarizeRecipeMaterialPrices([{key:'A',menuName:'test'}],[
  {recipeKey:'A',materialName:'أ',quantityBase:5},
  {recipeKey:'A',materialName:'ب',quantityBase:2},
 ],[{id:'a',name:'أ',last_purchase_unit_cost_base:1000},
    {id:'b',name:'ب',last_purchase_unit_cost_base:null}]);
 assert.equal(r.fullyPricedRecipes,0);
 assert.equal(r.recipes[0].knownSubtotal,5000);
 assert.equal(r.recipes[0].missingLines,1);
});

test('v0.28 page calls new reimport RPC and displays incomplete pricing',()=>{
 const ui=readFileSync(join(root,'js/recipe-import-v028.js'),'utf8');
 const costUi=readFileSync(join(root,'js/pages/menu.js'),'utf8');
 const sql=readFileSync(join(root,'database/Maria-CFO-Web-v0.28-Recipe-Resync.sql'),'utf8');
 const app=readFileSync(join(root,'js/app.js'),'utf8');
 assert.match(ui,/import_menu_recipes_v028/);
 assert.match(ui,/p_lines:check\.canonicalLines/);
 assert.match(ui,/summarizeRecipeMaterialPrices/);
 assert.match(ui,/materials','id,name,base_unit_id,last_purchase_unit_cost_base'/);
 assert.match(ui,/v028-replace/);
 assert.match(costUi,/row\.recipe_cost_base==null/);
 assert.match(costUi,/baseCost\*baseQty/);
 assert.match(app,/renderRecipeImportV028\(root\)/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.import_menu_recipes_v028/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.recipe_import_backups_v028/);
 assert.match(sql,/v_unchanged:=v_unchanged\+1/);
 assert.match(sql,/ri\.quantity_base AS existing_qty/);
 assert.doesNotMatch(sql,/UPDATE\s+public\.(materials|inventory_movements|orders|order_item_materials)/i);
 assert.doesNotMatch(sql,/DELETE\s+FROM\s+public\.(materials|inventory_movements|orders|order_item_materials)/i);
});
