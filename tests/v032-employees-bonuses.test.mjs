import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildEmployeeProfileV032} from '../js/employee-profile-v032.js';
import {BONUS_REASONS_V032, BONUS_STATUS_V032, validateBonusV032, bonusTotalsV032} from '../js/bonus-policy-v032.js';
const base=join(dirname(fileURLToPath(import.meta.url)),'..');
const src=path=>readFileSync(join(base,path),'utf8');
function form(fields){return {get:key=>fields[key]??null};}
const valid={name:' شيف   سعيد ',job:'شيف',department:'المطبخ',residence:'العدوية',phone:'0990555000',status:'active',pay:'monthly',wage:'250000',currency:'SYP',hire_date:'2026-01-01',termination_date:'',notes:''};
const staff={id:'staff-test-id',pay_type:'monthly',status:'active',wage_currency_code:'SYP'};
test('monthly employee editor accepts real fields and normalizes name and dates',()=>{
 const profile=buildEmployeeProfileV032(form(valid));
 assert.equal(profile.name,'شيف سعيد');
 assert.equal(profile.payType,'monthly');
 assert.equal(profile.wage,250000);
 assert.equal(profile.residence,'العدوية');
 assert.equal(profile.phone,'0990555000');
 assert.equal(profile.hireDate,'2026-01-01');
 assert.equal(profile.terminationDate,null);
});
test('profile rejects missing, invalid, impossible or reversed dates and suspicious wage',()=>{
 for(const delta of [{name:''},{wage:'0'},{wage:'Infinity'},{pay:'x'},{currency:'EUR'},{phone:'<script>'},{hire_date:'2026-02-30'},{termination_date:'2025-01-01'},{status:'fired'}]){
  assert.throws(()=>buildEmployeeProfileV032(form({...valid,...delta})));
 }
});
test('bonus uses employee currency and valid reason and cannot belong to fixed or inactive employee',()=>{
 const input=validateBonusV032({employee:staff,amount:'8000',effectiveDate:'2026-10-13',reason:BONUS_REASONS_V032[0],note:'خدمة متميزة'});
 assert.equal(input.amount,8000);assert.equal(input.employeeId,staff.id);
 assert.equal(input.note,'خدمة متميزة');
 assert.throws(()=>validateBonusV032({...input,employee:{...staff,pay_type:'fixed'}}),/المقطوع/);
 assert.throws(()=>validateBonusV032({...input,employee:{...staff,status:'inactive'}}),/غير نشط/);
 for(const changes of [{amount:0},{amount:-1},{amount:'nan'},{effectiveDate:'2026-99-13'},{reason:'X'}]){
  assert.throws(()=>validateBonusV032({...input,employee:staff,...changes}));
 }
});
test('pending totals exclude approved and voided bonuses and do not mix currencies',()=>{
 const totals=bonusTotalsV032([{status:'pending',currency_code:'SYP',amount_original:25000},
  {status:'pending',currency_code:'SYP',amount_original:2500},{status:'pending',currency_code:'USD',amount_original:15},
  {status:'applied',currency_code:'SYP',amount_original:123000},{status:'voided',currency_code:'USD',amount_original:900}]);
 assert.equal(totals.get('SYP'),27500);assert.equal(totals.get('USD'),15);
 assert.equal(BONUS_STATUS_V032.applied,'ضمن راتب معتمد');
});
test('quick import uses only the custom modal, for confirmation AND undo; no browser confirm',()=>{
 const ui=src('js/quick-imports-v030.js');
 assert.doesNotMatch(ui,/window\.confirm\s*\(|window\.alert\s*\(/);
 assert.match(ui,/confirmQuickImport/);
 assert.match(ui,/await confirmBox\(/);
 assert.match(ui,/onClose:\(\)=>resolve\(accepted\)/);
 assert.match(ui,/quick_import_employees_v031/);
 assert.match(ui,/quick_import_v030/);
});
test('employee rows open accessible dialogs and show payroll, leaves, and advances',()=>{
 const page=src('js/pages/employees.js');
 assert.match(page,/role="button" aria-label="فتح تفاصيل/);
 assert.match(page,/\.employee-clickable/);
 assert.match(page,/buildEmployeeProfileV032/);
 assert.match(page,/updateEmployeeV032\(/);
 assert.match(page,/loadEmployeeInsights/);
 assert.match(page,/api\.paidLeaveUsed/);
 assert.match(page,/api\.employeeAdvances/);
 assert.match(page,/api\.employeeBonusesV032/);
});
test('bonus management is wired through the existing payroll adjustment engine',()=>{
 const sql=src('database/Maria-CFO-Web-v0.32-Employees-Bonuses.sql');
 const api=src('js/api.js');const app=src('js/app.js');const hub=src('js/pages/hubs.js');
 for(const name of ['update_employee_profile_v032','record_employee_bonus_v032','void_pending_employee_bonus_v032']){
  assert.match(sql,new RegExp('FUNCTION public\\.'+name+'\\('));assert.match(api,new RegExp("'"+name+"'"));
 }
 assert.match(sql,/public\.add_employee_payroll_adjustment\(e\.id,'bonus'/);
 assert.match(sql,/BONUS_ALREADY_RECORDED_V032/);
 assert.match(sql,/BONUS_PERIOD_ALREADY_APPROVED_V032/);
 assert.match(sql,/BONUS_FIXED_PAY_UNSUPPORTED_V032/);
 assert.match(sql,/IF NOT public\.is_app_owner\(\)/);
 assert.match(sql,/status='voided'/);
 assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
 assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.(?:cashbox_transactions|payroll_payments|expenses)/i);
 assert.match(app,/case 'bonuses': return renderBonusesV032\(root\)/);
 assert.match(hub,/#\/bonuses/);
 assert.match(app,/Web v0\.(?:33|34|35|36|37|38)/);
});
