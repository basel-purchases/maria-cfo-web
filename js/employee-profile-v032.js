// Employee profile validation shared by add/edit dialogs. DB RPC enforces the same rules.
const TYPES = new Set(['monthly', 'daily', 'hourly', 'fixed']);
const CURRENCIES = new Set(['SYP', 'USD']);
const validDay = value => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const str = (fd, key) => String(fd.get(key) ?? '').trim();
export function buildEmployeeProfileV032(fd) {
  const name = str(fd, 'name').replace(/\s+/g, ' ');
  const jobTitle = str(fd, 'job');
  const department = str(fd, 'department');
  const residence = str(fd, 'residence');
  const phone = str(fd, 'phone');
  const notes = str(fd, 'notes');
  const payType = str(fd, 'pay');
  const currency = str(fd, 'currency');
  const status = str(fd, 'status') || 'active';
  const hireDate = str(fd, 'hire_date');
  const terminationDate = str(fd, 'termination_date');
  const wageText = str(fd, 'wage');
  const wage = Number(wageText);
  if (!name || name.length > 250) throw Error('اكتب اسم الموظف (حتى 250 حرفًا).');
  if (jobTitle.length > 250 || department.length > 250 || residence.length > 200 || notes.length > 2000)
    throw Error('إحدى الخانات النصية أطول من الحد المسموح.');
  if (phone.length > 40 || (phone && !/^[+0-9() .-]+$/.test(phone)))
    throw Error('رقم الموبايل يجب أن يتكون من أرقام أو + أو فواصل الهاتف المعتادة.');
  if (!TYPES.has(payType)) throw Error('اختر نوع الأجر الصحيح.');
  if (!CURRENCIES.has(currency)) throw Error('عملة الأجر غير معتمدة.');
  if (!wageText || !Number.isFinite(wage) || wage <= 0 || wage > 1000000000000)
    throw Error('أدخل أجرًا موجبًا وصحيحًا للموظف.');
  if (!['active', 'inactive'].includes(status)) throw Error('حالة الموظف غير صحيحة.');
  if (!validDay(hireDate) || !validDay(terminationDate) || (hireDate && terminationDate && hireDate > terminationDate))
    throw Error('راجع تاريخ التعيين وتاريخ انتهاء العمل.');
  return {name, jobTitle, department, residence, phone, notes, payType, wage, currency,
    status, hireDate: hireDate || null, terminationDate: terminationDate || null};
}
