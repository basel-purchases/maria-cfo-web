import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 PAGE_SIZES,pageInfo,paginateArray,sourceIndex,importedRowsFor,
 numericValue,supplierBalanceState,suppliersFilter,mergeSupplierRecords,
} from '../js/table-presenter-v025.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(join(root,p),'utf8');

test('Pagination handles zero rows, last page, invalid page, large catalogs',()=>{
 assert.deepEqual(pageInfo(0,100,18),{total:0,pages:1,page:1,from:0,to:0});
 assert.deepEqual(pageInfo(368,21,18),{total:368,pages:21,page:21,from:361,to:368});
 assert.deepEqual(pageInfo(368,23,18),{total:368,pages:21,page:21,from:361,to:368});
 const a=Array.from({length:63},(_,i)=>i);
 assert.deepEqual(paginateArray(a,3,25).rows,Array.from({length:13},(_,i)=>i+50));
 assert.equal(PAGE_SIZES.menu,18);assert.equal(PAGE_SIZES.orders,25);
});
test('Supplier zero, unpaid and credit balances use the imported balance, not transaction sums',()=>{
 assert.equal(supplierBalanceState({current_balance:0}),'settled');
 assert.equal(supplierBalanceState({current_balance:'19448'}),'unpaid');
 assert.equal(supplierBalanceState({current_balance:2000}),'unpaid');
 assert.equal(supplierBalanceState({current_balance:-1}),'credit');
 assert.equal(supplierBalanceState(null),'no-import');
 assert.equal(supplierBalanceState({current_balance:null}),'unknown');
});
test('Imported supplier accounts join by stable ID or external account without duplicates',()=>{
 const core=[{id:'1',name:'ملحمة الرجوب',ameen_account_code_v024:'2217',phone:'777'},
  {id:'2',name:'أدوات',ameen_account_code_v024:'2218'},
  {id:'3',name:'مورد يدوي'},
  {id:'4',name:'شراء مباشر',notes:'SYSTEM_DIRECT_PURCHASE'}];
 const accounts=[{supplier_id:'1',supplier_name:'ملحمة الرجوب',external_account:'2217',current_balance:0},
 {supplier_id:'2',supplier_name:'أدوات',external_account:'2218',current_balance:19448},
 {supplier_id:null,supplier_name:'مورد جديد',external_account:'2238',current_balance:2000}];
 const merged=mergeSupplierRecords(core,accounts);
 assert.equal(merged.length,4);
 assert.equal(suppliersFilter(merged,{status:'unpaid'}).length,2);
 assert.equal(suppliersFilter(merged,{status:'no-import'}).length,1);
 assert.equal(suppliersFilter(merged,{query:'2218'}).length,1);
 assert.equal(suppliersFilter(merged,{query:'ملحمة'}).length,1);
});
test('Imported warehouse snapshot lookup does not merge different item kinds or mislabel base stock',()=>{
 const a={id:'m1',name:'ليمون'},r=[
  {kind:'material',name:'ليمون',core_entity_id:'m1',warehouse:'المطبخ',quantity_original:300,unit_name:'غرام'},
  {kind:'material',name:'ليمون',core_entity_id:'m1',warehouse:'الصالة',quantity_original:400,unit_name:'غرام'},
  {kind:'menu',name:'ليمون',core_entity_id:'c1',warehouse:'الصالة',quantity_original:300,unit_name:'قطعة'},
 ];
 const index=sourceIndex(r,'material');
 assert.equal(importedRowsFor(a,index).length,2);
 assert.equal(importedRowsFor({id:'unknown',name:'ليمون'},index).length,0);
 assert.equal(numericValue(null),null);
 assert.equal(numericValue('0'),0);
});
test('Actual pages request server-side order and recipe paging; there are no unbounded card renders',()=>{
 const api=read('js/api.js');const daily=read('js/pages/daily.js');const menu=read('js/pages/menu.js');
 assert.match(api,/ordersPageV025/);assert.match(api,/menuItemsPageV025/);
 assert.match(api,/.range\(from,from\+size-1\)/);
 assert.match(menu,/PAGE_SIZES\.menu/);assert.match(menu,/api\.menuItemsPageV025/);
 assert.match(daily,/PAGE_SIZES\.orders/);assert.match(daily,/api\.ordersPageV025/);
 assert.doesNotMatch(daily.slice(daily.indexOf('export async function renderOrders(root)'),daily.indexOf('function newOrder(boxes)')),/api\.orders\(\)/);
});
test('CSS protects visible controls from one-letter-per-line materials table breakage and styles all RTL dropdowns',()=>{
 const css=read('assets/styles.css');
 assert.match(css,/materials-table-scroll \.materials-table/);
 assert.match(css,/min-width:1650px/);
 assert.match(css,/material-actions \.mini-btn/);
 assert.match(css,/white-space:nowrap/);
 assert.match(css,/select:not\(\[multiple\]\):not\(\[size\]\)/);
 assert.match(css,/appearance:none/);
 assert.match(css,/background-position:left 12px center/);
});
test('SQL stores Excel negotiable-paper balance without changing historical paid transactions',()=>{
 const sql=read('database/Maria_CFO_Web_v0.25_Migration.sql');
 const p=read('js/ameen-import-parser.js');
 assert.match(p,/uncollectedPapers:/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS uncollected_papers_v025 numeric/);
 assert.match(sql,/uncollected_papers_v025=excluded.uncollected_papers_v025/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.import_ameen_v024/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.cashbox_transactions/i);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.order_payments/i);
 assert.equal((sql.match(/^BEGIN;/mg)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/mg)||[]).length,1);
});
test('v0.25 keeps the Al-Ameen import, OCR and legacy routes intact',()=>{
 assert.match(read('js/app.js'),/Web v0\.25/);
 assert.match(read('js/app.js'),/renderQuickImports/);
 assert.match(read('js/app.js'),/renderImages/);
 assert.match(read('js/app.js'),/renderSuppliersWithAmeen/);
 assert.match(read('js/pages/materials.js'),/showImportedSourceDialog/);
 assert.match(read('js/pages/assets.js'),/showImportedSourceDialog/);
 assert.match(read('js/pages/suppliers.js'),/supplier-status-filter/);
 assert.ok(existsSync(join(root,'vendor/jszip.min.js')));
 assert.ok(!existsSync(join(root,'config.js')));
});
