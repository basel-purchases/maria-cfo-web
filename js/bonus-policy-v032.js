// Bonuses are payroll adjustments, not standalone cash payouts.
export const BONUS_REASONS_V032 = Object.freeze([
  'أداء متميز', 'انضباط والتزام', 'تغطية وردية إضافية', 'تحقيق هدف المبيعات',
  'خدمة عملاء متميزة', 'مناسبة أو مكافأة استثنائية',
]);
export const BONUS_STATUS_V032 = Object.freeze({
  pending: 'بانتظار المسير', applied: 'ضمن راتب معتمد', voided: 'ملغاة',
});
export function validateBonusV032({employee, amount, effectiveDate, reason, note = ''}) {
  if (!employee?.id) throw Error('اختر الموظف أولًا.');
  if (employee.status !== 'active') throw Error('لا يمكن منح مكافأة لموظف غير نشط.');
  if (employee.pay_type === 'fixed')
    throw Error('صرف المقطوع لا يدعم المكافآت ضمن مسير الرواتب حاليًا؛ لا يمكن تسجيل مكافأة غير محتسبة.');
  if (!['monthly', 'daily', 'hourly'].includes(employee.pay_type)) throw Error('نوع أجر الموظف غير مدعوم.');
  const valueText = String(amount ?? '').trim();
  const value = Number(valueText);
  if (!valueText || !Number.isFinite(value) || value <= 0 || value > 1000000000000)
    throw Error('أدخل مبلغ مكافأة موجبًا.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T12:00:00Z`)))
    throw Error('اختر تاريخ استحقاق صحيحًا.');
  if (!BONUS_REASONS_V032.includes(String(reason))) throw Error('اختر سبب المكافأة.');
  if (String(note).length > 500) throw Error('الملاحظة أطول من 500 حرف.');
  return {employeeId: employee.id, amount: value, effectiveDate,
    reason: String(reason), note: String(note).trim()};
}
export function bonusTotalsV032(rows) {
  const totals = new Map();
  for (const row of rows.filter(x => x.status === 'pending')) {
    const currency = String(row.currency_code || 'SYP');
    totals.set(currency, (totals.get(currency) || 0) + Number(row.amount_original || 0));
  }
  return totals;
}
