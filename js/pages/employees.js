import * as api from '../api.js?v=1.0.28';
import { modal, toast, loader, friendlyError, confirmBox } from '../ui.js?v=1.0.23';
import {currencyLabel, esc, money, todayISO, dateOnly } from '../utils.js?v=1.0';
import { finalMonthTermsV123 } from '../final-month-pay-v123.js?v=1.0.23';
import { EMPLOYEE_RATE_COLUMNS } from '../business-rules.js?v=1.0';
import {employeeDirectoryScoreV033} from '../staff-ux-v033.js?v=1.0';
import {buildEmployeeProfileV032} from '../employee-profile-v032.js?v=1.0.28';
import {openEmployeeBonusModal} from './bonuses.js?v=1.0';
import {openEmployeeAdvanceModalV123} from './advances.js?v=1.0.23';
import {visibleEmployeesV123,employeeTotalsV123,employeeLeaveCountV123,employeeLeaveNameV123,adjustmentKindV123,adjustmentLabelV123,adjustmentReasonV123} from '../employee-ledger-v123.js?v=1.0.23';

import { payTypeBadge } from '../payroll-ui.js?v=1.0';
import {openEmployeeAdjustmentModalV127 as sharedEmployeeAdjustmentModalV1271} from '../employee-adjustment-modal-v1271.js?v=1.0.28';
import {dateInEmployeeServiceV128,employeeServiceDateInputV128,outstandingAdvancesByEmployeeV128} from '../employee-service-v128.js?v=1.0.28';
const WAGE_LABELS = {monthly: 'الراتب الشهري', daily: 'الأجر اليومي', hourly: 'أجر الساعة',fixed:'أجر مقطوع'};
export async function renderEmployees(root) {
  root.innerHTML = loader();
  try {
    const [allRows,adjustments,leaves,staffSettings] = await Promise.all([
      api.employees(),api.employeeAdjustmentsV123(),api.employeeLeaveEventsV123(),api.payrollSettings()
    ]);
    const rows=visibleEmployeesV123(allRows);
    const month=todayISO().slice(0,7), year=todayISO().slice(0,4);
    const activeCount = rows.filter(r=>r.status==='active'&&(!r.termination_date||r.termination_date>todayISO())).length;
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
        <thead><tr><th>\u0627\u0644\u0627\u0633\u0645</th><th>\u0627\u0644\u0648\u0638\u064a\u0641\u0629</th><th>\u0639\u062f\u062f \u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a</th><th>\u0625\u0636\u0627\u0641\u0627\u062a \u0648\u062d\u0633\u0645\u064a\u0627\u062a</th><th>\u0646\u0648\u0639 \u0627\u0644\u0623\u062c\u0631</th><th>\u0627\u0644\u0623\u062c\u0631</th><th>\u0627\u0644\u0639\u0645\u0644\u0629</th><th>\u0627\u0644\u062d\u0627\u0644\u0629</th></tr></thead>
        <tbody>${rows.map(r => {
          const rate = r[EMPLOYEE_RATE_COLUMNS[r.pay_type]];
          return `<tr class="clickable employee-clickable" tabindex="0" role="button" aria-label="فتح تفاصيل ${esc(r.name)}" data-employee="${esc(r.id)}">
            <td><strong>${esc(r.name)}</strong><small class="employee-edit-hint">اضغط للتعديل ↗</small></td>
            <td>${esc(r.job_title || '—')}</td>
            <td><strong>${employeeLeaveCountV123(leaves,r.id,year)}</strong> <small>\u064a\u0648\u0645</small></td>
            <td>${(()=>{const total=employeeTotalsV123(adjustments,r.id,month);return `<div class="staff-v123-impact">
              <span class="staff-v123-positive">+ ${money(total.additions+total.bonuses,r.wage_currency_code||'SYP')}</span>
              <span class="staff-v123-negative">- ${money(total.deductions,r.wage_currency_code||'SYP')}</span>
              </div><small>\u0644\u0644\u0634\u0647\u0631 \u0627\u0644\u062d\u0627\u0644\u064a</small>`;})()}</td>
            <td>${payTypeBadge(r.pay_type)}</td>
            <td><strong>${rate == null ? '—' : money(rate, r.wage_currency_code || 'SYP')}</strong></td>
            <td>${esc(currencyLabel(r.wage_currency_code || 'SYP'))}</td>
            <td><span class="badge ${r.status==='active'&&(!r.termination_date||r.termination_date>todayISO())?'green':'yellow'}">${r.termination_date&&r.termination_date<=todayISO()?'انتهى عمله':r.status==='active'?'نشط':'غير نشط'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div><div id="employee-no-match-v032" class="empty" hidden>لا يوجد موظفون مطابقون للبحث.</div>`
        : '<div class="card empty"><strong>لا يوجد موظفون بعد</strong><div>أضف الموظفين يدويًا، أو استخدم الإدخالات السريعة لرفع جدول Excel.</div><a class="btn secondary" href="#/quick-imports">استيراد الموظفين</a></div>'}`;
    root.querySelector('.add').onclick = () => openEmployeeModal(root,null,Number(staffSettings.default_required_daily_hours)||8);
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
  if(msg.includes('V127_DAILY_HOURS_INVALID'))return 'ساعات الدوام اليومية يجب أن تكون بين ربع ساعة و24 ساعة.';
  if(msg.includes('PGRST202')&&msg.includes('save_employee_profile_hours_v127'))return 'يلزم تطبيق SQL v1.0.27 لتغيير ساعات دوام الموظف.';
  if(msg.includes('V128_SERVICE_DATES_CHANGED_RECALCULATE'))return 'تم تغيير مدة الخدمة بعد احتساب مسودة الرواتب. أعد احتساب المسودة قبل اعتمادها.';
  if(msg.includes('V123_FINAL_MONTH_ALREADY_APPROVED'))return 'راتب شهر انتهاء العمل معتمد أو مصروف؛ لا يمكن تغيير تاريخ النهاية أو الأيام المستحقة بعد اعتماده.';
  if(msg.includes('V123_FINAL_MONTH_DAYS_INVALID'))return 'راجع عدد الأيام المستحقة في شهر انتهاء العمل وتاريخ التعيين.';
  if(msg.includes('INVALID_EMPLOYEE_PROFILE_V032'))return 'راجع الاسم والمبلغ والهاتف والتواريخ، ثم حاول مرة أخرى.';
  if(msg.includes('PGRST202')||msg.includes('save_employee_final_profile_v123'))return 'شغّل تحديث SQL v1.0.23 كاملًا على Supabase ثم أعد تحميل الموقع.';
  return friendlyError(e);
}

function openEmployeeModal(root, employee=null, defaultHours=8) {
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
      <div class="staff-dialog-section-title">الأجر والاستحقاق · تسوية شهر انتهاء العمل</div>
      <div class="form-grid">
        <div class="field"><label>نوع الأجر</label><select name="pay">
          <option value="monthly">شهري</option><option value="daily">يومي</option><option value="hourly">بالساعة</option><option value="fixed">مقطوع</option>
        </select></div>
        <div class="field"><label class="wage-label">الراتب الشهري</label><input name="wage" type="number" min="0.0001" step="any" required inputmode="decimal" value="${value(rate)}"></div>
        <div class="field"><label>ساعات الدوام اليومية (الجمعة عطلة لحساب سعر الساعة)</label><input name="daily_hours" type="number" min="0.25" max="24" step="0.01" inputmode="decimal" required value="${value(employee?.required_daily_hours??defaultHours)}"></div>
        <div class="field"><label>عملة الأجر</label><select name="currency"><option value="SYP">ل.س · ليرة سورية</option><option value="USD">USD · دولار</option></select></div>
        <div class="field"><label>تاريخ التعيين</label><input name="hire_date" type="date" value="${value(employee?.hire_date)}"></div>
        <div class="field"><label>تاريخ انتهاء العمل (اختياري)</label><input name="termination_date" type="date" value="${value(employee?.termination_date)}"></div>
        <div class="field staff-v123-final-days-field" hidden><label>أيام الأجر المستحقة في شهر انتهاء العمل</label><input name="termination_paid_days" type="number" min="0" max="31" step="1" inputmode="numeric" value="${value(employee?.termination_paid_days_v123)}" placeholder="أدخل عدد الأيام الفعلية المستحقة"></div>
        <div class="field full staff-v123-final-preview" hidden aria-live="polite"></div>
        <div class="field full"><label>ملاحظات إدارية</label><textarea name="notes" maxlength="2000" rows="2">${value(employee?.notes)}</textarea></div>
      </div>
      ${editing?`<div class="staff-dialog-section-title">\u0627\u0644\u0633\u0644\u0641 \u0648\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a \u0648\u0627\u0644\u062d\u0633\u0645\u064a\u0627\u062a \u0648\u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a</div>
         <div class="staff-profile-insights" data-employee-insights>${loader()}</div>
         <div class="staff-dialog-links staff-v123-actions">
           <button type="button" class="btn staff-v123-advance">+ \u0633\u0644\u0641\u0629</button>
           <button type="button" class="btn secondary staff-v123-deduction">+ \u062e\u0635\u0645</button>
           <button type="button" class="btn secondary staff-v123-addition">+ \u0625\u0636\u0627\u0641\u0629</button>
           <button type="button" class="btn secondary staff-v123-leave">+ \u0625\u062c\u0627\u0632\u0629 / \u063a\u064a\u0627\u0628</button>
           ${employee.pay_type!=='fixed'&&employee.status==='active'?'<button type="button" class="btn secondary staff-award-employee">+ \u0645\u0643\u0627\u0641\u0623\u0629</button>':''}
           <button type="button" class="btn secondary staff-v123-delete">\u062d\u0630\u0641 \u0627\u0644\u0645\u0648\u0638\u0641</button>
         </div>`:''}
      <div class="notice rose staff-edit-warning">${editing?'تعديل الأجر يؤثر في المسيرات الجديدة فقط؛ الرواتب المعتمدة محفوظة كما صُرفت. تغيير نوع الأجر أو العملة قد يُمنع إن وُجدت عمليات مالية سابقة.':'لا يتم صرف أي راتب أو سلفة تلقائيًا عند إضافة الموظف.'}</div>
    </div>`,
    onSubmit: async fd=>{
      try {
        const input=buildEmployeeProfileV032(fd);
        if(editing){
          // Keep the existing profile RPC when hours are unchanged; otherwise
          // update the salary and daily hours together in the v1.0.27 RPC.
          if(Number(employee.required_daily_hours??8)===input.requiredDailyHours)
            await api.updateEmployeeFinalV123(employee.id,input);
          else await api.updateEmployeeHoursV127(employee.id,input);
          toast('تم تحديث بيانات الموظف بنجاح.','success');
        }
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
  // Calendar-day final-month settlement. This is preview only; SQL computes the official amount.
  const endInput=m.form.elements.namedItem('termination_date');
  const startInput=m.form.elements.namedItem('hire_date');
  const daysInput=m.form.elements.namedItem('termination_paid_days');
  const daysHolder=m.form.querySelector('.staff-v123-final-days-field');
  const preview=m.form.querySelector('.staff-v123-final-preview');
  const renderFinalMonth=()=>{
    const monthly=pay.value==='monthly';
    const end=endInput.value;
    const enabled=monthly&&Boolean(end);
    daysHolder.hidden=!enabled;preview.hidden=!enabled;
    daysInput.disabled=!enabled;
    if(!enabled){if(!end)daysInput.value='';return;}
    try{
      const terms=finalMonthTermsV123({payType:pay.value,wage:m.form.elements.namedItem('wage').value,
        hireDate:startInput.value||null,terminationDate:end,paidDays:daysInput.value||null});
      daysInput.max=String(terms.maxDays);
      preview.innerHTML=`<div class="notice"><strong>التسوية النهائية · ${esc(terms.month)}</strong>
       <div>عدد الأيام الممكنة خلال الخدمة: ${terms.maxDays} · عدد أيام الشهر: ${terms.daysInMonth}.</div>
       <div>${terms.paidDays===null?'أدخل عدد الأيام المستحقة لتفعيل حساب الأجر الأخير، وإلا يبقى الحساب الآلي السابق.':`الأجر الأساسي الأخير قبل الحسميات والسلف والمكافآت: <strong>${money(terms.basePay,currency.value)}</strong>`}</div>
       <small>الأساس: الراتب الشهري × الأيام المستحقة ÷ أيام الشهر التقويمية. لا تحتسب يوم الغياب غير المدفوع مرتين: أدخل الأيام قبل خصم الغياب المسجل كحسم منفصل.</small></div>`;
    }catch(e){preview.innerHTML=`<div class="notice rose">${esc(e.message)}</div>`;}
  };
  for(const control of [pay,endInput,startInput,daysInput,m.form.elements.namedItem('wage'),currency]){
    control.addEventListener(control===daysInput?'input':'change',renderFinalMonth);
    if(control===m.form.elements.namedItem('wage'))control.addEventListener('input',renderFinalMonth);
  }
  renderFinalMonth();
  if(editing){

    m.form.querySelector('.staff-award-employee')?.addEventListener('click',()=>{
      api.employees().then(staff=>openEmployeeBonusModal({staff,employeeId:employee.id,onSaved:()=>loadEmployeeInsights(m,employee)}))
        .catch(e=>toast(friendlyError(e),'error'));
    });
    m.form.querySelector('.staff-v123-advance').onclick=async()=>{
      try{const [staff,boxes]=await Promise.all([api.employees(),api.cashboxes()]);
        openEmployeeAdvanceModalV123({staff,boxes,employeeId:employee.id,onSaved:()=>loadEmployeeInsights(m,employee)});
      }catch(e){toast(friendlyError(e),'error');}
    };
    m.form.querySelector('.staff-v123-deduction').onclick=()=>openEmployeeAdjustmentModalV127(employee,'deduction',()=>loadEmployeeInsights(m,employee));
    m.form.querySelector('.staff-v123-addition').onclick=()=>openEmployeeAdjustmentModalV127(employee,'addition',()=>loadEmployeeInsights(m,employee));
    m.form.querySelector('.staff-v123-leave').onclick=()=>openEmployeeLeaveModalV123(employee,()=>loadEmployeeInsights(m,employee));
    m.form.querySelector('.staff-v123-delete').onclick=()=>openEmployeeRemovalV123(root,employee,m);
    loadEmployeeInsights(m,employee);
  }
}

async function loadEmployeeInsights(m, employee){
  const host=m.form.querySelector('[data-employee-insights]');if(!host)return;
  const year=todayISO().slice(0,4);
  const [advanceResult,adjustmentResult,leaveResult,balanceResult]=await Promise.allSettled([
    api.employeeAdvances(),api.employeeAdjustmentsV123(),api.employeeLeaveEventsV123(),api.employeeAdvanceOutstandingV128()
  ]);
  if(!m.element.isConnected)return;
  const advances=advanceResult.status==='fulfilled'?advanceResult.value.filter(x=>String(x.employee_id)===String(employee.id)):[];
  const adjustments=adjustmentResult.status==='fulfilled'?adjustmentResult.value.filter(x=>String(x.employee_id)===String(employee.id)):[];
  const leaves=leaveResult.status==='fulfilled'?leaveResult.value.filter(x=>String(x.employee_id)===String(employee.id)):[];
  const advanceAmounts=balanceResult.status==='fulfilled'
   ?outstandingAdvancesByEmployeeV128(balanceResult.value).get(String(employee.id))
   :null;
  const advanceText=balanceResult.status!=='fulfilled'?'غير متاح · تحقق من SQL v1.0.28'
   :[...(advanceAmounts||new Map())].map(([c,a])=>money(a,c)).join(' / ')||'0';
  const leaveTotal=employeeLeaveCountV123(leaves,employee.id,year);
  const current=employeeTotalsV123(adjustments,employee.id,todayISO().slice(0,7));
  const finalTerms=employee.pay_type==='monthly'&&employee.termination_date
    ? finalMonthTermsV123({payType:employee.pay_type,wage:employee.monthly_salary_original,
       hireDate:employee.hire_date,terminationDate:employee.termination_date,
       paidDays:employee.termination_paid_days_v123??null}) : null;
  const finalInsight=finalTerms?.paidDays!==null&&finalTerms
    ? `<div class="staff-insight"><span>أجر شهر الانتهاء · ${esc(finalTerms.month)} · ${finalTerms.paidDays}/${finalTerms.daysInMonth} يومًا</span><strong>${money(finalTerms.basePay,employee.wage_currency_code||'SYP')}</strong></div>` : '';
  host.innerHTML=`<div class="staff-v123-profile-stats">${finalInsight}
      <div class="staff-insight"><span>رصيد السلف المتبقي على الموظف · غير المخصوم من الراتب</span><strong>${esc(advanceText)}</strong></div>
      <div class="staff-insight"><span>\u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a ${year}</span><strong>${leaveTotal}</strong></div>
      <div class="staff-insight"><span>\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a\u0020\u0648\u0627\u0644\u0645\u0643\u0627\u0641\u0622\u062a</span><strong class="staff-v123-positive">+ ${money(current.additions+current.bonuses,employee.wage_currency_code||'SYP')}</strong></div>
      <div class="staff-insight"><span>\u0627\u0644\u062d\u0633\u0645\u064a\u0627\u062a</span><strong class="staff-v123-negative">- ${money(current.deductions,employee.wage_currency_code||'SYP')}</strong></div>
    </div>
    <div class="staff-v124-activity-heading"><div><h4>تفاصيل الحركات وتواريخها</h4>
      <p>السلف والحسميات والمكافآت والإجازات، مرتّبة من الأحدث إلى الأقدم.</p></div></div>
    <div class="table-wrap staff-v124-history-wrap" tabindex="0" aria-label="سجل حركات الموظف"><table class="table staff-v123-detail-table"><thead><tr><th>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</th><th>\u0627\u0644\u0646\u0648\u0639</th><th>\u0627\u0644\u0645\u0628\u0644\u063a</th><th>\u0627\u0644\u0633\u0628\u0628</th><th>\u0627\u0644\u062d\u0627\u0644\u0629</th><th>\u0625\u062c\u0631\u0627\u0621</th></tr></thead>
    <tbody>${[
      ...adjustments.map(a=>({id:a.id,date:a.effective_date,
        kind:adjustmentLabelV123(a)+(a.calc_mode_v127==='hours'?' · '+Number(a.entered_hours_v127)+' ساعة':''),
        amount:Number(a.amount_original||0),currency:a.currency_code,positive:adjustmentKindV123(a)!=='deduction',
        reason:adjustmentReasonV123(a)+(a.calc_mode_v127==='hours'?' · سعر الساعة وقت التسجيل: '+Number(a.hourly_rate_v127).toFixed(4)+' '+currencyLabel(a.currency_code):''),
        status:a.status,note:a.note,action:a.status==='pending'?'adjustment':null})),
      ...leaves.map(l=>({id:l.id,date:l.work_date,kind:employeeLeaveNameV123(l.status),amount:0,currency:employee.wage_currency_code,positive:false,reason:String(l.note||'').replace(/^MARIA_LEAVE_V123:\S*\s*/,'')||'\u2014',status:'recorded',action:String(l.note||'').startsWith('MARIA_LEAVE_V123:')?'leave':null})),
      ...advances.map(a=>({id:a.id,date:String(a.occurred_at||'').slice(0,10),kind:'\u0633\u0644\u0641\u0629',amount:Number(a.principal_original||0),currency:a.currency_code,positive:false,reason:`المتبقي: ${money(a.remaining_original,a.currency_code)}${a.note?' · '+a.note:''}`,status:a.status,action:null})),
    ].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,45).map(r=>`<tr>
      <td>${esc(dateOnly(r.date))}</td><td>${esc(r.kind)}</td>
      <td class="${r.positive?'staff-v123-positive':r.amount?'staff-v123-negative':''}">${r.amount?(r.positive?'+ ':'- ')+money(r.amount,r.currency):'\u2014'}</td>
      <td>${esc(r.reason||'\u2014')}</td><td>${esc(r.status)}</td>
      <td>${r.action==='adjustment'?`<button type="button" class="mini-btn danger-lite" data-v123-void="${esc(r.id)}">\u0625\u0644\u063a\u0627\u0621</button>`:
             r.action==='leave'?`<button type="button" class="mini-btn danger-lite" data-v123-cancel-leave="${esc(r.date)}">\u0625\u0644\u063a\u0627\u0621</button>`:'\u2014'}</td></tr>`).join('')||'<tr><td colspan="6">\u0644\u0627\u0020\u062a\u0648\u062c\u062f\u0020\u062d\u0631\u0643\u0627\u062a</td></tr>'}
    </tbody></table></div>`;
  host.querySelectorAll('[data-v123-void]').forEach(button=>button.onclick=async()=>{
    if(!await confirmBox('\u0647\u0644 \u062a\u0631\u064a\u062f \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0633\u0648\u064a\u0629 \u0642\u0628\u0644 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0631\u0627\u062a\u0628\u061f'))return;
    try{await api.voidEmployeeAdjustmentV123(button.dataset.v123Void,'Removed from employee profile before approval');
      await loadEmployeeInsights(m,employee);toast('\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0633\u0648\u064a\u0629.','success');}
    catch(e){toast(friendlyError(e),'error');}
  });
  host.querySelectorAll('[data-v123-cancel-leave]').forEach(button=>button.onclick=async()=>{
    if(!await confirmBox('\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u0648\u062e\u0635\u0645\u0647\u0627 \u0627\u0644\u0645\u0639\u0644\u0642\u061f'))return;
    try{await api.cancelEmployeeLeaveV123(employee.id,button.dataset.v123CancelLeave);
      await loadEmployeeInsights(m,employee);toast('\u062a\u0645 \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0625\u062c\u0627\u0632\u0629.','success');}
    catch(e){toast(friendlyError(e),'error');}
  });
}

// Compatibility export: employee profile and older integrations keep the same API.
// Both employee profile and payroll now use the dedicated shared implementation.
export function openEmployeeAdjustmentModalV127(...args){
  return sharedEmployeeAdjustmentModalV1271(...args);
}
function openEmployeeLeaveModalV123(employee,onSaved){
 modal({title:'\u0625\u0636\u0627\u0641\u0629 \u0625\u062c\u0627\u0632\u0629 \u0623\u0648 \u063a\u064a\u0627\u0628',subtitle:employee.name,
   body:`<div class="form-grid"><div class="field"><label>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</label><input name="date" type="date" value="${dateInEmployeeServiceV128(employee,todayISO())?todayISO():''}" ${employeeServiceDateInputV128(employee)} required></div>
     <div class="field"><label>\u0627\u0644\u0646\u0648\u0639</label><select name="kind"><option value="paid_leave">\u0625\u062c\u0627\u0632\u0629 \u0645\u062f\u0641\u0648\u0639\u0629</option><option value="unpaid_leave">\u0625\u062c\u0627\u0632\u0629 \u063a\u064a\u0631 \u0645\u062f\u0641\u0648\u0639\u0629</option><option value="absent">\u063a\u064a\u0627\u0628</option></select></div>
     <div class="field full"><label>\u0627\u0644\u0633\u0628\u0628 / \u0645\u0644\u0627\u062d\u0638\u0629</label><textarea name="note" rows="2" maxlength="400"></textarea></div></div>
     <div class="notice rose">\u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u063a\u064a\u0631 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629 \u0648\u0627\u0644\u063a\u064a\u0627\u0628 \u064a\u0648\u0644\u062f\u0627\u0646 \u062e\u0635\u0645\u064b\u0627 \u0645\u062d\u0633\u0648\u0628\u064b\u0627 \u0644\u0644\u0645\u0648\u0638\u0641 \u0627\u0644\u0634\u0647\u0631\u064a. \u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629 \u0644\u0627 \u062a\u0646\u0642\u0635 \u0627\u0644\u0631\u0627\u062a\u0628.</div>`,
   onSubmit:async fd=>{try{if(!dateInEmployeeServiceV128(employee,String(fd.get('date')||'')))throw Error('تاريخ الإجازة خارج فترة تعيين الموظف وانتهاء عمله.');
     await api.recordEmployeeLeaveV123({employeeId:employee.id,date:fd.get('date'),kind:fd.get('kind'),note:fd.get('note')});
     toast('\u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0625\u062c\u0627\u0632\u0629.','success');await onSaved();return true;
   }catch(e){toast(friendlyError(e),'error');return false;}}
 });
}
function openEmployeeRemovalV123(root,employee,profileModal){
 modal({title:'\u062d\u0630\u0641 \u0627\u0644\u0645\u0648\u0638\u0641',
   subtitle:employee.name,
   body:`<div class="notice rose">\u0627\u0644\u062d\u0630\u0641 \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0645\u062a\u0627\u062d \u0641\u0642\u0637 \u0625\u0630\u0627 \u0644\u0645 \u062a\u0648\u062c\u062f \u062d\u0631\u0643\u0627\u062a \u0645\u0627\u0644\u064a\u0629. \u0639\u0646\u062f \u0648\u062c\u0648\u062f\u0647\u0627 \u0633\u064a\u064f\u0624\u0631\u0634\u0641 \u0627\u0644\u0645\u0648\u0638\u0641 \u0648\u064a\u062e\u062a\u0641\u064a \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629\u060c \u0645\u0639 \u062d\u0641\u0638 \u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0645\u062d\u0627\u0633\u0628\u064a.</div>
   <div class="field"><label>\u0627\u0643\u062a\u0628 \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u0638\u0641 \u0644\u0644\u062a\u0623\u0643\u064a\u062f</label><input name="confirmation" required autocomplete="off" placeholder="${esc(employee.name)}"></div>`,
   submitText:'\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u062d\u0630\u0641',
   onSubmit:async fd=>{try{
     if(String(fd.get('confirmation')||'').trim()!==String(employee.name).trim())throw new Error('\u0627\u0644\u0627\u0633\u0645 \u063a\u064a\u0631 \u0645\u0637\u0627\u0628\u0642.');
     const result=await api.removeEmployeeV123(employee.id);
     toast(result==='deleted_permanently'?'\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0645\u0648\u0638\u0641 \u0646\u0647\u0627\u0626\u064a\u064b\u0627.':'\u062a\u0645 \u0623\u0631\u0634\u0641\u0629 \u0627\u0644\u0645\u0648\u0638\u0641 \u0644\u0648\u062c\u0648\u062f \u062d\u0631\u0643\u0627\u062a \u0645\u0627\u0644\u064a\u0629.','success');
     await profileModal.close();await renderEmployees(root);return true;
   }catch(e){toast(friendlyError(e),'error');return false;}}
 });
}
