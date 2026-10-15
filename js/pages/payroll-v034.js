import * as api from '../api.js?v=1.0';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=1.0';
import {currencyLabel,esc,money,dateOnly,todayISO} from '../utils.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {monthStartV034,filterPayrollReadyV034,currencyGroupsV034} from '../payroll-workbench-v034.js?v=1.0';

const MONTH_NAMES=['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
const PAY_TYPE={monthly:'شهري',daily:'يومي',hourly:'ساعي',fixed:'مقطوع'};
const compact=(v,c)=>money(Number(v)||0,c);
const fixedRate=e=>Number(e.fixed_pay_original_v023||0);
const empty=message=>`<div class="empty"><strong>${esc(message)}</strong></div>`;
const options=(arr,selected)=>arr.map(([id,label])=>`<option value="${esc(id)}" ${String(id)===String(selected)?'selected':''}>${esc(label)}</option>`).join('');
const amountGroup=(rows,key)=>currencyGroupsV034(rows,key).map(x=>`<span class="payroll-currency-v034">${money(x.amount,x.currency_code)}</span>`).join(' ')||'<span class="metric-note">لا توجد مبالغ</span>';
const rowMonth=(row,start)=>String(row.period_start||row.work_date||'').startsWith(start.slice(0,7));

export async function renderPayrollV034(root){
 const today=todayISO();
 const state={year:Number(today.slice(0,4)),month:Number(today.slice(5,7)),tab:'ready',status:'all',query:'',box:'',ready:[],paid:[],daily:[],fixed:[],runs:[],staff:[],boxes:[],busy:false};
 root.innerHTML=`<div class="page-head"><div><h2>الرواتب · مركز الدفع</h2><p>كشف واحد للمراجعة ثم الاعتماد والدفع. كل مبلغ مصروف يذهب إلى سجل المدفوعات وحركة الصندوق تلقائيًا.</p></div>
 <div class="quick-actions"><a class="btn secondary" href="#/employees-list">الموظفون</a><a class="btn secondary" href="#/advances">السلف</a><a class="btn secondary" href="#/bonuses">المكافآت</a></div></div>
 <section class="card payroll-controller-v034">
  <div class="payroll-filter-grid-v034">
   <div class="field"><label for="payroll-month-v034">الشهر</label><select id="payroll-month-v034">${MONTH_NAMES.map((name,i)=>`<option value="${i+1}" ${i+1===state.month?'selected':''}>${name}</option>`).join('')}</select></div>
   <div class="field"><label for="payroll-year-v034">السنة</label><select id="payroll-year-v034">${Array.from({length:9},(_,i)=>[state.year-4+i,state.year-4+i]).map(([y,l])=>`<option value="${y}" ${y===state.year?'selected':''}>${y}</option>`).join('')}</select></div>
   <div class="field"><label for="payroll-box-v034">صندوق الدفع</label><select id="payroll-box-v034"></select><small class="hint">الصندوق العام هو الافتراضي. الاختيار هنا يخص العملية فقط.</small></div>
   <div class="payroll-toolbar-v034"><button type="button" class="btn secondary" id="payroll-refresh-v034">تحديث البيانات ↻</button></div>
  </div>
  <div class="payroll-tabs-v034" role="tablist" aria-label="حالة الرواتب">
   <button type="button" role="tab" aria-selected="true" class="payroll-tab-v034 active" data-pay-tab="ready">الرواتب الجاهزة للدفع</button>
   <button type="button" role="tab" aria-selected="false" class="payroll-tab-v034" data-pay-tab="paid">الرواتب المدفوعة</button>
  </div>
 </section>
 <div id="payroll-data-v034">${loader()}</div>`;
 const panel=root.querySelector('#payroll-data-v034');
 const boxSelect=root.querySelector('#payroll-box-v034');
 const monthInput=root.querySelector('#payroll-month-v034'),yearInput=root.querySelector('#payroll-year-v034');
 const currBox=()=>state.boxes.find(b=>String(b.id)===state.box);
 const mayPay=()=>Boolean(currBox()?.is_active);
 const errorMessage=e=>{
  const s=String(e?.message||'');
  if(/PAYROLL_NOT_APPROVED/.test(s))return 'يجب اعتماد المسير قبل دفع راتب الموظف.';
  if(/PAYROLL_CASHBOX_INVALID/.test(s))return 'اختر صندوقًا نشطًا لدفع الراتب.';
  if(/INVALID_SALARY_PAYMENT_AMOUNT/.test(s))return 'تغيّر الرصيد أو المبلغ غير صالح. حدّث البيانات قبل المحاولة.';
  if(/DAILY_WAGE_ALREADY_SETTLED|DAILY_WAGE_ALREADY_PREPARED/.test(s))return 'سبق احتساب أو دفع أجر هذا اليوم. حدّث الجدول.';
  if(/MONTHLY_PAYROLL_ALREADY_EXISTS/.test(s))return 'يوجد مسير لهذا الشهر بالفعل. حدّث المسودة أو اعتمدها.';
  if(/PGRST202|payroll_ready_v034|payroll_paid_v034/i.test(s))return 'يلزم تشغيل تحديث SQL الخاص بالإصدار v0.34 أولًا.';
  return friendlyError(e,s||'تعذرت العملية');
 };
 const updateBoxes=()=>{
  const active=state.boxes.filter(x=>x.is_active);
  if(!active.some(b=>String(b.id)===state.box))state.box=String((active.find(b=>b.is_general)||active[0])?.id||'');
  boxSelect.innerHTML=options(active.map(x=>[x.id,x.name+(x.is_general?' · العام':'')]),state.box);
  if(!active.length)boxSelect.innerHTML='<option value="">لا يوجد صندوق نشط</option>';
 };
 async function load(){
  if(state.busy)return;
  state.busy=true;panel.innerHTML=loader();
  try{
   const start=monthStartV034(state.year,state.month);
   const [ready,paid,staff,boxes,runs,daily]=await Promise.all([
    api.payrollReadyV034(start),api.payrollPaidV034(start),api.employees(),api.cashboxes(),
    api.list('payroll_runs',{order:'period_start',limit:500}),api.dailyWageDues().catch(()=>[]),
   ]);
   state.ready=Array.isArray(ready)?ready:[];state.paid=Array.isArray(paid)?paid:[];
   state.staff=staff;state.boxes=boxes;state.runs=runs.filter(r=>r.note?.startsWith('MARIA_MONTHLY_V014:')&&rowMonth(r,start));
   state.daily=daily.filter(r=>String(r.work_date||'').startsWith(start.slice(0,7))&&Number(r.estimated_due_original)>0);
   state.fixed=staff.filter(e=>e.status==='active'&&e.pay_type==='fixed');
   updateBoxes();paint();
  }catch(e){panel.innerHTML=`<div class="notice"><strong>تعذر تحميل كشف الرواتب</strong><div>${esc(errorMessage(e))}</div></div>`;}
  finally{state.busy=false;}
 }
 function tabs(){
  root.querySelectorAll('[data-pay-tab]').forEach(b=>{const active=b.dataset.payTab===state.tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
 }
 function paint(){
  tabs();panel.innerHTML=state.tab==='ready'?readyHtml():paidHtml();
  state.tab==='ready'?bindReady():bindPaid();
 }
 const draftMonths=()=>state.runs.filter(r=>r.status==='draft');
 function readyHtml(){
  const month=monthStartV034(state.year,state.month);
  const salaryRows=filterPayrollReadyV034(state.ready,state.query);
  const shown=salaryRows.filter(r=>state.status==='all'||
     (state.status==='ready'&&r.payable)||(state.status==='draft'&&r.isDraft)||
     (state.status==='partial'&&r.paid>0&&r.remaining>0));
  const payable=salaryRows.filter(r=>r.payable);
  const selectedMonth=`${MONTH_NAMES[state.month-1]} ${state.year}`;
  const runs=draftMonths();
  const noBox=!mayPay();
  return `<div class="payroll-flow-v034"><span><b>1</b> حساب المسير</span><span>←</span><span><b>2</b> اعتماد المستحقات</span><span>←</span><span><b>3</b> الدفع من الصندوق</span></div>
  ${noBox?'<div class="notice">يجب وجود صندوق نشط قبل تسجيل أي دفعة. يمكنك فتح قسم الصناديق من التشغيل اليومي.</div>':''}
  <div class="grid cols-3 payroll-metrics-v034">
    <div class="card"><div class="metric-label">المستحقات المعتمدة المتبقية · ${esc(selectedMonth)}</div><div class="metric-value">${payable.length} موظف</div><div class="metric-note">${amountGroup(payable,'remaining')}</div></div>
    <div class="card"><div class="metric-label">مسيرات بانتظار الاعتماد</div><div class="metric-value">${runs.length}</div><div class="metric-note">لن يعمل زر دفع لمستحق غير معتمد.</div></div>
    <div class="card"><div class="metric-label">أجور يومية بانتظار الدفع</div><div class="metric-value">${state.daily.length}</div><div class="metric-note">تُحسب قيمتها النهائية على الخادم قبل الصرف.</div></div>
  </div>
  <section class="card finance-section payroll-ready-card-v034">
    <div class="finance-section-head"><div><h3>كشف الموظفين والمستحقات</h3><p>الراتب الأساسي، الإضافي، المكافآت، السلف والخصم والصافي في سطر واحد. المبالغ من حساب قاعدة البيانات المعتمد.</p></div>
    <button class="btn" id="new-month-run-v034" type="button" ${!state.staff.some(e=>e.pay_type==='monthly')?'disabled':''}>+ إنشاء مسير ${esc(selectedMonth)}</button></div>
    ${runs.map(r=>`<div class="payroll-run-alert-v034"><div><strong>مسودة ${dateOnly(r.period_start)} — ${dateOnly(r.period_end)}</strong><small>المسودة ليست إذن صرف. بعد تعديل الدوام أو المكافآت، حدّث الحساب ثم اعتمد.</small></div>
      <div class="quick-actions"><button class="btn secondary" data-run-recalc="${esc(r.id)}">إعادة احتساب</button><button class="btn" data-run-approve="${esc(r.id)}" ${state.ready.some(x=>String(x.payroll_run_id)===String(r.id)&&Number(x.missing_attendance_days)>0)?'disabled title="توجد أيام دوام ناقصة"':''}>اعتماد المسير</button></div></div>`).join('')}
    <div class="payroll-list-tools-v034"><div class="field"><label>البحث بالاسم</label><input id="payroll-find-v034" type="search" value="${esc(state.query)}" placeholder="اسم الموظف..."></div>
     <div class="field"><label>عرض</label><select id="payroll-status-v034">${options([['all','الكل'],['ready','جاهز للدفع'],['draft','مسودة'],['partial','مدفوع جزئيًا']],state.status)}</select></div>
     <span class="metric-note">${shown.length} نتيجة · التصدير يشمل جميع نتائج هذا الفلتر</span></div>
    ${shown.length?`<div class="table-wrap"><table class="table payroll-statement-table-v034"><thead><tr>
      <th>الموظف</th><th>الراتب المستحق</th><th>إضافي</th><th>المكافآت</th><th>السلف</th><th>الخصم</th><th>صافي الراتب</th><th>المدفوع</th><th>الباقي للدفع</th><th>ملاحظات / حالة</th><th>دفع</th>
      </tr></thead><tbody>${shown.map(r=>`<tr class="${r.payable?'payroll-row-payable-v034':''}">
      <td><strong>${esc(r.employee_name)}</strong><small>${esc(PAY_TYPE[r.pay_type]||r.pay_type||'—')}</small></td>
      <td>${compact(r.base,r.currency_code)}</td><td>${compact(r.overtime,r.currency_code)}</td><td class="payroll-positive-v034">+ ${compact(r.bonuses,r.currency_code)}</td>
      <td>${compact(r.advances,r.currency_code)}</td><td>${compact(r.deductions+r.shortage,r.currency_code)}</td>
      <td><strong>${compact(r.net,r.currency_code)}</strong></td><td>${compact(r.paid,r.currency_code)}</td>
      <td><strong>${compact(r.remaining,r.currency_code)}</strong></td>
      <td><small>${esc(r.note||'—')}</small><div><span class="badge ${r.isDraft?'yellow':r.remaining>0?'green':''}">${r.isDraft?'مسودة · غير معتمدة':r.remaining<=.0001?'مسدد':'معتمد'}</span>${Number(r.missing_attendance_days)>0?`<small class="payroll-danger-v034">⚠ ${r.missing_attendance_days} أيام دوام ناقصة</small>`:''}</div></td>
      <td><button class="btn pay-salary-v034" data-id="${esc(r.payroll_item_id)}" ${!r.payable||noBox?'disabled':''}>دفع</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد مسيرات أو مستحقات مطابقة في هذه الفترة. أنشئ مسيرًا ثم اعتمده.')}
  </section>
  <section class="card finance-section"><div class="finance-section-head"><div><h3>الأجور اليومية والساعية</h3><p>يمكن دفعها مباشرة بعد تسجيل الدوام. المبلغ المعروض تقديري قبل حساب المستحقات النهائي.</p></div><a href="#/attendance" class="btn secondary">تسجيل الدوام</a></div>
  ${state.daily.length?`<div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>اليوم</th><th>الساعات</th><th>التقديري</th><th>الملاحظات</th><th>دفع</th></tr></thead><tbody>
    ${state.daily.map(d=>`<tr><td>${esc(d.employee_name)}</td><td>${dateOnly(d.work_date)}</td><td>${esc(d.worked_hours)} / ${esc(d.expected_hours)}</td><td>${compact(d.estimated_due_original,d.currency_code)}</td><td>${esc(d.review_note||'—')}</td><td><button class="btn pay-day-v034" data-employee="${esc(d.employee_id)}" data-date="${esc(d.work_date)}" ${noBox?'disabled':''}>دفع</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد أجور يومية مستحقة للشهر المحدد.')}</section>
  ${state.fixed.length?`<section class="card finance-section"><div class="finance-section-head"><div><h3>الأجور المقطوعة</h3><p>تصرف عند اكتمال العمل وليس كراتب شهري تلقائي. تأكد من تاريخ العمل قبل الدفع.</p></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>الأجر</th><th>الحالة</th><th>الصرف</th></tr></thead><tbody>${state.fixed.map(e=>`<tr><td>${esc(e.name)}</td><td>${compact(fixedRate(e),e.wage_currency_code)}</td><td><span class="badge">مقطوع</span></td><td><button class="btn pay-fixed-v034" data-id="${esc(e.id)}" ${noBox?'disabled':''}>صرف أجر</button></td></tr>`).join('')}</tbody></table></div></section>`:''}`;
 }
 function paidHtml(){
  return `<section class="card finance-section"><div class="finance-section-head"><div><h3>الرواتب المدفوعة · ${esc(MONTH_NAMES[state.month-1])} ${state.year}</h3><p>الدفع المسجل حقيقي وله حركة صندوق؛ يعرض هذا التبويب تاريخ القبض الفعلي، وليس تاريخ المسير فقط.</p></div></div>
  <div class="grid cols-3 payroll-metrics-v034"><div class="card"><div class="metric-label">عدد حركات الصرف</div><div class="metric-value">${state.paid.length}</div></div><div class="card"><div class="metric-label">إجمالي المصروف حسب العملة</div><div class="metric-note">${amountGroup(state.paid,'amount_original')}</div></div><div class="card"><div class="metric-label">سجل محمي</div><div class="metric-note">تُراجع التعديلات المالية بواسطة الصندوق والمسير، لا بحذف صف من هذا الجدول.</div></div></div>
  ${state.paid.length?`<div class="table-wrap"><table class="table payroll-paid-table-v034"><thead><tr><th>الموظف</th><th>التاريخ</th><th>الفترة المستحقة</th><th>النوع</th><th>المبلغ المقبوض</th><th>المكافآت ضمن المسير</th><th>خصم السلف</th><th>الصندوق</th><th>ملاحظات</th></tr></thead><tbody>
    ${state.paid.map(p=>`<tr><td><strong>${esc(p.employee_name)}</strong></td><td>${dateOnly(p.paid_at)}</td><td>${dateOnly(p.period_start)} — ${dateOnly(p.period_end)}</td><td>${esc(PAY_TYPE[p.payment_kind]||p.payment_kind||'—')}</td><td><strong>${compact(p.amount_original,p.currency_code)}</strong></td><td>${compact(p.bonus_original,p.currency_code)}</td><td>${compact(p.advance_deduction_original,p.currency_code)}</td><td>${esc(state.boxes.find(b=>String(b.id)===String(p.cashbox_id))?.name||'—')}</td><td>${esc(p.note||'—')}</td></tr>`).join('')}</tbody></table></div>`:empty('لم تُسجَّل دفعات في الشهر المختار.')}
  </section>`;
 }
 const cashName=()=>currBox()?.name||'—';
 const freeze=fn=>async()=>{if(state.busy)return;state.busy=true;try{await fn();}finally{state.busy=false;}};
 function bindReady(){
  const table=panel.querySelector('.payroll-statement-table-v034');
  if(table)registerTableExport(table,()=>{
   const rows=filterPayrollReadyV034(state.ready,state.query).filter(r=>state.status==='all'||(state.status==='ready'&&r.payable)||(state.status==='draft'&&r.isDraft)||(state.status==='partial'&&r.paid>0&&r.remaining>0));
   return {title:`كشف الرواتب المستحقة ${MONTH_NAMES[state.month-1]} ${state.year}`,headers:['الموظف','نوع الأجر','الراتب','الإضافي','المكافآت','السلف','الخصومات','الصافي','المدفوع','الباقي','الحالة','ملاحظات'],rows:rows.map(r=>[r.employee_name,PAY_TYPE[r.pay_type]||r.pay_type,r.base,r.overtime,r.bonuses,r.advances,r.shortage+r.deductions,r.net,r.paid,r.remaining,r.isDraft?'مسودة':r.remaining>0?'معتمد':'مسدد',r.note||''])};
  });
  panel.querySelector('#payroll-find-v034')?.addEventListener('input',e=>{state.query=e.target.value;const point=e.target.selectionStart;paint();const newInput=panel.querySelector('#payroll-find-v034');newInput?.focus();try{newInput?.setSelectionRange(point,point);}catch(_){} });
  panel.querySelector('#payroll-status-v034')?.addEventListener('change',e=>{state.status=e.target.value;paint();});
  panel.querySelector('#new-month-run-v034')?.addEventListener('click',()=>modal({title:'إنشاء مسير رواتب شهري',subtitle:'يبدأ مسودة للمراجعة. لا تُصرف أي أموال بمجرد الإنشاء.',submitText:'إنشاء المسودة',
    body:`<div class="notice rose">${MONTH_NAMES[state.month-1]} ${state.year} · سيُحتسب الموظفون الشهريون فقط. يجب تسجيل الدوام قبل الاعتماد.</div>`,
    onSubmit:async()=>{try{await api.createMonthlyPayroll(state.year,state.month);toast('تم إنشاء المسير. راجع التفاصيل واعتمدها قبل الدفع.','success');await load();return true;}catch(e){toast(errorMessage(e),'error');return false;}}
  }));
  panel.querySelectorAll('[data-run-recalc]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api.recalculateMonthlyPayroll(b.dataset.runRecalc);toast('تم تحديث المسودة بالمكافآت والسلف والخصومات.','success');await load();}catch(e){toast(errorMessage(e),'error');}finally{b.disabled=false;}});
  panel.querySelectorAll('[data-run-approve]').forEach(b=>b.onclick=async()=>{
   if(!await confirmBox('اعتماد هذا المسير سيثبّت مستحقات الموظفين. تأكد من السلف والمكافآت والدوام؛ لا تُصرف أموال بعد الاعتماد.','اعتماد المسير'))return;
   b.disabled=true;try{await api.approveMonthlyPayroll(b.dataset.runApprove);toast('تم الاعتماد. أصبحت الرواتب جاهزة للدفع.','success');await load();}catch(e){toast(errorMessage(e),'error');}finally{b.disabled=false;}
  });
  panel.querySelectorAll('.pay-salary-v034').forEach(b=>b.onclick=()=>{
   const r=filterPayrollReadyV034(state.ready).find(x=>String(x.payroll_item_id)===b.dataset.id);if(!r||!r.payable||!mayPay())return;
   modal({title:'تأكيد دفع راتب',subtitle:'عملية واحدة تسجّل حركة النقد والقبض معًا. يمكن دفع مبلغ جزئي أيضًا.',submitText:'تأكيد الدفع من الصندوق',
    body:`<div class="payroll-pay-dialog-v034"><strong>${esc(r.employee_name)}</strong><span>${esc(MONTH_NAMES[state.month-1])} ${state.year} · ${esc(cashName())}</span><div class="metric-value">${compact(r.remaining,r.currency_code)}</div><small>صافي المسير ${compact(r.net,r.currency_code)} · مدفوع سابقًا ${compact(r.paid,r.currency_code)}</small></div>
      <div class="field"><label>المبلغ المراد دفعه (${esc(currencyLabel(r.currency_code))})</label><input name="amount" type="number" min="0.0001" step="any" max="${r.remaining}" value="${r.remaining}" required></div>
      <div class="field"><label>ملاحظة على الدفعة (اختياري)</label><textarea rows="2" maxlength="300" name="note" placeholder="مثال: قبض نقدي بموجب إيصال"></textarea></div>
      <div class="notice">بعد التأكيد ستظهر الحركة في «الرواتب المدفوعة» وفي الصندوق. لا تكرر الدفع إذا انقطع الاتصال قبل ظهور التأكيد؛ حدّث السجل أولًا.</div>`,
    onSubmit:async fd=>{try{const amt=Number(fd.get('amount'));if(!Number.isFinite(amt)||amt<=0||amt>r.remaining+.0001)throw Error('المبلغ أكبر من المتبقي أو غير صالح.');await api.payApprovedSalaryV034(r.payroll_item_id,amt,state.box,fd.get('note'));toast('تم صرف الراتب وحفظ حركة الصندوق.','success');await load();return true;}catch(e){toast(errorMessage(e),'error');return false;}}
   });
  });
  panel.querySelectorAll('.pay-day-v034').forEach(b=>b.onclick=()=>{
   const d=state.daily.find(x=>String(x.employee_id)===b.dataset.employee&&x.work_date===b.dataset.date);if(!d)return;
   modal({title:'دفع أجر يومي أو ساعي',subtitle:'سيعيد الخادم حساب المبلغ النهائي وتطبيق السلف والخصومات قبل تسجيل حركة المال.',submitText:'احتساب وصرف',
    body:`<div class="notice rose">${esc(d.employee_name)} · ${dateOnly(d.work_date)} · ${esc(cashName())}<div>التقديري: ${compact(d.estimated_due_original,d.currency_code)}</div></div>`,
    onSubmit:async()=>{try{await api.payDailyWageV034(d.employee_id,d.work_date,state.box);toast('تم احتساب الأجر وصرفه من الصندوق.','success');await load();return true;}catch(e){toast(errorMessage(e),'error');return false;}}
   });
  });
  panel.querySelectorAll('.pay-fixed-v034').forEach(b=>b.onclick=()=>{
   const e=state.fixed.find(x=>String(x.id)===b.dataset.id);if(!e)return;
   modal({title:'صرف أجر مقطوع',subtitle:'الأجر المقطوع يصرف عند استكمال العمل فقط؛ ليس راتبًا شهريًا.',submitText:'تأكيد الصرف',
    body:`<div class="notice rose">${esc(e.name)} · ${compact(fixedRate(e),e.wage_currency_code)} · ${esc(cashName())}</div>
    <div class="field"><label>تاريخ العمل</label><input name="date" type="date" value="${todayISO()}" required></div>`,
    onSubmit:async fd=>{try{await api.payFixedEmployee(e.id,state.box,fd.get('date'));toast('تم صرف الأجر المقطوع.','success');await load();return true;}catch(e){toast(errorMessage(e),'error');return false;}}
   });
  });
 }
 function bindPaid(){
  const table=panel.querySelector('.payroll-paid-table-v034');if(!table)return;
  registerTableExport(table,()=>({title:`الرواتب المقبوضة ${MONTH_NAMES[state.month-1]} ${state.year}`,headers:['الموظف','التاريخ','الفترة','النوع','المدفوع','مكافآت المسير','خصم السلفة','الصندوق','ملاحظات'],rows:state.paid.map(p=>[p.employee_name,p.paid_at?.slice(0,10)||'',`${p.period_start} — ${p.period_end}`,PAY_TYPE[p.payment_kind]||p.payment_kind,p.amount_original,p.bonus_original,p.advance_deduction_original,state.boxes.find(b=>b.id===p.cashbox_id)?.name||'',p.note||''])}));
 }
 root.querySelectorAll('[data-pay-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.payTab;paint();});
 boxSelect.addEventListener('change',()=>{state.box=boxSelect.value;paint();});
 const filterChange=()=>{state.month=Number(monthInput.value);state.year=Number(yearInput.value);state.status='all';state.query='';load();};
 monthInput.addEventListener('change',filterChange);yearInput.addEventListener('change',filterChange);
 root.querySelector('#payroll-refresh-v034').onclick=load;
 await load();
}
