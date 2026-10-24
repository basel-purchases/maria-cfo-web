import * as api from '../api.js?v=1.0.10';
import {modal, toast, loader, friendlyError, confirmBox} from '../ui.js?v=1.0';
import {currencyLabel, esc, money, dateOnly, todayISO} from '../utils.js?v=1.0';
import {employeeName} from '../payroll-ui.js?v=1.0';
import {BONUS_REASONS_V032, BONUS_STATUS_V032, validateBonusV032, bonusTotalsV032} from '../bonus-policy-v032.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {employeeDirectoryScoreV033} from '../staff-ux-v033.js?v=1.0';

const PAGE_SIZE=20;
const niceError=e=>{
 const msg=String(e?.message||e||'').toUpperCase();
 const errors={
  BONUS_ALREADY_RECORDED_V032:'هذه المكافأة مسجلة بالفعل بنفس المبلغ والتاريخ والسبب والملاحظة. يمكنك مراجعتها في الجدول.',
  BONUS_PERIOD_ALREADY_APPROVED_V032:'هذا التاريخ مرتبط براتب معتمد. لا يمكن إضافتها بأثر رجعي؛ اختر فترة راتب لم تُعتمد بعد.',
  BONUS_FIXED_PAY_UNSUPPORTED_V032:'لا يمكن احتساب المكافآت في الأجر المقطوع حاليًا. اختر موظفًا شهريًا أو يوميًا أو ساعيًا.',
  BONUS_ALREADY_APPROVED_OR_VOID_V032:'المكافأة دخلت في راتب معتمد أو أُلغيت مسبقًا؛ لا يمكن حذف أثرها المالي.',
  BONUS_VOID_REASON_REQUIRED_V032:'اكتب سبب إلغاء واضحًا لا يقل عن 3 أحرف.',
  BONUS_EMPLOYEE_NOT_ACTIVE_V032:'الموظف غير نشط. فعّله من بطاقة الموظف قبل إضافة مكافأة.',
  BONUS_DATE_OUTSIDE_EMPLOYMENT_V032:'تاريخ المكافأة خارج فترة عمل الموظف.',
  INVALID_BONUS_EFFECTIVE_DATE_V032:'تاريخ المكافأة غير مقبول (لا يمكن اختياره أبعد من سنة قادمة).',
  V032_REQUIRES_EXISTING_PAYROLL_AND_V031_MIGRATIONS:'يجب تشغيل ترحيل SQL للإصدارين v0.31 وv0.32 بالترتيب.',
 };
 for(const [key, value] of Object.entries(errors))if(msg.includes(key))return value;
 if(msg.includes('RECORD_EMPLOYEE_BONUS_V032')||msg.includes('VOID_PENDING_EMPLOYEE_BONUS_V032')||msg.includes('PGRST202'))
  return 'فعّل تحديث قاعدة البيانات v0.32 في Supabase أولًا، ثم أعد تحميل الصفحة.';
 return friendlyError(e);
};

