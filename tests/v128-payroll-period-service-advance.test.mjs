import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 periodFromPayrollDateV128,dateInEmployeeServiceV128,employeeServiceDateInputV128,
 advanceRemainingAfterPayrollV128,outstandingAdvancesByEmployeeV128
} from '../js/employee-service-v128.js';
const read = p=>readFileSync(new URL('../'+p, import.meta.url),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.28-Payroll-Period-Service-Advances.sql');
const pay=read('js/pages/payroll-v034.js'),adv=read('js/pages/advances.js'),emp=read('js/pages/employees.js');
test('manager selects the EARNINGS month explicitly even when creation is later',()=>{
 assert.deepEqual(periodFromPayrollDateV128('2026-11-17'),{year:2026,month:11,start:'2026-11-01'});
 assert.deepEqual(periodFromPayrollDateV128('2026-12-02'),{year:2026,month:12,start:'2026-12-01'});
 assert.throws(()=>periodFromPayrollDateV128('2026-02-30'),/تاريخ/);
 assert.throws(()=>periodFromPayrollDateV128('2026-13-02'),/تاريخ/);
 assert.throws(()=>periodFromPayrollDateV128(''),/تاريخ/);
 assert.throws(()=>periodFromPayrollDateV128('1990-11-05'),/2000/);
 assert.match(pay,/name="period_date" type="date" required/);
 assert.match(pay,/api\.createMonthlyPayrollV128\(chosen\)/);
 assert.doesNotMatch(pay,/api\.createMonthlyPayroll\(state\.year,state\.month\)/);
 assert.match(sql,/create_monthly_payroll_v117\(extract\(year from p_period_date\)/);
});
test('service date checks include hire and final day but exclude anything outside',()=>{
 const e={hire_date:'2026-11-12',termination_date:'2026-11-23'};
 for(const date of ['2026-11-12','2026-11-13','2026-11-23'])assert.equal(dateInEmployeeServiceV128(e,date),true,date);
 for(const date of ['2026-11-11','2026-11-24','2026-00-01',''])assert.equal(dateInEmployeeServiceV128(e,date),false,date);
 assert.match(employeeServiceDateInputV128(e),/min="2026-11-12" max="2026-11-23"/);
 assert.equal(dateInEmployeeServiceV128({hire_date:null,termination_date:null},'2026-11-23'),true);
 assert.match(adv,/dateInEmployeeServiceV128\(person/);
 assert.match(emp,/dateInEmployeeServiceV128\(employee/);
});
test('advance larger than salary remains outstanding; planned advance not applied twice',()=>{
 assert.equal(advanceRemainingAfterPayrollV128(3500000,2000000,'draft'),1500000);
 assert.equal(advanceRemainingAfterPayrollV128(1500000,2000000,'approved'),1500000);
 assert.equal(advanceRemainingAfterPayrollV128(3500000,5000000,'draft'),0);
 assert.equal(advanceRemainingAfterPayrollV128(3500000,0,'draft'),3500000);
 const outstanding=outstandingAdvancesByEmployeeV128([
  {employee_id:'A',currency_code:'SYP',remaining_original:1000000},
  {employee_id:'A',currency_code:'SYP',remaining_original:2500000},
  {employee_id:'A',currency_code:'USD',remaining_original:100},
  {employee_id:'B',currency_code:'SYP',remaining_original:0}
 ]);
 assert.equal(outstanding.get('A').get('SYP'),3500000);
 assert.equal(outstanding.get('A').get('USD'),100);
 assert.equal(outstanding.has('B'),false);
 assert.match(pay,/السلف المتبقية/);
 assert.match(emp,/رصيد السلف المتبقي على الموظف/);
 assert.match(sql,/a\.status='open' AND a\.remaining_original>0/);
});
test('SQL snapshots service boundaries and denies stale approved payroll drafts',()=>{
 for(const routine of ['create_monthly_payroll_v128','recalculate_monthly_payroll_v128','approve_monthly_payroll_v128','capture_monthly_service_v128','validate_monthly_service_v128','guard_monthly_service_approval_v128','guard_approved_service_dates_v128','guard_employee_advance_service_v128','guard_employee_leave_service_v128','record_employee_advance_v128','employee_advance_outstanding_v128','guard_fixed_pay_service_v128'])
  assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${routine}\\(`));
 assert.match(sql,/service_start_v128=GREATEST\(v_run.period_start/);
 assert.match(sql,/service_end_v128=LEAST\(v_run.period_end/);
 assert.match(sql,/V128_SERVICE_DATES_CHANGED_RECALCULATE/);
 assert.match(sql,/V128_EMPLOYEE_MISSING_RECALCULATE/);
 assert.match(sql,/BEFORE UPDATE OF status ON public.payroll_runs/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF employee_id,occurred_at ON public.employee_advances/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF employee_id,work_date,status ON public.employee_attendance/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF employee_id,work_date ON public.employee_fixed_payments_v023/);
 assert.match(sql,/RETURN public.record_employee_advance\(p_employee_id,p_cashbox_id,p_amount/);
 assert.doesNotMatch(sql,/DELETE FROM public\.(payroll_items|employee_advances|payroll_payments|cashbox_transactions)/i);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
});
test('all updated entrypoints are revisioned, and SQL migration remains separate',()=>{
 const app=read('js/app.js'),html=read('index.html'),api=read('js/api.js');
 for(const f of ['payroll-v034','employees','advances'])assert.match(app,new RegExp(`${f}\\.js\\?v=1\\.0\\.29`));
 assert.match(html,/js\/app\.js\?v=1\.0\.34/);
 for(const f of ['create_monthly_payroll_v128','record_employee_advance_v128','employee_advance_outstanding_v128'])assert.match(api,new RegExp(`rpc\\('${f}'`));
 assert.equal(read('VERSION').trim(),'1.0.34');
});
