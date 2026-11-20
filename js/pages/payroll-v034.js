import * as api from '../api.js?v=1.0.27.1';
import {modal,toast,loader,friendlyError,confirmBox} from '../ui.js?v=1.0.23';
import {currencyLabel,esc,money,dateOnly,todayISO} from '../utils.js?v=1.0';
import {registerTableExport} from '../table-export-v027.js?v=1.0';
import {openEmployeeAdjustmentModalV127} from '../employee-adjustment-modal-v1271.js?v=1.0.27.1';
import {monthStartV034,filterPayrollReadyV034,currencyGroupsV034,normalizedPayrollRowV034} from '../payroll-workbench-v034.js?v=1.0.17';

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
 <div class="quick-actions"><a class="btn secondary" href="#/employees-list">الموظفون</a><a class="btn secondary" href="#/advances">السلف</a><a class="btn secondary" href="#/bonuses">المكافآت</a><button type="button" class="btn secondary" data-salary-adjust="addition">+ إضافة ساعات / نقود</button><button type="button" class="btn secondary" data-salary-adjust="deduction">+ خصم ساعات / نقود</button></div></div>
 <section class="card payroll-controller-v034">
  <div class="payroll-filter-grid-v034">
   <div class="field"><label for="payroll-month-v034">الشهر</label><select id="payroll-month-v034">${MONTH_NAMES.map((name,i)=>`<option value="${i+1}" ${i+1===state.month?'selected':''}>${name}</option>`).join('')}</select></div>
   <div class="field"><label for="payroll-year-v034">السنة</label><select id="payroll-year-v034">${Array.from({length:9},(_,i)=>[state.year-4+i,state.year-4+i]).map(([y,l])=>`<option value="${y}" ${y===state.year?'selected':''}>${y}</option>`).join('')}</select></div>
   <div class="field"><label for="payroll-box-v034">صندوق الدفع</label><select id="payroll-box-v034"></select></div>
   <div class="payroll-toolbar-v034"><button type="button" class="btn secondary" id="payroll-refresh-v034">تحديث البيانات ↻</button></div>
  </div>
  <div class="payroll-tabs-v034" role="tablist" aria-label="حالة الرواتب">
   <button type="button" role="tab" aria-selected="true" class="payroll-tab-v034 active" data-pay-tab="ready">الرواتب الجاهزة للدفع</button>
   <button type="button" role="tab" aria-selected="false" class="payroll-tab-v034" data-pay-tab="paid">الرواتب المدفوعة</button>
  </div>
 </section>
 <div id="payroll-total-v105" class="grid cols-3 payroll-totals-v105" aria-live="polite"></div>
 <div id="payroll-data-v034">${loader()}</div>`;
 const panel=root.querySelector('#payroll-data-v034');
 const boxSelect=root.querySelector('#payroll-box-v034');
 const monthInput=root.querySelector('#payroll-month-v034'),yearInput=root.querySelector('#payroll-year-v034');
 const currBox=()=>state.boxes.find(b=>String(b.id)===state.box);
 const mayPay=()=>Boolean(currBox()?.is_active);
 const errorMessage=e=>{
  const s=String(e?.message||'');
  if(/V123_FINAL_MONTH_DRAFT_NEEDS_RECALC/.test(s))return 'تغيرت أيام أو بيانات التسوية النهائية؛ أعد احتساب مسودة الرواتب أولًا قبل اعتمادها.';
  if(/V123_FINAL_MONTH_DEDUCTIONS_EXCEED_PAY/.test(s))return 'الحسميات تتجاوز الأجر الأخير. راجع خصومات الموظف قبل إعداد مسير شهر النهاية.';
  if(/V123_|post_purchase_invoice_paid_v123|prepare_scheduled_workdays_v123|pay_daily_wage_v123/i.test(s))return '\u064a\u062c\u0628 \u062a\u0634\u063a\u064a\u0644 SQL v1.0.23 \u0623\u0648 \u0645\u0631\u0627\u062c\u0639\u0629 \u064a\u0648\u0645 \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u0635\u0646\u062f\u0648\u0642.';
  if(/PAYROLL_NOT_APPROVED/.test(s))return 'يجب اعتماد المسير قبل دفع راتب الموظف.';
  if(/PAYROLL_CASHBOX_INVALID/.test(s))return 'اختر صندوقًا نشطًا لدفع الراتب.';
  if(/INVALID_SALARY_PAYMENT_AMOUNT/.test(s))return 'تغيّر الرصيد أو المبلغ غير صالح. حدّث البيانات قبل المحاولة.';
  if(/DAILY_WAGE_ALREADY_SETTLED|DAILY_WAGE_ALREADY_PREPARED/.test(s))return 'سبق احتساب أو دفع أجر هذا اليوم. حدّث الجدول.';
  if(/V117_MONTHLY_DRAFT_REQUIRED/.test(s))return 'لا يمكن اعتماد هذا المسير؛ يجب أن يكون مسودة رواتب شهرية.';
  if(/V117_NON_MONTHLY_ITEM_REQUIRES_RECALCULATION/.test(s))return 'تحتوي المسودة على أجر غير شهري. اضغط إعادة احتساب ثم حاول الاعتماد.';
  if(/create_monthly_payroll_v117|approve_monthly_payroll_v117|recalculate_monthly_payroll_v117|monthly_attendance_default_v117/i.test(s))return 'يجب تشغيل SQL v1.0.17 في Supabase قبل استخدام المسير.';
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
   if(start===todayISO().slice(0,7)+'-01'){
     // Standard daily/hourly workdays are assumed automatically; exceptions remain unchanged.
     await api.prepareScheduledWorkdaysV123(start,todayISO());
   }
   const [ready,paid,staff,boxes,runs,daily]=await Promise.all([
    api.payrollReadyV034(start),api.payrollPaidV034(start),api.employees(),api.cashboxes(),
    api.list('payroll_runs',{order:'period_start',limit:500}),api.dailyWageDues(),
   ]);
   state.ready=Array.isArray(ready)?ready:[];state.paid=Array.isArray(paid)?paid:[];
   state.daily=(Array.isArray(daily)?daily:[]).filter(row=>String(row.work_date||'').startsWith(start.slice(0,7))
      &&Number(row.estimated_due_original)>0.0001);
   state.staff=staff;state.boxes=boxes;state.runs=runs.filter(r=>r.note?.startsWith('MARIA_MONTHLY_V014:')&&rowMonth(r,start));
   state.fixed=staff.filter(e=>e.status==='active'&&e.pay_type==='fixed');
   updateBoxes();paint();
  }catch(e){panel.innerHTML=`<div class="notice"><strong>تعذر تحميل كشف الرواتب</strong><div>${esc(errorMessage(e))}</div></div>`;}
  finally{state.busy=false;}
 }
 function tabs(){
  root.querySelectorAll('[data-pay-tab]').forEach(b=>{const active=b.dataset.payTab===state.tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
 }
 function paint(){
  tabs();
  const normalizedMonth=state.ready.map(normalizedPayrollRowV034);
  const monthlyMonth=normalizedMonth.filter(r=>r.pay_type==='monthly');
  const totals=root.querySelector('#payroll-total-v105');
  if(totals)totals.innerHTML=`<div class="card"><div class="metric-label">إجمالي صافي الرواتب في مسيرات الشهر</div><div class="metric-note">${amountGroup(normalizedMonth,'net')}</div><small>تشمل المسيرات الظاهرة في قاعدة البيانات، ولا تشمل راتبًا لم يُنشأ له مسير.</small></div>
    <div class="card"><div class="metric-label">إجمالي ما دُفع في الشهر</div><div class="metric-note">${amountGroup(state.paid,'amount_original')}</div><small>حركات الدفع الحقيقية فقط، موزعة حسب العملة.</small></div>
    <div class="card"><div class="metric-label">إجمالي الرواتب المتبقية في مسيرات الشهر</div><div class="metric-note">${amountGroup(normalizedMonth,'remaining')}</div><small>بما فيها المسودات؛ الاعتماد لا يعني الصرف.</small></div>`;
  panel.innerHTML=state.tab==='ready'?readyHtml(monthlyMonth):paidHtml();
  state.tab==='ready'?bindReady():bindPaid();
 }
 const draftMonths=()=>state.runs.filter(r=>r.status==='draft');
 function readyHtml(monthlyMonth){
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
  <div class="payroll-metrics-v034 payroll-monthly-metrics-v117">
    <div class="card"><div class="metric-label">المستحقات المعتمدة المتبقية · ${esc(selectedMonth)}</div><div class="metric-value">${payable.length} موظف</div><div class="metric-note">${amountGroup(payable,'remaining')}</div></div>
    <div class="card"><div class="metric-label">مسيرات بانتظار الاعتماد</div><div class="metric-value">${runs.length}</div><div class="metric-note">لن يعمل زر دفع لمستحق غير معتمد.</div></div>
    <div class="card"><div class="metric-label">مجموع المكافآت</div><div class="metric-note">${amountGroup(monthlyMonth,'bonuses')}</div></div>
    <div class="card"><div class="metric-label">مجموع السلف المخصومة</div><div class="metric-note">${amountGroup(monthlyMonth,'advances')}</div></div>
  </div>
  <section class="card finance-section payroll-ready-card-v034">
    <div class="finance-section-head"><div><h3>كشف الموظفين والمستحقات</h3><p>الراتب الأساسي، الإضافي، المكافآت، السلف والخصم والصافي في سطر واحد. المبالغ من حساب قاعدة البيانات المعتمد.</p></div>
    <button class="btn" id="new-month-run-v034" type="button" ${!state.staff.some(e=>e.pay_type==='monthly')?'disabled':''}>+ إنشاء مسير ${esc(selectedMonth)}</button></div>
    ${runs.map(r=>`<div class="payroll-run-alert-v034"><div><strong>مسودة ${dateOnly(r.period_start)} — ${dateOnly(r.period_end)}</strong><small>الراتب الشهري كامل افتراضيًا باستثناء شهر انتهاء الخدمة، حيث يُطبّق عدد الأيام المحدد في ملف الموظف. بعد أي تغيير للسلف أو المكافآت أو الأيام اضغط إعادة احتساب.</small></div>
      <div class="quick-actions"><button class="btn secondary" data-run-recalc="${esc(r.id)}">إعادة احتساب</button><button class="btn" data-run-approve="${esc(r.id)}">اعتماد المسير</button></div></div>`).join('')}
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
      <td><small>${esc(r.note||'—')}</small><div><span class="badge ${r.isDraft?'yellow':r.remaining>0?'green':''}">${r.isDraft?'مسودة · غير معتمدة':r.remaining<=.0001?'مسدد':'معتمد'}</span>${r.pay_type!=='monthly'&&Number(r.missing_attendance_days)>0?`<small class="payroll-danger-v034">⚠ ${r.missing_attendance_days} أيام دوام ناقصة</small>`:''}</div></td>
      <td><button class="btn pay-salary-v034" data-id="${esc(r.payroll_item_id)}" ${!r.payable||noBox?'disabled':''}>دفع</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد مسيرات أو مستحقات مطابقة في هذه الفترة. أنشئ مسيرًا ثم اعتمده.')}
  </section>
  ${state.daily.length?`<section class="card finance-section staff-v123-daily-wages">
    <div class="finance-section-head"><div><h3>\u0623\u062c\u0648\u0631 \u064a\u0648\u0645\u064a\u0629 \u0648\u0633\u0627\u0639\u064a\u0629 \u062a\u0644\u0642\u0627\u0626\u064a\u0629</h3><p>\u064a\u064f\u0639\u062a\u0645\u062f \u0627\u0644\u064a\u0648\u0645 \u0627\u0644\u0645\u062c\u062f\u0648\u0644 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627 \u0625\u0644\u0627 \u0625\u0630\u0627 \u0633\u064f\u062c\u0651\u0644\u062a \u0625\u062c\u0627\u0632\u0629 \u0623\u0648 \u063a\u064a\u0627\u0628 \u0645\u0646 \u0645\u0644\u0641 \u0627\u0644\u0645\u0648\u0638\u0641. \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0641\u0639\u0644\u064a \u0645\u0646 \u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u062f\u0641\u0639.</p></div><span class="badge green">${state.daily.length} \u064a\u0648\u0645 \u0645\u0633\u062a\u062d\u0642</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>\u0627\u0644\u0645\u0648\u0638\u0641</th><th>\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0639\u0645\u0644</th><th>\u0646\u0648\u0639 \u0627\u0644\u0623\u062c\u0631</th><th>\u0627\u0644\u0645\u0633\u062a\u062d\u0642</th><th>\u0627\u0644\u0635\u0631\u0641</th></tr></thead><tbody>
    ${state.daily.slice(0,75).map(d=>`<tr><td>${esc(d.employee_name)}</td><td>${dateOnly(d.work_date)}</td><td>${esc(PAY_TYPE[d.pay_type]||d.pay_type)}</td><td><strong>${compact(d.estimated_due_original,d.currency_code)}</strong></td><td><button type="button" class="btn staff-v123-pay-day" data-employee="${esc(d.employee_id)}" data-date="${esc(d.work_date)}" ${noBox?'disabled':''}>\u0635\u0631\u0641</button></td></tr>`).join('')}</tbody></table></div>
    ${state.daily.length>75?'<div class="notice">\u062a\u0648\u062c\u062f \u0623\u064a\u0627\u0645 \u0623\u062e\u0631\u0649 \u0645\u0633\u062a\u062d\u0642\u0629. \u062d\u062f\u062b \u0627\u0644\u0634\u0647\u0631 \u0648\u0631\u0627\u062c\u0639 \u0633\u062c\u0644\u0627\u062a \u0627\u0644\u062f\u0641\u0639.</div>':''}
   </section>`:''}
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
    body:`<div class="notice rose">${MONTH_NAMES[state.month-1]} ${state.year} · الحضور افتراضي، وتُحتسب الاستثناءات المسجلة فقط.</div>`,
    onSubmit:async()=>{try{await api.createMonthlyPayroll(state.year,state.month);toast('تم إنشاء المسير. راجع التفاصيل واعتمدها قبل الدفع.','success');await load();return true;}catch(e){toast(errorMessage(e),'error');return false;}}
  }));
  panel.querySelectorAll('[data-run-recalc]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api.recalculateMonthlyPayroll(b.dataset.runRecalc);toast('تم تحديث المسودة بالمكافآت والسلف والخصومات.','success');await load();}catch(e){toast(errorMessage(e),'error');}finally{b.disabled=false;}});
  panel.querySelectorAll('[data-run-approve]').forEach(b=>b.onclick=async()=>{
   if(!await confirmBox('اعتماد هذا المسير سيثبّت مستحقات الموظفين. راجع السلف والمكافآت والخصومات؛ الاعتماد لا يصرف أي أموال.','اعتماد المسير'))return;
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
  panel.querySelectorAll('.staff-v123-pay-day').forEach(b=>b.onclick=()=>{
   const row=state.daily.find(d=>String(d.employee_id)===b.dataset.employee&&String(d.work_date)===b.dataset.date);
   if(!row||!mayPay())return;
   modal({title:'\u062a\u0623\u0643\u064a\u062f \u0635\u0631\u0641 \u0623\u062c\u0631 \u064a\u0648\u0645\u064a',subtitle:row.employee_name+' \u00b7 '+String(row.work_date)+' \u00b7 '+cashName(),
     body:`<div class="notice rose"><strong>${compact(row.estimated_due_original,row.currency_code)}</strong> \u00b7 \u0645\u0633\u062a\u062d\u0642 \u0645\u0628\u062f\u0626\u064a \u0642\u0628\u0644 \u0627\u0644\u062a\u0633\u0648\u064a\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a\u0629 \u0644\u0644\u0633\u0644\u0641 \u0648\u0627\u0644\u062d\u0633\u0645\u064a\u0627\u062a.</div>`,
     submitText:'\u0635\u0631\u0641 \u0645\u0646 \u0627\u0644\u0635\u0646\u062f\u0648\u0642',
     onSubmit:async()=>{try{await api.payDailyWageV034(row.employee_id,row.work_date,state.box);
       toast('\u062a\u0645 \u0635\u0631\u0641 \u0627\u0644\u0623\u062c\u0631 \u0648\u062a\u0633\u062c\u064a\u0644 \u062d\u0631\u0643\u0629 \u0627\u0644\u0635\u0646\u062f\u0648\u0642.','success');await load();return true;
     }catch(e){toast(errorMessage(e),'error');return false;}}
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
 // Use the exact same atomic adjustment dialog from the employee profile.
 root.querySelectorAll('[data-salary-adjust]').forEach(button=>button.onclick=()=>{
  const staff=state.staff.filter(e=>e.status==='active'&&!e.archived_v123&&e.pay_type!=='fixed');
  if(!staff.length){toast('لا يوجد موظف نشط بنظام راتب يقبل الإضافة أو الخصم.','error');return;}
  const kind=button.dataset.salaryAdjust;
  let selected=null;
  modal({title:kind==='addition'?'اختيار موظف للإضافة':'اختيار موظف للخصم',
   subtitle:'تُطبق التسوية على الشهر الموافق للتاريخ، وليس كحركة صندوق.',
   submitText:'متابعة',
   body:`<div class="field"><label>الموظف</label><select name="employee" required>
      ${staff.map(e=>`<option value="${esc(e.id)}">${esc(e.name)} · ${esc(PAY_TYPE[e.pay_type]||e.pay_type)}</option>`).join('')}
    </select></div>`,
   onSubmit:async fd=>{
    selected=staff.find(x=>String(x.id)===String(fd.get('employee')))||null;
    return Boolean(selected);
   },
   onClose:()=>{
    if(selected)openEmployeeAdjustmentModalV127(selected,kind,load,state.year===Number(todayISO().slice(0,4))&&state.month===Number(todayISO().slice(5,7))?todayISO():monthStartV034(state.year,state.month));
   },
  });
 });
 root.querySelectorAll('[data-pay-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.payTab;paint();});
 boxSelect.addEventListener('change',()=>{state.box=boxSelect.value;paint();});
 const filterChange=()=>{state.month=Number(monthInput.value);state.year=Number(yearInput.value);state.status='all';state.query='';load();};
 monthInput.addEventListener('change',filterChange);yearInput.addEventListener('change',filterChange);
 root.querySelector('#payroll-refresh-v034').onclick=load;
 await load();
}
