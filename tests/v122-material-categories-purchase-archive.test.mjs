import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  normalizeMaterialCategoryV122,cleanMaterialCategoryNameV122,
  findMaterialCategoryV122,suggestMaterialCategoriesV122,ensureMaterialCategoryV122,
} from '../js/material-category-manager-v122.js';
import {filterPurchaseInvoicesV122,isVoidedPurchaseV122} from '../js/purchase-list-filter-v122.js';
import {supplierPurchaseSummaryV119} from '../js/purchase-workflow-v119.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=file=>readFileSync(path.join(root,file),'utf8');
const cats=[
  {id:'hot',name:'مشروبات ساخنة'},
  {id:'cold',name:'مشروبات باردة'},
  {id:'clean',name:'مواد تنظيف'},
  {id:'dry',name:'مواد جافة'},
];

test('v122 normalization and first-letter suggestions for MATERIAL categories only',()=>{
  assert.equal(normalizeMaterialCategoryV122('  مشروبات    باردة  '),'مشروبات باردة');
  assert.equal(cleanMaterialCategoryNameV122('  مشروبات    ساخنة  '),'مشروبات ساخنة');
  assert.deepEqual(suggestMaterialCategoriesV122(cats,'مش').map(c=>c.id),['cold','hot']);
  assert.deepEqual(suggestMaterialCategoriesV122(cats,'تنظيف').map(c=>c.id),['clean']);
  assert.equal(findMaterialCategoryV122(cats,'مشروبات   ساخنة').id,'hot');
  assert.equal(findMaterialCategoryV122(cats,'خضروات'),null);
});

test('v122 existing or blank category never creates a row',async()=>{
  let created=0,loaded=0;
  const dependencies={categories:cats,loadCategories:async()=>{loaded++;return cats;},createCategory:async()=>{created++;return 'x';}};
  assert.equal(await ensureMaterialCategoryV122('  مشروبات باردة ',dependencies),'cold');
  assert.equal(await ensureMaterialCategoryV122('  ',dependencies),null);
  assert.equal(loaded,0); assert.equal(created,0);
});

test('v122 creating new category is persisted exactly once and reuses parallel duplicate',async()=>{
  const stored=[...cats];let creates=0;
  const config={categories:cats,loadCategories:async()=>stored,createCategory:async name=>{
    creates++; const category={id:'new',name};stored.push(category);return category.id;
  }};
  assert.equal(await ensureMaterialCategoryV122('   خضروات   طازجة ',config),'new');
  assert.equal(creates,1);
  assert.equal(await ensureMaterialCategoryV122('خضروات طازجة',{...config,categories:stored}),'new');
  assert.equal(creates,1);
});

test('v122 concurrent category creation failure resolves to saved category instead of duplicate',async()=>{
  let reads=0;
  const result=await ensureMaterialCategoryV122('مواد ورقية',{
    categories:[],loadCategories:async()=>++reads===1?[]:[{id:'race-winner',name:'مواد ورقية'}],
    createCategory:async()=>{throw new Error('duplicate key');},
  });
  assert.equal(result,'race-winner');assert.equal(reads,2);
});

test('v122 category name invalid or missing back-end is blocked before material write',async()=>{
  await assert.rejects(ensureMaterialCategoryV122('ك'.repeat(121),{}),/MATERIAL_CATEGORY_NAME_INVALID/);
  await assert.rejects(ensureMaterialCategoryV122('جديد',{}),/MATERIAL_CATEGORY_RESOLVER_UNAVAILABLE/);
});

const invoices=[
  {id:'draft',status:'draft',supplier_id:'a',invoice_number:'A-1'},
  {id:'live',status:'posted',supplier_id:'a',invoice_number:'A-2'},
  {id:'cancel',status:'voided',is_voided:true,supplier_id:'a',invoice_number:'A-3'},
  {id:'cancel2',status:'posted',is_voided:true,supplier_id:'b',invoice_number:'B-1'},
  {id:'archived',status:'voided',is_voided:true,archived_at_v122:'2026-11-19T00:00:00Z',supplier_id:'b',invoice_number:'B-2'},
];
const suppliers={a:{name:'أبو صفوان'},b:{name:'مشتريات حرة'}};
const ids=(filter)=>filterPurchaseInvoicesV122(invoices,suppliers,filter).map(i=>i.id);
test('v122 status filter shows draft, posted, cancelled and deleted separately',()=>{
  assert.deepEqual(ids({}),['draft','live','cancel','cancel2']);
  assert.deepEqual(ids({status:'draft'}),['draft']);
  assert.deepEqual(ids({status:'posted'}),['live']);
  assert.deepEqual(ids({status:'voided'}),['cancel','cancel2']);
  assert.deepEqual(ids({status:'archived'}),['archived']);
  assert.equal(isVoidedPurchaseV122(invoices[3]),true);
  assert.equal(isVoidedPurchaseV122(invoices[1]),false);
});
test('v122 supplier and free-text filters combine correctly; deleted stay hidden',()=>{
  assert.deepEqual(ids({supplier:'b'}),['cancel2']);
  assert.deepEqual(ids({query:'أبو'}),['draft','live','cancel']);
  assert.deepEqual(ids({status:'voided',supplier:'b',query:'B-1'}),['cancel2']);
});
test('v122 archived cancelled invoices disappear from supplier displayed counts, not financial transactions',()=>{
  const summary=supplierPurchaseSummaryV119({invoices,items:[],payments:[],allocations:[],movements:[]});
  assert.equal(summary.liveCount,1);
  assert.equal(summary.voidedCount,2);
  assert.equal(summary.draftCount,1);
});

test('v122 source includes controlled archive, material CRUD and SQL with no hard delete or reset',()=>{
  const migration=src('database/Maria-CFO-Web-v1.0.22-Invoice-Archive-Material-Categories.sql');
  assert.match(migration,/BEGIN;/);
  assert.match(migration,/COMMIT;/);
  assert.match(migration,/archive_voided_purchase_invoice_v122/);
  assert.match(migration,/archived_at_v122/);
  assert.match(migration,/v_invoice\.status <> 'voided'/);
  assert.match(migration,/manage_material_category_v122/);
  assert.match(migration,/MATERIAL_CATEGORY_IN_USE/);
  assert.match(migration,/IF EXISTS \(SELECT 1 FROM public\.materials WHERE category_id_v023=p_category_id\)/);
  assert.doesNotMatch(migration,/TRUNCATE\s|DELETE FROM public\.purchase_invoices|DELETE FROM public\.inventory_movements|DROP\s+TABLE/i);
  const material=src('js/pages/materials.js');
  assert.match(material,/attachMaterialCategoryPickerV122/);
  assert.doesNotMatch(material,/api\.assetCategoriesV023\(\)/);
  assert.doesNotMatch(material,/materialCategoryChoicesV121/);
  assert.match(material,/categoryId:await categoryPicker\.resolve\(\)/);
  const settings=src('js/pages/settings.js');
  assert.match(settings,/data-category-tab="material-categories"/);
  assert.match(settings,/manageMaterialCategoryV122\('delete'/);
  const purchases=src('js/pages/purchases.js');
  assert.match(purchases,/purchase-status-v122/);
  assert.match(purchases,/archiveVoidedPurchaseV122/);
  assert.match(purchases,/data-restore/);
});
