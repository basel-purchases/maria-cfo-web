import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {finalMonthTermsV123} from '../js/final-month-pay-v123.js';
import {buildEmployeeProfileV032} from '../js/employee-profile-v032.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.23-Cash-Purchases-Employee-Profile.sql');
const ui=read('js/pages/employees.js');
const payroll=read('js/pages/payroll-v034.js');
const api=read('js/api.js');
const build=(data={})=>{
 const fd=new Map(Object.entries({name:'عامل',pay:'monthly',wage:'30000',currency:'SYP',status:'active',
 hire_date:'2026-01-01',termination_date:'2026-11-12',termination_paid_days:'10',...data}));
 return buildEmployeeProfileV032(fd);
};
test('30-day November final month uses explicit paid days, not assumed attendance',()=>{
 assert.deepEqual(finalMonthTermsV123({wage:30000,terminationDate:'2026-11-12',paidDays:'10'}),{
  month:'2026-11',daysInMonth:30,maxDays:12,paidDays:10,basePay:10000});
});
test('February leap-year, 31-day month, and zero payable days are precise',()=>{
 const leap=finalMonthTermsV123({wage:29000,terminationDate:'2024-02-20',paidDays:14});
 assert.equal(leap.daysInMonth,29);assert.equal(leap.basePay,14000);
 const dec=finalMonthTermsV123({wage:31000,terminationDate:'2026-12-31',paidDays:15});
 assert.equal(dec.daysInMonth,31);assert.equal(dec.basePay,15000);
 assert.equal(finalMonthTermsV123({wage:30000,terminationDate:'2026-11-01',paidDays:0}).basePay,0);
});
test('days cannot exceed employment interval; daily/hourly do not use monthly override',()=>{
 assert.equal(finalMonthTermsV123({terminationDate:'2026-11-25',hireDate:'2026-11-18',paidDays:8}).maxDays,8);
 assert.throws(()=>finalMonthTermsV123({terminationDate:'2026-11-25',hireDate:'2026-11-18',paidDays:9}),/0 إلى 8/);
 assert.throws(()=>finalMonthTermsV123({terminationDate:'2026-11-04',paidDays:6}),/0 إلى 4/);
 assert.throws(()=>finalMonthTermsV123({terminationDate:'2026-02-30',paidDays:1}),/تاريخ/);
 assert.equal(finalMonthTermsV123({payType:'daily',terminationDate:'2026-11-12'}),null);
 assert.throws(()=>finalMonthTermsV123({payType:'daily',terminationDate:'2026-11-12',paidDays:2}),/للراتب الشهري/);
});
test('profile validates paid days and persists explicit terms without fabricating zero',()=>{
 assert.equal(build().terminationPayableDays,10);
 assert.equal(build({termination_paid_days:''}).terminationPayableDays,null);
 assert.throws(()=>build({termination_paid_days:'12.5'}),/0 إلى/);
 assert.throws(()=>build({termination_paid_days:'20'}),/0 إلى/);
 assert.throws(()=>build({termination_date:''}),/تاريخ انتهاء/);
 assert.match(ui,/name="termination_paid_days"/);
 assert.match(ui,/api\.updateEmployeeFinalV123\(/);
 assert.match(api,/termination_paid_days_v123:input\.terminationPayableDays/);
 assert.match(api,/rpc\('save_employee_final_profile_v123'/);
});
test('final month SQL is atomic, draft-only, and protects historical payouts',()=>{
 for(const fn of ['guard_final_month_change_v123','save_employee_final_profile_v123','apply_final_month_salary_v123',
 'create_monthly_payroll_v117','recalculate_monthly_payroll_v117','approve_monthly_payroll_v117']){
   assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
 }
 assert.match(sql,/V123_FINAL_MONTH_ALREADY_APPROVED/);
 assert.match(sql,/pr\.status IN \('approved','closed'\)/);
 assert.match(sql,/v_run\.status<>'draft'/);
 assert.match(sql,/v_row\.monthly_salary_snapshot\*v_row\.final_days\/v_days/);
 assert.match(sql,/PERFORM public\.apply_final_month_salary_v123\(p_payroll_run_id,false\)/);
 assert.match(sql,/DELETE FROM public\.payroll_advance_deductions WHERE payroll_item_id=v_row\.id/);
 assert.match(sql,/v_available-v_total_adv/);
 assert.doesNotMatch(sql,/DELETE FROM public\.(?:payroll_payments|cashbox_transactions|employee_advances)/);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
});
test('final month preview and payroll review show same verified period without auto payment',()=>{
 assert.match(ui,/finalMonthTermsV123/);
 assert.match(ui,/أيام الأجر المستحقة في شهر انتهاء العمل/);
 assert.match(ui,/الأجر الأساسي الأخير قبل الحسميات والسلف والمكافآت/);
 assert.match(payroll,/عدد الأيام المحدد في ملف الموظف/);
 assert.match(sql,/PERFORM public\.approve_payroll_run\(p_payroll_run_id\)/);
 assert.doesNotMatch(sql,/INSERT INTO public\.cashbox_transactions/);
});
