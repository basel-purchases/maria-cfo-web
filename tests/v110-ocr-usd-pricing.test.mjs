import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readHandwrittenAmountV110} from '../js/ocr-numeric-v110.js';
import {parseUnlabelledReceiptTableV109} from '../js/ocr-digit-review-v109.js';
import {receiptItemsV106} from '../js/purchase-image-v106.js';
import {supplierOcrSuggestionsV110,annotateSupplierOcrV110} from '../js/supplier-ocr-v110.js';
import {chooseBestOcrRowsV110} from '../js/ocr-selection-v110.js';
import {usdFromSypV110,sypFromUsdV110,pricingPreviewV110} from '../js/material-pricing-v110.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=p=>readFileSync(resolve(root,p),'utf8');

test('Dot at the end of Arabic-Indic amount may represent a handwritten zero, never alter valid decimals',()=>{
 assert.equal(readHandwrittenAmountV110('٦٥٥,').value,6550);
 assert.equal(readHandwrittenAmountV110('٤٧٧.').value,4770);
 assert.equal(readHandwrittenAmountV110('١٩.').value,190);
 assert.equal(readHandwrittenAmountV110('•').value,0);
 assert.equal(readHandwrittenAmountV110('٠').value,0);
 assert.equal(readHandwrittenAmountV110('٥').value,5);
 assert.equal(readHandwrittenAmountV110('۰').value,0);
 assert.equal(readHandwrittenAmountV110('۵').value,5);
 assert.equal(readHandwrittenAmountV110('٠,٨').value,.8,'valid decimal comma is not converted to zero');
 assert.equal(readHandwrittenAmountV110('٦,٥').value,6.5);
 assert.equal(readHandwrittenAmountV110('2.5').value,2.5);
 assert.equal(readHandwrittenAmountV110('190.').value,null,'Western period cannot become Arabic zero');
 assert.equal(readHandwrittenAmountV110('co,').value,null,'mixed Latin OCR noise must never be invented as a number');
 assert.equal(readHandwrittenAmountV110('٦٥٥,',{numericCell:false}).value,null);
 assert.match(readHandwrittenAmountV110('٦٥٥,').note,/صفر عربي محتمل/);
});

test('First-pass unlabelled OCR retains original string and zero-dot candidate but does not invent qty or price',()=>{
 const text='|---|---|---|---|\n| co, | ٦٥٥, | ضبا + مثال | 1 |\n| cco | ٤٧٧. | لم عارف | 2 |\n| ١٩. | ١٢٢٠ | لينة | 3 |';
 const items=receiptItemsV106(text);
 assert.equal(items.length,3);
 assert.equal(items[0].ocr_numeric_candidates.some(x=>x.value===6550),true);
 assert.ok(items[0].ocr_numeric_candidates.some(x=>x.zero_dot_suspected===true));
 assert.equal(items[1].ocr_numeric_candidates.some(x=>x.value===4770),true);
 assert.equal(items[2].ocr_numeric_candidates.some(x=>x.value===190),true);
 assert.ok(items.every(x=>x.quantity===''&&x.unit_price===''));
 assert.equal(parseUnlabelledReceiptTableV109(text).length,3);
});

test('Labelled columns accept zero-dot suggestions without replacing printed invoice rows',()=>{
 const text='| المادة | الكمية | السعر | الإجمالي |\n|---|---|---|---|\n| بندورة | ١٩. | ٥٠٠ | ٩٥٠٠٠ |';
 const rows=receiptItemsV106(text);
 assert.equal(rows.length,1);
 assert.equal(rows[0].quantity,'190');
 assert.equal(rows[0].unit_price,'500');
 assert.equal(rows[0].ocr_review_required,true);
 assert.match(rows[0].review_note,/النقطة الأخيرة/);
});

