import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {invoiceAmountV107} from '../js/invoice-amount-v107.js';
import {receiptHeaderV106,receiptItemsV106,receiptMathV106} from '../js/purchase-image-v106.js';
import {validateImageDocument} from '../js/image-document-rules.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const raw=read('tests/fixtures/v107-ocr-markdown-invoice.txt');
const units=[{id:'g',name:'غرام',code:'G'},{id:'kg',name:'كغ',code:'KG'},{id:'bunch',name:'ربطة',code:'BUNCH'}];
const materials=[
 {id:'tom',name:'بندورة',base_unit_id:'g'},
 {id:'pars',name:'بقدونس',base_unit_id:'bunch'},
 {id:'cuc',name:'خيار',base_unit_id:'g'},
 {id:'lem',name:'ليمون',base_unit_id:'g'},
];
const items=()=>receiptItemsV106(raw,materials,80,units);
test('Arabic, Persian and Western digits; decimal comma and thousands grouping are parsed distinctly',()=>{
 assert.equal(invoiceAmountV107('٠,٨'),0.8);
 assert.equal(invoiceAmountV107('۸,۴'),8.4);
 assert.equal(invoiceAmountV107('١٦٤١٥'),16415);
 assert.equal(invoiceAmountV107('١٬٢٥٠'),1250);
 assert.equal(invoiceAmountV107('۱,250.50'),1250.5);
 assert.equal(invoiceAmountV107('1.250,50'),1250.5);
 assert.equal(invoiceAmountV107('٤٥٫٥'),45.5);
 assert.equal(invoiceAmountV107('0'),0);
 for(const invalid of ['','not a number','-', '12x','1,23,4','-3'])assert.equal(invoiceAmountV107(invalid),null);
});
test('Real supplied OCR markdown table yields exactly 15 item rows, no header/footer ghosts',()=>{
 const rows=items();
 assert.equal(rows.length,15);
 assert.equal(rows[0].name,'بندورة');
 assert.equal(rows[0].quantity,'45');
 assert.equal(rows[0].unit_price,'45');
 assert.equal(rows[0].ocr_line_total,'450');
 assert.equal(rows[0].catalog_id,'tom');
 assert.ok(rows.every(x=>x.quantity!==''&&x.unit_price!==''));
 assert.equal(rows[1].name,'فوز');
 assert.equal(rows[1].quantity,'0.8');
 assert.equal(rows[1].unit_price,'48');
 assert.equal(rows[5].quantity,'6.5');
 assert.equal(rows[14].quantity,'8.4');
 assert.equal(rows[14].unit_price,'130');
 assert.equal(rows[14].ocr_line_total,'3695');
 assert.equal(rows[14].catalog_id,'lem');
 assert.equal(rows[3].name,'بقدونس');
 assert.equal(rows[3].quantity,'60','bundle material takes count, not net kilograms');
 assert.equal(rows[3].unit_text,'');
 assert.ok(!rows.some(x=>x.name.includes('المجموع')||x.name.includes('السلسل')));
});
test('Printed totals stay visible; arithmetic conflicts are labelled instead of zeroing OCR amounts',()=>{
 const rows=items();
 assert.equal(rows[0].ocr_review_required,true);
 assert.equal(rows[0].ocr_reviewed,false);
 assert.match(rows[0].review_note,/لا يساوي/);
 assert.equal(rows[4].ocr_review_required,false,'3 x 60 really equals the printed 180');
 assert.equal(rows[2].ocr_unit_unresolved,true,'zero net kg must not invent a unit');
 assert.equal(receiptHeaderV106({number:'رقم الفاتورة:\n. ٣٧٥',items:raw}).invoiceTotal,16415);
 assert.equal(receiptHeaderV106({number:'رقم الفاتورة:\n. ٣٧٥',items:raw}).number,'375');
 assert.equal(receiptMathV106({items:rows,ocr_total:'١٦٤١٥'}).discrepancy,true);
});
test('A flagged OCR mismatch remains visible while saving relies on the final invoice dialog, not an extra checkbox',()=>{
 const row=items()[0];
 const base={type:'purchase',date:'2026-10-23',currency:'SYP',items:[{...row,unit_id:'kg',material_mode:'matched'}]};
 const inventory={materials,units,materialLinks:[{material_id:'tom',unit_id:'kg'}]};
 assert.equal(validateImageDocument(base,inventory).ready,true);
 assert.equal(validateImageDocument({...base,items:[{...row,unit_id:'kg',material_mode:'matched',ocr_reviewed:true}]},inventory).ready,true);
 assert.equal(validateImageDocument({...base,items:[{...row,unit_id:'kg',material_mode:'matched',ocr_reviewed:true,quantity:'٤٥',unit_price:'٤٥',discount:'٠'}]},inventory).ready,true);
});
test('UI supports Arabic numeric keyboard entry, preserves original OCR sources and improves region clear',()=>{
 const page=read('js/pages/images.js'),style=read('assets/styles.css'),html=read('index.html');
 assert.match(page,/receiptItemsV106\(sections\.full,catalog\.materials,80,catalog\.units\)/);
 assert.match(page,/data-field="quantity"[^>]*inputmode="decimal"|inputmode="decimal"[^>]*data-field="quantity"/);
 assert.doesNotMatch(page,/data-field="ocr_reviewed"/);
 assert.match(page,/image-reset-regions-v107/);
 assert.match(style,/image-reset-regions-v107:focus-visible/);
 assert.match(page,/current\(\)\.regions=\{\};cropMode=''/);
 assert.match(page,/data-raw-panel hidden/);
 assert.doesNotMatch(page,/data-reparse|data-audit-digits|تكبير الأرقام/);
 assert.doesNotMatch(page,/data-bulk-ocr="1"|data-ocr="1"/);
 assert.match(html,/Web v1\.0\.13/);
 assert.equal(existsSync(resolve(root,'config.js')),false);
});
