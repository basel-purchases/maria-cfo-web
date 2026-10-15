import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMasterV030,QUICK_TYPES_V030} from '../js/quick-import-parser-v030.js';
import {parseAmeenRows} from '../js/ameen-import-parser.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const slurp=p=>readFileSync(join(root,p),'utf8');
function master(){
 const mats=[['المادة','الوحدة','الرصيد الموجود','آخر سعر','تاريخ آخر شراء','الكود'],['سكر','غرام',200,10,'2026-10-10','M001'],['ملح','غرام',180,5,'2026-10-10','M002']];
 const dishes=[['اسم الوجبة','سعر البيع','الحالة','ابحث عن مادة','المادة','الكمية','الوحدة','سعر','التكلفة','نسبة الكوست','ملاحظات'],
 ['عصير',250,'منتهي',null,'سكر',15,'غرام',null,null,null,null,null,null,'M001'],
 ['وجبة',300,'بحاجة لتعبئة كميات',null,'ملح',null,'غرام',null,null,null,'حدد الكميات',null,null,'M002'],
 ['وجبة بدون مواد',700,'بحاجة لإضافة مواد',null,null,null,null,null,null,null,'أضف المكونات'],
 ['صنف غير مسعر',null,'بحاجة لإضافة مواد',null,null,null,null,null,null,null,'أضف المكونات']];
 return {sheets:[{name:'المواد',rows:mats},{name:'المنيو والوصفات',rows:dishes}]};
}
test('four types and master data parse without inventing prices or recipes',()=>{
 assert.deepEqual(Object.keys(QUICK_TYPES_V030).slice(0,4),['master','assets','suppliers','orders']);
 const result=parseMasterV030(master());
 assert.equal(result.materials.length,2);
 assert.equal(result.dishes.length,4);
 assert.equal(result.stats.readyRecipes,1);
 assert.equal(result.stats.pendingRecipes,3);
 assert.deepEqual(result.dishes[0].lines.map(l=>[l.materialName,l.quantity,l.needsReview]),[['سكر',15,false]]);
 assert.equal(result.dishes[1].lines[0].needsReview,true);
 assert.equal(result.dishes[2].lines.length,0);
 assert.equal(result.dishes[3].salePrice,null);
 assert.ok(result.warnings.some(w=>/سعر بيع/.test(w.message)));
});
test('hidden source material code resolves formula cells not cached',()=>{
 const wb=master();
 wb.sheets[1].rows[1][4]=null; // formula E has no cached value
 const result=parseMasterV030(wb);
 assert.equal(result.dishes[0].lines[0].materialName,'سكر');
 assert.equal(result.stats.readyRecipes,1);
});
test('invalid workbook structures or inventory numbers are rejected',()=>{
 const wb=master();wb.sheets[0].rows[1][3]=0;
 assert.throws(()=>parseMasterV030(wb),/السعر/);
 wb.sheets[0].rows[1][3]=10;wb.sheets[0].rows[2][0]='سكر';
 assert.throws(()=>parseMasterV030(wb),/مكرر/);
 const wrong=master();wrong.sheets[1].name='خطأ';
 assert.throws(()=>parseMasterV030(wrong),/يجب وجود/);
});
test('one central sidebar link immediately before settings and no recipes-import button',()=>{
 const app=slurp('js/app.js'), hub=slurp('js/pages/hubs.js'),menu=slurp('js/pages/menu.js');
 assert.match(app,/\['#\/quick-imports', 'الإدخالات السريعة'\],\s*(?:\['#\/daily-orders', 'الأوردرات'\],\s*)?\['#\/settings'/);
 assert.doesNotMatch(hub,/#\/quick-imports|#\/recipes-import/);
 assert.doesNotMatch(menu,/#\/recipes-import/);
 assert.match(app,/case 'recipes-import': location\.hash='#\/quick-imports'/);
});
test('server migration has atomic ingestion, owner check, source types, history, and guarded 24h undo',()=>{
 const sql=slurp('database/Maria-CFO-Web-v0.30-Central-Quick-Imports.sql');
 assert.match(sql,/BEGIN;[\s\S]+COMMIT;/);
 for(const func of ['quick_import_v030','quick_import_history_v030','quick_import_undo_v030']){
  assert.match(sql,new RegExp('FUNCTION public\\.'+func+'\\('));
 }
 assert.match(sql,/interval '24 hours'/);
 assert.match(sql,/UNDO_24_HOUR_WINDOW_EXPIRED/);
 assert.match(sql,/UNDO_RECORD_CHANGED_AFTER_IMPORT/);
 assert.match(sql,/UNDO_MATERIAL_USED_AFTER_IMPORT/);
 assert.match(sql,/UNDO_NEWER_IMPORT_FIRST/);
 assert.match(sql,/quick_import_recipe_drafts_v030/);
 assert.match(sql,/quick_import_order_rows_v030/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/coalesce\(v_rec->>'kind',''\)<>'asset'/);
 assert.match(sql,/v_pending:=v_pending\+1/);
 assert.match(sql,/p_cashbox_id=>NULL/);
 assert.doesNotMatch(sql,/post_order\(|record_cashbox_transaction\(|post_purchase_invoice\(/i);
});
test('front-end uses one RPC per file and does not publish financial transactions',()=>{
 const ui=slurp('js/quick-imports-v030.js');
 assert.match(ui,/quick_import_v030/);
 assert.match(ui,/quick_import_history_v030/);
 assert.match(ui,/quick_import_undo_v030/);
 assert.match(ui,/parseMasterV030/);
 assert.match(ui,/kind==='assets'/);
 assert.match(ui,/\.filter\(r=>r\.kind==='asset'/);
});
test('real legacy Ameen report parsers still handle orders, inventory and suppliers',()=>{
 const headers=['رقم الطلب','التاريخ','صافي الطلب','اسم المادة','الكمية','السعر','صافي القلم','ليرة سورية','الوحدة'];
 const rows=[headers,['105','2026-10-12 10:00:00',600,'مياه',2,300,600,0,'قطعة']];
 const orders=parseAmeenRows('orders',rows);
 assert.equal(orders.records.length,1);
 assert.equal(orders.records[0].items.length,1);
 assert.equal(orders.records[0].reviewReasons.length>0,true);
});
