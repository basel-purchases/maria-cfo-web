import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {scheduleMonthV127,hourBasedAdjustmentV127} from '../js/employee-hours-v127.js';
import {buildEmployeeProfileV032} from '../js/employee-profile-v032.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');
const sql=read('database/Maria-CFO-Web-v1.0.27-Hourly-Employee-Adjustments.sql');
const employees=read('js/pages/employees.js');
const payroll=read('js/pages/payroll-v034.js');
const api=read('js/api.js');
test('November 2026 has 26 payable workdays excluding four Fridays',()=>{
 const rate=scheduleMonthV127({year:2026,month:11,dailyHours:8});
 assert.deepEqual(rate,{workdays:26,monthlyHours:208});
 assert.deepEqual(hourBasedAdjustmentV127({salary:208000,workHours:rate.monthlyHours,hours:3}),{hourlyRate:1000,amount:3000});
 assert.equal(hourBasedAdjustmentV127({salary:208000,workHours:rate.monthlyHours,hours:2.5}).amount,2500);
});
test('months with five Fridays use a different divisor, no fixed 208-hour assumption',()=>{
 assert.deepEqual(scheduleMonthV127({year:2027,month:1,dailyHours:8}),{workdays:26,monthlyHours:208});
 assert.deepEqual(scheduleMonthV127({year:2027,month:10,dailyHours:8}),{workdays:26,monthlyHours:208});
 assert.deepEqual(scheduleMonthV127({year:2026,month:12,dailyHours:8}),{workdays:27,monthlyHours:216});
});
test('personal schedules and variable shifts are accounted for, Friday always excluded',()=>{
 const schedule={0:5,1:8,2:8,3:8,4:8,5:12,6:0};
 const x=scheduleMonthV127({year:2026,month:11,dailyHours:8,weeklySchedule:schedule});
 assert.equal(x.workdays,22); // Sundays through Thursdays, excludes Fridays and Saturdays
 assert.equal(x.monthlyHours,22*8-5*3); // five Sundays are 5 hours, not 8
});
test('invalid hours, zero divisor, and invalid weekdays are rejected',()=>{
 for(const hours of [0,-1,745,1.234,Number.NaN])assert.throws(()=>hourBasedAdjustmentV127({salary:200000,workHours:200,hours}));
 for(const value of [0,-1,Infinity])assert.throws(()=>hourBasedAdjustmentV127({salary:200000,workHours:value,hours:1}));
 assert.throws(()=>scheduleMonthV127({year:2026,month:13,dailyHours:8}));
 assert.throws(()=>scheduleMonthV127({year:2026,month:11,dailyHours:8,weeklySchedule:{0:25}}));
});
test('employee form supports per-employee daily hours and validates the range',()=>{
 const profile=new Map(Object.entries({name:'عامل',pay:'monthly',wage:'200000',currency:'SYP',
 status:'active',daily_hours:'7.5'}));
 assert.equal(buildEmployeeProfileV032(profile).requiredDailyHours,7.5);
 profile.set('daily_hours','0');assert.throws(()=>buildEmployeeProfileV032(profile),/ساعات الدوام/);
 profile.set('daily_hours','7.123');assert.throws(()=>buildEmployeeProfileV032(profile),/ساعات الدوام/);
 assert.match(employees,/name="daily_hours"/);
 assert.match(api,/required_daily_hours:input\.requiredDailyHours/);
 assert.match(api,/rpc\('save_employee_profile_hours_v127'/);
});
test('SQL uses actual weekday schedule and stores the rate in the payroll adjustment ledger',()=>{
 for(const fn of ['employee_hour_rate_v127','record_employee_adjustment_v127','save_employee_profile_hours_v127'])
  assert.match(sql,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
 assert.match(sql,/EXTRACT\(ISODOW FROM g\.d::date\)=5/);
 assert.match(sql,/public\.get_employee_expected_hours\(p_employee_id,g\.d::date\)/);
 assert.match(sql,/salary_basis\/v_total/);
 assert.match(sql,/v_rate\.hourly_rate\*p_value/);
 assert.match(sql,/round\(v_rate\.hourly_rate,8\)/);
 assert.match(sql,/UPDATE public\.employee_payroll_adjustments/);
 assert.match(sql,/public\.record_employee_adjustment_v123\(/);
 assert.match(sql,/v_amount:=round\(v_rate\.hourly_rate\*p_value,4\)/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/PERFORM 1 FROM public\.employees WHERE id=p_employee_id FOR UPDATE/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.doesNotMatch(sql,/(INSERT INTO public\.(cashbox_transactions|payroll_payments)|DELETE FROM public\.payroll_items)/i);
 assert.equal((sql.match(/^BEGIN;/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;/gm)||[]).length,1);
});
test('employee profile and payroll pages share the same money/hours entry dialog',()=>{
 assert.match(employees,/export function openEmployeeAdjustmentModalV127/);
 assert.match(employees,/option value="hours"/);
 assert.match(employees,/option value="money"/);
 assert.match(employees,/api\.employeeHourRateV127\(/);
 assert.match(employees,/api\.recordEmployeeAdjustmentV127\(/);
 assert.match(employees,/calc_mode_v127==='hours'/);
 assert.match(payroll,/openEmployeeAdjustmentModalV127/);
 assert.match(payroll,/data-salary-adjust="addition"/);
 assert.match(payroll,/data-salary-adjust="deduction"/);
});
