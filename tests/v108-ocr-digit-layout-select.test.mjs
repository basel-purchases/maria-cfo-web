import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {invoiceAmountV107,invoiceDigitWarningV108} from '../js/invoice-amount-v107.js';
import {receiptHeaderV106,receiptItemsV106,receiptMathV106} from '../js/purchase-image-v106.js';
import {validateImageDocument} from '../js/image-document-rules.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Arabic-Indic zero (٠) and five (٥) are never interchanged with Western zero',()=>{
 for(const [glyph,expected] of [['٠',0],['٥',5],['۰',0],['۵',5],['0',0],['5',5],['٥٠',50],['۵۰',50],['١,٥',1.5],['١٠٠',100],['١0٠',100]]){
  assert.equal(invoiceAmountV107(glyph),expected,`digit ${glyph}`);
 }
 assert.equal(invoiceAmountV107('.'),null,'bare dot is ambiguous, not an OCR numeric value');
 assert.match(invoiceDigitWarningV108('.'),/صفرًا عربيًا/);
 assert.match(invoiceDigitWarningV108('١٠0'),/الخمسة العربية/);
 assert.equal(invoiceDigitWarningV108('٥٠'),'');
});

test('New three-column layout reads the item name embedded under quantity heading',()=>{
 const materials=[{id:'m1',name:'برك جبنة',base_unit_id:'u'}];
 const rows=receiptItemsV106(read('tests/fixtures/v108-ocr-modern-invoice.txt'),materials,80,[{id:'u',name:'حبة'}]);
 assert.equal(rows.length,1,'ignore numeric-only/OCR ghost rows and totals');
 const row=rows[0];
 assert.equal(row.name,'برك جبنة 48 قطعة = حبة سوداء');
 assert.equal(row.unit_price,'920');
 assert.equal(row.ocr_line_total,'9200');
 assert.equal(row.quantity,'10','9200 divided by 920 is a suggested order quantity');
 assert.equal(row.ocr_quantity_inferred,true);
 assert.equal(row.unit_text,'','48-piece packaging description is NOT the purchase unit');
 assert.equal(row.ocr_unit_unresolved,true,'a 48-piece package needs an explicitly reviewed purchase unit');
 assert.equal(row.ocr_quantity_inferred,true);
 assert.equal(row.catalog_id,'','fuzzy name must never auto-select an inventory ID');
 assert.equal(receiptMathV106({items:rows,ocr_total:'9,200'}).discrepancy,false);
});

test('Number containing an underscore survives the invoice header parser',()=>{
 const header=receiptHeaderV106({number:'رقم الفاتورة:\n30_4114',items:read('tests/fixtures/v108-ocr-modern-invoice.txt')});
 assert.equal(header.number,'30_4114');
 assert.equal(header.invoiceTotal,9200);
 const sameLine=receiptHeaderV106({full:'رقم الفاتورة: 30_4114\nالصافي للدفع 9,200'});
 assert.equal(sameLine.number,'30_4114');
});

test('A derived quantity needs a valid unit but no extra review checkbox after the final invoice preview',()=>{
 const row=receiptItemsV106(read('tests/fixtures/v108-ocr-modern-invoice.txt'))[0];
 const cat={materials:[{id:'m1',name:row.name,base_unit_id:'u'}],units:[{id:'u',name:'حبة'}],materialLinks:[]};
 const doc={type:'purchase',date:'2026-10-23',currency:'SYP',items:[{...row,material_mode:'matched',catalog_id:'m1',unit_id:'u'}]};
 assert.equal(validateImageDocument(doc,cat).ready,true);
 assert.equal(validateImageDocument({...doc,items:[{...doc.items[0],unit_id:'',ocr_reviewed:true}]},cat).ready,false,'a reviewed quantity still requires a purchase unit');
 assert.equal(validateImageDocument({...doc,items:[{...doc.items[0],ocr_reviewed:true}]},cat).ready,true);
});

test('UI keeps OCR text editable and links purchase manual / photos screens',()=>{
 const images=read('js/pages/images.js');
 const purchases=read('js/pages/purchases.js');
 const combo=read('js/searchable-select-v033.js');
 const app=read('js/app.js');
 const html=read('index.html');
 assert.match(images,/data-field="name"/);
 assert.match(images,/name:nextName/);
 assert.match(images,/data-go-purchases/);
 assert.match(images,/await saveCurrent\(\);location\.hash='#\/purchases'/);
 assert.match(purchases,/href="#\/images"/);
 assert.match(combo,/Typing is not a selection/);
 const inputHandler=combo.match(/input\.addEventListener\('input',[\s\S]*?\n \}\);/);
 assert.ok(inputHandler);
 assert.doesNotMatch(inputHandler[0],/dispatchEvent/,'typing must not trigger a form re-render');
 assert.match(combo,/select\.dispatchEvent\(new Event\('change'/,'committed selection must notify form');
 assert.match(app,/searchable-select-v033\.js\?v=1\.0\.8/);
 assert.match(html,/Web v1\.0\.15/);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});
