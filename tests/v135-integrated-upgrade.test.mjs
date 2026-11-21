import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const home = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(home,p),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.35-Historical-Cash-Cost-And-Food-Cost.sql');
const app=read('js/app.js');
const api=read('js/api.js');

test('historic sale cost queue has old-row catchup and future insert trigger',()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.v135_archive_cost_queue/);
  assert.match(sql,/AFTER INSERT ON public\.v134_sales_archive_lines/);
  assert.match(sql,/SELECT l\.document_id,l\.line_index,l\.menu_item_id FROM public\.v134_sales_archive_lines/);
  assert.match(sql,/state='pending'/);
  assert.match(sql,/get_material_cost_at\(/);
  assert.doesNotMatch(sql,/\b(?:INSERT INTO public\.inventory_movements|record_inventory_movement\()\b/);
});

test('cash posting uses protected accounting functions and source identity',()=>{
  assert.match(sql,/PRIMARY KEY\(source_kind,source_id\)/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/record_supplier_invoice_payment\(/);
  assert.match(sql,/record_cashbox_transaction\(/);
  assert.match(sql,/IF NOT p_confirm THEN RAISE EXCEPTION/);
  assert.match(sql,/v135_cash_on_archive_insert/);
  assert.match(sql,/v135_cash_on_purchase_insert/);
  assert.doesNotMatch(sql,/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.cashbox_transactions\b/i);
});

test('food cost settings, alerts and recipe/price triggers are included',()=>{
  for(const s of ['v135_food_cost_settings','v135_cost_alerts','v135_menu_price_notice','v135_recipe_notice','v135_material_price_notice','v135_food_cost_overview']){
    assert.ok(sql.includes(s),s);
  }
  assert.match(sql,/v135_set_food_cost_limits\(p_min numeric,p_max numeric\)/);
  assert.match(sql,/min_percent>=0 AND max_percent<=100 AND min_percent<max_percent/);
});

test('new routes and sidebar UI exist with statistics only on homepage',()=>{
  assert.match(app,/\['#\/daily-inputs', 'الإدخالات اليومية'\]/);
  assert.match(app,/case 'daily-inputs': return renderDailyInputsV135\(root\)/);
  assert.match(app,/case 'historical-cash': return renderHistoricalCashV135\(root\)/);
  assert.match(app,/case 'food-cost': return renderFoodCostV135\(root\)/);
  assert.match(app,/'dashboard':/);
  const nav=app.slice(app.indexOf('const nav = ['),app.indexOf('];',app.indexOf('const nav = ['))+2);
  assert.doesNotMatch(nav,/#\/statistics/);
  assert.match(app,/#\/food-cost/);
});

test('API wrappers, tabs, and cost highlights are connected',()=>{
  for(const name of ['v135ArchiveCostReport','v135ReconcileArchiveCosts','v135HistoricCashPreview','v135BackfillHistoricCash','v135FoodCostOverview','v135SaveFoodCostSettings']) assert.ok(api.includes(name),name);
  assert.match(read('js/pages/analytics-tabs-v132.js'),/key:'purchases'/);
  assert.match(read('js/pages/analytics-tabs-v132.js'),/key:'cost'/);
  assert.match(read('js/pages/menu.js'),/v135-foodcost-card-high/);
  assert.match(read('js/pages/food-cost-v135.js'),/foodCostMenuLinkV135/);
});

test('migration does not reset business data',()=>{
  assert.doesNotMatch(sql,/\bTRUNCATE\s+public\./i);
  assert.doesNotMatch(sql,/\bDROP\s+TABLE\s+public\./i);
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/COMMIT;/);
});
