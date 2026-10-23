import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {materialKeyV106,materialExactV106,materialMatchesV106,materialSuggestionsV106,materialSearchTextV106} from '../js/material-search-v106.js';
import {receiptHeaderV106,receiptItemsV106,receiptMathV106} from '../js/purchase-image-v106.js';
import {validateImageDocument} from '../js/image-document-rules.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=p=>readFileSync(resolve(root,p),'utf8');
const mats=[
 {id:'tea',name:'شاي أحمر',__aliases:['شاي سيلاني','شاي أسود'],base_unit_id:'kg',code:'M-1'},
 {id:'rice',name:'أرز مصري',__aliases:['رز مصري','أرز'],base_unit_id:'kg',code:'M-2'},
 {id:'sugar',name:'سكر أبيض',__aliases:['سكر ناعم'],base_unit_id:'kg',code:'M-3'},
];
const units=[{id:'kg',name:'كيلوغرام',code:'KG'},{id:'pcs',name:'قطعة',code:'PCS'}];

test('material alias normalization, exact and partial search include all approved names',()=>{
 assert.equal(materialKeyV106('  شَاي  آحمر  '),'شاي احمر');
 assert.equal(materialExactV106('رز مصري',mats)?.id,'rice');
 assert.equal(materialExactV106('شاي أسود',mats)?.id,'tea');
 assert.equal(materialMatchesV106(mats[0],'سيلاني'),true);
 assert.equal(materialMatchesV106(mats[1],'سكر'),false);
 assert.match(materialSearchTextV106(mats[0]),/شاي سيلاني/);
 assert.equal(materialExactV106('شاي',mats),null);
 assert.equal(materialExactV106('أرز',[mats[1],{id:'duplicate',name:'أرز'}]),null);
});
test('material suggestions can prefer supplier history without treating fuzzy names as safe stock IDs',()=>{
 const rows=[{id:'a',name:'حمص أحمر',__aliases:[]},{id:'b',name:'حمص أبيض',__aliases:[]}];
 assert.equal(materialExactV106('حمص',rows),null);
 assert.equal(materialSuggestionsV106('حمص',rows,['b'],2)[0].id,'b');
});
test('OCR header uses dedicated supplier/number areas and extracts the printed invoice total',()=>{
 const head=receiptHeaderV106({supplier:'عبد الحليم شلب الشام\nمطعم',number:'رقم الفاتورة 0375',items:'أرز 2 1000 2000\nالمجموع 164250'},[{name:'عبد الحليم شلب الشام'}]);
 assert.equal(head.supplier,'عبد الحليم شلب الشام');
 assert.equal(head.number,'0375');
 assert.equal(head.invoiceTotal,164250);
});
test('OCR imports only mathematically verified item amounts and exact alias matches',()=>{
 const rows=receiptItemsV106('شاي سيلاني 2 3000 6000\nرز مصري 5 1000 5000\nالمجموع 11000',mats);
 assert.equal(rows.length,2);
 assert.equal(rows[0].catalog_id,'tea');
 assert.equal(rows[1].catalog_id,'rice');
 assert.equal(Number(rows[0].quantity)*Number(rows[0].unit_price),6000);
 assert.equal(Number(rows[1].quantity)*Number(rows[1].unit_price),5000);
 assert.equal(receiptMathV106({items:rows,ocr_total:11000}).discrepancy,false);
 assert.equal(receiptMathV106({items:rows,ocr_total:12000}).discrepancy,true);
});
test('OCR does not fabricate qty/price from ambiguous text',()=>{
 const rows=receiptItemsV106('سكر ناعم 8 3000',mats);
 assert.equal(rows.length,1);
 assert.equal(rows[0].catalog_id,'sugar');
 assert.equal(rows[0].quantity,'');
 assert.equal(rows[0].unit_price,'');
 assert.match(rows[0].review_note,/راجع|التمييز/);
 assert.equal(receiptMathV106({items:rows}).valid,false);
});
test('explicit unresolved OCR materials block invoice posting; manual new or mapped need valid units and price',()=>{
 const doc={type:'purchase',date:'2026-10-23',currency:'SYP',supplier:'',items:[{name:'سكر ناعم',material_mode:'unresolved',catalog_id:'',quantity:'2',unit_price:'1000',discount:'0'}]};
 const cat={materials:mats,units,materialLinks:[]};
 assert.equal(validateImageDocument(doc,cat).ready,false);
 const matched={...doc.items[0],material_mode:'matched',catalog_id:'sugar',unit_id:'kg'};
 assert.equal(validateImageDocument({...doc,items:[matched]},cat).ready,true);
 assert.equal(validateImageDocument({...doc,items:[{...matched,unit_id:'pcs'}]},cat).ready,false);
 const created={...matched,material_mode:'new',catalog_id:'',new_name:'مادة جديدة',new_base_unit_id:'kg'};
 assert.equal(validateImageDocument({...doc,items:[created]},cat).ready,true);
 assert.equal(validateImageDocument({...doc,items:[{...created,new_name:'سكر ناعم'}]},cat).ready,false);
});
test('photo route is purchase-only, engine 3 only, scoped crops, hidden raw text and final review dialog',()=>{
 const src=file('js/pages/images.js'),app=file('js/app.js');
 assert.match(app,/images: 'الصور - إدخال سريع'/);
 assert.match(src,/const REGIONS=\[/);
 assert.match(src,/key:'supplier'/);assert.match(src,/key:'number'/);assert.match(src,/key:'items'/);
 assert.match(src,/data-region-mode/);
 assert.match(src,/data-raw-panel hidden/);
 assert.match(src,/data-bulk-ocr="3"/);
 assert.match(src,/data-ocr="3"/);
 assert.doesNotMatch(src,/data-bulk-ocr="1"|data-ocr="1"|api\.createOrder\(|api\.postOrder\(/);
 assert.match(src,/receiptItemsV106\(itemText,catalog\.materials\)\.map\(fillRow\)/);
 assert.match(src,/data-review-invoice/);
 assert.match(src,/title:'مراجعة فاتورة الشراء قبل الحفظ'/);
 assert.match(src,/submitText:'حفظ ونشر الفاتورة'/);
 assert.match(src,/doc\.status='uncertain'/);
 assert.match(src,/postPurchase\(doc\.server_id\)/);
 assert.doesNotMatch(src,/\bOCR\.space\b/);
});
test('SQL migration only adds aliases, enforces collisions, uses RLS and owner-only RPCs',()=>{
 const sql=file('database/Maria-CFO-Web-v1.0.6-Material-Aliases.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.material_aliases_v106/);
 assert.match(sql,/UNIQUE\(alias_key\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.material_identity_create_v106/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.material_identity_update_v106/);
 assert.match(sql,/CREATE TRIGGER material_name_alias_guard_v106/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDROP TABLE public\.materials\b|DELETE FROM public\.materials\b/i);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});
