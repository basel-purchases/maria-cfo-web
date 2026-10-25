import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizedPayrollRowV034,currencyGroupsV034} from '../js/payroll-workbench-v034.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.17-Monthly-Payroll-Default-Attendance.sql');
const ui=read('js/pages/payroll-v034.js');
const api=read('js/api.js');

test('monthly approval and payment ignore unlogged attendance but not the unapproved draft',()=>{
 const monthly=normalizedPayrollRowV034({pay_type:'monthly',run_status:'approved',missing_attendance_days:29,net_due_original:25000,remaining_original:25000});
 assert.equal(monthly.payable,true);
 const draft=normalizedPayrollRowV034({pay_type:'monthly',run_status:'draft',missing_attendance_days:29,remaining_original:25000});
 assert.equal(draft.payable,false);
 const day=normalizedPayrollRowV034({pay_type:'daily',run_status:'approved',missing_attendance_days:1,remaining_original:100});
 assert.equal(day.payable,false);
 assert.equal(normalizedPayrollRowV034({...monthly,run_status:'approved',remaining_original:0}).payable,false);
});

test('monthly salary RPCs are protected new wrappers and old daily payment path is untouched',()=>{
 assert.match(api,/rpc\('create_monthly_payroll_v117'/);
 assert.match(api,/rpc\('recalculate_monthly_payroll_v117'/);
 assert.match(api,/rpc\('approve_monthly_payroll_v117'/);
 assert.match(api,/rpc\('pay_daily_wage_v034'/);
 assert.match(api,/rpc\('pay_approved_salary_v034'/);
 for(const f of ['create_monthly_payroll_v117','recalculate_monthly_payroll_v117','approve_monthly_payroll_v117','monthly_attendance_default_v117']) {
  assert.match(sql,new RegExp('CREATE OR REPLACE FUNCTION public\\.'+f));
 }
 assert.match(sql,/PERFORM public\.approve_payroll_run\(p_payroll_run_id\)/);
 assert.match(sql,/public\.is_app_owner\(\)/);
 assert.doesNotMatch(sql,/DELETE FROM public\.(?:payroll_payments|payroll_runs|employee_attendance)/i);
 assert.doesNotMatch(sql,/INSERT INTO public\.(?:cashbox_transactions|payroll_payments|employee_attendance)/i);
});

test('only monthly draft missing-attendance marker may be updated by migration',()=>{
 assert.match(sql,/SET missing_attendance_days=0/);
 assert.match(sql,/pi\.pay_type_snapshot='monthly'/);
 assert.match(sql,/pr\.status='draft'/);
 assert.match(sql,/pr\.note LIKE 'MARIA_MONTHLY_V014:%'/);
 assert.doesNotMatch(sql,/SET (?:net_due_original|monthly_salary_original|advance_deduction_original)\s*=/i);
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
});

test('approval button remains enabled without punches; daily section and redundant hint are removed',()=>{
 assert.match(ui,/data-run-approve="\$\{esc\(r\.id\)\}">اعتماد المسير/);
 assert.doesNotMatch(ui,/title="توجد أيام دوام ناقصة"/);
 assert.doesNotMatch(ui,/الأجور اليومية والساعية/);
 assert.doesNotMatch(ui,/الصندوق العام هو الافتراضي\. الاختيار هنا يخص العملية فقط\./);
 assert.match(ui,/مجموع المكافآت/);
 assert.match(ui,/مجموع السلف المخصومة/);
 assert.match(ui,/amountGroup\(monthlyMonth,'bonuses'\)/);
 assert.match(ui,/amountGroup\(monthlyMonth,'advances'\)/);
 const group=currencyGroupsV034([{currency_code:'SYP',bonuses:5000},{currency_code:'USD',bonuses:5},{currency_code:'SYP',bonuses:1000}],'bonuses');
 assert.deepEqual(group,[{currency_code:'SYP',amount:6000},{currency_code:'USD',amount:5}]);
});
