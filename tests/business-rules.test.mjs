import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MariaValidationError,
  buildEmployeePayload,
  buildAttendanceArgs,
  calculatedShortageHours,
  buildEventArgs,
} from '../js/business-rules.js';

const RATE_KEYS = ['monthly_salary_original', 'daily_rate_original', 'hourly_rate_original'];

for (const [payType, key] of [
  ['monthly', 'monthly_salary_original'],
  ['daily', 'daily_rate_original'],
  ['hourly', 'hourly_rate_original'],
]) {
  test(`employee ${payType} sends only ${key}, never missing rate`, () => {
    const p = buildEmployeePayload({name: '  موظف تجريبي ', jobTitle: 'عامل', payType, wage: '1000', currency: 'SYP'});
    assert.equal(p.name, 'موظف تجريبي');
    assert.equal(p.pay_type, payType);
    assert.equal(p[key], 1000);
    assert.deepEqual(Object.keys(p).filter(k => RATE_KEYS.includes(k)), [key]);
    assert.equal(p.wage_rate_original, undefined);
  });
}

test('employee rejects empty, zero, negative and invalid wage; never retries with blank data', () => {
  for (const wage of ['', '0', '-3', 'NaN']) {
    assert.throws(() => buildEmployeePayload({name:'A',payType:'hourly',wage}), MariaValidationError);
  }
  assert.throws(() => buildEmployeePayload({name: 'X',payType:'invalid',wage:1000}), MariaValidationError);
});

test('normal 8/8 attendance supports zero applied shortage', () => {
  assert.equal(calculatedShortageHours({expected:8,worked:8,status:'full'}), 0);
  const args = buildAttendanceArgs({employeeId:'test-id',date:'2026-10-08',worked:8,expected:8,status:'full',overtime:0,shortage:0});
  assert.equal(args.p_applied_shortage_hours, 0);
  assert.equal(args.p_work_date,'2026-10-08');
});

test('normal 8/8 attendance rejects manual shortage 5, with actionable Arabic message', () => {
  assert.throws(
    () => buildAttendanceArgs({employeeId:'test-id',date:'2026-10-08',worked:8,expected:8,status:'full',shortage:5}),
    err => err instanceof MariaValidationError && err.message.includes('النقص المطبق') && err.message.includes('الرواتب'),
  );
});

test('partial 8/3 attendance allows up to 5 shortage hours and rejects 6', () => {
  assert.equal(calculatedShortageHours({expected:8,worked:3,status:'partial'}),5);
  const args = buildAttendanceArgs({employeeId:'test-id',date:'2026-10-08',worked:3,expected:8,status:'partial',shortage:5});
  assert.equal(args.p_applied_shortage_hours, 5);
  assert.throws(() => buildAttendanceArgs({employeeId:'test-id',date:'2026-10-08',worked:3,expected:8,status:'partial',shortage:6}), MariaValidationError);
});

test('attendance status-based shortage matches database trigger', () => {
  for(const status of ['paid_leave','holiday','day_off']){
    assert.equal(calculatedShortageHours({expected:8,worked:0,status}),0);
  }
  for(const status of ['absent','unpaid_leave']){
    assert.equal(calculatedShortageHours({expected:8,worked:0,status}),8);
  }
});

test('create_event arguments match all 12 live RPC names', () => {
  const p=buildEventArgs({name:'ربارة',date:'2026-10-08',type:'private',revenueMode:'bookings',guests:'200'});
  const names=['p_name','p_event_type','p_event_date','p_capacity','p_planned_guest_count','p_default_pricing_mode','p_default_price','p_currency_code','p_revenue_mode','p_start_at','p_end_at','p_notes'];
  assert.deepEqual(Object.keys(p),names);
  assert.equal(p.p_default_price,null);
  assert.equal(p.p_planned_guest_count,200);
  assert.equal(Object.hasOwn(p,'p_default_price_original'),false);
});

test('event guest count is optional, otherwise a nonnegative integer', () => {
  const p=buildEventArgs({name:'حفلة',date:'2026-10-08',guests:''});
  assert.equal(p.p_planned_guest_count,null);
  assert.throws(() => buildEventArgs({name:'حفلة',date:'2026-10-08',guests:'1.5'}), MariaValidationError);
});
