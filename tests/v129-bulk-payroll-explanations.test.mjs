import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recentFirstMonthsV129,readablePayrollNoteV129,eligibleBulkPayrollV129,
 bulkTotalsV129,payrollDetailTooltipV129,payrollSummaryTooltipV129} from '../js/payroll-batch-v129.js';
import {normalizedPayrollRowV034} from '../js/payroll-workbench-v034.js';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.29-Payroll-Bulk-Payment-Explanations.sql');
const page=read('js/pages/payroll-v034.js');

test('final month audit markers render in understandable Arabic without altering stored data',()=>{
 assert.equal(readablePayrollNoteV129('FINAL_MONTH_AUTO_V123:2026-12-03'),
  'راتب شهر انتهاء الخدمة محسوب تلقائيًا حتى 03/12/2026');
 assert.equal(readablePayrollNoteV129('ملاحظة المحاسب | FINAL_MONTH_V123:2026-12-03:3/31'),
  'ملاحظة المحاسب | راتب شهر انتهاء الخدمة حتى 03/12/2026 · الأيام المستحقة 3 من 31');
 assert.equal(readablePayrollNoteV129('ملاحظة عادية'),'ملاحظة عادية');
 assert.equal(readablePayrollNoteV129(null),'');
 assert.match(page,/esc\(readablePayrollNoteV129\(r\.note\)/);
 assert.doesNotMatch(sql,/UPDATE public\.payroll_items SET note/);
});

test('month selectors show recent month first with all months exactly once',()=>{
 const list=recentFirstMonthsV129(['1','2','3','4','5','6','7','8','9','10','11','12']);
 assert.deepEqual(list.map(x=>x.month),[12,11,10,9,8,7,6,5,4,3,2,1]);
 assert.match(page,/recentFirstMonthsV129\(MONTH_NAMES\)/);
});

test('bulk excludes multiple employees, rejects drafts and preserves per-currency totals',()=>{
 const rows=[
  normalizedPayrollRowV034({payroll_item_id:'a',pay_type:'monthly',run_status:'approved',currency_code:'SYP',net_due_original:18000,paid_original:0,remaining_original:18000}),
  normalizedPayrollRowV034({payroll_item_id:'b',pay_type:'monthly',run_status:'approved',currency_code:'SYP',net_due_original:10000,paid_original:3000,remaining_original:7000}),
  normalizedPayrollRowV034({payroll_item_id:'c',pay_type:'monthly',run_status:'approved',currency_code:'USD',net_due_original:50,paid_original:0,remaining_original:50}),
  normalizedPayrollRowV034({payroll_item_id:'d',pay_type:'monthly',run_status:'draft',currency_code:'SYP',net_due_original:9000,paid_original:0,remaining_original:9000}),
  normalizedPayrollRowV034({payroll_item_id:'e',pay_type:'monthly',run_status:'closed',currency_code:'SYP',net_due_original:9000,paid_original:9000,remaining_original:0}),
 ];
 assert.deepEqual(eligibleBulkPayrollV129(rows).map(x=>x.payroll_item_id),['a','b','c']);
 assert.deepEqual(eligibleBulkPayrollV129(rows,['a','c']).map(x=>x.payroll_item_id),['b']);
 assert.deepEqual(bulkTotalsV129(eligibleBulkPayrollV129(rows)),[
  {currency_code:'SYP',amount:25000},{currency_code:'USD',amount:50},
 ]);
 assert.deepEqual(eligibleBulkPayrollV129(rows,['a','b','c']),[]);
});

test('tooltips show original linked advance and bonus notes with employees, not fabricated sources',()=>{
 const m=new Map();
 m.set('i1',{bonus_details:[{amount:100,date:'2026-11-12',reason:'ADDITION_V123: عمل إضافي',note:'حفلة الجمعة'}],
  advance_details:[{amount:25,date:'2026-11-03',note:'دفعة السلفة الأولى'}]});
 const row={payroll_item_id:'i1',employee_name:'سارة',bonuses:100,advances:25};
 assert.match(payrollDetailTooltipV129(row,m.get('i1'),'advance'),/سارة[\s\S]*سلفة[\s\S]*دفعة السلفة الأولى/);
 assert.match(payrollDetailTooltipV129(row,m.get('i1'),'bonus'),/سارة[\s\S]*عمل إضافي[\s\S]*حفلة الجمعة/);
 assert.match(payrollSummaryTooltipV129([row],m,'advance'),/سارة/);
 assert.match(payrollDetailTooltipV129({employee_name:'سارة',bonuses:5},undefined,'bonus'),/لا توجد ملاحظات تفصيلية/);
 assert.equal(payrollDetailTooltipV129({employee_name:'سارة',bonuses:0},null,'bonus'),'');
 assert.match(page,/title="\$\{esc\(message\)\}"/);
});

test('batch payment is server-side, serialized, checked and all-or-nothing',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.pay_approved_salaries_bulk_v129/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.match(sql,/FOR UPDATE OF pi/);
 assert.match(sql,/V129_DUPLICATE_BATCH_ITEMS/);
 assert.match(sql,/V129_BATCH_PERIOD_MISMATCH/);
 assert.match(sql,/v_item\.remaining<=0\.0001/);
 assert.match(sql,/public\.pay_approved_salary_v034\(v_item\.id,v_item\.remaining,p_cashbox_id/);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
 assert.doesNotMatch(sql,/INSERT INTO public\.(payroll_payments|cashbox_transactions)/);
 assert.match(page,/api\.payApprovedSalariesBulkV129\(monthStartV034/);
 assert.match(page,/fd\.getAll\('exclude'\)/);
 assert.match(page,/if\(!selected\.length\)/);
 assert.match(read('js/api.js'),/rpc\('pay_approved_salaries_bulk_v129'/);
});

test('server explanations are sourced from actual payroll item allocations and posted payments',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.payroll_item_explanations_v129/);
 assert.match(sql,/public\.payroll_advance_deductions d/);
 assert.match(sql,/public\.employee_advances adv/);
 assert.match(sql,/public\.employee_payroll_adjustments a/);
 assert.match(sql,/a\.status<>'voided'/);
 assert.match(sql,/pp\.status='posted'/);
 assert.match(sql,/jsonb_agg/);
 assert.match(page,/state\.detailsByPayment\.set/);
});
