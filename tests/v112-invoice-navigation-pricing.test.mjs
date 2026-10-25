import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {materialKnownSypPriceV110,pricingPreviewV110} from '../js/material-pricing-v110.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Row layout: quantity at right, unit in middle, unit-price at left; discount/total/delete below',()=>{
 const css=read('assets/styles.css');const page=read('js/pages/images.js');
 assert.match(css,/grid-template-columns:minmax\(0,1\.05fr\) minmax\(0,1\.05fr\) minmax\(0,1\.18fr\)!important/);
 for(const [n,col,row] of [[3,1,2],[2,2,2],[4,3,2],[6,1,3],[5,2,3],[7,3,3]]){
  const rule=css.match(new RegExp('tr\\[data-image-item\\] td:nth-child\\('+n+'\\)\\{[^}]+\\}'));
  assert.ok(rule,`CSS placement for cell ${n}`);
  assert.match(rule[0],new RegExp('grid-column:'+col+'!important'));
  assert.match(rule[0],new RegExp('grid-row:'+row+'!important'));
 }
 assert.match(css,/justify-content:flex-end!important/);
 assert.match(page,/data-field="quantity"/);
 assert.match(page,/data-field="unit_id"/);
 assert.match(page,/data-field="unit_price"/);
});

test('Clicking numbered index navigates inside the line pane, not the whole page',()=>{
 const js=read('js/pages/images.js');
 assert.match(js,/image-item-nav-v112/);
 assert.match(js,/data-jump-item="\$\{i\}"/);
 assert.match(js,/panel\.scrollTo\(\{top:/);
 assert.match(js,/getBoundingClientRect\(\)\.top-panel\.getBoundingClientRect\(\)\.top/);
});

test('Editing numeric cells does not reset viewport or recreate the document',()=>{
 const js=read('js/pages/images.js');
 assert.match(js,/previousScrollTop=existingPanel\?\.scrollTop/);
 assert.match(js,/restoredPanel\.scrollTop=previousScrollTop/);
 assert.match(js,/if\(\['quantity','unit_price','discount'\]\.includes\(el\.dataset\.field\)\)return/);
});

test('Obsolete explanatory OCR note is not generated or shown for old drafts',()=>{
 const js=read('js/pages/images.js');const parser=read('js/ocr-digit-review-v109.js');
 assert.match(js,/الجدول بلا عناوين موثوقة للأرقام/);
 assert.match(js,/conciseReviewNoteV111/);
 assert.match(parser,/review_note:''/);
});

test('USD migration is self-contained, safe for zero prices and auditable',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.12-PRICING-REPAIR.sql');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.material_price_initialize_usd_v110/);
 assert.match(sql,/material_price_set_exchange_rate_v110/);
 assert.match(sql,/WITH eligible AS MATERIALIZED/);
 assert.match(sql,/PERFORM m\.id FROM public\.materials AS m/);
 assert.match(sql,/nullif\(m\.last_purchase_unit_cost_base,0\)/);
 assert.match(sql,/m\.price_usd_v110>0 AND m\.price_syp_v110>0/);
 assert.match(sql,/PRICING_AUDIT_MISMATCH/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDELETE FROM\s+public\.materials\b/i);
 assert.doesNotMatch(sql,/\bUPDATE public\.(?:purchase_invoices|inventory_movements|cashbox_transactions)\b/i);
 const samples=[{last_purchase_unit_cost_base:0,price_syp_v110:null},{last_purchase_unit_cost_base:13500,price_syp_v110:null}];
 assert.equal(materialKnownSypPriceV110(samples[0]),null);
 assert.deepEqual(pricingPreviewV110(samples,14000),{priced:1,unpriced:1,overridden:0});
});

test('Pricing approval has one modal, and inline persistent error on failures',()=>{
 const js=read('js/pages/materials.js');
 const pricing=js.slice(js.indexOf('function priceAllMaterialsUSD('),js.indexOf('async function manageMaterialUnits('));
 assert.match(pricing,/data-pricing-error/);
 assert.match(pricing,/materialPricingErrorV111\(e\)/);
 assert.match(pricing,/await api\.materialPriceInitializeUsdV110\(rate\)/);
 assert.doesNotMatch(pricing,/confirmBox\(/);
 assert.match(read('index.html'),/Web v1\.0\.18/);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});

test('Typing quantity refreshes price and publish readiness without redrawing the editor',()=>{
 const js=read('js/pages/images.js');
 const fn=js.slice(js.indexOf(' function recomputeTotals(){'),js.indexOf(' function refresh(){'));
 assert.match(fn,/syncEditor\(\)/);
 assert.match(fn,/validateImageDocument\(doc,catalog\)/);
 assert.match(fn,/button\.disabled=processing/);
 assert.doesNotMatch(fn,/refresh\(\)/);
});
