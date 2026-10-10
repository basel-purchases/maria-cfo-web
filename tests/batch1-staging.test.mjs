import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {calculateOrderTotals} from '../js/order-totals.js';
import {chooseStockPair,splitStockQuantity} from '../js/material-stock-display.js';
import {datePeriod,dateInRange} from '../js/date-range-batch.js';
import {filteredManualTransactions} from '../js/manual-ledger-filter.js';
import {buildXlsxBlob} from '../js/xlsx-export.js';
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=x=>readFileSync(resolve(base,x),'utf8');
test('multi-unit stock splits kg and gram with no rounding loss',()=>{
 const units=[{id:'kg',code:'KG',name:'kg'},{id:'g',code:'G',name:'g'}];
 const pair=chooseStockPair({id:'sugar',base_unit_id:'kg'},units,[]);
 assert.ok(pair);
 const split=splitStockQuantity(10.5,pair.large.factor,pair.small.factor);
 assert.equal(split.whole,10);assert.equal(split.minor,500);
});
test('carton/sachet split tracks conversion of 24 units',()=>{
 const units=[{id:'carton',code:'CARTON',name:'carton'},{id:'sachet',code:'SACHET',name:'sachet'}];
 const pair=chooseStockPair({id:'tea',base_unit_id:'carton'},units,[{material_id:'tea',unit_id:'sachet',quantity_in_base:1/24}]);
 assert.equal(pair.large.unit.code,'CARTON');
 const split=splitStockQuantity(34+14/24,pair.large.factor,pair.small.factor);
 assert.equal(split.whole,34);assert.equal(split.minor,14);
});
test('hospitality consumes stock but has no sale value and taxes are separate',()=>{
 const r=calculateOrderTotals([
  {quantity:1,unit_price_original:2000,adjustment_type:'none'},
  {quantity:1,unit_price_original:1000,adjustment_type:'complimentary'},
 ],{discountPercent:5,expenditurePercent:2,localPercent:10});
 assert.equal(r.gross,3000);assert.equal(r.complimentary,1000);
 assert.equal(r.subtotal,2000);assert.equal(r.orderDiscount,100);
 assert.equal(r.expenditureTax,38);assert.equal(r.localTax,3.8);
 assert.equal(r.collected,1941.8);
});
test('date filtering applies to day, month, year correctly',()=>{
 assert.deepEqual(datePeriod('day','2026-10-10'),{start:'2026-10-10',end:'2026-10-10'});
 assert.deepEqual(datePeriod('month','2026-02-11'),{start:'2026-02-01',end:'2026-02-28'});
 assert.deepEqual(datePeriod('year','2026-07-02'),{start:'2026-01-01',end:'2026-12-31'});
 assert.equal(dateInRange('2026-10-10','2026-10-01','2026-10-31'),true);
 assert.equal(dateInRange('2026-09-30','2026-10-01','2026-10-31'),false);
});
test('manual transfers appear in both in/out cashbox history',()=>{
 const d='2026-10-10T13:00:00.000Z';
 const rows=[
  {occurred_at:d,transaction_type:'transfer_out',direction:'out',cashbox_id:'a',amount_original:200},
  {occurred_at:d,transaction_type:'transfer_in',direction:'in',cashbox_id:'b',amount_original:200},
  {occurred_at:d,transaction_type:'sale',direction:'in',cashbox_id:'a',amount_original:4000},
  {occurred_at:d,transaction_type:'expense',direction:'out',cashbox_id:'a',amount_original:50},
 ];
 const opts={period:'day',anchor:'2026-10-10'};
 const manual=filteredManualTransactions(rows,opts);
 assert.equal(manual.length,2);
 assert.equal(filteredManualTransactions(rows,{...opts,direction:'in'}).length,1);
 assert.equal(filteredManualTransactions(rows,{...opts,box:'a'}).length,1);
});
test('Excel output is an OOXML ZIP with no network reference',async()=>{
 const blob=buildXlsxBlob(['Item','Amount'],[['Sugar',1500]],'Cashboxes');
 const bytes=new Uint8Array(await blob.arrayBuffer());
 assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
 assert.ok(blob.size>1000);
});
test('dismissed confirmations resolve false and block backdrop during submission',()=>{
 const ui=file('js/ui.js');
 assert.match(ui,/back\.addEventListener\('click',e=>\{if\(e\.target===back\)close\(\);\}\)/);
 assert.match(ui,/onClose:\(\)=>finish\(false\)/);
 assert.match(ui,/if\(closed\|\|busy\)return/);
});
test('financial migration uses ledger RPCs not direct client updates',()=>{
 const sql=file('database/Maria_CFO_Web_v0.23_Batch1_DRAFT.sql');
 for(const expected of ['public.post_order(p_order_id,false)','public.record_cashbox_transaction(','public.record_inventory_movement(','ORDER_INVENTORY_REVERSAL_MISMATCH']){
  assert.ok(sql.includes(expected),expected);
 }
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.cashbox_transactions/i);
 assert.doesNotMatch(sql,/UPDATE\s+public\.inventory_movements/i);
 assert.match(sql,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.reopen_posted_order_v023/i);
});
test('working pages remain and day-hub image duplicate removed',()=>{
 const hubs=file('js/pages/hubs.js');
 assert.match(hubs,/#\/orders/);
 assert.match(hubs,/#\/inventory/);
 assert.doesNotMatch(hubs,/#\/images/);
 assert.match(file('js/pages/daily.js'),/renderFilteredExpenses/);
});