test('Full vs selected items crop compares parsed rows rather than always trusting image enhancement',()=>{
 const full=[{name:'بندورة',quantity:'2',unit_price:'500',ocr_source:'markdown_columns'}];
 const crop=[{name:'بنود غير واضحة',quantity:'',unit_price:'',ocr_source:'unlabelled_columns'}];
 assert.equal(chooseBestOcrRowsV110(full,crop).source,'full');
 assert.equal(chooseBestOcrRowsV110([],crop).source,'selected_items');
 assert.equal(chooseBestOcrRowsV110(full,[]).source,'full');
});

test('Supplier-aware OCR prioritizes known supplier material but never assigns a fuzzy material automatically',()=>{
 const mats=[{id:'a',name:'بندورة',__aliases:['طماطم']},{id:'b',name:'بطاطا'},{id:'c',name:'بندور أخضر'}];
 const suggestions=supplierOcrSuggestionsV110('بندوره',mats,[{material_id:'a'}]);
 assert.equal(suggestions[0].material.id,'a');
 const rows=annotateSupplierOcrV110([{name:'بندوره',catalog_id:''}],mats,[{material_id:'a'}]);
 assert.equal(rows[0].catalog_id,'');
 assert.ok(rows[0].supplier_ocr_suggestions.includes('a'));
 assert.equal(rows[0].ocr_review_required,true);
 assert.match(rows[0].review_note,/اقتراحات من مشتريات المورد/);
});

test('USD material pricing never prices unknown costs and does not alter ledger history via currency math',()=>{
 assert.equal(usdFromSypV110(15000,15000),1);
 assert.equal(sypFromUsdV110(1.25,16000),20000);
 assert.equal(usdFromSypV110(null,16000),null);
 assert.equal(sypFromUsdV110(null,16000),null);
 const stats=pricingPreviewV110([
  {last_purchase_unit_cost_base:15000},
  {last_purchase_unit_cost_base:null},
  {price_syp_v110:30000,price_usd_v110:2},
 ],15000);
 assert.deepEqual(stats,{priced:2,unpriced:1,overridden:1});
});

test('SQL pricing migration is additive and has atomic owner-checks and an audit trail',()=>{
 const sql=source('database/Maria-CFO-Web-v1.0.10-USD-Material-Pricing.sql');
 for(const token of ['ADD COLUMN IF NOT EXISTS price_usd_v110','ADD COLUMN IF NOT EXISTS price_syp_v110','material_price_history_v110',
  'material_price_initialize_usd_v110','material_price_set_exchange_rate_v110','material_identity_update_priced_v110',
  'public.is_app_owner()',"PERFORM public.set_exchange_rate('USD'",'ENABLE ROW LEVEL SECURITY'])assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDROP TABLE\s+public\.materials\b|DELETE FROM\s+public\.inventory_movements\b/i);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.(?:inventory_movements|purchase_invoices|purchase_invoice_items|cashbox_transactions)\b/i);
 assert.match(sql,/IF p_update_material_prices THEN/);
 const settings=source('js/pages/settings.js');
 assert.match(settings,/data-fx-yes/);assert.match(settings,/data-fx-no/);assert.match(settings,/data-fx-cancel/);
 assert.match(settings,/materialPriceApplyExchangeV110\(rate,apply\)/);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});

test('New UI is a single extraction control without separate magnifier or reread',()=>{
 const src=source('js/pages/images.js');
 assert.match(src,/const REGIONS=\[\{key:'items'/);
 assert.match(src,/data-ocr="3"/);
 assert.doesNotMatch(src,/data-bulk-ocr=|data-audit-digits|data-preview-digits|data-reparse/);
 assert.match(src,/profile:'standard'/);
 assert.match(src,/Number\(candidate\?\.value\)/,'reviewed Arabic zero candidate can be accepted by a deliberate click');
 assert.match(src,/annotateSupplierOcrV110/);
 const index=source('index.html');const app=source('js/app.js');
 assert.match(index,/Web v1\.0\.14/);assert.match(app,/Web v1\.0\.14/);
});
