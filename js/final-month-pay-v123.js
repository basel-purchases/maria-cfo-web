// Pure presentation/validation helper. The definitive payroll calculation is
// executed by protected PostgreSQL functions, not by the browser.
const validISO = day => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day||''))) return false;
  const dt = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(dt.valueOf()) && dt.toISOString().slice(0, 10) === day;
};
export function finalMonthTermsV123({payType='monthly', wage, hireDate=null, terminationDate=null, paidDays=null}={}) {
  if (paidDays === '' || paidDays === undefined) paidDays = null;
  if (!terminationDate) {
    if (paidDays !== null) throw new Error('حدد تاريخ انتهاء العمل قبل إدخال الأيام المستحقة.');
    return null;
  }
  if (!validISO(terminationDate) || (hireDate && !validISO(hireDate)) || (hireDate && hireDate > terminationDate))
    throw new Error('راجع تاريخ بدء العمل وانتهائه.');
  if (payType !== 'monthly') {
    if (paidDays !== null) throw new Error('عدد أيام الأجر الأخير مخصص للراتب الشهري؛ اليومي والساعي لهما احتساب مستقل.');
    return null;
  }
  const start = `${terminationDate.slice(0,7)}-01`;
  const firstDay = (hireDate && hireDate > start) ? hireDate : start;
  const maxDays = Math.round((Date.parse(`${terminationDate}T12:00:00Z`) - Date.parse(`${firstDay}T12:00:00Z`)) / 86400000) + 1;
  const daysInMonth = new Date(Date.UTC(Number(start.slice(0,4)), Number(start.slice(5,7)), 0)).getUTCDate();
  if (paidDays !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(String(paidDays)) || Number(paidDays) > maxDays)
      throw new Error(`أيام الأجر المستحقة يجب أن تكون من 0 إلى ${maxDays} يومًا ضمن فترة خدمة الموظف.`);
  }
  const monthly = Number(wage);
  const amount = paidDays === null || !Number.isFinite(monthly) || monthly<=0 ? null :
    Math.round(((monthly * Number(paidDays) / daysInMonth)+Number.EPSILON)*10000)/10000;
  return {month:start.slice(0,7), daysInMonth, maxDays, paidDays:paidDays===null?null:Number(paidDays), basePay:amount};
}
