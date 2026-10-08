import * as api from '../api.js?v=0.17';
import { modal, toast, loader, friendlyError } from '../ui.js?v=0.17';
import { esc, money, todayISO, dateOnly, statusBadge } from '../utils.js?v=0.17';
import { EMPLOYEE_RATE_COLUMNS, calculatedShortageHours } from '../business-rules.js?v=0.17';

import { PAY_LABELS, payTypeBadge, employeeName, currenciesSummary } from '../payroll-ui.js?v=0.17';
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
            <td>${payTypeBadge(r.pay_type)}</td>
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
                 <td>${employeeName(employeeNames[r.employee_id], employees.find(e=>e.id===r.employee_id)?.pay_type)}</td>
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
        <input name="short" type="number" min="0" step="any" value="${esc(row.applied_shortage_hours ?? '')}" placeholder="اتركه فارغًا لحساب النقص تلقائيًا">
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
  root.innerHTML=loader();
  const names={};let info;
  try {
    const [duesResult,balancesResult,runsResult,paymentsResult,boxesResult,settingsResult,employeesResult,runHeadersResult]=await Promise.allSettled([
      api.dailyWageDues(),api.approvedSalaryBalances(),api.payrollRuns(),
      api.payrollPaymentHistory(),api.cashboxes(),api.payrollSettings(),api.employees(),
      api.list('payroll_runs',{order:'period_end',limit:500}),
    ]);
    const resolved=x=>x.status==='fulfilled'?x.value:[];
    const dues=resolved(duesResult),balances=resolved(balancesResult),runs=resolved(runsResult);
    const payments=resolved(paymentsResult),boxes=resolved(boxesResult),settings=settingsResult.status==='fulfilled'?settingsResult.value:{};
    const employees=resolved(employeesResult),runHeaders=resolved(runHeadersResult);
    const runMap=new Map(runHeaders.map(r=>[r.id,r]));
    const employeeMap=new Map(employees.map(e=>[e.id,e]));
    const boxMap=new Map(boxes.map(b=>[b.id,b.name]));
    const chosenBox=boxes.find(b=>b.id===settings.payroll_cashbox_id);
    const dueItems=dues.filter(d=>Number(d.estimated_due_original)>0.001);
    const zeroDue=dues.filter(d=>Number(d.estimated_due_original)<=0.001);
    const dueWarnings=dues.filter(d=>d.review_note);
    const monthlyRuns=runs.filter(r=>!String(runMap.get(r.payroll_run_id)?.note||'').startsWith('MARIA_DAILY_V014:'));
    const schemaError=duesResult.status==='rejected'?friendlyError(duesResult.reason,'لم تُفعّل خدمات الرواتب اليومية بعد.'):'',
      balancesError=balancesResult.status==='rejected'?friendlyError(balancesResult.reason,'تعذّر تحميل المستحقات المعتمدة.'):'',
      paymentsError=paymentsResult.status==='rejected'?friendlyError(paymentsResult.reason,'تعذّر تحميل سجل المدفوعات.'):'';
    root.innerHTML=`
      <div class="page-head"><div><h2>الرواتب والمستحقات</h2><p>تظهر أجور اليومي والساعي فور تسجيل الدوام. ولا تختفي الدفعة من السجل المالي بعد الصرف.</p></div><a class="btn secondary" href="#/settings">إعداد صندوق الرواتب</a></div>
      ${!chosenBox?`<div class="notice"><strong>حدد صندوق دفع الرواتب أولًا.</strong> لا يمكن دفع راتب قبل اختيار صندوق نشط من <a href="#/settings" class="text-link">الإعدادات ← الرواتب</a>.</div>`:
      `<div class="notice green">صندوق دفع الرواتب: <strong>${esc(chosenBox.name)}</strong> · كل دفعة تُسجَّل في حركة الصندوق.</div>`}
      ${schemaError?`<div class="notice"><strong>خدمة احتساب الأجور اليومية غير مفعّلة:</strong> ${esc(schemaError)}<p>نفّذ Migration v0.14 في Supabase ثم حدّث الموقع.</p></div>`:''}
      ${balancesError?`<div class="notice">${esc(balancesError)}</div>`:''}
      <div class="grid cols-3 finance-summary-grid">
        <div class="card"><div class="metric-label">أيام أجور تنتظر التسوية</div><div class="metric-value">${dueItems.length}</div><div class="metric-note">تقديرية حتى الاعتماد</div></div>
        <div class="card"><div class="metric-label">أرصدة رواتب معتمدة وغير مسددة</div><div class="metric-value">${balances.length}</div><div class="metric-note">مسيرات معتمدة أو مدفوعة جزئيًا</div></div>
        <div class="card"><div class="metric-label">المستحقات اليومية المقدّرة</div><div class="metric-note">${currenciesSummary(dueItems)}</div><div class="metric-note">تُعرض العملات منفصلة ولا تُجمع دون تحويل تاريخي</div></div>
      </div>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>أجور الدوام المسجّل</h3><p>يومي وساعي · قبل الدفع يثبت النظام الحساب النهائي ويطبّق السلف والخصومات المسجلة.</p></div><a href="#/attendance" class="btn secondary">الدوام</a></div>
      ${dueItems.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>اليوم</th><th>الساعات</th><th>المبلغ التقديري</th><th>الصرف</th></tr></thead><tbody>
      ${dueItems.map(d=>`<tr><td>${employeeName(d.employee_name,d.pay_type)}</td><td>${dateOnly(d.work_date)}</td><td>${esc(d.worked_hours)} / ${esc(d.expected_hours)}</td><td><strong>${money(d.estimated_due_original,d.currency_code)}</strong></td><td><button class="btn pay-daily" data-employee="${esc(d.employee_id)}" data-date="${esc(d.work_date)}" ${!chosenBox?'disabled':''}>دفع</button></td></tr>`).join('')}
      </tbody></table></div>`:'<div class="empty"><strong>لا توجد أجور يومية أو ساعية تنتظر الصرف</strong><div>بعد تسجيل الدوام تظهر الأجور غير المسددة هنا.</div></div>'}
      ${zeroDue.length?`<p class="metric-note">${zeroDue.length} سجل دوام دون مبلغ مستحق حاليًا (مثل غياب غير مدفوع أو صفر ساعات).</p>`:''}
      ${dueWarnings.length?`<div class="notice"><strong>أيام تحتاج مراجعة</strong><div>${dueWarnings.map(d=>`${esc(d.employee_name)} (${dateOnly(d.work_date)}): ${esc(d.review_note)}`).join('<hr>')}</div><a href="#/attendance" class="text-link">مراجعة الدوام</a></div>`:''}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>أرصدة الرواتب المعتمدة</h3><p>المدفوع جزئيًا يبقى ظاهرًا حتى يسدد بالكامل.</p></div></div>
      ${balances.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>الفترة</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th></th></tr></thead><tbody>${balances.map(b=>`<tr>
      <td>${employeeName(b.employee_name,b.pay_type||employeeMap.get(b.employee_id)?.pay_type)}</td>
      <td>${dateOnly(b.run.period_start)} — ${dateOnly(b.run.period_end)}</td><td>${money(b.net_due_original,b.currency_code)}</td><td>${money(b.paid_original,b.currency_code)}</td><td><strong>${money(b.remaining_original,b.currency_code)}</strong></td>
      <td><button class="btn pay-balance" data-id="${esc(b.payroll_item_id)}" ${!chosenBox?'disabled':''}>دفع</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">لا توجد أرصدة رواتب معتمدة وغير مدفوعة.</div>'}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>الرواتب الشهرية</h3><p>تُثبت الرواتب الشهرية في مسير قابل للمراجعة والاعتماد، ولا يُخصم النقص تلقائيًا.</p></div><button type="button" class="btn create-month" ${!employees.some(e=>e.pay_type==='monthly')?'disabled':''}>إنشاء مسير شهري</button></div>
      ${monthlyRuns.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الفترة</th><th>الحالة</th><th>الموظفون</th><th>أيام دوام ناقصة</th><th>المبلغ بعد الحساب</th><th>إجراءات</th></tr></thead><tbody>
      ${monthlyRuns.map(r=>`<tr><td>${dateOnly(r.period_start)} — ${dateOnly(r.period_end)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.employee_count)}</td><td>${esc(r.missing_attendance_days)}</td><td>${money(r.total_net_due_base||0)}</td><td>${r.status==='draft'?`<button class="btn secondary recalc-month" data-id="${esc(r.payroll_run_id)}">تحديث</button> <button class="btn approve-month" data-id="${esc(r.payroll_run_id)}" ${Number(r.missing_attendance_days)>0?'disabled':''}>اعتماد</button>`:'—'}</td></tr>`).join('')}
      </tbody></table></div>`:'<div class="empty">لم تُنشأ مسيرات رواتب شهرية حتى الآن.</div>'}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>سجل صرف الرواتب</h3><p>دائم وقابل للمراجعة: الدفع لا يحذف السجل، ويدخل مباشرة في الصندوق.</p></div></div>
      ${paymentsError?`<div class="notice">${esc(paymentsError)}</div>`:''}
      ${payments.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>تاريخ الدفع</th><th>المبلغ المدفوع</th><th>الصندوق</th><th>الحالة</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${employeeName(employeeMap.get(p.employee_id)?.name||'موظف',employeeMap.get(p.employee_id)?.pay_type)}</td><td>${dateOnly(p.occurred_at)}</td><td>${money(p.amount_original,p.currency_code)}</td><td>${esc(boxMap.get(p.cashbox_id)||'—')}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">لم تُسجّل دفعات راتب بعد.</div>'}</section>`;

    for(const b of root.querySelectorAll('.pay-daily')) b.onclick=()=>{
      const d=dueItems.find(x=>x.employee_id===b.dataset.employee&&x.work_date===b.dataset.date);
      if(!d)return;
      modal({title:'دفع أجر دوام',subtitle:'يتم احتساب القيمة النهائية في قاعدة البيانات ثم تسجيل الدفع في الصندوق تلقائيًا.',submitText:'اعتماد ودفع',
        body:`<div class="notice rose">الموظف: <strong>${esc(d.employee_name)}</strong><div>اليوم: ${dateOnly(d.work_date)}</div><div>المبلغ التقديري: <strong>${money(d.estimated_due_original,d.currency_code)}</strong></div><div>الصندوق: ${esc(chosenBox.name)}</div><small>قد يختلف المبلغ النهائي بسبب السلف أو المكافآت أو الخصومات المسجلة. لا يُدفع اليوم نفسه مرتين.</small></div>`,
        onSubmit:async()=>{try{await api.payDailyWage(d.employee_id,d.work_date);toast('تم صرف الأجر وتسجيله في الصندوق','success');await renderPayroll(root);return true;}catch(e){toast(friendlyError(e),'error');return false;}}
      });
    };
    for(const b of root.querySelectorAll('.pay-balance')) b.onclick=()=>{
      const due=balances.find(x=>x.payroll_item_id===b.dataset.id);if(!due)return;
      modal({title:'صرف راتب معتمد',subtitle:'يمكنك دفع الرصيد كاملًا أو جزءًا منه.',submitText:'تأكيد الدفع',
        body:`<div class="notice rose">${employeeName(due.employee_name,due.pay_type)} · الصندوق ${esc(chosenBox.name)}</div><div class="field"><label>المبلغ (${esc(due.currency_code)}) — المتبقي ${money(due.remaining_original,due.currency_code)}</label><input type="number" name="amount" step="any" min="0.0001" max="${esc(due.remaining_original)}" value="${esc(due.remaining_original)}" required></div>`,
        onSubmit:async fd=>{try{const amount=Number(fd.get('amount'));if(!(amount>0&&amount<=Number(due.remaining_original)+0.001))throw new Error('أدخل مبلغًا ضمن الرصيد المتبقي.');await api.payApprovedSalary(due.payroll_item_id,amount);toast('تم تسجيل دفعة الراتب','success');await renderPayroll(root);return true;}catch(e){toast(friendlyError(e,e.message),'error');return false;}}
      });
    };
    root.querySelector('.create-month').onclick=()=>{
      const current=todayISO().slice(0,7);
      modal({title:'إنشاء مسير راتب شهري',subtitle:'للموظفين الشهريين فقط. سيتطلب الاعتماد تسجيل دوام الفترة بالكامل.',submitText:'إنشاء مسودة',
        body:`<div class="field"><label>شهر المسير</label><input type="month" name="month" value="${current}" required></div>`,
        onSubmit:async fd=>{try{const [year,month]=String(fd.get('month')).split('-').map(Number);await api.createMonthlyPayroll(year,month);toast('أُنشئت مسودة المسير','success');await renderPayroll(root);return true;}catch(e){toast(friendlyError(e),'error');return false;}}
      });
    };
    for(const b of root.querySelectorAll('.recalc-month'))b.onclick=async()=>{
      try{await api.recalculateMonthlyPayroll(b.dataset.id);toast('تم تحديث حساب المسير','success');await renderPayroll(root);}catch(e){toast(friendlyError(e),'error');}
    };
    for(const b of root.querySelectorAll('.approve-month'))b.onclick=()=>{
      modal({title:'اعتماد مسير الرواتب',subtitle:'الاعتماد يثبت الرواتب تاريخيًا قبل الدفع.',submitText:'اعتماد المسير',
        body:'<div class="notice">تأكد من تسجيل الدوام والسلف والخصومات قبل الاعتماد؛ لا يُعدّل الراتب المعتمد مباشرة.</div>',
        onSubmit:async()=>{try{await api.approveMonthlyPayroll(b.dataset.id);toast('تم اعتماد المسير','success');await renderPayroll(root);return true;}catch(e){toast(friendlyError(e),'error');return false;}}
      });
    };
  } catch(e) {
    root.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}
