import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeArabicNumbers,parseOcrLines,exactCatalogId,autofillExactCatalog,validateImageDocument,localStatus} from '../js/image-document-rules.js';
import {conversionChoices,preferredChoice,fromBase,toBase,prettyRelation} from '../js/unit-display-conversion.js';
import {recognitionScore} from '../js/image-local-ocr.js';
import {formatUnitAmount} from '../js/unit-catalog.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sql=readFileSync(resolve(root,'database/Maria_CFO_Web_v0.19_Migration.sql'),'utf8');
const images=readFileSync(resolve(root,'js/pages/images.js'),'utf8');
const app=readFileSync(resolve(root,'js/app.js'),'utf8');
const css=readFileSync(resolve(root,'assets/styles.css'),'utf8');
const gram={id:'g',code:'G',name:'Gram'};
const kg={id:'kg',code:'KG',name:'Kilogram'};
const sugar={id:'sugar',name:'سكر',base_unit_id:'kg'};
const menu=[{id:'tea',name:'شاي'}];
const sample={type:'order',date:'2026-10-09',currency:'SYP',cashbox_id:'cash',items:[{catalog_id:'tea',name:'شاي',quantity:'2',unit_price:'1000',discount:'3'}],status:'review'};
const cat={menu,materials:[sugar],units:[kg,gram],materialLinks:[],cashboxes:[{id:'cash',is_active:true}]};

test('gram display for sugar recipe with kilogram inventory base is exactly converted',()=>{
  const choice=preferredChoice(kg,[kg,gram],0.004);
  assert.equal(choice.unit.code,'G');
  assert.equal(fromBase(0.004,choice),4);
  assert.equal(toBase(4,choice),0.004);
  assert.match(prettyRelation({name:'ملعقة سكر',code:'U_SUGAR'},kg,0.004,[kg,gram],formatUnitAmount),/٤ غرام/);
  assert.equal(fromBase(1,preferredChoice(kg,[kg,gram],1)),1);
});

test('switching between grams and kilograms never mutates the stored base quantity',()=>{
  const choices=conversionChoices(kg,[kg,gram]);
  const small=choices.find(x=>x.unit.code==='G');
  const large=choices.find(x=>x.unit.code==='KG');
  assert.equal(toBase(4,small),0.004);
  assert.equal(fromBase(toBase(4,small),large),0.004);
});

test('Arabic and eastern Arabic digits are parsed without inventing missing quantity',()=>{
  assert.equal(normalizeArabicNumbers('١٢٣٫٥'), '123.5');
  assert.equal(normalizeArabicNumbers('۱۲۳'), '123');
  const rows=parseOcrLines('فاتورة\n٢ شاي ١٠٠٠\nأوزي ٢ ٣٠٠٠\nمجموع ٧٠٠٠\nشاي ١٥٠٠');
  assert.equal(rows.length,3);
  assert.deepEqual(rows.slice(0,2).map(x=>[x.name,x.quantity,x.unit_price]),[['شاي','2','1000'],['أوزي','2','3000']]);
  assert.equal(rows[2].quantity,'');
});

test('OCR exact match is unambiguous; fuzzy names are not silently mapped',()=>{
  assert.equal(exactCatalogId('شاي',menu),'tea');
  assert.equal(exactCatalogId('شاى',menu),'tea');
  assert.equal(exactCatalogId('شایء',menu),'');
  assert.equal(exactCatalogId('شاي',[...menu,{id:'other',name:'شاي'}]),'');
  assert.equal(autofillExactCatalog([{name:'شاي'}],menu)[0].catalog_id,'tea');
});

test('a complete order is ready, wrong cashbox or missing price prevents posting',()=>{
  assert.equal(validateImageDocument(sample,cat).ready,true);
  assert.equal(validateImageDocument({...sample,cashbox_id:''},cat).ready,false);
  assert.equal(validateImageDocument({...sample,items:[{...sample.items[0],unit_price:''}]},cat).ready,false);
  assert.equal(validateImageDocument({...sample,items:[{...sample.items[0],discount:'105'}]},cat).ready,false);
});

test('purchase requires mapped unit and discount within item total',()=>{
  const purchase={...sample,type:'purchase',supplier:'',cashbox_id:'',items:[{name:'سكر',catalog_id:'sugar',unit_id:'kg',quantity:2,unit_price:1200,discount:200}]};
  assert.equal(validateImageDocument(purchase,cat).ready,true);
  assert.equal(validateImageDocument({...purchase,items:[{...purchase.items[0],unit_id:'invalid'}]},cat).ready,false);
  assert.equal(validateImageDocument({...purchase,items:[{...purchase.items[0],discount:3000}]},cat).ready,false);
});

test('an unprocessed image remains visible while incomplete; a published image remains labelled published',()=>{
  assert.equal(localStatus({status:'unprocessed',items:[],text:''},null),'غير معالج');
  assert.equal(localStatus({status:'review',items:[{}],text:''},{ready:false}),'يحتاج استكمال');
  assert.equal(localStatus({status:'review',items:[{}],text:'x'},{ready:true}),'جاهز للنشر');
  assert.equal(localStatus({status:'published'},null),'منشور');
});

test('cashbox adjustment migration uses valid type per direction; no constraint weakening',()=>{
  assert.match(sql,/WHEN 'in' THEN 'adjustment_in'/);
  assert.match(sql,/ELSE 'adjustment_out'/);
  assert.match(sql,/public\.record_cashbox_transaction\(/);
  assert.match(sql,/public\.is_app_owner\(\)/);
  assert.match(sql,/REVOKE ALL/);
  assert.doesNotMatch(sql,/DROP CONSTRAINT|DISABLE TRIGGER|INSERT INTO public\.cashbox_transactions/i);
});

test('local pictures are not sent to Supabase; saving drafts uses existing protected API functions',()=>{
  const store=readFileSync(resolve(root,'js/image-local-store.js'),'utf8');
  assert.match(store,/indexedDB\.open/);
  assert.doesNotMatch(store,/\.functions\.invoke|\.storage\.from|fetch\(/);
  assert.match(images,/await saveLocalImage\(/);
  assert.match(images,/api\.createOrder\(/);
  assert.match(images,/api\.createPurchase\(/);
  assert.match(images,/api\.postOrder\(/);
  assert.match(images,/api\.postPurchase\(/);
  assert.match(images,/actual\?\.status!==['"]posted['"]/);
  assert.match(images,/await confirmBox\(/);
  assert.match(images,/filter\(isReady\)/);
});

test('two OCR modes available, both default to Arabic and English',()=>{
  const ocr=readFileSync(resolve(root,'js/image-local-ocr.js'),'utf8');
  assert.match(ocr,/\['ara','eng'\]/);
  assert.match(ocr,/if\(mode==='accurate'\)/);
  assert.match(ocr,/processedImage\(/);
  assert.match(ocr,/worker\.recognize/);
  assert.ok(recognitionScore({text:'شاي 2 1000',confidence:80})>recognitionScore({text:'',confidence:0}));
});

test('new images route and styles integrated without changing config.js',()=>{
  assert.match(app,/\['#\/images', 'الصور'\]/);
  assert.match(app,/case 'images': return renderImages\(root\)/);
  assert.match(css,/\.image-document-grid\{/);
  assert.match(images,/data-ocr="3"/);
  assert.match(images,/حفظ محلي/);
  assert.match(images,/نشر الجاهزة/);
});
