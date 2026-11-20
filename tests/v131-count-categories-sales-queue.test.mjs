import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePhysicalCountV131,consumptionBusinessDateV131} from '../js/physical-count-standard-v131.js';
const base='database/Maria-CFO-Web-v1.0.31-';
const countSql=fs.readFileSync(base+'Inventory-Catalog-And-Count-Ledger.sql','utf8');
const saleSql=fs.readFileSync(base+'Pending-Sales-Consumption.sql','utf8');
const page=fs.readFileSync('js/pages/baseline-imports-v126.js','utf8');
const app=fs.readFileSync('js/app.js','utf8');
const queue=fs.readFileSync('js/pages/sale-cost-queue-v131.js','utf8');
const workbook={sheets:[{name:'الجرد',rows:[
 ['اسم المادة','الكمية','الواحدة','التاريخ','القسم'],
 ['بيبسي',null,'قطعة',null,'مشروبات غازية'],
 ['كولا',3,'قطعة','20/11/2026','مشروبات غازية'],
 ['حليب',0,'لتر','2026-11-20','ألبان'],
 ['تفاح',null,'كغ',null,'فواكه'],
]}]};
test('canonical five-column sheet reads classification independently of count quantity',()=>{
 const parsed=parsePhysicalCountV131(workbook);
 assert.equal(parsed.records.length,2);
 assert.equal(parsed.catalog.length,4);
 assert.equal(parsed.stats.empty,2);
 assert.equal(parsed.records[0].department,'مشروبات غازية');
 assert.equal(parsed.records[1].quantity,0);
});
test('same material with two category labels is not silently classified',()=>{
 const w=structuredClone(workbook);
 w.sheets[0].rows.push(['بيبسي',null,'قطعة',null,'عصائر']);
 const r=parsePhysicalCountV131(w);
 assert.ok(r.issues.some(x=>x.includes('أكثر من قسم')));
 assert.equal(r.catalog.some(x=>x.name==='بيبسي'),false);
});
test('date boundary includes inventory day in approved count',()=>{
 assert.equal(consumptionBusinessDateV131('2026-11-19','2026-11-20'),'covered_by_count');
 assert.equal(consumptionBusinessDateV131('2026-11-20','2026-11-20'),'covered_by_count');
 assert.equal(consumptionBusinessDateV131('2026-11-21','2026-11-20'),'after_count');
});
test('classification only fills unclassified materials, does not create from blank quantity',()=>{
 assert.match(countSql,/WHERE id=v_id AND category_id_v023 IS NULL/);
 assert.doesNotMatch(countSql,/INSERT INTO public\.materials/i);
 assert.match(page,/v131ClassifyCountCatalog/);
 assert.match(page,/parsed\.catalog/);
});
test('count upload is idempotent for material and same date regardless of file hash',()=>{
 assert.match(countSql,/SELECT id INTO v_existing FROM public\.v126_physical_counts WHERE material_id=v_mat AND count_date=v_date/);
 assert.match(countSql,/v_skipped:=v_skipped\+1/);
 assert.match(countSql,/v131_count_batch_lines/);
});
test('sale completion never records cash receipt, snapshots every material, skips count-covered days',()=>{
 assert.doesNotMatch(saleSql,/record_cashbox_transaction\s*\(/i);
 assert.match(saleSql,/v_covered:=\(v_last_count IS NOT NULL AND v_sale.sale_date<=v_last_count\)/);
 assert.match(saleSql,/public\.material_consumption_plan_v130/);
 assert.match(saleSql,/public\.record_inventory_movement/);
 assert.match(saleSql,/ON CONFLICT\(ameen_line_id\) DO NOTHING/);
 assert.match(saleSql,/EXCEPTION WHEN OTHERS/);
});
test('queue and physical count history are routed and available as manual actions',()=>{
 assert.match(app,/case 'sale-cost-queue'/);
 assert.match(app,/case 'count-history'/);
 assert.match(app,/maria:recipe-saved/);
 assert.match(queue,/صرف المكونات الجاهزة/);
 assert.match(queue,/background:#e8f7eb/);
});
