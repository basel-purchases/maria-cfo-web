import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {proposeEventAllocationV035,bookingDisplayNamesV035} from '../js/event-seating-v035.js';
const root=new URL('../',import.meta.url);
const read=x=>fs.readFileSync(new URL(x,root),'utf8');
test('group booking fills first table and immediate right neighbour',()=>{
 const ts=[1,2,3].map(i=>({id:String(i),table_label:`طاولة ${i}`,display_order:i,capacity:4,status:'available',booking_id:null}));
 assert.deepEqual(proposeEventAllocationV035(ts,'1',5).rows,[{table_id:'1',guests:4},{table_id:'2',guests:1}]);
});
test('booked neighbour cannot be crossed to reach distant empty table',()=>{
 const ts=[1,2,3].map(i=>({id:String(i),table_label:`طاولة ${i}`,display_order:i,capacity:4,status:'available',booking_id:i===2?'occupied':null}));
 const out=proposeEventAllocationV035(ts,'1',5);
 assert.equal(out.ok,false);
 assert.match(out.reason,/لا تكفي/);
});
test('left neighbour can be used when right neighbour is reserved',()=>{
 const ts=[1,2,3].map(i=>({id:String(i),table_label:`طاولة ${i}`,display_order:i,capacity:4,status:'available',booking_id:i===3?'occupied':null}));
 assert.deepEqual(proposeEventAllocationV035(ts,'2',6).rows,[{table_id:'2',guests:4},{table_id:'1',guests:2}]);
});
test('guest display fills unnamed attendees with owner name',()=>{
 assert.deepEqual(bookingDisplayNamesV035('زياد',5,['زياد','','محمد']),['زياد','مع زياد 1','محمد','مع زياد 3','مع زياد 4']);
});
test('v035 SQL keeps batch and group changes atomic and owner-only',()=>{
 const sql=read('database/Maria-CFO-Web-v0.35-Event-Workflow.sql');
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.event_bulk_tables_v035/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.event_group_booking_v035/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/UNIQUE\(table_id,seat_number\)/);
 assert.match(sql,/GRANT EXECUTE/);
});
test('v1.0.13 UI reserves seats without exposing legacy physical table assignments',()=>{
 const ui=read('js/pages/events-v034.js');
 assert.match(ui,/eventCreateSeatsV113/);
 assert.match(ui,/eventBookSeatsV113/);
 assert.match(ui,/bookingsHtml\(\)/);
 assert.match(ui,/eventSeatGuestsV113/);
 assert.doesNotMatch(ui,/eventBulkTablesV035|data-picker="start"|data-picker="additional"/);
});
