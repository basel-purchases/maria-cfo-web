/**
 * Maria CFO Web: small client-side validation helpers.
 * The PostgreSQL constraints/RPCs remain the source of truth.
 */

export class MariaValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MariaValidationError';
  }
}

export const EMPLOYEE_RATE_COLUMNS = Object.freeze({
  monthly: 'monthly_salary_original',
  daily: 'daily_rate_original',
  hourly: 'hourly_rate_original',
});

const ATTENDANCE_STATUSES = new Set([
  'full', 'partial', 'absent', 'paid_leave', 'unpaid_leave', 'holiday', 'day_off',
]);

function positiveAmount(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new MariaValidationError(`يرجى إدخال ${label}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new MariaValidationError(`يجب أن يكون ${label} أكبر من صفر.`);
  }
  return number;
}

function hours(value, label) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new MariaValidationError(`يرجى إدخال ${label}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 9999.99) {
    throw new MariaValidationError(`${label} يجب أن تكون قيمة غير سالبة وصحيحة.`);
  }
  // The corresponding PostgreSQL employee_attendance columns are numeric(6,2).
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function buildEmployeePayload({name, jobTitle = null, payType, wage, currency = 'SYP'}) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new MariaValidationError('يرجى إدخال اسم الموظف.');
  const rateColumn = EMPLOYEE_RATE_COLUMNS[payType];
  if (!rateColumn) throw new MariaValidationError('نوع الأجر غير صحيح.');
  const amount = positiveAmount(wage, 'الأجر');
  const cleanCurrency = String(currency ?? '').trim().toUpperCase();
  if (!['SYP', 'USD'].includes(cleanCurrency)) throw new MariaValidationError('عملة الأجر غير مدعومة.');
  return {
    name: cleanName,
    job_title: String(jobTitle ?? '').trim() || null,
    pay_type: payType,
    wage_currency_code: cleanCurrency,
    [rateColumn]: amount,
  };
}

export function calculatedShortageHours({expected, worked, status = 'full'}) {
  const planned = hours(expected, 'الساعات المطلوبة');
  const actual = hours(worked, 'الساعات الفعلية');
  if (!ATTENDANCE_STATUSES.has(status)) throw new MariaValidationError('حالة الدوام غير صحيحة.');
  if (['paid_leave', 'holiday', 'day_off'].includes(status)) return 0;
  if (['absent', 'unpaid_leave'].includes(status)) return planned;
  return Math.round(Math.max(planned - actual, 0) * 100) / 100;
}

export function buildAttendanceArgs({employeeId, date, worked, status = 'full', expected, overtime = null, shortage = null, note = null}) {
  if (!employeeId) throw new MariaValidationError('الموظف غير محدد.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) throw new MariaValidationError('تاريخ الدوام غير صحيح.');
  const planned = hours(expected, 'الساعات المطلوبة');
  const actual = hours(worked, 'الساعات الفعلية');
  const calculated = calculatedShortageHours({expected: planned, worked: actual, status});
  const approvedOvertime = overtime == null || overtime === '' ? null : hours(overtime, 'الإضافي المعتمد');
  const appliedShortage = shortage == null || shortage === '' ? null : hours(shortage, 'النقص المطبق');
  if (appliedShortage !== null && appliedShortage > calculated + 0.000001) {
    throw new MariaValidationError(`النقص المطبق (${appliedShortage}) أكبر من النقص المحسوب (${calculated}) ساعة. لتسجيل حسم إداري إضافي استخدم خصومات الرواتب.`);
  }
  return {
    p_employee_id: employeeId,
    p_work_date: date,
    p_worked_hours: actual,
    p_status: status,
    p_expected_hours: planned,
    p_approved_overtime_hours: approvedOvertime,
    p_applied_shortage_hours: appliedShortage,
    p_note: String(note ?? '').trim() || null,
  };
}

export function buildEventArgs({name, date, type = 'private', revenueMode = 'bookings', guests = null, currency = 'SYP'}) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) throw new MariaValidationError('يرجى إدخال اسم الحفلة.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) throw new MariaValidationError('يرجى إدخال تاريخ الحفلة.');
  if (!['public', 'private'].includes(type)) throw new MariaValidationError('نوع الحفلة غير صحيح.');
  if (!['bookings', 'orders', 'both'].includes(revenueMode)) throw new MariaValidationError('نمط الإيراد غير صحيح.');
  const cleanCurrency = String(currency ?? '').trim().toUpperCase();
  if (!['SYP', 'USD'].includes(cleanCurrency)) throw new MariaValidationError('عملة الحفلة غير مدعومة.');
  const guestCount = guests === null || guests === undefined || String(guests).trim() === ''
    ? null
    : Number(guests);
  if (guestCount !== null && (!Number.isSafeInteger(guestCount) || guestCount < 0)) {
    throw new MariaValidationError('عدد الضيوف يجب أن يكون عددًا صحيحًا غير سالب.');
  }
  // All arguments match the LIVE create_event RPC signature, including optional defaults.
  // p_default_price_original is a column name, NOT a valid RPC parameter.
  return {
    p_name: cleanName,
    p_event_type: type,
    p_event_date: date,
    p_capacity: null,
    p_planned_guest_count: guestCount,
    p_default_pricing_mode: 'per_person',
    p_default_price: null,
    p_currency_code: cleanCurrency,
    p_revenue_mode: revenueMode,
    p_start_at: null,
    p_end_at: null,
    p_notes: null,
  };
}
