import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {roundUpKnownMaterialPriceV120,displayKnownMaterialPriceV120,editedKnownMaterialPriceV120}
  from '../js/material-price-rounding-v120.js';
import {marketNewSypPerUsdV120,validateNewSypRateV120,rateApprovalStateV120}
  from '../js/fx-rate-v120.js';
import {validatePurchaseRevisionLinesV120} from '../js/purchase-bulk-editor-v120.js';
import {readMarketDisplayUnitV115,setMarketDisplayUnitV115,marketValueV115}
  from '../js/market-usd-v115.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=name=>readFileSync(path.join(root,name),'utf8');
const sql=source('database/Maria-CFO-Web-v1.0.20-Purchase-Fix-New-SYP-Materials.sql');

// Material price rounding must never change historical invoice records.
test('v120 material last-known price rounds up to the next 10 without separators',()=>{
 for(const [input,out] of [[0,0],[1,10],[10,10],[10.001,20],[19.999,20],[25,30],[149.5,150],[1010,1010],['1250.02',1260]]){
  assert.equal(roundUpKnownMaterialPriceV120(input),out);
 }
 assert.equal(roundUpKnownMaterialPriceV120(null),null);
 assert.equal(roundUpKnownMaterialPriceV120(undefined),null);
 assert.equal(roundUpKnownMaterialPriceV120(-1),null);
 assert.equal(roundUpKnownMaterialPriceV120('ليس رقمًا'),null);
 assert.equal(displayKnownMaterialPriceV120(1234.5),'1240 ل.س');
 assert.equal(displayKnownMaterialPriceV120(null),'—');
 assert.equal(editedKnownMaterialPriceV120(25),30);
});

test('v120 approves only NEW Syrian pound market and configured rates',()=>{
 const quote={buyNew:149.5,sellNew:151,buyOld:14950,sellOld:15100};
 assert.equal(marketNewSypPerUsdV120(quote),151);
 assert.equal(marketNewSypPerUsdV120(quote,'buy'),149.5);
 assert.equal(marketNewSypPerUsdV120({sellNew:15000}),null);
 assert.equal(marketValueV115(quote,'sell','old'),'151');
 assert.equal(readMarketDisplayUnitV115({getItem:()=> 'old'}),'new');
 assert.equal(setMarketDisplayUnitV115('old',{notify:false}),'new');
 assert.equal(validateNewSypRateV120(149.5),true);
 assert.equal(validateNewSypRateV120(14950),false);
 assert.equal(validateNewSypRateV120(0),false);
 assert.equal(rateApprovalStateV120(151,149.5).changed,true);
 assert.equal(rateApprovalStateV120(149.5,149.5).changed,false);
 assert.deepEqual(rateApprovalStateV120(151,14950),{valid:false,reason:'OLD_SYP_RATE_REVIEW_REQUIRED'});
});

test('v120 batch editor validates posted invoice edits before any RPC',()=>{
 const mk=(qty=3,price=20,discount=5)=>[{material_id:'m',purchase_unit_id:'u',quantity:qty,unit_price:price,discount}];
 assert.deepEqual(validatePurchaseRevisionLinesV120(mk(),{posted:true}),{valid:true,total:55});
 assert.equal(validatePurchaseRevisionLinesV120([],{posted:true}).code,'PURCHASE_REVISION_EMPTY_POSTED');
 assert.deepEqual(validatePurchaseRevisionLinesV120([],{posted:false}),{valid:true,total:0});
 assert.equal(validatePurchaseRevisionLinesV120(mk(0),{posted:true}).valid,false);
 assert.equal(validatePurchaseRevisionLinesV120(mk(2,-1),{posted:true}).valid,false);
 assert.equal(validatePurchaseRevisionLinesV120(mk(1,20,21),{posted:true}).valid,false);
 assert.equal(validatePurchaseRevisionLinesV120([{...mk()[0],purchase_unit_id:''}],{posted:true}).valid,false);
 assert.equal(validatePurchaseRevisionLinesV120(Array(501).fill(mk()[0])).code,'PURCHASE_REVISION_BAD_ITEMS');
});

test('v120 published invoice fix matches actual inventory movement source columns',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.void_purchase_invoice_v010\(/);
 assert.match(sql,/source_type='purchase_invoice' AND source_id=p_invoice_id/);
 assert.match(sql,/source_line_id/);
 assert.doesNotMatch(sql.split('\n').filter(line=>!/\s*--/.test(line)).join('\n'),/reference_type|reference_id/);
 assert.match(sql,/v_expected<>v_actual/);
 assert.match(sql,/PERFORM public\.repair_material_latest_purchase_snapshot/);
 assert.match(sql,/WHERE id=v_move\.material_id/);
 assert.match(sql,/source_type,source_id,source_line_id,note/);
});

