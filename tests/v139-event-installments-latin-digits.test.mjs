import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installmentCheckV139,bookingInstallmentStatusV139,outstandingTicketAmountV139} from '../js/event-installments-v139.js';
import {latinDigitsV139} from '../js/latin-digits-v139.js';
import {seatReservationDashboardV113} from '../js/event-seats-v113.js';
const read=rel=>fs.readFileSync(new URL('../'+rel,import.meta.url),'utf8');
test('ticket installments accept a deposit, a second payment, and full settlement without changing the original ticket sale',()=>{
 const first=installmentCheckV139(120000,0,30000);
 assert.deepEqual(first,{ok:true,paid:30000,remaining:90000});
 const second=installmentCheckV139(120000,30000,20000);
 assert.deepEqual(second,{ok:true,paid:50000,remaining:70000});
 const final=installmentCheckV139(120000,50000,70000);
 assert.deepEqual(final,{ok:true,paid:120000,remaining:0});
 const stats=seatReservationDashboardV113({planned_guest_count:10},[{id:'b',status:'reserved',guest_count:2,agreed_amount_original:120000}],
 [{booking_id:'b',paid_original:50000,balance_original:70000}]);
 assert.equal(stats.expected,120000); assert.equal(stats.received,50000);assert.equal(stats.due,70000);
});
test('overpayment, negative amount, non-numeric values and excess decimals are rejected',()=>{
 for(const amount of [-1,15001,NaN,Infinity,1000.12345]) assert.equal(installmentCheckV139(15000,0,amount).ok,false,String(amount));
 assert.equal(installmentCheckV139(200,150,50).remaining,0);
 assert.equal(installmentCheckV139(200,150,60).ok,false);
 assert.equal(outstandingTicketAmountV139({balance_original:'20.25'}),20.25);
});
test('display recognizes unpaid, partially paid, overdue and settled bookings',()=>{
 assert.equal(bookingInstallmentStatusV139(100,0,100),'بانتظار الدفعة الأولى');
 assert.equal(bookingInstallmentStatusV139(100,50,50),'تقسيط · دفع جزئي');
 assert.equal(bookingInstallmentStatusV139(100,50,50,'2026-01-01','2026-11-24'),'قسط متأخر');
 assert.equal(bookingInstallmentStatusV139(100,100,0),'مدفوع بالكامل');
 assert.equal(bookingInstallmentStatusV139(0,0,0),'بلا سعر');
});
test('Latin digit conversion preserves words, values and separators',()=>{
 assert.equal(latinDigitsV139('الهاتف ٠٩٣٣٦٥٢ و ۰۹۲۱ مبلغ ١٢٣٤.٥٠'),'الهاتف 0933652 و 0921 مبلغ 1234.50');
 assert.equal(latinDigitsV139('2026-11-24'), '2026-11-24');
 const arabicLocalDate=new Date('2026-11-24T12:00:00Z').toLocaleDateString('ar-SY-u-nu-latn');
 assert.doesNotMatch(arabicLocalDate,/[٠-٩۰-۹]/u);
});
test('new SQL preserves payment ledger integrity and prevents duplicate receipts',()=>{
 const sql=read('database/Maria-CFO-Web-v1.0.39-Event-Ticket-Installments.sql');
 assert.match(sql,/^BEGIN;$/m);assert.match(sql,/^COMMIT;$/m);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.event_book_and_collect_installment_v139/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.event_collect_booking_installment_v139/);
 assert.match(sql,/p_request_key uuid DEFAULT NULL/);
 assert.match(sql,/request_key uuid PRIMARY KEY/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/p_amount>v_due\+0\.00001/);
 assert.match(sql,/PERFORM public\.record_event_booking_payment/);
 assert.match(sql,/PERFORM public\.ensure_cashbox_session_v013/);
 assert.match(sql,/CREATE POLICY v139_owner_read/);
 assert.doesNotMatch(sql,/\b(TRUNCATE|DROP TABLE|DELETE FROM public\.cashbox_transactions|UPDATE public\.cashbox_transactions|UPDATE public\.event_booking_payments)\b/i);
});
test('all UI locale formatting uses Latin digits and no numbers are persisted through a DOM mutation',()=>{
 for(const f of fs.readdirSync(new URL('../js/',import.meta.url),{recursive:true})) {
   if(!String(f).endsWith('.js'))continue;
   const src=read('js/'+f);
   assert.doesNotMatch(src,/(?:toLocaleString|toLocaleDateString|toLocaleTimeString|Intl\.NumberFormat|Intl\.DateTimeFormat)\(['"]ar(?:-SY)?['"]/u, f);
 }
 const src=read('js/latin-digits-v139.js');
 assert.match(src,/MutationObserver/);
 assert.match(src,/document\.activeElement/);
 assert.match(src,/Never alter server payloads/);
 const source=read('js/pages/events-v034.js');
 assert.match(source,/eventBookSeatsV139\(/);
 assert.match(source,/eventCollectBookingInstallmentV139\(/);
 assert.match(source,/eventSetBookingInstallmentPlanV139\(/);
});
