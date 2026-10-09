import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chooseStockPair,splitStockQuantity,formatSmartStock} from '../js/material-stock-display.js';
import {invertedRelationIsClear,prettyRelation,relationAmountFromBase,relationBaseFromAmount} from '../js/unit-display-conversion.js';
import {reviewedOcrItemCandidates} from '../js/image-document-rules.js';
import {normalizedCrop,recognitionQuality} from '../js/image-local-ocr.js';
import {validateNamedUnitDraft} from '../js/unit-catalog.js';
const base=join(dirname(fileURLToPath(import.meta.url)),'..');
const cart={id:'carton',code:'CARTON',name:'Carton'};
const sachet={id:'sachet',code:'SACHET',name:'Sachet'};
const tea={id:'tea',name:'شاي',base_unit_id:cart.id};
const links=[{material_id:'tea',unit_id:sachet.id,quantity_in_base:0.04166667}];
const units=[cart,sachet];

test('34.583333 cartons with 24 sachets per carton shows 34 cartons and 14 sachets, NOT 20',()=>{
  const actual=formatSmartStock(tea,units,links,34.583333);
  assert.match(actual.text,/٣٤ كرتونة/);
  assert.match(actual.text,/١٤ ظرف/);
  assert.equal(actual.converted,true);
  assert.match(actual.original,/٣٤٫٥٨٣٣٣٣/);
});
test('inverse packaging works when sachet is the base stock unit',()=>{
  const t={id:'tea',name:'شاي',base_unit_id:'sachet'};
  const pair=chooseStockPair(t,units,[{material_id:'tea',unit_id:'carton',quantity_in_base:24}]);
  assert.equal(pair.large.unit.id,'carton');
  assert.equal(pair.small.unit.id,'sachet');
  assert.match(formatSmartStock(t,units,[{material_id:'tea',unit_id:'carton',quantity_in_base:24}],830).text,/٣٤ كرتونة و١٤ ظرف/);
});
test('change display direction without mutating stored quantity',()=>{
  assert.equal(invertedRelationIsClear(cart,0.04166667),true);
  assert.equal(relationAmountFromBase(0.04166667,{unit:cart,factor:1},true),24);
  assert.ok(Math.abs(relationBaseFromAmount(24,{unit:cart,factor:1},true)-1/24)<1e-9);
  assert.match(prettyRelation(sachet,cart,0.04166667,units,n=>String(n)),/1 كرتونة = 24 ظرف/);
  assert.equal(invertedRelationIsClear({code:'KG'},.004),false);
});
test('unmapped units remain as original stock: no invented conversions',()=>{
  assert.equal(formatSmartStock(tea,units,[],34.583333).converted,false);
  assert.equal(splitStockQuantity(0,1,.04166667).whole,0);
});
test('printed Arabic item with valid quantity and price may be promoted only on explicit action',()=>{
  const rows=reviewedOcrItemCandidates('فاتورة\n٢ شاي ١٠٠٠\n٢ رز ٥٠٠\nCe Ql Ral المطلوب VE PIV\nمجموع ٣٠٠٠',[]);
  assert.deepEqual(rows.map(r=>r.name),['شاي','رز']);
});
test('gibberish from the uploaded handwritten invoice does not become 15 arbitrary purchase lines',()=>{
  const noisy=`٠ 0 مجموعة 111 ججح\nA 5 كبن © 8 كلا\nIRR VINES التاريغ er الى :\nCe Ql Ral المطلوب من السيد ممديرية رهبم\nم الب VE PIV بحي ازج 1\nCASEI اذى Ve LE é\nEE Es Tm\n`; 
  assert.equal(reviewedOcrItemCandidates(noisy,[]).length,0);
});
test('image crop validates bounds and does not modify image blob',()=>{
  assert.deepEqual(normalizedCrop({x:.12,y:.07,w:.8,h:.4}),{x:.12,y:.07,w:.8,h:.4});
  assert.equal(normalizedCrop({x:-1,y:0,w:1,h:1}),null);
  assert.equal(normalizedCrop({x:0,y:0,w:.001,h:1}),null);
});
test('weak OCR is marked uncertain; confidence is an estimate, not posting permission',()=>{
  assert.equal(recognitionQuality({text:'معلومات',confidence:20}).uncertain,true);
  assert.equal(recognitionQuality({text:'شاي أرز ٢ ١٠٠٠',confidence:85}).uncertain,false);
});
test('OCR only modifies the text; no automatic line items or DB writes on extraction',()=>{
  const src=readFileSync(join(base,'js/pages/images.js'),'utf8');
  const segment=src.split('async function extractOne')[1].split('async function extractMany')[0];
  assert.match(segment,/doc\.text=result\.text/);
  assert.doesNotMatch(segment,/doc\.items\s*=/);
  assert.doesNotMatch(segment,/api\.post|api\.create|api\.add/);
  assert.match(src,/data-clear-items/);
  assert.match(src,/data-remove-item/);
  assert.match(src,/reviewedOcrItemCandidates/);
  assert.match(src,/ocr-progress-pill/);
  assert.match(src,/data-toggle-crop/);
});

test('editing an existing legacy sachet named ظرف is allowed; creating another ambiguous name is not',()=>{
  const legacy=[{id:'sachet',name:'ظرف',code:'SACHET',is_system:false}];
  const input={name:'ظرف',materialId:'tea',amount:1/24,units:legacy};
  assert.equal(validateNamedUnitDraft({...input,unitId:'sachet'}),null);
  assert.match(validateNamedUnitDraft(input),/اسم الوحدة عام/);
});
