import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {materialCategoryChoicesV121,normalizeCategoryNameV121,resolveMaterialCategoryChoiceV121} from '../js/material-category-choices-v121.js';
import {supplierInvoiceDraftPayloadV121,createSupplierInvoiceDraftV121} from '../js/purchase-supplier-shortcut-v121.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=name=>readFileSync(path.join(root,name),'utf8');
const existingAssets=[
  {id:'asset-kitchen',name:'تجهيزات مطبخ'},
  {id:'asset-bags',name:'اكياس وعلب قصدير'},
  {id:'asset-clothes',name:'ثياب'},
];

test('v121 material edit offers categories already present in Settings even if material category table is empty',()=>{
  const options=materialCategoryChoicesV121([],existingAssets);
  assert.equal(options.length,3);
  assert.deepEqual(options.map(o=>o.name).sort(),existingAssets.map(o=>o.name).sort());
  assert.deepEqual(options.map(o=>o.source),['asset','asset','asset']);
  assert.ok(options.every(o=>o.id.startsWith('asset:')));
});

test('v121 material categories take precedence, matching asset names appear once only',()=>{
  const options=materialCategoryChoicesV121([
    {id:'mat-bags',name:'  اكياس   وعلب قصدير  '},
    {id:'mat-food',name:'خضروات'},
  ],existingAssets);
  const bags=options.filter(o=>normalizeCategoryNameV121(o.name)===normalizeCategoryNameV121('اكياس وعلب قصدير'));
  assert.equal(bags.length,1);
  assert.deepEqual(bags[0],{id:'mat-bags',name:'اكياس   وعلب قصدير',source:'material'});
  assert.equal(options.length,4);
});

test('v121 resolves existing material category without any insert or SQL migration',async()=>{
  const choices=materialCategoryChoicesV121([{id:'mat-food',name:'خضروات'}],existingAssets);
  let creates=0;
  const result=await resolveMaterialCategoryChoiceV121('mat-food',choices,{
    loadMaterialCategories:()=>{throw Error('Should not fetch');},
    createMaterialCategory:()=>{creates++;throw Error('Should not create');},
  });
  assert.equal(result,'mat-food');assert.equal(creates,0);
  assert.equal(await resolveMaterialCategoryChoiceV121('',choices,{}),null);
});

test('v121 choosing a category from Settings assets resolves to valid material category ID on save',async()=>{
  const choices=materialCategoryChoicesV121([],existingAssets);
  const selected=choices.find(c=>c.name==='اكياس وعلب قصدير');
  let materialCategories=[],created=0;
  const deps={
    loadMaterialCategories:async()=>materialCategories,
    createMaterialCategory:async name=>{
      created++;
      const c={id:'material-linked-category',name};materialCategories.push(c);return c;
    },
  };
  const materialId=await resolveMaterialCategoryChoiceV121(selected.id,choices,deps);
  assert.equal(materialId,'material-linked-category');
  assert.notEqual(materialId,existingAssets[1].id);
  assert.equal(created,1);
  assert.deepEqual(materialCategoryChoicesV121(materialCategories,existingAssets).find(c=>c.id===materialId),{
    id:materialId,name:selected.name,source:'material',
  });
  assert.equal(await resolveMaterialCategoryChoiceV121(selected.id,choices,deps),materialId);
  assert.equal(created,1);
});

test('v121 concurrent category creation reuses matching row instead of creating a duplicate',async()=>{
  const choices=materialCategoryChoicesV121([],existingAssets);
  const selected=choices.find(c=>c.name==='ثياب');
  let listed=0;
  const id=await resolveMaterialCategoryChoiceV121(selected.id,choices,{
    loadMaterialCategories:async()=>++listed===1?[]:[{id:'material-race-winner',name:' ثياب '}],
    createMaterialCategory:async()=>{throw Error('duplicate key value violates unique constraint');},
  });
  assert.equal(id,'material-race-winner');
});

test('v121 rejects invalid category selections before modifying the material',async()=>{
  const choices=materialCategoryChoicesV121([],existingAssets);
  await assert.rejects(
    resolveMaterialCategoryChoiceV121('nonexistent-category',choices,{
      loadMaterialCategories:async()=>[],createMaterialCategory:async()=>({id:'wrong'}),
    }),/MATERIAL_CATEGORY_INVALID_SELECTION/);
});

