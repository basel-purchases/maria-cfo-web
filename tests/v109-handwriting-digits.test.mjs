import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {receiptItemsV106} from '../js/purchase-image-v106.js';
import {applyDigitAuditV109,parseDigitAuditRowsV109,enhanceHandwritingPixelsV109,parseUnlabelledReceiptTableV109} from '../js/ocr-digit-review-v109.js';
import {invoiceAmountV107} from '../js/invoice-amount-v107.js';
import {validateImageDocument} from '../js/image-document-rules.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=p=>readFileSync(resolve(root,p),'utf8');
const raw=`البنود والإجمالي:\n| | | |\n|---|---|---|\n| ٦٥٠٠ | ضبا 2 + مثال كل | ٦٥٠٠ |\n| ٤٤٥٠ | اسم عارف | ٤٧٧ |\n| ١٩٠ | لفة حب | ١٢٢٠ |`;

test('Unheaded three-column handwriting keeps numeric glyphs and descriptions without inventing qty/price',()=>{
 const items=receiptItemsV106(raw);
 assert.equal(items.length,3);
 assert.equal(items[0].name,'ضبا 2 + مثال كل');
 assert.equal(items[1].name,'اسم عارف');
 assert.equal(items[2].name,'لفة حب');
 assert.deepEqual(items[0].ocr_numeric_candidates.map(x=>x.raw),['٦٥٠٠','٦٥٠٠']);
 assert.deepEqual(items[1].ocr_numeric_candidates.map(x=>x.raw),['٤٤٥٠','٤٧٧']);
 assert.deepEqual(items[2].ocr_numeric_candidates.map(x=>x.value),[190,1220]);
 assert.ok(items.every(x=>x.quantity===''&&x.unit_price===''));
 assert.ok(items.every(x=>x.ocr_review_required===true&&!x.ocr_reviewed));
 assert.equal(items[0].review_note,''); // v1.0.12 removes the obsolete long explanatory paragraph
 assert.equal(validateImageDocument({type:'purchase',date:'2026-10-24',currency:'SYP',items},{}).ready,false);
});
test('Unknown unlabelled numbers are preserved, not relabelled using math or handwritten glyph folklore',()=>{
 const input='|---|---|---|\n| ٢٣ | حمص | ٧٥ |\n| ٠ | خبز | ٥ |';
 const result=parseUnlabelledReceiptTableV109(input);
 assert.equal(result.length,2);
 assert.deepEqual(result[0].ocr_numeric_candidates.map(x=>x.value),[23,75]);
 assert.deepEqual(result[1].ocr_numeric_candidates.map(x=>x.value),[0,5]);
 assert.equal(invoiceAmountV107('٢٣'),23);
 assert.equal(invoiceAmountV107('٣'),3);
 assert.equal(invoiceAmountV107('٧'),7);
 assert.equal(invoiceAmountV107('٥'),5);
 assert.equal(invoiceAmountV107('٠'),0);
});
test('Digit reread surfaces alternatives but does not silently rewrite accounting amounts',()=>{
 const items=receiptItemsV106(raw);
 const second='| ٦٥٠ | ضبا | ٦٠٠٠ |\n| ٤٤٥٠ | عارف | ٤٧٧ |\n| ١٩٠ | لفة | ١٢٢٠ |';
 const review=applyDigitAuditV109(items,second);
 assert.equal(review.matched,true);
 assert.equal(review.rowCount,3);
 assert.equal(review.rows[0].ocr_digit_candidates[0].raw,'٦٥٠');
 assert.equal(review.rows[0].quantity,'');
 assert.equal(review.rows[0].unit_price,'');
 assert.equal(review.rows[0].ocr_reviewed,false);
 assert.match(review.rows[0].review_note,/اختلف/);
 assert.match(review.rows[1].review_note,/لا تضمن صحة الرقم/);
 assert.equal(applyDigitAuditV109(items,'| ٦٥٠ | واحد | ٦٠٠٠ |').matched,false);
 assert.equal(items[0].ocr_digit_candidates,undefined);
});
test('Audit supports cropped one-column digits, but no fake alignment on extra totals',()=>{
 assert.deepEqual(parseDigitAuditRowsV109('| ٢٣ |\n| ٥٠ |').map(x=>x.candidates[0].value),[23,50]);
 assert.equal(applyDigitAuditV109(receiptItemsV106(raw),'| ٦٥٠٠ |').matched,false);
});
test('Gentle handwriting enhancement preserves small dark dots (Arabic zero) and brightens paper',()=>{
 const pixels=new Uint8ClampedArray(7*7*4);
 for(let i=0;i<49;i++){pixels[i*4]=205;pixels[i*4+1]=196;pixels[i*4+2]=177;pixels[i*4+3]=255;}
 // tiny blue dot at center, representing a handwritten Arabic-Indic zero.
 const pos=(3*7+3)*4;pixels[pos]=57;pixels[pos+1]=63;pixels[pos+2]=125;
 const output=enhanceHandwritingPixelsV109(pixels,7,7);
 assert.ok(output[pos]<output[0]-70,'the small dot remains darker than paper');
 assert.ok(output[0]>230,'beige background is cleaned');
 assert.equal(output[pos+3],255);
 assert.deepEqual(Array.from(pixels.slice(pos,pos+3)),[57,63,125],'source image is not mutated');
 assert.throws(()=>enhanceHandwritingPixelsV109([],3,3),/INVALID_HANDWRITING_IMAGE/);
});
test('OCR UI v1.0.10 uses only Engine 3 through a single extract action',()=>{
 const ui=file('js/pages/images.js');const cloud=file('js/image-cloud-ocr.js');
 assert.match(ui,/const REGIONS=\[\{key:'items'/);
 assert.doesNotMatch(ui,/key:'digits'|data-audit-digits|data-preview-digits|data-reparse|data-bulk-ocr/);
 assert.match(ui,/const withCrop=Boolean\(doc\.regions\?\.items\)/);
 assert.match(ui,/sections\.full=full\.text/);
 assert.match(ui,/sections\.items=items\.text/);
 assert.match(ui,/profile:'standard'/);
 assert.match(ui,/data-ocr="3"/);
 assert.match(ui,/data-apply-digit="quantity"/);
 assert.match(ui,/data-apply-digit="unit_price"/);
 assert.match(cloud,/enhanceHandwritingPixelsV109/,'helper retained for old data compatibility, not called by v110 UI');
 assert.equal(existsSync(resolve(root,'config.js')),false);
});
