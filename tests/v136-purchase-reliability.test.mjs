import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=new URL('../js/pages/baseline-imports-v126.js',import.meta.url);
const page=readFileSync(source,'utf8');
const sql=readFileSync(new URL('../database/Maria-CFO-Web-v1.0.36-Purchase-Import-Reliability.sql',import.meta.url),'utf8');
const func=page.match(/export function v136PurchaseChunks\([\s\S]*?\n}\n/)[0];
const errorFn=page.match(/export function v136ImportError\([\s\S]*?\n}\n/)[0];
const {v136PurchaseChunks,v136ImportError}=await import('data:text/javascript,'+encodeURIComponent(
 'const friendlyError=(e,f)=>f;\n'+func+'\n'+errorFn));

test('keeps a 209-line invoice atomic and splits following invoices',()=>{
 const invoices=[{number:'شراء: 12',lines:Array.from({length:209},(_,i)=>({row:i}))},
   ...Array.from({length:200},(_,i)=>({number:`شراء: ${i+13}`,lines:Array.from({length:7},()=>({}))}))];
 const batches=v136PurchaseChunks(invoices);
 assert.equal(batches[0].length,1);
 assert.equal(batches[0][0].lines.length,209);
 assert.deepEqual(batches.flat(),invoices);
 assert.ok(batches.every(b=>b.length<=6));
 assert.ok(batches.every(b=>b.length===1||b.reduce((sum,v)=>sum+v.lines.length,0)<=85));
});

test('error message preserves real server details instead of generic toast',()=>{
 const err=v136ImportError({code:'P0001',message:'V136_PURCHASE_IMPORT_FAILED invoice=شراء: 12',details:'row 33'});
 assert.match(err,/شراء: 12/);
 assert.match(err,/row 33/);
 assert.match(err,/P0001/);
});

test('SQL replaces cashier trigger and captures payment failure as deferred',()=>{
 assert.match(sql,/DROP TRIGGER IF EXISTS v135_purchase_archive_cash_trigger/);
 assert.match(sql,/CREATE TRIGGER v136_purchase_archive_cash_trigger/);
 assert.match(sql,/EXCEPTION WHEN OTHERS THEN[\s\S]*?v136_historical_cash_deferred/);
 assert.match(sql,/v136_retry_deferred_cash/);
 assert.match(sql,/NOTIFY pgrst, 'reload schema'/);
});

test('SQL historic importer refreshes invoice total once after all item rows',()=>{
 const section=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.v126_import_historic_invoices('));
 assert.equal((section.match(/PERFORM public.refresh_purchase_invoice_totals_v010/g)||[]).length,1);
 assert.equal((section.match(/PERFORM public.add_purchase_invoice_item/g)||[]).length,0);
 assert.match(section,/V136_PURCHASE_IMPORT_FAILED invoice=/);
});

test('original menu catalogue not reimported and physical count last',()=>{
 const steps=readFileSync(new URL('../js/pages/initial-setup-v134.js',import.meta.url),'utf8');
 const a=steps.indexOf("{id:'salesArchive'");
 const b=steps.indexOf("{id:'count'");
 assert.ok(a>=0&&b>a);
 assert.match(steps,/2-المنيو-والمواد-بدون-أساسيات.xlsx/);
 assert.match(steps,/نموذج-الجرد-الرسمي.xlsx/);
});
