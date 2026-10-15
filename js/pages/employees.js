import * as api from '../api.js?v=1.0';
import { modal, toast, loader, friendlyError } from '../ui.js?v=1.0';
import {currencyLabel, esc, money, todayISO, dateOnly, statusBadge } from '../utils.js?v=1.0';
import { EMPLOYEE_RATE_COLUMNS, calculatedShortageHours } from '../business-rules.js?v=1.0';
import {employeeDirectoryScoreV033, attendanceSummaryV033, filterAttendanceV033} from '../staff-ux-v033.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {buildEmployeeProfileV032} from '../employee-profile-v032.js?v=1.0';
import {openEmployeeBonusModal} from './bonuses.js?v=1.0';

import { PAY_LABELS, payTypeBadge, employeeName, currenciesSummary } from '../payroll-ui.js?v=1.0';
const WAGE_LABELS = {monthly: 'الراتب الشهري', daily: 'الأجر اليومي', hourly: 'أجر الساعة',fixed:'أجر مقطوع'};
const ATTENDANCE_LABELS = {
  full: 'دوام كامل', partial: 'دوام جزئي', absent: 'غياب',
  paid_leave: 'إجازة مدفوعة', unpaid_leave: 'إجازة غير مدفوعة',
  holiday: 'عطلة', day_off: 'يوم راحة',
};

