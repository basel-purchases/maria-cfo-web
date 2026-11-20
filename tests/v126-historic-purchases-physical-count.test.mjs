import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 parseHistoryInvoicesV126,parsePhysicalCountV126,countPresentAtDateV126,excelDateV126,
} from '../js/baseline-parsers-v126.js';
const sql=fs.readFileSync(new URL('../database/Maria-CFO-Web-v1.0.26-Historical-Invoices-Physical-Count.sql',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../js/pages/baseline-imports-v126.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const historyHeaders=['التاريخ','الفاتورة','اسم الزبون','اسم المادة','الكمية','الوحدة','السعر','القيمة','مجموع الحسم','مجموع الإضافات','صافي القيمة','إجمالي الضرائب'];
const historySample={sheets:[{name:'حركة تفاصيل الفواتير',rows:[historyHeaders,
 ['2026-11-19','شراء: 101','مورد أول','صدر دجاج',3,'كغ',20,60,10,0,50,0],
 ['2026-11-19','شراء: 101','مورد أول','ثوم',4,'كغ',15,60,0,3,63,0],
 ['2026-11-18','شراء: 99','مورد ثاني','زيت زيتون',1,'لتر',0,0,0,0,0,0],
 ]}]};
const countHeaders=['اسم المادة المعتمد','الكمية المعدودة','وحدة العد','تاريخ الجرد','ملاحظات الجرد','اسم الجرد القديم','كمية الجرد القديم','وحدة الجرد القديم','حالة المطابقة','مصدر الصنف','آخر سعر فاتورة (ل.س/وحدة شراء)','آخر تاريخ فاتورة','المورد الأخير','وحدة شراء الأمين','عدد سطور الشراء','حالة الاعتماد'];
const countSample={sheets:[{name:'اللحوم الحمراء',rows:[[],[],[],countHeaders,
 ['لحم غنم',12,'كغ','2026-11-18',''],
 ['صدر دجاج',0,'كغ','2026-11-18','تأكدنا من الصفر',null,null,null,null,null,null,null,null,null,null,'معتمد'],
 ['صدر غنم',5,'كغ','2026-11-18','غير مطابق',null,null,null,null,null,null,null,null,null,null,'مراجعة']
 ]},{name:'البوظة',rows:[[],[],[],countHeaders,['بوظة امية حليب',3,'كغ','2026-11-17','',null,null,null,null,null,null,null,null,null,null,'معتمد']]}]};

test('historical invoice parser groups same date-number-supplier as single invoice',()=>{
 const r=parseHistoryInvoicesV126(historySample);
 assert.deepEqual([r.stats.invoices,r.stats.lines,r.stats.suppliers,r.stats.materials],[2,3,2,3]);
 assert.equal(r.records[1].lines.length,2);
 assert.equal(r.records[1].total,113);
 assert.equal(r.stats.currency,'SYP');
});
test('Al-Ameen net includes line discounts and additions without inventing USD',()=>{
 const r=parseHistoryInvoicesV126(historySample).records[1];
 assert.equal(r.lines[0].net,50);assert.equal(r.lines[0].discount,10);
 assert.equal(r.lines[1].net,63);assert.equal(r.lines[1].additions,3);
 assert.equal(r.lines[0].unit,'كغ');
});
test('invoice parser separates identical number with different day or supplier',()=>{
 const sample={sheets:[{name:'x',rows:[historyHeaders,
 ['2026-11-18','شراء: 3','س','م',1,'كغ',1,1,0,0,1,0],
 ['2026-11-19','شراء: 3','س','م',1,'كغ',1,1,0,0,1,0],
 ['2026-11-19','شراء: 3','ص','م',1,'كغ',1,1,0,0,1,0],
 ]}]};
 assert.equal(parseHistoryInvoicesV126(sample).stats.invoices,3);
});
test('invoice parser warns about missing purchase units and preserves explicit audit marker',()=>{
 const x=structuredClone(historySample);x.sheets[0].rows[1][5]='';
 const p=parseHistoryInvoicesV126(x);assert.equal(p.stats.missingUnits,1);
 assert.equal(p.records[1].lines[0].unitWasMissing,true);
 assert.ok(p.issues.some(s=>s.includes('وحدة ناقصة')));
});
test('invalid invoice line cannot be silently posted',()=>{
 const x=structuredClone(historySample);x.sheets[0].rows[1][4]=-2;
 assert.throws(()=>parseHistoryInvoicesV126(x),/السطر 2/);
});
test('physical count ignores empty quantities and lines without explicit approval',()=>{
 const p=parsePhysicalCountV126(countSample);
 assert.deepEqual([p.stats.sections,p.stats.approved,p.stats.review,p.stats.empty],[2,2,2,0]);
 assert.deepEqual(p.records.map(r=>r.name),['صدر دجاج','بوظة امية حليب']);
});
test('explicit counted zero is valid and different from unknown blank',()=>{
 const p=parsePhysicalCountV126(countSample);
 assert.equal(p.records[0].quantity,0);assert.equal(p.records.length,2);
});
test('duplicate approved item across sheets is refused before any database write',()=>{
 const x=structuredClone(countSample);x.sheets[1].rows[4][0]='صدر دجاج';
 assert.throws(()=>parsePhysicalCountV126(x),/مكررة/);
});
test('invalid date in approved count is rejected',()=>{
 const x=structuredClone(countSample);x.sheets[1].rows[4][3]='2026-14-55';
 assert.throws(()=>parsePhysicalCountV126(x),/التاريخ/);
});
test('stock reconciliation: approved count on historical date + posted later movements',()=>{
 assert.deepEqual(countPresentAtDateV126({count:100,opening:230,after:-36}),{difference:-130,current:64});
 assert.deepEqual(countPresentAtDateV126({count:0,opening:20,after:5}),{difference:-20,current:5});
 assert.deepEqual(countPresentAtDateV126({count:12,opening:5,after:-2}),{difference:7,current:10});
});
test('Excel date parsing protects invalid dates including local DD/MM/YYYY',()=>{
 assert.equal(excelDateV126('20\\11\\2026'),'2026-11-20');
 assert.equal(excelDateV126('2026-11-20T00:00:00'),'2026-11-20');
 assert.equal(excelDateV126('2026-02-30'),null);
 assert.equal(excelDateV126(46346)?.length,10);
});
test('historical paid assertion is separate from cashbox payments',()=>{
 assert.match(sql,/is_ameen_legacy_v029\s*=\s*true/);
 assert.match(sql,/paid_outside_system_by_operator/);
 assert.doesNotMatch(sql,/record_cashbox_transaction\s*\(/i);
 assert.doesNotMatch(sql,/supplier_payment_post|post_purchase_invoice_paid_v123/i);
});
test('menu-only import never writes or adjusts stock quantities',()=>{
 const start=sql.indexOf('CREATE OR REPLACE FUNCTION public.v126_import_menu_only');
 const end=sql.indexOf('CREATE OR REPLACE FUNCTION public.v126_guard_backdated_stock');
 const body=sql.slice(start,end);
 assert.doesNotMatch(body,/record_inventory_movement\s*\(/);
 assert.doesNotMatch(body,/current_stock_base\s*=/);
 assert.match(body,/v126_menu_recipe_reviews/);
});
test('approved physical count uses saved historic ledger and post-date ledger',()=>{
 assert.match(sql,/occurred_at<v_cutoff/);
 assert.match(sql,/occurred_at>=v_cutoff/);
 assert.match(sql,/v_qbase-v_before/);
 assert.match(sql,/source_sha256=p_sha256 AND counted_base=v_qbase/);
 assert.match(sql,/COUNT_ALREADY_APPROVED_FOR_MATERIAL_AND_DATE/);
 assert.match(sql,/BACKDATED_STOCK_MOVEMENT_BEFORE_APPROVED_COUNT/);
});
test('historic import does not assert unknown dollar prices or silently translate carton units',()=>{
 assert.match(sql,/PACKAGE_UNIT_CONVERSION_REQUIRES_REVIEW/);
 assert.doesNotMatch(sql,/price_usd_v110\s*=/);
 assert.match(page,/لا يُخترَع سعر دولار/);
});
test('app includes dedicated navigation and marks v1.0.26',()=>{
 assert.match(app,/case 'baseline-imports': return renderBaselineImportsV126/);
 assert.match(app,/\['#\/baseline-imports', 'استيراد الفواتير والجرد'\]/);
 assert.match(app,/Web v1\.0\.27/);
});

test('an approved count with a blank quantity must fail, never silently skip the material',()=>{
 const x=structuredClone(countSample);x.sheets[0].rows[4][1]=null;x.sheets[0].rows[4][15]='معتمد';
 assert.throws(()=>parsePhysicalCountV126(x),/دون كمية معدودة/);
});
