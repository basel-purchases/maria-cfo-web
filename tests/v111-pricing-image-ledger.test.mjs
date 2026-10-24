import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {materialKnownSypPriceV110,usdFromSypV110,pricingPreviewV110} from '../js/material-pricing-v110.js';
import {materialPricingErrorV111} from '../js/pricing-error-v111.js';
import {validateImageDocument} from '../js/image-document-rules.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');

test('Zero or unknown price remains without a USD anchor, including when exchange rate changes',()=>{
 const materials=[
  {name:'مادة بلا سعر',price_syp_v110:null,last_purchase_unit_cost_base:0,price_usd_v110:null},
  {name:'مادة غير مسعرة',price_syp_v110:null,last_purchase_unit_cost_base:null,price_usd_v110:null},
  {name:'مادة مسعرة',price_syp_v110:null,last_purchase_unit_cost_base:14000,price_usd_v110:null},
 ];
 for(const rate of [12000,14000,20000]){
  assert.equal(materialKnownSypPriceV110(materials[0]),null);
  assert.equal(usdFromSypV110(materialKnownSypPriceV110(materials[0]),rate),null);
  assert.deepEqual(pricingPreviewV110(materials,rate),{priced:1,unpriced:2,overridden:0});
 }
});

test('Pricing errors explain SQL or permissions failures rather than hiding the cause',()=>{
 assert.match(materialPricingErrorV111({code:'PGRST202',message:'Could not find the function'}),/SQL v1.0.11/);
 assert.match(materialPricingErrorV111({code:'57014',message:'statement timeout'}),/مهلة/);
 assert.match(materialPricingErrorV111({code:'42501',message:'permission denied'}),/صلاحية/);
 assert.match(materialPricingErrorV111({code:'XX001',message:'internal problem'}),/XX001/);
});

test('Purchase OCR flags remain visible without a checkbox gate; valid quantities and units are still required',()=>{
 const mat={id:'mat',name:'برك جبنة',base_unit_id:'box'};
 const cat={materials:[mat],units:[{id:'box',name:'علبة'}],materialLinks:[]};
 const doc={type:'purchase',date:'2026-10-24',currency:'SYP',items:[{
  name:'برك جبنة',material_mode:'matched',catalog_id:'mat',unit_id:'box',quantity:'10',unit_price:'920',discount:'0',ocr_review_required:true,ocr_reviewed:false,review_note:'الكمية مقترحة'
 }]};
 assert.equal(validateImageDocument(doc,cat).ready,true);
 assert.equal(validateImageDocument({...doc,items:[{...doc.items[0],unit_id:''}]},cat).ready,false);
 assert.equal(validateImageDocument({...doc,items:[{...doc.items[0],unit_price:''}]},cat).ready,false);
 const ui=read('js/pages/images.js');
 assert.doesNotMatch(ui,/name="accept_difference"|data-field="ocr_reviewed"|راجعت الأرقام والوحدة مع الفاتورة/);
 assert.match(ui,/مراجعة فاتورة الشراء قبل الحفظ/);
});

test('Invoice rows are nested alongside preview and scroll vertically rather than overflowing horizontally',()=>{
 const page=read('js/pages/images.js'),style=read('assets/styles.css');
 assert.match(page,/image-document-grid image-review-workspace-v111/);
 assert.match(page,/image-purchase-wrap-v106 image-items-scroll-v111/);
 assert.match(style,/\.image-review-workspace-v111\s*>?\s*\.image-preview-pane|\.image-review-workspace-v111>\.image-preview-pane/);
 assert.match(style,/overflow-x:hidden!important;overflow-y:auto!important/);
 assert.match(style,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
 assert.match(page,/conciseReviewNoteV111/);
 assert.doesNotMatch(read('js/purchase-image-v106.js'),/if\(inferred\)notes\.push/);
});

test('Repair migration is independently deployable, set-based, audit-safe and skips zero prices',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.11-PRICING-REPAIR.sql');
 assert.match(sql,/ADD COLUMN IF NOT EXISTS price_usd_v110/);
 assert.match(sql,/WITH eligible AS MATERIALIZED/);
 assert.match(sql,/nullif\(m\.last_purchase_unit_cost_base,0\)/);
 assert.match(sql,/WHERE m\.price_usd_v110>0 AND m\.price_syp_v110>0/);
 assert.match(sql,/material_price_history_v110/);
 assert.match(sql,/RETURN jsonb_build_object\('rate'/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDELETE FROM\s+public\.materials\b/i);
 assert.doesNotMatch(sql,/\bUPDATE public\.(?:purchase_invoices|purchase_invoice_items|inventory_movements|cashbox_transactions)\b/i);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});