export async function renderEmployees(root) {
  root.innerHTML = loader();
  try {
    const rows = await api.employees();
    const activeCount = rows.filter(r=>r.status==='active').length;
    root.innerHTML = `
      <div class="page-head">
        <div><h2>الموظفون</h2><p>اضغط على أي موظف لتعديل بياناته وراتبه أو مراجعة السلف والإجازات والمكافآت.</p></div>
        <div class="quick-actions"><a class="btn secondary" href="#/bonuses">المكافآت</a><a class="btn secondary" href="#/advances">السلف</a><button class="btn add" type="button">+ موظف جديد</button></div>
      </div>
      <div class="grid cols-3 staff-stats-grid">
        <div class="card"><div class="metric-label">جميع الموظفين</div><div class="metric-value">${rows.length}</div></div>
        <div class="card"><div class="metric-label">الموظفون النشطون</div><div class="metric-value">${activeCount}</div></div>
        <div class="card"><div class="metric-label">الموظفون غير النشطين</div><div class="metric-value">${rows.length-activeCount}</div></div>
      </div>
      ${rows.length ? `<div class="card staff-directory-tools">
       <div class="field"><label for="employee-search-v032">البحث باسم الموظف أو وظيفته أو رقم موبايله</label><input id="employee-search-v032" type="search" placeholder="ابحث بسرعة..."></div>
       <span id="employee-match-count-v032" class="metric-note" aria-live="polite">${rows.length} موظف · اضغط على أي سطر للتعديل</span>
      </div>
      <div class="table-wrap"><table class="table staff-directory-table">
        <thead><tr><th>الاسم</th><th>الوظيفة</th><th>السكن</th><th>رقم الموبايل</th><th>نوع الأجر</th><th>الأجر</th><th>العملة</th><th>الحالة</th></tr></thead>
        <tbody>${rows.map(r => {
          const rate = r[EMPLOYEE_RATE_COLUMNS[r.pay_type]];
          return `<tr class="clickable employee-clickable" tabindex="0" role="button" aria-label="فتح تفاصيل ${esc(r.name)}" data-employee="${esc(r.id)}">
            <td><strong>${esc(r.name)}</strong><small class="employee-edit-hint">اضغط للتعديل ↗</small></td>
            <td>${esc(r.job_title || '—')}</td>
            <td>${esc(r.residence_v031 || '—')}</td>
            <td dir="ltr">${esc(r.mobile_phone_v031 || '—')}</td>
            <td>${payTypeBadge(r.pay_type)}</td>
            <td><strong>${rate == null ? '—' : money(rate, r.wage_currency_code || 'SYP')}</strong></td>
            <td>${esc(currencyLabel(r.wage_currency_code || 'SYP'))}</td>
            <td><span class="badge ${r.status==='active'?'green':'yellow'}">${r.status==='active'?'نشط':'غير نشط'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div><div id="employee-no-match-v032" class="empty" hidden>لا يوجد موظفون مطابقون للبحث.</div>`
        : '<div class="card empty"><strong>لا يوجد موظفون بعد</strong><div>أضف الموظفين يدويًا، أو استخدم الإدخالات السريعة لرفع جدول Excel.</div><a class="btn secondary" href="#/quick-imports">استيراد الموظفين</a></div>'}`;
    root.querySelector('.add').onclick = () => openEmployeeModal(root);
    root.querySelectorAll('.employee-clickable').forEach(tr => {
      const open=()=>{const employee=rows.find(e=>String(e.id)===tr.dataset.employee);if(employee)openEmployeeModal(root,employee);};
      tr.addEventListener('click',open);
      tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    });
    const search=root.querySelector('#employee-search-v032');
    search?.addEventListener('input',()=>{
      const tbody=root.querySelector('.staff-directory-table tbody');
      const query=search.value;
      const byId=new Map([...tbody.querySelectorAll('.employee-clickable')].map(tr=>[tr.dataset.employee,tr]));
      const ranked=rows.map((employee,index)=>({employee,index,score:employeeDirectoryScoreV033(employee,query)}));
      ranked.sort((a,b)=>b.score-a.score||a.index-b.index);
      let count=0;
      for(const item of ranked){
        // Look up by the stable employee ID; sorting must not alter row identity.
        const target=byId.get(String(item.employee.id));
        if(!target)continue;
        target.hidden=item.score<0;
        tbody.appendChild(target);
        if(item.score>=0)count++;
      }
      root.querySelector('#employee-match-count-v032').textContent=`${count} من ${rows.length} موظف`;
      root.querySelector('#employee-no-match-v032').hidden=count>0;
    });
  } catch (e) {
    root.innerHTML = `<div class="notice">${esc(friendlyError(e))}</div>`;
  }
}

function profileError(e){
  const msg=String(e?.message||e||'').toUpperCase();
  if(msg.includes('EMPLOYEE_NAME_ALREADY_USED_V032'))return 'هذا الاسم مستخدم لموظف آخر. لا يمكن إنشاء سجلين بالاسم نفسه.';
  if(msg.includes('EMPLOYEE_PAY_BASIS_LOCKED_V032'))return 'لا يمكن تغيير نوع الأجر أو العملة لوجود سجل دوام أو سلفة أو راتب أو مكافأة. يمكنك تعديل مبلغ الراتب والبيانات الأخرى دون المساس بالتاريخ المالي.';
  if(msg.includes('EMPLOYEE_PENDING_BONUS_V032'))return 'توجد مكافأة معلقة لهذا الموظف. عالجها في قسم المكافآت قبل تحويله إلى غير نشط.';
  if(msg.includes('INVALID_EMPLOYEE_PROFILE_V032'))return 'راجع الاسم والمبلغ والهاتف والتواريخ، ثم حاول مرة أخرى.';
  if(msg.includes('UPDATE_EMPLOYEE_PROFILE_V032')||msg.includes('PGRST202'))return 'شغّل تحديث SQL v0.32 على Supabase ثم أعد تحميل الموقع.';
  return friendlyError(e);
}

function openEmployeeModal(root, employee=null) {
  const editing=!!employee;
  const rate=editing?employee[EMPLOYEE_RATE_COLUMNS[employee.pay_type]]:'';
  const value=x=>esc(String(x??''));
  const m = modal({
    title: editing ? `ملف الموظف · ${employee.name}` : 'إضافة موظف جديد',
    subtitle: editing ? 'حدّث بياناته من هنا دون التأثير على الرواتب المصروفة سابقًا.' : 'أدخل البيانات الأساسية، ويمكنك إضافة السلف والمكافآت لاحقًا.',
    submitText: editing ? 'حفظ التعديلات' : 'إضافة الموظف',wide:true,
    body: `<div class="staff-dialog-sections">
      <div class="staff-dialog-section-title">البيانات الشخصية والوظيفية</div>
      <div class="form-grid">
        <div class="field"><label>الاسم <span class="staff-required">*</span></label><input name="name" maxlength="250" required value="${value(employee?.name)}" autocomplete="off"></div>
        <div class="field"><label>الوظيفة</label><input name="job" maxlength="250" value="${value(employee?.job_title)}" placeholder="مثال: شيف، كاشير"></div>
        <div class="field"><label>القسم</label><input name="department" maxlength="250" value="${value(employee?.department)}" placeholder="مثال: المطبخ، الصالة"></div>
        <div class="field"><label>السكن</label><input name="residence" maxlength="200" value="${value(employee?.residence_v031)}"></div>
        <div class="field"><label>رقم الموبايل</label><input name="phone" dir="ltr" inputmode="tel" maxlength="40" value="${value(employee?.mobile_phone_v031)}" placeholder="09xxxxxxxx"></div>
        <div class="field"><label>الحالة</label><select name="status"><option value="active" ${employee?.status!=='inactive'?'selected':''}>نشط</option><option value="inactive" ${employee?.status==='inactive'?'selected':''}>غير نشط</option></select></div>
      </div>
      <div class="staff-dialog-section-title">الأجر والاستحقاق</div>
      <div class="form-grid">
        <div class="field"><label>نوع الأجر</label><select name="pay">
          <option value="monthly">شهري</option><option value="daily">يومي</option><option value="hourly">بالساعة</option><option value="fixed">مقطوع</option>
        </select></div>
        <div class="field"><label class="wage-label">الراتب الشهري</label><input name="wage" type="number" min="0.0001" step="any" required inputmode="decimal" value="${value(rate)}"></div>
        <div class="field"><label>عملة الأجر</label><select name="currency"><option value="SYP">ل.س · ليرة سورية</option><option value="USD">USD · دولار</option></select></div>
        <div class="field"><label>تاريخ التعيين</label><input name="hire_date" type="date" value="${value(employee?.hire_date)}"></div>
        <div class="field"><label>تاريخ انتهاء العمل (اختياري)</label><input name="termination_date" type="date" value="${value(employee?.termination_date)}"></div>
        <div class="field full"><label>ملاحظات إدارية</label><textarea name="notes" maxlength="2000" rows="2">${value(employee?.notes)}</textarea></div>
      </div>
      ${editing?`<div class="staff-dialog-section-title">المتابعة المالية والدوام</div>
         <div class="staff-profile-insights" data-employee-insights>${loader()}</div>
         <div class="staff-dialog-links"><a class="btn secondary" href="#/advances">سلف الموظفين</a><a class="btn secondary" href="#/attendance">سجل الدوام والإجازات</a><a class="btn secondary" href="#/bonuses">سجل المكافآت</a>
           ${employee.status==='active'&&employee.pay_type!=='fixed'?'<button type="button" class="btn staff-award-employee">+ منح مكافأة</button>':''}
         </div>`:''}
      <div class="notice rose staff-edit-warning">${editing?'تعديل الأجر يؤثر في المسيرات الجديدة فقط؛ الرواتب المعتمدة محفوظة كما صُرفت. تغيير نوع الأجر أو العملة قد يُمنع إن وُجدت عمليات مالية سابقة.':'لا يتم صرف أي راتب أو سلفة تلقائيًا عند إضافة الموظف.'}</div>
    </div>`,
    onSubmit: async fd=>{
      try {
        const input=buildEmployeeProfileV032(fd);
        if(editing){await api.updateEmployeeV032(employee.id,input);toast('تم تحديث بيانات الموظف بنجاح.','success');}
        else {await api.createEmployee(input);toast('تمت إضافة الموظف.','success');}
        await renderEmployees(root);
        return true;
      } catch (e) {toast(profileError(e),'error');return false;}
    },
  });
  m.element.querySelector('.modal')?.classList.add('staff-employee-modal');
  const pay=m.form.elements.namedItem('pay');
  const currency=m.form.elements.namedItem('currency');
  pay.value=employee?.pay_type||'monthly';
  currency.value=employee?.wage_currency_code||'SYP';
  const label=m.form.querySelector('.wage-label');
  const updateLabel=()=>{label.textContent=WAGE_LABELS[pay.value]||'الأجر';};
  pay.addEventListener('change',updateLabel);updateLabel();
  if(editing){
    m.form.querySelectorAll('.staff-dialog-links a').forEach(a=>a.addEventListener('click',()=>m.close()));
    m.form.querySelector('.staff-award-employee')?.addEventListener('click',()=>{
      api.employees().then(staff=>openEmployeeBonusModal({staff,employeeId:employee.id,onSaved:()=>loadEmployeeInsights(m,employee)}))
        .catch(e=>toast(friendlyError(e),'error'));
    });
    loadEmployeeInsights(m,employee);
  }
}

async function loadEmployeeInsights(m, employee){
  const host=m.form.querySelector('[data-employee-insights]');if(!host)return;
  const year=todayISO().slice(0,4);
  const [advances,leaves,settings,bonuses]=await Promise.allSettled([
    api.employeeAdvances(),api.paidLeaveUsed(year),api.payrollSettings(),api.employeeBonusesV032(),
  ]);
  if(!m.element.isConnected)return;
  const good=entry=>entry.status==='fulfilled';
  const allAdvances=good(advances)?advances.value:null;
  const allLeaves=good(leaves)?leaves.value:null;
  const allBonuses=good(bonuses)?bonuses.value:null;
  const allowance=good(settings)?Number(settings.value.paid_leave_days_per_year_v023??0):null;
  const ownedAdvance=allAdvances?.filter(a=>String(a.employee_id)===String(employee.id)&&a.status==='open')||[];
  const totals=new Map();for(const a of ownedAdvance){const c=a.currency_code||'SYP';totals.set(c,(totals.get(c)||0)+Number(a.remaining_original||0));}
  const advanceText=allAdvances==null?'تعذر التحميل':[...totals].map(([c,a])=>money(a,c)).join(' · ')||'لا توجد سلف مفتوحة';
  const usedLeaves=allLeaves?.filter(a=>String(a.employee_id)===String(employee.id)).length;
  const leaveText=allLeaves==null?'تعذر التحميل':`${usedLeaves} / ${allowance??'؟'} يوم (${year})`;
  const ownedBonuses=allBonuses?.filter(b=>String(b.employee_id)===String(employee.id)&&b.status==='pending')||[];
  const bonusAmount=ownedBonuses.reduce((n,b)=>n+Number(b.amount_original||0),0);
  const bonusText=allBonuses==null?'تعذر التحميل':`${ownedBonuses.length} معلقة${bonusAmount?' · '+money(bonusAmount,employee.wage_currency_code):''}`;
  host.innerHTML=`<div class="staff-insight"><span>السلف المفتوحة</span><strong>${esc(advanceText)}</strong></div>
    <div class="staff-insight"><span>إجازات مدفوعة</span><strong>${esc(leaveText)}</strong></div>
    <div class="staff-insight"><span>المكافآت</span><strong>${esc(bonusText)}</strong></div>`;
}

export async function renderAttendance(root) {
  await drawAttendance(root, todayISO());
}

async function drawAttendance(root, day) {
  root.innerHTML = loader();
  try {
    const [rows, employees, staffRules, usedLeave] = await Promise.all([
      api.attendance(day), api.employees(), api.payrollSettings(), api.paidLeaveUsed(day.slice(0,4))
    ]);
    const leaveCounts=new Map();
    for(const entry of usedLeave)leaveCounts.set(String(entry.employee_id),(leaveCounts.get(String(entry.employee_id))||0)+1);
    const allowance=Number(staffRules.paid_leave_days_per_year_v023||0);
    const employeeById=new Map(employees.map(e=>[String(e.id),e]));
    const views=rows.map(row=>({row,summary:attendanceSummaryV033(row),employee:employeeById.get(String(row.employee_id))}));
    const counts={all:views.length,issues:filterAttendanceV033(views,'issues').length,
      shortage:filterAttendanceV033(views,'shortage').length,overtime:filterAttendanceV033(views,'overtime').length};
    const number=amount=>String(Number(amount||0).toLocaleString('en-US',{maximumFractionDigits:2}));
    const textDiff=summary=>summary.excused?'معذور':summary.actualDiff>0?`+${number(summary.actualDiff)} س`:
       summary.actualDiff<0?`−${number(-summary.actualDiff)} س`:'متطابق';
    const attendanceLabel=s=>ATTENDANCE_LABELS[s]||s||'—';
    root.innerHTML = `
      <div class="page-head">
        <div><h2>الدوام</h2><p>راقب الفرق بين المطلوب والفعلي، والإضافي المعتمد والنقص المطبق. الإجازات السنوية المدفوعة: ${allowance} يوم.</p></div>
        <div class="quick-actions">
          <input id="att-date" type="date" value="${esc(day)}" aria-label="تاريخ الدوام" style="padding:10px;border:1px solid var(--line);border-radius:12px">
          <button type="button" class="btn init" ${!employees.length ? 'disabled' : ''}>اعتماد الطبيعي</button>
        </div>
      </div>
      ${!employees.length
        ? '<div class="notice">أضف الموظفين أولًا إذا كنت تريد استخدام الدوام.</div>'
        : rows.length
          ? `<div class="card attendance-filter-bar-v033">
               <div class="field"><label for="attendance-filter-v033">عرض سجلات الدوام</label>
                <select id="attendance-filter-v033" aria-label="فلتر الدوام">
                 <option value="all">الكل (${counts.all})</option>
                 <option value="issues">غير مكتمل / يحتاج مراجعة (${counts.issues})</option>
                 <option value="shortage">لديه نقص / خصم ساعات (${counts.shortage})</option>
                 <option value="overtime">لديه زيادة (${counts.overtime})</option>
                </select></div>
               <div class="attendance-filter-status-v033" aria-live="polite" id="attendance-visible-count-v033">عرض ${counts.all} من ${counts.all} موظف</div>
               <div class="attendance-filter-key-v033"><span class="badge red">⚠ نقص</span><span class="badge green">+ إضافي</span><span class="badge yellow">بحاجة مراجعة</span></div>
             </div>
             <div class="table-wrap"><table class="table attendance-audit-table-v033">
               <thead><tr><th>الموظف</th><th>المطلوب</th><th>الفعلي</th><th>فرق الساعات</th><th>الإضافي المعتمد</th><th>النقص المطبق</th><th>الحالة</th><th>الإجازات / المسموح</th><th>إجراء</th></tr></thead>
               <tbody>${views.map(({row:r,summary:a,employee})=>`<tr class="${a.flaggedShortage?'attendance-shortage-row-v033':''}" data-attendance-row-v033="${esc(r.id)}">
                 <td><div class="attendance-employee-v033">${a.flaggedShortage?'<span title="يوجد نقص بساعات الدوام" aria-label="نقص في الساعات">⚠️</span>':''}${employeeName(employee?.name||'موظف',employee?.pay_type)}</div></td>
                 <td class="attendance-numeric">${number(a.expected)}</td>
                 <td class="attendance-numeric">${number(a.worked)}</td>
                 <td><span class="badge ${a.actualDiff<0?'red':a.actualDiff>0?'green':a.excused?'yellow':''}">${textDiff(a)}</span></td>
                 <td>${a.overtimeEffective>0?`<span class="badge green">+${number(a.overtimeEffective)} س</span>`:
                   a.overtimeUnapproved?`<span class="badge yellow">0 معتمد</span><small class="attendance-inline-hint-v033">${number(a.overtimeCalculated)} س زيادة غير معتمدة</small>`:'—'}</td>
                 <td>${a.shortageEffective>0?`<span class="badge red">−${number(a.shortageEffective)} س</span>`:
                   a.shortageWaived?`<span class="badge yellow">0 مطبق</span><small class="attendance-inline-hint-v033">${number(a.shortageComputed)} س نقص غير مطبق</small>`:'—'}</td>
                 <td><span class="${['absent','unpaid_leave'].includes(a.status)?'attendance-status-alert-v033':''}">${esc(attendanceLabel(a.status))}</span></td>
                 <td>${leaveCounts.get(String(r.employee_id))||0} / ${allowance}</td>
                 <td><button type="button" class="btn secondary edit" data-id="${esc(r.id)}">تعديل</button></td>
               </tr>`).join('')}</tbody>
             </table></div>
             <div class="empty attendance-no-results-v033" hidden>لا توجد سجلات تطابق هذا الفلتر. جرّب «الكل».</div>
             <p class="metric-note attendance-payroll-caution-v033">النقص المطبق هنا هو ساعات دوام، وليس خصمًا نقديًا تلقائيًا من راتب الموظف الشهري. ستجد السلف والخصومات المالية في المسير.</p>`
          : '<div class="card empty"><strong>لم يتم إنشاء دوام هذا اليوم</strong><div>اضغط اعتماد الطبيعي، ثم عدّل فقط الحالات المختلفة.</div></div>'}`;

    root.querySelector('#att-date').onchange = e => drawAttendance(root, e.target.value);
    root.querySelector('.init')?.addEventListener('click', async () => {
      try {
        await api.initializeAttendance(day);
        toast('تم اعتماد الدوام الطبيعي', 'success');
        await drawAttendance(root, day);
      } catch (e) {toast(friendlyError(e), 'error');}
    });
    root.querySelectorAll('.edit').forEach(button => {
      button.onclick = () => {
        const found=views.find(x=>String(x.row.id)===String(button.dataset.id));
        if (found) openAttendanceModal(root, day, found.row, found.employee?.name);
      };
    });
    const filter=root.querySelector('#attendance-filter-v033');
    const table=root.querySelector('.attendance-audit-table-v033');
    if(filter&&table){
      const exportData=()=>{
        const current=filterAttendanceV033(views,filter.value);
        const name=filter.selectedOptions[0]?.textContent?.replace(/\s*\([^)]*\)/g,'')||'الكل';
        return {title:`دوام ${day} · ${name}`,headers:['الموظف','المطلوب (ساعة)','الفعلي (ساعة)','فرق الساعات','الإضافي المعتمد (ساعة)','النقص المطبق (ساعة)','الحالة','الإجازات المستخدمة','الإجازات المسموحة','ملاحظة'],
          rows:current.map(({row:r,summary:a,employee})=>[
            employee?.name||'موظف',a.expected,a.worked,a.excused?'معذور':a.actualDiff,a.overtimeEffective,
            a.shortageEffective,attendanceLabel(a.status),leaveCounts.get(String(r.employee_id))||0,allowance,r.note||''
          ])};
      };
      registerTableExport(table,exportData);
      const apply=()=>{
        const filtered=filterAttendanceV033(views,filter.value);
        const ids=new Set(filtered.map(x=>String(x.row.id)));
        table.querySelectorAll('[data-attendance-row-v033]').forEach(tr=>{tr.hidden=!ids.has(tr.dataset.attendanceRowV033);});
        root.querySelector('#attendance-visible-count-v033').textContent=`عرض ${filtered.length} من ${views.length} موظف`;
        root.querySelector('.attendance-no-results-v033').hidden=filtered.length!==0;
      };
      filter.addEventListener('change',apply);apply();
    }
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
      <div class="field full attendance-leave-field-v033"><label class="attendance-leave-label-v033">
        <input type="checkbox" name="leave_flag" class="attendance-leave-check">
        <span><strong>إجازة مدفوعة</strong><small>فعّلها إذا كان اليوم إجازة مدفوعة ضمن الرصيد المتاح.</small></span>
      </label></div>
      <div class="field full"><label>ملاحظة (اختياري)</label><input name="note" value="${esc(row.note || '')}"></div>
    </div>`,
    onSubmit: async fd => {
      try {
        await api.setAttendance({
          employeeId: row.employee_id,
          date: day,
          status: fd.get('leave_flag')==='on'?'paid_leave':fd.get('status'),
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
  const leave=m.form.querySelector('[name=leave_flag]');
  leave.checked=row.status==='paid_leave';
  leave.addEventListener('change',()=>{
    if(leave.checked){status.value='paid_leave';worked.value='0';shortage.value='0';}
    else if(status.value==='paid_leave'){status.value='full';worked.value=String(expected);shortage.value='0';}
    refreshShortageHint();
  });

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
    leave.checked=status.value==='paid_leave';
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
    const fixedStaff=employees.filter(e=>e.pay_type==='fixed'&&e.status==='active');
    const advances=await api.employeeAdvances().catch(()=>[]);
    const outstanding=new Map();for(const a of advances.filter(a=>a.status==='open')){const key=a.employee_id;outstanding.set(key,(outstanding.get(key)||0)+Number(a.remaining_original||0));}
    const dueItems=dues.filter(d=>Number(d.estimated_due_original)>0.001);
    const zeroDue=dues.filter(d=>Number(d.estimated_due_original)<=0.001);
    const dueWarnings=dues.filter(d=>d.review_note);
    const monthlyRuns=runs.filter(r=>!String(runMap.get(r.payroll_run_id)?.note||'').startsWith('MARIA_DAILY_V014:'));
    const schemaError=duesResult.status==='rejected'?friendlyError(duesResult.reason,'لم تُفعّل خدمات الرواتب اليومية بعد.'):'',
      balancesError=balancesResult.status==='rejected'?friendlyError(balancesResult.reason,'تعذّر تحميل المستحقات المعتمدة.'):'',
      paymentsError=paymentsResult.status==='rejected'?friendlyError(paymentsResult.reason,'تعذّر تحميل سجل المدفوعات.'):'';
    root.innerHTML=`
      <div class="page-head"><div><h2>الرواتب والمستحقات</h2><p>تظهر أجور اليومي والساعي فور تسجيل الدوام. ولا تختفي الدفعة من السجل المالي بعد الصرف.</p></div><div class="quick-actions"><a class="btn secondary" href="#/advances">سلف الموظفين</a><a class="btn secondary" href="#/bonuses">المكافآت</a><a class="btn secondary" href="#/settings">إعداد صندوق الرواتب</a></div></div>
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
      ${dueItems.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>اليوم</th><th>الساعات</th><th>المبلغ التقديري</th><th>رصيد السلفة</th><th>الصرف</th></tr></thead><tbody>
      ${dueItems.map(d=>`<tr><td>${employeeName(d.employee_name,d.pay_type)}</td><td>${dateOnly(d.work_date)}</td><td>${esc(d.worked_hours)} / ${esc(d.expected_hours)}</td><td><strong>${money(d.estimated_due_original,d.currency_code)}</strong></td><td>${money(outstanding.get(d.employee_id)||0,d.currency_code)}</td><td><button class="btn pay-daily" data-employee="${esc(d.employee_id)}" data-date="${esc(d.work_date)}" ${!chosenBox?'disabled':''}>دفع</button></td></tr>`).join('')}
      </tbody></table></div>`:'<div class="empty"><strong>لا توجد أجور يومية أو ساعية تنتظر الصرف</strong><div>بعد تسجيل الدوام تظهر الأجور غير المسددة هنا.</div></div>'}
      ${zeroDue.length?`<p class="metric-note">${zeroDue.length} سجل دوام دون مبلغ مستحق حاليًا (مثل غياب غير مدفوع أو صفر ساعات).</p>`:''}
      ${dueWarnings.length?`<div class="notice"><strong>أيام تحتاج مراجعة</strong><div>${dueWarnings.map(d=>`${esc(d.employee_name)} (${dateOnly(d.work_date)}): ${esc(d.review_note)}`).join('<hr>')}</div><a href="#/attendance" class="text-link">مراجعة الدوام</a></div>`:''}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>أرصدة الرواتب المعتمدة</h3><p>المدفوع جزئيًا يبقى ظاهرًا حتى يسدد بالكامل.</p></div></div>
      ${balances.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>الفترة</th><th>المستحق</th><th>المدفوع</th><th>خصم سلفة</th><th>باقي السلفة</th><th>المتبقي</th><th></th></tr></thead><tbody>${balances.map(b=>`<tr>
      <td>${employeeName(b.employee_name,b.pay_type||employeeMap.get(b.employee_id)?.pay_type)}</td>
      <td>${dateOnly(b.run.period_start)} — ${dateOnly(b.run.period_end)}</td><td>${money(b.net_due_original,b.currency_code)}</td><td>${money(b.paid_original,b.currency_code)}</td><td>${money(b.advance_deduction_original||0,b.currency_code)}</td><td>${money(outstanding.get(b.employee_id)||0,b.currency_code)}</td><td><strong>${money(b.remaining_original,b.currency_code)}</strong></td>
      <td><button class="btn pay-balance" data-id="${esc(b.payroll_item_id)}" ${!chosenBox?'disabled':''}>دفع</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">لا توجد أرصدة رواتب معتمدة وغير مدفوعة.</div>'}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>\u0627\u0644\u0623\u062c\u0648\u0631 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629</h3><p>\u062a\u064f\u0635\u0631\u0641 \u062f\u0648\u0646 \u0634\u0631\u0637 \u0627\u0644\u062f\u0648\u0627\u0645 \u0645\u0639 \u062e\u0635\u0645 \u0623\u0642\u0633\u0627\u0637 \u0627\u0644\u0633\u0644\u0641 \u0627\u0644\u0645\u0633\u062a\u062d\u0642\u0629.</p></div></div>
      ${fixedStaff.length?`<div class="table-wrap"><table class="table"><thead><tr><th>\u0627\u0644\u0645\u0648\u0638\u0641</th><th>\u0627\u0644\u0623\u062c\u0631</th><th>\u0631\u0635\u064a\u062f \u0627\u0644\u0633\u0644\u0641\u0629</th><th>\u0627\u0644\u062f\u0641\u0639</th></tr></thead><tbody>${fixedStaff.map(e=>`<tr><td>${employeeName(e.name,e.pay_type)}</td><td>${money(e.fixed_pay_original_v023,e.wage_currency_code)}</td><td>${money(outstanding.get(e.id)||0,e.wage_currency_code)}</td><td><button class="btn pay-fixed" data-id="${esc(e.id)}" ${!chosenBox?'disabled':''}>\u062f\u0641\u0639</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">\u0644\u0627 \u064a\u0648\u062c\u062f \u0645\u0648\u0638\u0641\u0648\u0646 \u0628\u0623\u062c\u0631 \u0645\u0642\u0637\u0648\u0639.</div>'}</section>
      <section class="card finance-section"><div class="finance-section-head"><div><h3>الرواتب الشهرية</h3><p>تُثبت الرواتب الشهرية في مسير قابل للمراجعة والاعتماد، مع المكافآت المعتمدة للاستحقاق والسلف. لا يُخصم النقص تلقائيًا. عند إضافة مكافأة لمسودة قائمة اضغط «تحديث» قبل الاعتماد.</p></div><button type="button" class="btn create-month" ${!employees.some(e=>e.pay_type==='monthly')?'disabled':''}>إنشاء مسير شهري</button></div>
      ${monthlyRuns.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الفترة</th><th>الحالة</th><th>الموظفون</th><th>أيام دوام ناقصة</th><th>المبلغ بعد الحساب</th><th>إجراءات</th></tr></thead><tbody>
      ${monthlyRuns.map(r=>`<tr><td>${dateOnly(r.period_start)} — ${dateOnly(r.period_end)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.employee_count)}</td><td>${esc(r.missing_attendance_days)}</td><td>${money(r.total_net_due_base||0)}</td><td>${r.status==='draft'?`<button class="btn secondary recalc-month" data-id="${esc(r.payroll_run_id)}">تحديث</button> <button class="btn approve-month" data-id="${esc(r.payroll_run_id)}" ${Number(r.missing_attendance_days)>0?'disabled':''}>اعتماد</button>`:'—'}</td></tr>`).join('')}
      </tbody></table></div>`:'<div class="empty">لم تُنشأ مسيرات رواتب شهرية حتى الآن.</div>'}</section>
      <section class="card finance-section"><div class="finance-section-head"><h3>\u0633\u062c\u0644 \u0635\u0631\u0641 \u0627\u0644\u0631\u0648\u0627\u062a\u0628</h3></div><div id="salary-ledger-v023"></div></section>`;
    await renderSalaryLedger(root,employeeMap,boxMap);

    for(const b of root.querySelectorAll('.pay-fixed')) b.onclick=()=>{
      const employee=fixedStaff.find(e=>e.id===b.dataset.id);if(!employee)return;
      modal({title:'\u0635\u0631\u0641 \u0623\u062c\u0631 \u0645\u0642\u0637\u0648\u0639',submitText:'\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062f\u0641\u0639',
        body:`<div class="notice rose">${employeeName(employee.name,'fixed')} · ${money(employee.fixed_pay_original_v023,employee.wage_currency_code)}<div>\u0627\u0644\u0635\u0646\u062f\u0648\u0642: ${esc(chosenBox.name)}</div><div>\u0627\u0644\u0633\u0644\u0641\u0629: ${money(outstanding.get(employee.id)||0,employee.wage_currency_code)}</div></div><div class="field"><label>\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0635\u0631\u0641</label><input type="date" name="date" value="${todayISO()}" required></div>`,
        onSubmit:async fd=>{try{await api.payFixedEmployee(employee.id,chosenBox.id,fd.get('date'));toast('\u062a\u0645 \u0635\u0631\u0641 \u0627\u0644\u0623\u062c\u0631','success');await renderPayroll(root);return true;}catch(error){toast(friendlyError(error),'error');return false;}}
      });
    };
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

// Independent, server-paginated salary ledger. Historic payments never disappear.
async function renderSalaryLedger(root,employeeMap,boxMap){
  const wrap=root.querySelector('#salary-ledger-v023');if(!wrap)return;
  const now=todayISO();
  let kind='day',day=now,page=0,period;
  const fetchPage=async()=>{
    const bounds=(await import('../payroll-policy-v023.js?v=1.0')).salaryPeriod(kind,day);
    period=bounds;
    const result=await api.salaryPaymentPage(bounds.start,bounds.end,page*25,25);
    const rows=Array.isArray(result?.rows)?result.rows:[];
    const count=Number(result?.total)||0;
    const allTotals=Object.entries(result?.totals_by_currency||{}).map(([code,val])=>money(val,code)).join(' + ')||'0';
    const paid=new Map();
    for(const row of rows){if(row.status==='voided')continue;const code=row.currency_code||'SYP';paid.set(code,(paid.get(code)||0)+Number(row.amount_original||0));}
    wrap.innerHTML=`<div class="form-grid"><div class="field"><label>\u0627\u0644\u0641\u062a\u0631\u0629</label><select id="salary-kind"><option value="day" ${kind==='day'?'selected':''}>\u064a\u0648\u0645\u064a</option><option value="month" ${kind==='month'?'selected':''}>\u0634\u0647\u0631\u064a</option><option value="year" ${kind==='year'?'selected':''}>\u0633\u0646\u0648\u064a</option></select></div><div class="field"><label>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</label><input id="salary-day" type="date" value="${esc(day)}"></div></div>
    <p class="metric-note">${bounds.start} \u2014 ${bounds.end} \u00b7 ${count} \u062d\u0631\u0643\u0629. \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0641\u062a\u0631\u0629: ${allTotals}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>\u0627\u0644\u0645\u0648\u0638\u0641</th><th>\u0627\u0644\u064a\u0648\u0645</th><th>\u0627\u0644\u0645\u062f\u0641\u0648\u0639</th><th>\u062e\u0635\u0645 \u0633\u0644\u0641\u0629</th><th>\u0627\u0644\u0635\u0646\u062f\u0648\u0642</th><th>\u0627\u0644\u0646\u0648\u0639</th></tr></thead><tbody>
    ${rows.map(p=>{const e=employeeMap.get(p.employee_id);return `<tr><td>${employeeName(e?.name||'?',e?.pay_type)}</td><td>${dateOnly(p.occurred_at)}</td><td>${money(p.amount_original,p.currency_code)}</td><td>${money(p.advance_deducted_original||0,p.currency_code)}</td><td>${esc(boxMap.get(p.cashbox_id)||'\u2014')}</td><td>${p.kind==='fixed'?'\u0645\u0642\u0637\u0648\u0639':'\u0645\u0633\u064a\u0631'}</td></tr>`;}).join('')||'<tr><td colspan="6">\u0644\u0627 \u062a\u0648\u062c\u062f \u062f\u0641\u0639\u0627\u062a \u0641\u064a \u0627\u0644\u0641\u062a\u0631\u0629.</td></tr>'}</tbody></table></div>
    <div class="pagination-bar"><button id="salary-prev" class="mini-btn" ${page<=0?'disabled':''}>\u0627\u0644\u0633\u0627\u0628\u0642</button><span>${page+1} / ${Math.max(1,Math.ceil(count/25))}</span><button id="salary-next" class="mini-btn" ${(page+1)*25>=count?'disabled':''}>\u0627\u0644\u062a\u0627\u0644\u064a</button></div>`;
    wrap.querySelector('#salary-kind').onchange=e=>{kind=e.target.value;page=0;safeLoad();};
    wrap.querySelector('#salary-day').onchange=e=>{day=e.target.value;page=0;safeLoad();};
    wrap.querySelector('#salary-prev').onclick=()=>{page--;safeLoad();};
    wrap.querySelector('#salary-next').onclick=()=>{page++;safeLoad();};
    // Preserve selected controls across pagination by assigning after markup refresh.
    wrap.querySelector('#salary-kind').value=kind;
  };
  const safeLoad=async()=>{
    const k=wrap.querySelector('#salary-kind'),d=wrap.querySelector('#salary-day');
    if(k)kind=k.value;if(d)day=d.value;
    try{await fetchPage();}catch(e){wrap.innerHTML=`<div class="notice">${esc(friendlyError(e))}</div>`;}
  };
  await safeLoad();
}