export function openEmployeeBonusModal({staff=[],employeeId='',onSaved=()=>{}}={}){
 const eligible=staff.filter(e=>e.status==='active'&&e.pay_type!=='fixed');
 if(!eligible.length){toast('لا يوجد موظفون نشطون بنوع أجر مدعوم للمكافآت.','error');return;}
 const options=eligible.map(e=>`<option value="${esc(e.id)}" data-search="${esc([e.job_title,e.department,e.residence_v031,e.mobile_phone_v031].filter(Boolean).join(' '))}">${esc(e.name)} · ${esc(currencyLabel(e.wage_currency_code||'SYP'))}</option>`).join('');
 const m=modal({
  title:'منح مكافأة موظف',
  subtitle:'تُضاف إلى مستحقات مسير الراتب المناسب، ولا تُصرف من الصندوق الآن.',
  submitText:'تسجيل المكافأة',
  body:`<div class="notice green">الخطوات: سجّل المكافأة ← راجعها في سجل المكافآت ← حدّث مسودة المسير إن وُجدت ← اعتمد الراتب واصرفه كالمعتاد.</div>
    <div class="form-grid">
      <div class="field full"><label>الموظف</label><select name="employee" required>${options}</select><small class="hint">اكتب الاسم أو الوظيفة أو رقم الهاتف، ثم اختر الموظف من النتائج.</small></div>
      <div class="field"><label>المبلغ</label><input type="number" name="amount" min="0.0001" max="1000000000000" step="any" inputmode="decimal" required placeholder="0"></div>
      <div class="field"><label>العملة</label><div class="employee-bonus-currency" aria-live="polite"></div></div>
      <div class="field"><label>تاريخ الاستحقاق</label><input type="date" name="date" value="${todayISO()}" required></div>
      <div class="field"><label>سبب المكافأة</label><select name="reason" required>${BONUS_REASONS_V032.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>
      <div class="field full"><label>ملاحظة (اختيارية)</label><textarea name="note" rows="2" maxlength="500" placeholder="مثال: وردية نهاية الأسبوع أو تقييم الأداء"></textarea></div>
    </div>
    <p class="metric-note">المكافأة في عملة راتب الموظف. الموظف ذو الأجر المقطوع مستبعد لأن نظام صرفه الحالي لا يضيف المكافآت تلقائيًا.</p>`,
  onSubmit: async fd=>{
   try{
    const employee=eligible.find(e=>String(e.id)===String(fd.get('employee')));
    const input=validateBonusV032({employee, amount:fd.get('amount'), effectiveDate:fd.get('date'), reason:fd.get('reason'), note:fd.get('note')});
    await api.recordEmployeeBonusV032(input);
    toast('تم تسجيل المكافأة ضمن مستحقات الراتب، دون صرف نقدي.','success');
    await onSaved();
    return true;
   }catch(e){toast(niceError(e),'error');return false;}
  },
 });
 const select=m.form.elements.namedItem('employee');
 if(employeeId && eligible.some(e=>String(e.id)===String(employeeId)))select.value=String(employeeId);
 const badge=m.form.querySelector('.employee-bonus-currency');
 const sync=()=>{
  const employee=eligible.find(e=>String(e.id)===String(select.value));
  badge.innerHTML=employee?`<strong class="staff-currency-chip">${esc(currencyLabel(employee.wage_currency_code||'SYP'))}</strong><small class="hint"> نفس عملة راتب الموظف </small>`:'<span class="hint">اختر الموظف لتحديد عملة راتبه.</span>';
 };
 select.addEventListener('change',sync);sync();
 return m;
}