test('v120 saves header taxes, discount and notes when revising a posted invoice',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.revise_purchase_invoice_v119\(/);
 for(const field of ['discount_original','tax_original','notes','due_date']){
  assert.match(sql,new RegExp(field+'=v_old\\.'+field));
 }
 assert.match(sql,/PURCHASE_REVISION_BELOW_PAID_AMOUNT/);
 assert.match(sql,/PURCHASE_REVISION_PAID_PARTY_OR_CURRENCY/);
 assert.match(sql,/v_old\.currency_code=p_currency_code/);
 assert.match(sql,/UPDATE public\.supplier_payment_allocations SET invoice_id=v_new_id/);
 assert.match(sql,/INSERT INTO public\.purchase_invoice_revisions_v119/);
});

test('v120 invoice edits preserve concurrency safety and financial audit',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.revise_purchase_invoice_v120/);
 assert.match(sql,/p_expected_updated_at timestamptz DEFAULT NULL/);
 assert.match(sql,/PURCHASE_REVISION_STALE_INVOICE/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/PERFORM public\.post_purchase_invoice\(v_new_id\)/);
 assert.match(sql,/PERFORM public\.void_purchase_invoice_v010/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.repair_material_latest_purchase_snapshot/);
 assert.match(sql,/pi\.status='posted' AND NOT coalesce\(pi\.is_voided,false\)/);
});

test('v120 safe supplier deletion rejects linked financial or material history',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.supplier_delete_if_unused_v120/);
 for(const table of ['purchase_invoices','supplier_payments','supplier_materials','ameen_supplier_balances_v024']){
  assert.match(sql,new RegExp('FROM public\\.'+table+' WHERE supplier_id=p_supplier_id'));
 }
 assert.match(sql,/SUPPLIER_HAS_HISTORY_CANNOT_DELETE/);
});

test('v120 USD price sync uses approved rate, audit and idempotent comparison, not a market fetch',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.material_price_sync_current_fx_v120/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.material_price_set_new_exchange_v120/);
 assert.match(sql,/v_rate>1000/);
 assert.match(sql,/p_rate>1000/);
 assert.match(sql,/price_usd_v110\*v_rate/);
 assert.match(sql,/IS DISTINCT FROM v_new/);
 assert.match(sql,/IS DISTINCT FROM v_rate/);
 assert.match(sql,/INSERT INTO public\.material_price_history_v110/);
 assert.match(sql,/fx_revalue/);
 assert.match(sql,/PERFORM public\.set_exchange_rate\('USD',p_rate/);
 assert.doesNotMatch(sql,/http[s]?:\/\/|TRUNCATE\s+TABLE|DROP TABLE/i);
});

test('v120 UI supplier row includes edit, delete and direct invoice, with locked supplier selection',()=>{
 const supplier=source('js/pages/suppliers.js');
 const purchase=source('js/pages/purchases.js');
 assert.match(supplier,/supplier-edit-v120/);
 assert.match(supplier,/supplier-delete-v120/);
 assert.match(supplier,/supplier-new-invoice-v119/);
 assert.match(supplier,/supplierDeleteIfUnusedV120/);
 assert.match(supplier,/startSupplierInvoiceV121\(\{supplier:entry\}\)/);
 assert.match(purchase,/supplierId:supplier\?\.id\|\|null/);
 assert.match(purchase,/maria_open_supplier_catalog_v119/);
 assert.match(purchase,/purchase-new-for-supplier-v121/);
 assert.match(purchase,/openInvoiceLineEditorV120/);
 assert.match(purchase,/saveInvoiceRevisionV120/);
 assert.match(purchase,/updatedAt:invoice\.updated_at\|\|null/);
});

test('v120 material classification can be created, edited, persisted and used in filter',()=>{
 const material=source('js/pages/materials.js');
 const api=source('js/api.js');
 assert.match(material,/category_id_v023/);
 assert.match(material,/materialCategoryFieldV122/);
 assert.match(material,/attachMaterialCategoryPickerV122/);
 assert.match(api,/manageMaterialCategoryV122/);
 assert.match(material,/categoryPicker\.resolve\(\)/);
 assert.match(api,/materialIdentityUpdatePricedV110/);
 assert.match(material,/displayKnownMaterialPriceV120\(price\)/);
 assert.match(material,/referencePriceEdited/);
});

test('v120 settings show only new SYP, launch checks USD material revalue and version is cache-busted',()=>{
 const settings=source('js/pages/settings.js');
 const app=source('js/app.js');
 const index=source('index.html');
 assert.doesNotMatch(settings,/id="usd-market-unit-v115"/);
 assert.match(settings,/1 USD = كم ل\.س جديدة/);
 assert.match(settings,/materialPriceSetNewExchangeV120\(rate\)/);
 assert.match(app,/syncStoredMaterialFxOnLaunchV120/);
 assert.match(app,/materialPriceSyncCurrentFxV120\(\)/);
 assert.match(app,/marketNewSypPerUsdV120\(q,side\)/);
 for(const mod of ['pages/materials.js','pages/settings.js','pages/purchases.js','pages/suppliers.js']){
  assert.ok(app.includes("./"+mod+'?v='+(['pages/materials.js','pages/settings.js'].includes(mod)?'1.0.22':mod==='pages/purchases.js'?'1.0.23':'1.0.26')),mod);
 }
 assert.match(index,/Web v1\.0\.29/);
 assert.equal(source('VERSION').trim(),'1.0.29');
 assert.equal(existsSync(path.join(root,'config.js')),false);
});
