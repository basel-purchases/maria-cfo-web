import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 normalizeStaffQueryV033,staffSearchScoreV033,employeeDirectoryScoreV033,
 attendanceSummaryV033,filterAttendanceV033
} from '../js/staff-ux-v033.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const source=f=>readFileSync(join(root,f),'utf8');
const attendance=(id,worked,status='full',opts={})=>({id,expected_hours:8,worked_hours:worked,status,...opts});
test('search ignores Arabic vowel marks, hamza variants, and different Arabic digits',()=>{
 assert.equal(normalizeStaffQueryV033('أَحْمَدُ'),normalizeStaffQueryV033('احمد'));
 assert.ok(staffSearchScoreV033('أحمد ٠٩٩١٢٣٤٥٦٧','احمد 0991')>0);
 assert.equal(staffSearchScoreV033('محمد سعيد','مطعم دمشق'),-1);
 assert.equal(staffSearchScoreV033('سَامر محمد موظف', 'سامر موظف')>0,true);
});
test('employee search ranks the exact employee name and does not match unrelated table badges',()=>{
 const e={name:'أحمد سعيد',job_title:'كاشير',residence_v031:'العدوية',mobile_phone_v031:'٠٩٩٠١٢٣٤٥٦'};
 assert.ok(employeeDirectoryScoreV033(e,'احمد')>0);
 assert.ok(employeeDirectoryScoreV033(e,'كاشير 0990')>0);
 assert.ok(employeeDirectoryScoreV033(e,'عدويه')>0);
 assert.equal(employeeDirectoryScoreV033(e,'راتب شهري'),-1);
});
test('real shortage shows warning, effective shortage and difference',()=>{
 const row=attendance('s',7,'partial',{calculated_shortage_hours:1,applied_shortage_hours:1});
 const a=attendanceSummaryV033(row);
 assert.equal(a.actualDiff,-1);assert.equal(a.shortageEffective,1);
 assert.equal(a.flaggedShortage,true);assert.equal(a.needsAttention,true);
});
test('waived shortage is visible as an exception but is not counted as a payroll deduction',()=>{
 const row=attendance('waived',6,'full',{calculated_shortage_hours:2,applied_shortage_hours:0});
 const a=attendanceSummaryV033(row);
 assert.equal(a.shortageComputed,2);assert.equal(a.shortageEffective,0);
 assert.equal(a.shortageWaived,true);assert.equal(a.flaggedShortage,true);
});
test('extra hours retain the difference between actual hours and approved overtime',()=>{
 const row=attendance('extra',9,'full',{calculated_overtime_hours:1,approved_overtime_hours:0});
 const a=attendanceSummaryV033(row);
 assert.equal(a.actualDiff,1);assert.equal(a.overtimeEffective,0);
 assert.equal(a.overtimeUnapproved,true);assert.equal(a.flaggedExtra,true);
});
test('paid leave, holidays and day off are excused; not marked as shortages',()=>{
 for(const status of ['paid_leave','holiday','day_off']){
  const a=attendanceSummaryV033(attendance('excused',0,status,{calculated_shortage_hours:8}));
  assert.equal(a.shortageEffective,0);assert.equal(a.flaggedShortage,false);assert.equal(a.needsAttention,false);
  assert.equal(a.excused,true);
 }
});
test('filters cover all, exceptions, shortage and extra, including absences',()=>{
 const models=[
  attendance('ok',8),attendance('short',7,'partial',{applied_shortage_hours:1}),
  attendance('over',9,'full',{approved_overtime_hours:1}),
  attendance('abs',0,'absent'),attendance('leave',0,'paid_leave')
 ].map(row=>({row,summary:attendanceSummaryV033(row)}));
 assert.equal(filterAttendanceV033(models,'all').length,5);
 assert.equal(filterAttendanceV033(models,'issues').length,3);
 assert.equal(filterAttendanceV033(models,'shortage').length,2);
 assert.equal(filterAttendanceV033(models,'overtime').length,1);
 assert.equal(filterAttendanceV033(models,'invalid').length,5);
});
test('attendance card places paid leave before note, and displayed table exposes applied/approved',()=>{
 const ui=source('js/pages/employees.js');
 assert.ok(ui.indexOf('attendance-leave-field-v033')>0);
 assert.ok(ui.indexOf('attendance-leave-field-v033')<ui.indexOf('name=\\"note\\"')||ui.indexOf('attendance-leave-field-v033')<ui.indexOf('name="note"'));
 assert.match(ui,/الإضافي المعتمد/);assert.match(ui,/النقص المطبق/);
 assert.match(ui,/registerTableExport\(table,exportData\)/);
 assert.match(ui,/const current=filterAttendanceV033\(views,filter.value\)/);
});
test('bonus employee filter is one search input and dialog selection uses shared combobox',()=>{
 const bonuses=source('js/pages/bonuses.js');
 const combo=source('js/searchable-select-v033.js');
 const app=source('js/app.js');
 assert.match(bonuses,/<input type="search" id="bonus-staff-filter"/);
 assert.doesNotMatch(bonuses,/<select id="bonus-staff-filter"/);
 assert.match(bonuses,/employeeDirectoryScoreV033/);
 assert.match(combo,/role','combobox'/);assert.match(combo,/select\.dispatchEvent\(new Event\('change'/);
 assert.match(app,/installSearchableSelectsV033\(\)/);
 assert.doesNotMatch(app,/installSearchableSelectsV029\(\)/);
});
test('backdrop dismissal respects only the topmost dialog and the busy state',()=>{
 const ui=source('js/ui.js');
 assert.match(ui,/back\.addEventListener\('pointerdown'/);
 assert.match(ui,/stack\[stack\.length-1\]===back/);
 assert.match(ui,/if\(closed\|\|busy\)return/);
});
