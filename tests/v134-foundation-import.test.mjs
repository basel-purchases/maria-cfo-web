import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseMenuOnlyV134,parseSalesArchiveV134,parseOriginalCountV134} from '../js/foundation-import-v134.js';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const msql=read('database/Maria-CFO-Web-v1.0.34-Purchase-First-Menu-And-Sales-Archive.sql');
const page=read('js/pages/baseline-imports-v126.js');
const reset=fs.readFileSync('/mnt/data/Maria-CFO-v1.0.34-RESET-OPERATIONAL-DATA-GATED.sql','utf8');
const menuHeaders=['اسم الوجبة','سعر البيع','حالة الوصفة','اسم المادة','الكمية','الوحدة','ملاحظات المصدر'];
const sample={sheets:[{name:'المواد',rows:[['المادة','الوحدة','الرصيد الموجود','آخر سعر شراء للوحدة','تاريخ آخر شراء','كود المادة','مصدر المادة'],['سكر','غرام',null,null,null,null,'فواتير الشراء'],['نشاء','غرام',0,null,null,null,'مادة من المنيو والوصفات']]},
 {name:'المنيو والوصفات',rows:[menuHeaders,['مشروب',250,'منتهي'],[null,null,null,'سكر',10,'غرام','من الشيف'],
 ['حلوى',450,'منتهي'],[null,null,null,'نشاء',5,'غرام','تقديري - افتراض'],
 ['فارغة',null,'بانتظار وصفة']]}]};
test('menu parser preserves recipe catalog, does not import any purchase prices or stock',()=>{
 const r=parseMenuOnlyV134(sample);
 assert.equal(r.stats.menu,3);assert.equal(r.stats.lines,2);
 assert.equal(r.stats.readyRecipes,1);assert.equal(r.stats.pendingRecipes,2);
 assert.equal(r.stats.materialPricesFromWorkbook,0);assert.equal(r.materials.length,2);assert.equal(r.newMaterials.length,1);assert.equal(r.newMaterials[0].stock,0);
});
test('menu parser marks any estimated line for review',()=>{
 const r=parseMenuOnlyV134(sample);
 assert.equal(r.dishes[1].status,'بانتظار اعتماد الوصفة');
});
test('sales parser keeps negative quantity and net amount without payment assumption',()=>{
 const r=parseSalesArchiveV134({sheets:[{name:'حركة تفاصيل الفواتير',rows:[
 ['التاريخ','الفاتورة','اسم الزبون','اسم المادة','الكمية','الوحدة','السعر','القيمة','مجموع الحسم','مجموع الإضافات','صافي القيمة','إجمالي الضرائب'],
 ['2026-11-10 14:03:05','مبيع ك1: 44','','قهوة',-2,'كاسة',100,-200,0,0,-200,0],
 ['2026-11-10 14:03:05','مبيع ك1: 44','','مياه',0,'قطعة',100,0,0,0,0,0],
 ]}]});
 assert.equal(r.stats.invoices,1);assert.equal(r.stats.lines,2);
 assert.equal(r.records[0].lines[0].quantity,-2);assert.equal(r.records[0].lines[0].net,-200);
 assert.equal(r.stats.cashboxPaymentsCreated,0);
});
test('original physical count duplicates are excluded without silently summing dissimilar units',()=>{
 const w={sheets:[{name:'ورقة1',rows:[['المادة','الكمية','الواحدة','ملاحظات','التاريخ'],
 ['عرق ميماس',4,'نصية',null,'20\\11\\2026'],['عرق ميماس',1,'قطعة','1 لتر','20\\11\\2026'],
 ['سكر',2,'كغ',null,'20\\11\\2026'],['عرق عنقود',4,null,null,'20\\11\\2026']]}]};
 const r=parseOriginalCountV134(w);
 assert.equal(r.records.length,1);assert.equal(r.stats.review,2);assert.equal(r.stats.empty,1);
 assert.ok(r.issues.some(x=>x.includes('مكرر')));
});
test('new menu SQL only creates missing recipe catalog materials at zero stock with unknown cost',()=>{
 const f=msql.slice(msql.indexOf('CREATE OR REPLACE FUNCTION public.v134_import_menu_purchase_first'),msql.indexOf('CREATE OR REPLACE FUNCTION public.v134_import_sales_archive'));
 assert.doesNotMatch(f,/INSERT\s+INTO\s+public\.materials/i);
 assert.doesNotMatch(f,/last_purchase_unit_cost_base\s*=/i);
 assert.doesNotMatch(f,/INSERT\s+INTO\s+public\.inventory_movements/i);
 assert.match(f,/public\.purchase_invoice_items/);
 assert.match(f,/v126_menu_recipe_reviews/);
 assert.match(msql,/v134_create_recipe_catalog_materials/);
 assert.match(msql,/v126_material_for_name/);
 assert.match(msql,/materialPricesImported',0/);
});
test('sales history archive never posts cash/stock or order transactions',()=>{
 const f=msql.slice(msql.indexOf('CREATE OR REPLACE FUNCTION public.v134_import_sales_archive'));
 assert.doesNotMatch(f,/INSERT\s+INTO\s+public\.(?:orders|inventory_movements|cashbox_transactions)/i);
 assert.match(msql,/financial_posted boolean NOT NULL DEFAULT false/);
});
test('reset is fail-closed by default, with RESTRICT and owner retained',()=>{
 assert.match(reset,/v_confirmation text := 'DO_NOT_RUN'/);
 assert.match(reset,/SAFE_STOP_UNKNOWN_PUBLIC_TABLES/);
 assert.match(reset,/TRUNCATE TABLE .*RESTART IDENTITY RESTRICT/);
 assert.match(reset,/'app_users'/);
 assert.doesNotMatch(reset,/TRUNCATE TABLE [^;]*CASCADE/);
});
test('baseline import route uses the purchase-first, not prior master catalog parser',()=>{
 assert.match(page,/v134_import_menu_purchase_first/);
 assert.match(page,/v134_create_recipe_catalog_materials/);
 assert.match(page,/v134_import_sales_archive/);
 assert.match(page,/parseOriginalCountV134/);
 assert.doesNotMatch(page,/parseMasterV030/);
 assert.match(page,/p_create_missing:false/);
});
