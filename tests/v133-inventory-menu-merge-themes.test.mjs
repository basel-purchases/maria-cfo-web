import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const home=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(home,p),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.33-Menu-Merge-And-Inventory-Only-Completion.sql');

test('v133: the SQL migration is wrapped in one transaction, guarded and reuses the old RPC signature',()=>{
 assert.match(sql,/^-- Maria CFO Web v1\.0\.33/);
 assert.match(sql,/\bBEGIN;[\s\S]*\bCOMMIT;\s*NOTIFY pgrst,'reload schema';/);
 assert.match(sql,/V133_REQUIRES_V132_AND_V131/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.v131_complete_sale_cost\(p_queue_id uuid\)/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.v131_sale_queue_list\(/);
});
test('v133: price is not a prerequisite to stock issue; missing price is clearly tagged',()=>{
 const body=sql.match(/CREATE OR REPLACE FUNCTION public\.v131_complete_sale_cost\([\s\S]*?\$complete\$;/)[0];
 assert.doesNotMatch(body,/RAISE EXCEPTION 'V131_COST_MISSING_AT_SALE_DATE'/);
 assert.match(body,/v_missing_cost boolean:=false/);
 assert.match(body,/v_cost:=0;v_missing_cost:=true/);
 assert.match(body,/last_purchase_unit_cost_base INTO v_cost_fallback/);
 assert.match(body,/public\.record_inventory_movement/);
 assert.match(body,/V133_COST_UNCONFIRMED_STOCK_ISSUED/);
 assert.match(body,/IF v_sale\.state IN \('issued','included_in_count'\)/);
 assert.match(body,/v_sale\.sale_date<=v_last_count/);
 assert.match(body,/known_cost_total_base=CASE WHEN v_missing_cost THEN known_cost_total_base/);
 assert.match(body,/cost_total_base=CASE WHEN v_missing_cost THEN NULL/);
});
test('v133: historical records cannot be deleted; merge archives source and keeps aliases',()=>{
 for(const name of ['v133_menu_usage','v133_menu_delete_unused','v133_menu_merge'])
  assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
 assert.match(sql,/FROM pg_constraint c JOIN pg_attribute a/);
 assert.match(sql,/V133_MENU_USED/);
 assert.match(sql,/is_archived_v133=true,merged_into_menu_id_v133=p_target_id/);
 assert.match(sql,/UPDATE public\.menu_item_aliases_v104 SET menu_item_id=p_target_id/);
 assert.match(sql,/UPDATE public\.v131_sale_cost_queue SET menu_item_id=p_target_id,updated_at=now\(\)/);
 assert.match(sql,/public\.v133_menu_merge_history/);
 assert.match(sql,/recipe_transferred/);
 assert.match(sql,/AND NOT mi\.is_archived_v133/);
});
test('v133: legacy name matching ignores archived primaries and routes aliases to survivor',()=>{
 const body=sql.match(/CREATE OR REPLACE FUNCTION public\.menu_match_v104\([\s\S]*?\$match\$;/)[0];
 assert.match(body,/WHERE NOT mi\.is_archived_v133/);
 assert.match(body,/JOIN public\.menu_items mi ON mi\.id=a\.menu_item_id/);
 assert.match(sql,/public\.menu_alias_normalize_v104\(m\.name\)=v_key[\s\S]*m\.merged_into_menu_id_v133 IS DISTINCT FROM p_menu_id/);
});
test('v133: menu page exposes separate merge/delete actions and shows the server guard',()=>{
 const menu=read('js/pages/menu.js');
 const api=read('js/api.js');
 assert.match(menu,/v133-menu-merge/);
 assert.match(menu,/v133-menu-delete/);
 assert.match(menu,/api\.v133MenuMerge\(/);
 assert.match(menu,/api\.v133MenuUsage\(/);
 assert.match(menu,/api\.v133MenuDeleteUnused\(/);
 assert.match(menu,/menuAliasChoicesV104/);
 for(const func of ['v133_menu_usage','v133_menu_merge','v133_menu_delete_unused'])assert.ok(api.includes(func),func);
 assert.match(api,/master=master\.filter\(m=>m\.is_archived_v133!==true\)/);
});
test('v133: sale queue distinguishes cost uncertainty from completed stock and keeps old sale lines',()=>{
 const ui=read('js/pages/sale-cost-queue-v132.js');
 assert.match(ui,/row\.costComplete === false \? \['صُرفت المواد/);
 assert.match(ui,/V133_COST_UNCONFIRMED_STOCK_ISSUED/);
 assert.match(ui,/استكمال الصرف/);
 const source=sql.match(/CREATE OR REPLACE FUNCTION public\.v131_complete_sale_cost\([\s\S]*?\$complete\$;/)[0];
 assert.doesNotMatch(source,/INSERT INTO public\.ameen_daily_lines_v041/);
 assert.doesNotMatch(source,/UPDATE public\.ameen_daily_lines_v041/);
 assert.doesNotMatch(source,/UPDATE public\.cashbox_transactions/);
});
test('v133: all themes affect workspace cards, tables, modals, fields and topbar',()=>{
 const css=read('assets/styles.css');
 for(const token of ['.main {','.hero {','.table th,','.modal,','.field input,','.topbar {'])
  assert.ok(css.slice(css.indexOf('/* Maria CFO v1.0.33:')).includes(token),token);
 assert.match(css,/html\[data-maria-theme="elegant"\]/);
 assert.match(css,/not\(\[data-maria-theme="classic"\]\)/);
});
test('v133: cache versions and code manifest match',()=>{
 assert.equal(read('VERSION').trim(),'1.0.34.1');
 for(const p of ['js/app.js','js/pages/menu.js','js/pages/settings.js'])assert.match(read(p),/1\.0\.34/);
 const index=read('index.html');
 assert.match(index,/styles\.css\?v=1\.0\.34/);
 assert.match(index,/js\/app\.js\?v=1\.0\.34/);
});
