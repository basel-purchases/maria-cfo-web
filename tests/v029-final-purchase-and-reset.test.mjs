import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=new URL('../',import.meta.url);
const sql=fs.readFileSync(new URL('database/Maria-CFO-v0.29-FINAL-Kitchen-Purchases.sql',base),'utf8');
const reset=fs.readFileSync(new URL('database/Maria-CFO-v0.29-RESET-ALL-BUSINESS-DATA-KEEP-OWNER-DANGER.sql',base),'utf8');
test('legacy kitchen purchase postings are canonical, atomic, and do not invent cash payments',()=>{
 assert.match(sql,/public\.post_purchase_invoice\(v_invoice\)/);
 assert.match(sql,/public\.add_purchase_invoice_item\(/);
 assert.match(sql,/is_ameen_legacy_v029=true/);
 assert.match(sql,/WHERE coalesce\(pi\.is_ameen_legacy_v029,false\)=false/);
 assert.match(sql,/SOURCE_INVOICE_CHANGED_REVIEW_REQUIRED/);
 assert.doesNotMatch(sql,/PERFORM public\.record_cashbox_transaction\(/);
 assert.doesNotMatch(sql,/PERFORM public\.record_supplier_invoice_payment\(/);
});
test('balance reconciliation prevents treating gross historical purchases as on-hand',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.reconcile_ameen_kitchen_stock_v029/);
 assert.match(sql,/IF v_invoices<>538 THEN/);
 assert.match(sql,/reference_quantity-v_mat\.current_stock_base/);
 assert.match(sql,/CASE WHEN v_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out'/);
 assert.match(sql,/source_code='2015011'/);
 assert.match(sql,/RECONCILE_MARIA_KITCHEN_V029_NOW/);
});
test('reset cannot be triggered by an accidental paste',()=>{
 assert.match(reset,/v_confirmation text := 'NOT_CONFIRMED'/);
 assert.match(reset,/RESTART IDENTITY RESTRICT/);
 assert.match(reset,/ameen_kitchen_catalog_v029/);
 assert.match(reset,/ameen_purchase_documents_v029/);
 assert.match(reset,/ameen_kitchen_reconciliation_runs_v029/);
 assert.doesNotMatch(reset,/TRUNCATE TABLE[^;]*CASCADE/i);
});