export async function renderBonusesV032(root){
 root.innerHTML=loader();
 try{
  const [staff,bonuses]=await Promise.all([api.employees(),api.employeeBonusesV032()]);
  const employeeById=new Map(staff.map(e=>[String(e.id),e]));
  const state={employeeQuery:'',status:'all',month:'',page:1};
  root.innerHTML=`<div class="page-head"><div><h2>مكافآت الموظفين</h2><p>تُضاف المكافآت إلى مسير الرواتب ولا تُخرج نقودًا من الصندوق عند تسجيلها. كل تغيير يترك أثرًا واضحًا.</p></div>
    <div class="quick-actions"><button class="btn add-bonus" type="button">+ مكافأة جديدة</button><a class="btn secondary" href="#/payroll">مسيرات الرواتب</a></div></div>
    <div class="grid cols-3 staff-stats-grid">
      <div class="card"><div class="metric-label">مكافآت تنتظر المسير</div><div class="metric-value" id="bonus-pending-count">0</div><div class="metric-note">لم تدخل بعد في راتب معتمد</div></div>
      <div class="card"><div class="metric-label">القيمة المعلقة حسب العملة</div><div id="bonus-pending-value" class="staff-metric-values">—</div></div>
      <div class="card"><div class="metric-label">حالات المكافآت</div><div id="bonus-status-breakdown" class="staff-metric-values">—</div></div>
    </div>
    <div class="card staff-filter-card"><div class="form-grid">
      <div class="field"><label for="bonus-staff-filter">بحث عن الموظف</label><input type="search" id="bonus-staff-filter" autocomplete="off" placeholder="الاسم أو الوظيفة أو رقم الموبايل" aria-label="بحث عن الموظف في المكافآت"></div>
      <div class="field"><label>الحالة</label><select id="bonus-status-filter"><option value="all">كل الحالات</option><option value="pending">بانتظار المسير</option><option value="applied">ضمن راتب معتمد</option><option value="voided">ملغاة</option></select></div>
      <div class="field"><label>شهر الاستحقاق (اختياري)</label><input id="bonus-month-filter" type="month"></div>
      <div class="field staff-filter-guidance"><p class="metric-note">يمكنك التصفية ثم تصدير السجل إلى Excel أو PDF.</p></div>
    </div></div>
    <div class="card"><div class="finance-section-head"><div><h3>سجل المكافآت</h3><p>المكافأة المعلقة يمكن إلغاؤها بسبب واضح؛ المكافأة المعتمدة محفوظة ضمن الراتب ولا تُحذف.</p></div><span id="bonus-visible-count" class="badge"></span></div><div id="bonus-table"></div></div>
    <div class="notice rose"><strong>متى تُدفع المكافأة؟</strong> بعد إضافتها، تدخل في حساب مسير الشهر إذا كان الموظف شهريًا، أو في أجر اليوم المحدد إذا كان يوميًا/ساعيًا. إن كان مسير الشهر مسودة قديمة اضغط «تحديث» قبل «اعتماد». لا يحدث صرف مستقل من هذا القسم.</div>`;

  const draw=()=>{
   const filtered=bonuses.filter(b=>(!state.employeeQuery||employeeDirectoryScoreV033(employeeById.get(String(b.employee_id)),state.employeeQuery)>=0)
      &&(state.status==='all'||b.status===state.status)
      &&(!state.month||String(b.effective_date||'').startsWith(state.month)));
   const pending=filtered.filter(b=>b.status==='pending');
   const applied=filtered.filter(b=>b.status==='applied').length;
   const voided=filtered.filter(b=>b.status==='voided').length;
   const sums=bonusTotalsV032(filtered);
   root.querySelector('#bonus-pending-count').textContent=String(pending.length);
   root.querySelector('#bonus-pending-value').innerHTML=[...sums].map(([currency,value])=>`<strong class="pay-total-chip">${money(value,currency)}</strong>`).join(' ')||'لا توجد مبالغ معلقة';
   root.querySelector('#bonus-status-breakdown').innerHTML=`${filtered.length} إجمالي · ${applied} معتمدة · ${voided} ملغاة`;
   root.querySelector('#bonus-visible-count').textContent=`${filtered.length} سجل`;
   const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));state.page=Math.min(pages,Math.max(1,state.page));
   const showing=filtered.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);
   const host=root.querySelector('#bonus-table');
   host.innerHTML=filtered.length?`<div class="table-wrap"><table class="table staff-bonuses-table">
    <thead><tr><th>الموظف</th><th>تاريخ الاستحقاق</th><th>السبب</th><th>المكافأة</th><th>الحالة</th><th>ملاحظة</th><th>إجراء</th></tr></thead>
    <tbody>${showing.map(b=>{
     const employee=employeeById.get(String(b.employee_id));
     const badge=b.status==='applied'?'green':b.status==='voided'?'red':'yellow';
     return `<tr><td>${employeeName(employee?.name||'موظف',employee?.pay_type)}</td>
      <td>${dateOnly(b.effective_date)}</td><td>${esc(b.reason||'—')}</td>
      <td><strong>${money(b.amount_original,b.currency_code)}</strong></td>
      <td><span class="badge ${badge}">${esc(BONUS_STATUS_V032[b.status]||b.status)}</span></td>
      <td>${esc(b.status==='voided'?(b.void_reason||b.note||'—'):(b.note||'—'))}</td>
      <td>${b.status==='pending'?`<button type="button" class="mini-btn danger-lite" data-void-bonus="${esc(b.id)}">إلغاء</button>`:'—'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="pagination-bar"><button class="mini-btn" id="bonus-prev" ${state.page===1?'disabled':''}>السابق</button>
      <span>صفحة ${state.page} من ${pages} · إجمالي ${filtered.length}</span>
      <button class="mini-btn" id="bonus-next" ${state.page===pages?'disabled':''}>التالي</button></div>`
      :'<div class="empty"><strong>لا توجد مكافآت تطابق الفلتر.</strong><div>جرّب تغيير الموظف أو الحالة أو الشهر، أو أضف مكافأة جديدة.</div></div>';
   const table=host.querySelector('table');
   if(table)registerTableExport(table,()=>({title:'مكافآت الموظفين',
      headers:['الموظف','الاستحقاق','السبب','المكافأة','العملة','الحالة','ملاحظة'],
      rows:filtered.map(b=>{const employee=employeeById.get(String(b.employee_id));return [employee?.name||'موظف',dateOnly(b.effective_date),b.reason,Number(b.amount_original||0),b.currency_code,BONUS_STATUS_V032[b.status]||b.status,b.status==='voided'?b.void_reason:b.note];})}));
   host.querySelector('#bonus-prev')?.addEventListener('click',()=>{state.page--;draw();});
   host.querySelector('#bonus-next')?.addEventListener('click',()=>{state.page++;draw();});
   host.querySelectorAll('[data-void-bonus]').forEach(btn=>btn.addEventListener('click',async()=>{
      const bonus=bonuses.find(b=>String(b.id)===String(btn.dataset.voidBonus));
      if(!bonus || bonus.status!=='pending')return;
      const employee=employeeById.get(String(bonus.employee_id));
      const m=modal({title:'إلغاء مكافأة معلقة',submitText:'إلغاء المكافأة',
       subtitle:'لن تُحذف المكافأة من السجل. ستبقى بحالة «ملغاة» وسبب الإلغاء.',
       body:`<div class="notice rose"><strong>${esc(employee?.name||'موظف')}</strong> · ${money(bonus.amount_original,bonus.currency_code)} · ${dateOnly(bonus.effective_date)}</div>
        <div class="field"><label>سبب الإلغاء (إلزامي)</label><textarea name="reason" required minlength="3" maxlength="250" rows="2" placeholder="لماذا لم تعد المكافأة مستحقة؟"></textarea></div>`,
       onSubmit:async fd=>{
        try{await api.voidEmployeeBonusV032(bonus.id,String(fd.get('reason')||'').trim());
          toast('أُلغيت المكافأة مع حفظ سبب الإلغاء.','success');await renderBonusesV032(root);return true;
        }catch(e){toast(niceError(e),'error');return false;}
       },
      });
   }));
  };
  const bind=(id,key)=>root.querySelector(id).addEventListener('change',e=>{state[key]=e.target.value;state.page=1;draw();});
  root.querySelector('#bonus-staff-filter').addEventListener('input',e=>{state.employeeQuery=e.target.value;state.page=1;draw();});
  bind('#bonus-status-filter','status');bind('#bonus-month-filter','month');
  root.querySelector('.add-bonus').onclick=()=>openEmployeeBonusModal({staff,onSaved:()=>renderBonusesV032(root)});
  draw();
 }catch(e){root.innerHTML=`<div class="notice">${esc(niceError(e))}</div><a class="btn secondary" href="#/employees-list">الموظفون</a>`;}
}