test('v121 new supplier invoice preselects supplier and does not copy old invoice identity or line items',()=>{
  assert.deepEqual(supplierInvoiceDraftPayloadV121({id:'supp-1',name:' أبو صفوان ',default_currency_code:'SYP'},'USD'),{
    supplierId:'supp-1',supplierName:'أبو صفوان',currency:'USD',invoiceNumber:null,
  });
  assert.deepEqual(supplierInvoiceDraftPayloadV121({name:'مورد مستورد'},'BAD'),{
    supplierId:null,supplierName:'مورد مستورد',currency:'SYP',invoiceNumber:null,
  });
  assert.throws(()=>supplierInvoiceDraftPayloadV121(null),/SUPPLIER_NOT_FOUND/);
});

test('v121 one click creates draft then schedules item choices then opens third-screen invoice details',async()=>{
  const events=[];
  const id=await createSupplierInvoiceDraftV121({
    supplier:{id:'supp-1',name:'أبو صفوان'},currency:'SYP',date:'2026-11-19',
    createPurchase:async args=>{
      events.push(['create',args]);return 'draft-new-uuid';
    },
    prepareCatalog:id=>events.push(['catalog',id]),
    navigate:route=>events.push(['route',route]),
  });
  assert.equal(id,'draft-new-uuid');
  assert.deepEqual(events,[
    ['create',{supplierId:'supp-1',supplierName:'أبو صفوان',currency:'SYP',invoiceNumber:null,date:'2026-11-19'}],
    ['catalog','draft-new-uuid'],['route','#/purchase/draft-new-uuid'],
  ]);
});

test('v121 failed purchase creation never navigates to a nonexistent invoice or opens stale catalog',async()=>{
  const events=[];
  await assert.rejects(createSupplierInvoiceDraftV121({
    supplier:{id:'s',name:'مورد'},date:'2026-11-19',
    createPurchase:async()=>{events.push('create');throw Error('NETWORK_DOWN');},
    prepareCatalog:()=>events.push('catalog'),
    navigate:()=>events.push('navigate'),
  }),/NETWORK_DOWN/);
  assert.deepEqual(events,['create']);
});

test('v121 no misleading edit lines button: invoice list and detail create new supplier invoice',()=>{
  const purchase=src('js/pages/purchases.js');
  const suppliers=src('js/pages/suppliers.js');
  const materials=src('js/pages/materials.js');
  assert.match(purchase,/purchase-new-for-supplier-v121/);
  assert.match(purchase,/data-new-from-invoice/);
  assert.match(purchase,/new-supplier-invoice-v121/);
  assert.match(purchase,/startSupplierInvoiceV121\(\{supplier,currency:invoice\.currency_code\}\)/);
  assert.doesNotMatch(purchase,/class="mini-action purchase-open-bulk-v120"/);
  assert.doesNotMatch(purchase,/class="btn edit-lines-v120"/);
  assert.match(purchase,/class="btn add"/); // Preserve adding lines in draft/details
  assert.match(purchase,/class="btn secondary reuse"/); // Supplier item picker
  assert.match(purchase,/class="btn secondary ocr"/); // Photo import
  assert.match(purchase,/class="mini-action edit-item"/); // Existing invoice line edits remain
  assert.match(suppliers,/startSupplierInvoiceV121\(\{supplier:entry\}\)/);
  assert.match(suppliers,/startSupplierInvoiceV121\(\{supplier\}\)/);
  assert.doesNotMatch(materials,/api\.assetCategoriesV023\(\)/);
  assert.match(materials,/attachMaterialCategoryPickerV122/);
  assert.match(materials,/materialCategoryFieldV122/);
});

test('v121 version is fully updated and ZIP source does not contain user config',()=>{
  assert.equal(src('VERSION').trim(),'1.0.27.1');
  assert.match(src('index.html'),/Web v1\.0\.27/);
  assert.match(src('js/app.js'),/Web v1\.0\.27/);
  for(const name of ['materials','purchases','suppliers']){
    assert.match(src('js/app.js'),new RegExp(`pages/${name}\\.js\\?v=1\\.0\\.${name==='purchases'?'23':name==='suppliers'?'26':'22'}`));
  }
  assert.equal(existsSync(path.join(root,'config.js')),false);
  // Previously shipped SQL had missing semicolon before another CREATE FUNCTION.
  const sql=src('database/Maria-CFO-Web-v1.0.20-Purchase-Fix-New-SYP-Materials.sql');
  assert.match(sql,/RETURN v_new_id;\s*END;\s*\$function\$;\s*-- Optimistic concurrency/);
});
