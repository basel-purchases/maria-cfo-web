import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBonusV032, BONUS_REASONS_V032, optionalPayrollReasonV129,
 UNSPECIFIED_PAYROLL_REASON_V129} from '../js/bonus-policy-v032.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const employee={id:'11111111-1111-4111-8111-111111111111',status:'active',pay_type:'monthly'};
const common={employee,amount:'30000',effectiveDate:'2026-11-13',note:''};

test('bonus reason is optional, preserves selected reasons and rejects invalid choices',()=>{
 const blank=validateBonusV032({...common,reason:''});
 assert.equal(blank.reason,UNSPECIFIED_PAYROLL_REASON_V129);
 assert.equal(validateBonusV032({...common,reason:'   '}).reason,UNSPECIFIED_PAYROLL_REASON_V129);
 assert.equal(validateBonusV032({...common,reason:BONUS_REASONS_V032[0]}).reason,BONUS_REASONS_V032[0]);
 assert.throws(()=>validateBonusV032({...common,reason:'unexpected reason'}),/غير مدعوم/);
});

test('bonus UI presents optional default and its client-to-server record keeps an explicit unprovided reason',()=>{
 const page=read('js/pages/bonuses.js');
 assert.match(page,/سبب المكافأة \(اختياري\)/);
 assert.match(page,/<option value="">بدون سبب<\/option>/);
 assert.doesNotMatch(page,/<select name="reason" required>/);
 assert.match(page,/validateBonusV032\(/);
});

test('additions and deductions can be submitted without a user-supplied reason',()=>{
 const dialog=read('js/employee-adjustment-modal-v1271.js');
 assert.match(dialog,/السبب \(اختياري\)/);
 assert.doesNotMatch(dialog,/<input name="reason"[^>]*required/);
 assert.match(dialog,/reason:optionalPayrollReasonV129\(fd\.get\('reason'\)\)/);
 assert.equal(optionalPayrollReasonV129(''),UNSPECIFIED_PAYROLL_REASON_V129);
 assert.equal(optionalPayrollReasonV129('  مساعدة  '),'مساعدة');
});

test('reason-free submissions respect non-null payroll ledger without schema changes or hidden financial side effects',()=>{
 const v123=read('database/Maria-CFO-Web-v1.0.23-Cash-Purchases-Employee-Profile.sql');
 const v032=read('database/Maria-CFO-Web-v0.32-Employees-Bonuses.sql');
 assert.match(v123,/nullif\(btrim\(coalesce\(p_reason/);
 assert.match(v032,/nullif\(btrim\(coalesce\(p_reason/);
 assert.ok(UNSPECIFIED_PAYROLL_REASON_V129.length<120);
 assert.ok(UNSPECIFIED_PAYROLL_REASON_V129.length<150);
});
