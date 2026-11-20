import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  purchaseLineTotalV119,purchaseTotalsV119,revisionLinesV119,
  supplierSuggestionsV119,supplierPurchaseSummaryV119,
} from '../js/purchase-workflow-v119.js';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=name=>readFileSync(path.join(base,name),'utf8');

test('v1.0.19 invoice total handles quantity, unit price and line discounts',()=>{
  const items=[
    {quantity_purchase_unit:3,unit_price_original:1200,line_discount_original:150},
    {quantity_purchase_unit:1.5,unit_price_original:80,line_discount_original:20},
  ];
  assert.equal(purchaseLineTotalV119(items[0]),3450);
  assert.deepEqual(purchaseTotalsV119(items),{subtotal:3720,discounts:170,total:3550});
  assert.equal(purchaseLineTotalV119({quantity:2,unit_price:4,discount:3}),5);
  assert.deepEqual(purchaseTotalsV119([]),{subtotal:0,discounts:0,total:0});
});

test('v1.0.19 posted invoice correction payload preserves all editable line attributes',()=>{
  const lines=revisionLinesV119([
    {material_id:'material1',purchase_unit_id:'unit1',quantity_purchase_unit:2,
      unit_price_original:7,line_discount_original:1,notes:'ملاحظة'},
    {material_id:'material2',purchase_unit_id:'unit2',quantity:4,unit_price:9,discount:0},
  ]);
  assert.deepEqual(lines,[
    {material_id:'material1',purchase_unit_id:'unit1',quantity:2,unit_price:7,discount:1,notes:'ملاحظة'},
    {material_id:'material2',purchase_unit_id:'unit2',quantity:4,unit_price:9,discount:0,notes:null},
  ]);
});

test('v1.0.19 supplier suggestion matches first Arabic letter and prioritizes prefix',()=>{
  const suppliers=[
    {id:'1',name:'أبو أحمد للخضار'},
    {id:'2',name:'شركة أحمد'},
    {id:'3',name:'ابو فارس'},
    {id:'4',name:'شراء مباشر',notes:'SYSTEM_DIRECT_PURCHASE'},
  ];
  const results=supplierSuggestionsV119(suppliers,'ا');
  assert.deepEqual(results.map(x=>x.id),['1','3','2']);
  assert.deepEqual(supplierSuggestionsV119(suppliers,'فا').map(x=>x.id),['3']);
  assert.equal(supplierSuggestionsV119(suppliers,' ').length,0);
});

test('v1.0.19 supplier totals exclude voided/draft/historic revisions and do not mix currencies',()=>{
  const activity={
    invoices:[
      {id:'a',status:'posted',currency_code:'SYP',total_original:300,is_voided:false},
      {id:'b',status:'posted',currency_code:'USD',total_original:10,is_voided:false},
      {id:'c',status:'posted',currency_code:'SYP',total_original:0,is_voided:true},
      {id:'d',status:'draft',currency_code:'SYP',total_original:600,is_voided:false},
      {id:'e',status:'posted',currency_code:'SYP',total_original:550,is_ameen_legacy_v029:true},
    ],
    items:[
      {invoice_id:'a',material_id:'m',purchase_unit_id:'u',material_name:'طحين',unit_name:'كغ',quantity_purchase_unit:2,unit_price_original:100,line_discount_original:0},
      {invoice_id:'a',material_id:'m',purchase_unit_id:'u',material_name:'طحين',unit_name:'كغ',quantity_purchase_unit:1,unit_price_original:100,line_discount_original:0},
      {invoice_id:'b',material_id:'m',purchase_unit_id:'u',material_name:'طحين',unit_name:'كغ',quantity_purchase_unit:4,unit_price_original:2.5,line_discount_original:0},
      {invoice_id:'c',material_id:'m',purchase_unit_id:'u',material_name:'طحين',unit_name:'كغ',quantity_purchase_unit:8,unit_price_original:10,line_discount_original:0},
    ],
    payments:[{id:'pay',status:'posted'},{id:'draftpay',status:'draft'}],
    allocations:[
      {payment_id:'pay',invoice_id:'a',amount_invoice_currency:100},
      {payment_id:'pay',invoice_id:'b',amount_invoice_currency:3},
      {payment_id:'draftpay',invoice_id:'b',amount_invoice_currency:4},
      {payment_id:'pay',invoice_id:'c',amount_invoice_currency:8},
    ],
    movements:[{id:'movement'}],
  };
  const summary=supplierPurchaseSummaryV119(activity);
  assert.deepEqual(summary.currencies.SYP,{purchased:300,paidAllocated:100,outstanding:200,invoiceCount:1});
  assert.deepEqual(summary.currencies.USD,{purchased:10,paidAllocated:3,outstanding:7,invoiceCount:1});
  assert.equal(summary.liveCount,2);
  assert.equal(summary.draftCount,1);
  assert.equal(summary.voidedCount,1);
  assert.equal(summary.materials.length,1);
  assert.equal(summary.materials[0].quantity,7);
  assert.deepEqual(summary.materials[0].amounts,{SYP:300,USD:10});
  assert.equal(summary.materials[0].invoiceCount,2);
  assert.equal(summary.movementCount,1);
});

test('v1.0.19 posted correction only happens through one server transaction; no data reset',()=>{
  const migration=source('database/Maria-CFO-Web-v1.0.19-Purchase-Revisions-Supplier-Insights.sql');
  assert.match(migration,/BEGIN\s*;/i);
  assert.match(migration,/COMMIT\s*;/i);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.revise_purchase_invoice_v119/i);
  assert.match(migration,/CREATE OR REPLACE FUNCTION public\.supplier_activity_v119/i);
  assert.match(migration,/IF NOT public\.is_app_owner\(\)/i);
  assert.match(migration,/PERFORM public\.post_purchase_invoice\(v_new_id\)/);
  assert.match(migration,/PERFORM public\.void_purchase_invoice_v010\(p_invoice_id/);
  assert.match(migration,/PURCHASE_REVISION_BELOW_PAID_AMOUNT/);
  assert.match(migration,/PURCHASE_REVISION_PAID_PARTY_OR_CURRENCY/);
  assert.match(migration,/purchase_invoice_revisions_v119/i);
  const sqlBody=migration.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
  assert.doesNotMatch(sqlBody,/\b(TRUNCATE|DROP TABLE|DELETE FROM public\.purchase_invoices)\b/i);
});

test('v1.0.19 no accidental dialog backdrop close; supplier quick invoice and detail route are wired',()=>{
  const ui=source('js/ui.js');
  const app=source('js/app.js');
  const supplier=source('js/pages/suppliers.js');
  const purchase=source('js/pages/purchases.js');
  assert.doesNotMatch(ui,/back\.addEventListener\(['"]pointerdown['"]/);
  assert.match(app,/case 'supplier': return renderSupplierDetail\(root,id\)/);
  assert.match(supplier,/supplier-new-invoice-v119/);
  assert.match(supplier,/supplier-create-purchase-v119/);
  assert.match(supplier,/data-supplier-tab="invoices"/);
  assert.match(supplier,/data-supplier-tab="payments"/);
  assert.match(purchase,/maria_open_supplier_catalog_v119/);
  assert.match(purchase,/openSupplierCatalogDialog/);
  assert.match(purchase,/edit-invoice-v119/);
  assert.match(purchase,/purchase-total-row-v119/);
  assert.equal(source('VERSION').trim(),'1.0.34.1');
  assert.equal(existsSync(path.join(base,'config.js')),false);
});
