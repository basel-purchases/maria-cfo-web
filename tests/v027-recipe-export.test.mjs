import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {parseRecipesV027} from '../js/recipe-import-parser-v027.js';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(join(root,p),'utf8');

async function workbook(){
 return structuredClone(JSON.parse(read('tests/fixtures/v027-recipe-rows.json')));
}
test('the extracted real workbook rows load in the same validated import parser and contains precisely 75 recipes',async()=>{
 const data=parseRecipesV027(await workbook());
 assert.equal(data.recipes.length,75);
 assert.equal(data.lines.length,729);
 assert.equal(new Set(data.recipes.map(r=>r.menuName)).size,75);
 assert.equal(data.newMaterials.length,32);
 assert.ok(data.estimates>50);
 assert.ok(data.lines.every(x=>x.quantityBase>0&&x.baseUnit&&x.materialName&&x.recipeKey));
});
test('no duplicate same raw material within a recipe; all lines belong to existing recipe key',async()=>{
 const {lines,recipes}=parseRecipesV027(await workbook());
 const seen=new Set(),keys=new Set(recipes.map(r=>r.key));
 for(const x of lines){assert.ok(keys.has(x.recipeKey));
   const key=`${x.recipeKey}|${x.materialName}`;
   assert.ok(!seen.has(key),key);seen.add(key);
 }
});
test('rejects missing ingredient quantities, wrong menu count and orphan lines',async()=>{
 const a=await workbook();
 const one=a.sheets.find(s=>s.name==='IMPORT_LINES_V027');
 const two=a.sheets.find(s=>s.name==='IMPORT_RECIPES_V027');
 const ix=one.rows[0].indexOf('quantity_base');const old=one.rows[1][ix];
 one.rows[1][ix]=0;assert.throws(()=>parseRecipesV027(a),/RECIPE_V027_INVALID_FORMAT/);one.rows[1][ix]=old;
 const oldKey=one.rows[1][0];one.rows[1][0]='Unknown';assert.throws(()=>parseRecipesV027(a),/RECIPE_V027_INVALID_FORMAT/);one.rows[1][0]=oldKey;
 const saved=two.rows.pop();assert.throws(()=>parseRecipesV027(a),/RECIPE_V027_INVALID_FORMAT/);two.rows.push(saved);
});
test('server import is atomic, owner-only and reuses historical recipe-safe writer',()=>{
 const sql=read('database/Maria-CFO-v0.27-Recipe-Import-Migration.sql');
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/public\.save_menu_recipe_item_v07\(/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/recipe_import_backups_v027/);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.inventory_movements/i);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.cashbox/i);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.order_items/i);
});
test('all table exports appear globally, and server-paged filtering is exported across pages',()=>{
 const exports=read('js/table-export-v027.js');
 assert.match(exports,/document\.querySelectorAll\('table'\)/);
 assert.match(exports,/MutationObserver/);
 assert.match(exports,/registerTableExport/);
 assert.match(exports,/downloadXlsx/);
 assert.match(exports,/window\.open/);
 assert.match(exports,/popup\.print\(\)/);
 for(const p of ['pages/assets.js','pages/suppliers.js','pages/advances.js','pages/daily.js']){
   assert.match(read('js/'+p),/registerTableExport/);
 }
 const menu=read('js/pages/menu.js');assert.match(menu,/filteredMenuDataset/);
 assert.match(menu,/menuItemsPageV025\(\{page,pageSize:100/);
 assert.match(read('js/app.js'),/installTableExportV027\(\)/);
});
test('release branches from v0.25 only; rejected v0.26 is absent',()=>{
 const sql=read('database/Maria-CFO-v0.27-Recipe-Import-Migration.sql');
 assert.match(sql,/Branch(es)? directly from v0\.25/);
 assert.ok(existsSync(join(root,'database/Maria_CFO_Web_v0.25_Migration.sql')));
 assert.ok(!existsSync(join(root,'database/Maria-CFO-v0.26-Recipes-Migration.sql')));
});
