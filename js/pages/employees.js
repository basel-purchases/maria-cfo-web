import * as api from '../api.js?v=0.13.2';
import { modal, toast, loader, friendlyError } from '../ui.js?v=0.13.2';
import { esc, money, todayISO, statusBadge } from '../utils.js?v=0.13.2';
import { EMPLOYEE_RATE_COLUMNS, calculatedShortageHours } from '../business-rules.js?v=0.13.2';

const PAY_LABELS = {monthly: 'شهري', daily: 'يومي', hourly: 'بالساعة'};
const WAGE_LABELS = {monthly: 'الراتب الشهري', daily: 'الأجر اليومي', hourly: 'أجر الساعة'};
const ATTENDANCE_LABELS = {
  full: 'دوام كامل', partial: 'دوام جزئي', absent: 'غياب',
  paid_leave: 'إجازة مدفوعة', unpaid_leave: 'إجازة غير مدفوعة',
  holiday: 'عطلة', day_off: 'يوم راحة',
};

export async function renderEmployees(root) {
  root.innerHTML = loader();
  try {
    const rows = await api.employees();
    root.innerHTML = `
      <div class="page-head">
        <div><h2>الموظفون</h2><p>اختياري. تحتاج هذا القسم فقط إذا كنت ستستخدم الدوام والرواتب والسلف.</p></div>
        <button class="btn add" type="button">إضافة موظف</button>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>الاسم</th><th>الوظيفة</th><th>نوع الأجر</th><th>الأجر</th><th>العملة</th></tr></thead>
        <tbody>${rows.map(r => {
          const rate = r[EMPLOYEE_RATE_COLUMNS[r.pay_type]];
          return `<tr>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${esc(r.job_title || '—')}</td>
            <td>${esc(PAY_LABELS[r.pay_type] || r.pay_type)}</td>
            <td>${rate == null ? '—' : money(rate, r.wage_currency_code || 'SYP')}</td>
            <td>${esc(r.wage_currency_code || 'SYP')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="card empty"><strong>لا يوجد موظفون</strong><div>يمكنك تجاهل هذا القسم إذا لم تستخدم الرواتب.</div></div>'}`;
    root.querySelector('.add').onclick = () => openEmployeeModal(root);
  } catch (e) {
    root.innerHTML = `<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}

function openEmployeeModal(root) {
  const m = modal({
    title: 'إضافة موظف',
    body: `<div class="form-grid">
      <div class="field"><label>الاسم</label><input name="name" required></div>
      <div class="field"><label>الوظيفة</label><input name="job"></div>
      <div class="field"><label>نوع الأجر</label><select name="pay">
        <option value="monthly">شهري</option><option value="daily">يومي</option><option value="hourly">بالساعة</option>
      </select></div>
      <div class="field"><label class="wage-label">الراتب الشهري</label>
        <input name="wage" type="number" min="0.01" step="any" required inputmode="decimal">
      </div>
      <div class="field"><label>العملة</label><select name="currency"><option>SYP</option><option>USD</option></select></div>
    </div>`,
    onSubmit: async fd => {
      try {
        await api.createEmployee({
          name: fd.get('name'),
          jobTitle: fd.get('job'),
          payType: fd.get('pay'),
          wage: fd.get('wage'),
          currency: fd.get('currency'),
        });
        toast('تمت إضافة الموظف', 'success');
        await renderEmployees(root);
        return true;
      } catch (e) {
        toast(friendlyError(e), 'error');
        return false;
      }
    },
  });
  const pay = m.form.elements.namedItem('pay');
  const label = m.form.querySelector('.wage-label');
  const updateLabel = () => { label.textContent = WAGE_LABELS[pay.value] || 'الأجر'; };
  pay.addEventListener('change', updateLabel);
  updateLabel();
}

export async function renderAttendance(root) {
  await drawAttendance(root, todayISO());
}

async function drawAttendance(root, day) {
  root.innerHTML = loader();
  try {
    const [rows, employees] = await Promise.all([api.attendance(day), api.employees()]);
    const employeeNames = Object.fromEntries(employees.map(e => [e.id, e.name]));
    root.innerHTML = `
      <div class="page-head">
        <div><h2>الدوام</h2><p>اعتمد الدوام الطبيعي للجميع ثم عدّل الاستثناءات فقط.</p></div>
        <div class="quick-actions">
          <input id="att-date" type="date" value="${esc(day)}" style="padding:10px;border:1px solid var(--line);border-radius:12px">
          <button type="button" class="btn init" ${!employees.length ? 'disabled' : ''}>اعتماد الطبيعي</button>
        </div>
      </div>
      ${!employees.length
        ? '<div class="notice">أضف الموظفين أولًا إذا كنت تريد استخدام الدوام.</div>'
        : rows.length
          ? `<div class="table-wrap"><table class="table">
               <thead><tr><th>الموظف</th><th>المطلوب</th><th>الفعلي</th><th>الحالة</th><th></th></tr></thead>
               <tbody>${rows.map(r => `<tr>
                 <td>${esc(employeeNames[r.employee_id] || 'موظف')}</td>
                 <td>${esc(r.expected_hours)}</td><td>${esc(r.worked_hours)}</td>
                 <td>${esc(ATTENDANCE_LABELS[r.status] || r.status)}</td>
                 <td><button type="button" class="btn secondary edit" data-id="${esc(r.id)}">تعديل</button></td>
               </tr>`).join('')}</tbody>
             </table></div>`
          : '<div class="card empty"><strong>لم يتم إنشاء دوام هذا اليوم</strong><div>اضغط اعتماد الطبيعي، ثم عدّل فقط الحالات المختلفة.</div></div>'}`;

    root.querySelector('#att-date').onchange = e => drawAttendance(root, e.target.value);
    root.querySelector('.init')?.addEventListener('click', async () => {
      try {
        await api.initializeAttendance(day);
        toast('تم اعتماد الدوام الطبيعي', 'success');
        await drawAttendance(root, day);
      } catch (e) {
        toast(friendlyError(e), 'error');
      }
    });
    root.querySelectorAll('.edit').forEach(button => {
      button.onclick = () => {
        const row = rows.find(r => String(r.id) === button.dataset.id);
        if (row) openAttendanceModal(root, day, row, employeeNames[row.employee_id]);
      };
    });
  } catch (e) {
    root.innerHTML = `<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}

function openAttendanceModal(root, day, row, name) {
  const expected = Number(row.expected_hours) || 0;
  const m = modal({
    title: name || 'موظف',
    subtitle: 'سجّل ساعات العمل الحقيقية، ثم اختر مقدار النقص الذي تريد تطبيقه إن وُجد.',
    body: `<div class="form-grid">
      <div class="field"><label>الحالة</label><select name="status">
        ${Object.entries(ATTENDANCE_LABELS).map(([value, label]) =>
          `<option value="${value}">${label}</option>`).join('')}
      </select></div>
      <div class="field"><label>الساعات الفعلية (المطلوب ${esc(expected)})</label>
        <input name="worked" type="number" min="0" step="any" required value="${esc(row.worked_hours ?? 0)}">
      </div>
      <div class="field"><label>الإضافي المعتمد</label>
        <input name="ot" type="number" min="0" step="any" value="${esc(row.approved_overtime_hours ?? 0)}">
      </div>
      <div class="field"><label>النقص المطبق</label>
        <input name="short" type="number" min="0" step="any" value="${esc(row.applied_shortage_hours ?? 0)}">
        <small class="hint" data-shortage-hint></small>
      </div>
      <div class="field full"><label>ملاحظة (اختياري)</label><input name="note" value="${esc(row.note || '')}"></div>
    </div>`,
    onSubmit: async fd => {
      try {
        await api.setAttendance({
          employeeId: row.employee_id,
          date: day,
          status: fd.get('status'),
          expected,
          worked: fd.get('worked'),
          overtime: fd.get('ot'),
          shortage: fd.get('short'),
          note: fd.get('note'),
        });
        toast('تم حفظ تعديل الدوام', 'success');
        await drawAttendance(root, day);
        return true;
      } catch (e) {
        toast(friendlyError(e), 'error');
        return false;
      }
    },
  });

  const status = m.form.elements.namedItem('status');
  const worked = m.form.elements.namedItem('worked');
  const shortage = m.form.elements.namedItem('short');
  const hint = m.form.querySelector('[data-shortage-hint]');
  status.value = row.status || 'full';

  function refreshShortageHint() {
    try {
      const computed = calculatedShortageHours({expected, worked: worked.value, status: status.value});
      const applied = Number(shortage.value || 0);
      const overLimit = Number.isFinite(applied) && applied > computed;
      hint.textContent = overLimit
        ? `النقص المحسوب ${computed} ساعة فقط؛ لا يمكن تطبيق ${applied} ساعة. لخصم إداري إضافي استخدم الرواتب.`
        : `النقص المحسوب: ${computed} ساعة. يمكن تطبيق قيمة بين 0 و${computed}. لا يُخصم الموظف الشهري تلقائيًا.`;
      hint.style.color = overLimit ? '#a23e4b' : '';
    } catch (e) {
      hint.textContent = e.message;
      hint.style.color = '#a23e4b';
    }
  }

  status.addEventListener('change', () => {
    if (['absent', 'paid_leave', 'unpaid_leave'].includes(status.value)) worked.value = '0';
    if (status.value === 'full' && Number(worked.value) === 0 && expected > 0) worked.value = String(expected);
    refreshShortageHint();
  });
  worked.addEventListener('input', refreshShortageHint);
  shortage.addEventListener('input', refreshShortageHint);
  refreshShortageHint();
}

export async function renderPayroll(root) {
  root.innerHTML = loader();
  try {
    const rows = await api.payrollRuns();
    root.innerHTML = `<div class="page-head"><div><h2>الرواتب</h2><p>المسيرات والاعتمادات والدفعات في مكان واحد. الراتب الشهري لا يُخصم تلقائيًا بسبب نقص الساعات.</p></div></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الفترة</th><th>الحالة</th><th>الإجمالي</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.period_start || '')} — ${esc(r.period_end || '')}</td><td>${statusBadge(r.status)}</td><td>${money(r.net_due_base ?? r.total_net_due_base ?? 0)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty"><strong>لا توجد مسيرات رواتب بعد</strong><div>سنضيف إنشاء المسير وإدارته هنا بعد اختبار تدفق الموظفين على الموقع.</div></div>'}`;
  } catch (e) {
    root.innerHTML = `<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}
