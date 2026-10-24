import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatUsdPriceV113,ceilUsdPriceV113} from '../js/material-usd-display-v113.js';
import {seatReservationDashboardV113,seatPlanV113,seatBookingCheckV113} from '../js/event-seats-v113.js';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const ui=read('js/pages/events-v034.js'),api=read('js/api.js'),sql=read('database/Maria-CFO-Web-v1.0.13-SEAT-ONLY-EVENTS.sql');

test('USD display rounds upward to exactly three places; unset price remains unset',()=>{
 assert.equal(formatUsdPriceV113(.4444),'0.445 $');
 assert.equal(formatUsdPriceV113(.444),'0.444 $');
 assert.equal(formatUsdPriceV113(12.0001),'12.001 $');
 assert.equal(formatUsdPriceV113(.00001),'0.001 $');
 assert.equal(formatUsdPriceV113(0),'—');
 assert.equal(formatUsdPriceV113(null),'—');
 assert.equal(ceilUsdPriceV113(5.5),5.5);
});

test('seat reservation availability counts people, not tables, and excludes cancelled/no-show',()=>{
 const event={planned_guest_count:200};
 const bookings=[{id:'a',guest_count:9,status:'confirmed',agreed_amount_original:900},
  {id:'b',guest_count:4,status:'reserved',agreed_amount_original:400},
  {id:'c',guest_count:18,status:'cancelled',agreed_amount_original:1800},
  {id:'d',guest_count:2,status:'no_show',agreed_amount_original:200}];
 const balances=[{booking_id:'a',paid_original:600,balance_original:300},{booking_id:'b',paid_original:400,balance_original:0}];
 const result=seatReservationDashboardV113(event,bookings,balances);
 assert.equal(result.capacity,200);assert.equal(result.reserved,13);assert.equal(result.available,187);
 assert.equal(result.received,1000);assert.equal(result.due,300);
 assert.equal(result.expected,1300);
 assert.equal(seatBookingCheckV113(188,result.available).ok,false);
 assert.equal(seatBookingCheckV113(187,result.available).ok,true);
 assert.equal(seatBookingCheckV113(1.5,result.available).ok,false);
});

test('seat cost planner uses a single synthetic group instead of real tables',()=>{
 const p=seatPlanV113(200);
 assert.equal(p.target,200);assert.equal(p.unseated,0);
 assert.equal(p.tables.length,1);assert.equal(p.tables[0].planned_guest_count,200);
 assert.equal(seatPlanV113(0).tables.length,0);
});

test('materials omit code and source report columns while keeping full details in a dialog',()=>{
 const src=read('js/pages/materials.js'),css=read('assets/styles.css');
 assert.match(src,/data-material-detail/);assert.match(src,/showMaterialDetailsV113/);
 assert.match(src,/<th>المادة<\/th><th>الوحدة<\/th><th>الرصيد الحالي<\/th>/);
 const header=src.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)?.[1]||'';
 assert.doesNotMatch(header,/الكود|المستودع|الجرد|سعر التقرير/);
 assert.match(src,/\['الكود',materialCode\(material\)\]/);
 assert.match(src,/\['سعر التقرير المستورد'/);
 assert.match(src,/formatUsdPriceV113\(r\.price_usd_v110\)/);
 assert.match(src,/ceilUsdPriceV113\(material.price_usd_v110\)\.toFixed\(3\)/);
 assert.doesNotMatch(src,/name="price_usd_v110"[^\n]*value="\$\{formatUsdPriceV113/);
 assert.match(css,/\.materials-compact-v113\{[^}]*overflow-x:hidden!important/);
 assert.match(css,/\.materials-compact-v113 \.materials-table\{min-width:0!important/);
 assert.match(css,/@media\(max-width:860px\)/);
});

test('event interface has only seat booking and optional seating note, no table picker',()=>{
 assert.match(ui,/eventCreateSeatsV113/);assert.match(ui,/eventSaveSeatsV113/);
 assert.match(ui,/eventBookSeatsV113/);assert.match(ui,/eventCompleteSeatsV113/);
 assert.match(ui,/name="seatNote"/);assert.match(ui,/name="guests"/);
 assert.doesNotMatch(ui,/bookingSeatMapHtml|data-table-book|data-picker="start"|eventBulkTablesV035/);
 assert.match(ui,/seatReservationDashboardV113/);
 assert.match(api,/event_book_and_collect_seats_v113/);
});

test('new SQL keeps historical tables and financial records, uses owner-only atomic seat booking',()=>{
 for(const needle of [/^BEGIN;/m,/^COMMIT;/m,/CREATE TABLE IF NOT EXISTS public\.event_seat_guests_v113/,
  /ALTER TABLE public\.event_seat_guests_v113 ENABLE ROW LEVEL SECURITY/,
  /CREATE OR REPLACE FUNCTION public\.event_book_and_collect_seats_v113/,
  /FOR UPDATE/,/EVENT_SEATS_FULL/,/public\.record_event_booking_payment/,
  /IF NOT public\.is_app_owner\(\)/,/GRANT EXECUTE ON FUNCTION public\.event_create_seats_v113/]) assert.match(sql,needle);
 assert.doesNotMatch(sql,/\b(?:DELETE|TRUNCATE|DROP TABLE)\s+(?:FROM\s+)?public\.event_tables\b/i);
 assert.doesNotMatch(sql,/\b(?:DELETE|TRUNCATE|DROP TABLE)\s+(?:FROM\s+)?public\.event_bookings\b/i);
 assert.match(sql,/p_seat_note text DEFAULT NULL/);
 assert.match(sql,/ceil\(p_usd\*1000\)\/1000/);
});
