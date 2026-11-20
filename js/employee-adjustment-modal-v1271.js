// Maria CFO v1.0.27.1: shared modal, loaded from a dedicated module so stale
// employees.js on a partially updated hosting deployment cannot break the
// entire ES module graph at startup.
import * as api from './api.js?v=1.0.28';
import {modal,toast,friendlyError} from './ui.js?v=1.0.23';
import {currencyLabel,esc,todayISO} from './utils.js?v=1.0';
import {dateInEmployeeServiceV128,employeeServiceDateInputV128} from './employee-service-v128.js?v=1.0.28';
import {optionalPayrollReasonV129} from './bonus-policy-v032.js?v=1.0.29';

// Reused by the employee file and by the payroll screen.
export function openEmployeeAdjustmentModalV127(employee,kind,onSaved,defaultDate=todayISO()){
 if(employee.pay_type==='fixed'){
  toast('الأجر المقطوع لا يدعم التسويات ضمن المسير الحالي.','error');return;
 }
 const addition=kind==='addition';
 const currency=employee.wage_currency_code||'SYP';
 const m=modal({
  title:addition?'إضافة على راتب الموظف':'خصم من راتب الموظف',
  subtitle:employee.name+' · '+currencyLabel(currency),
  submitText:'تسجيل التسوية',
  body:`<div class="form-grid">
    <div class="field"><label>التاريخ</label><input name="date" type="date" value="${dateInEmployeeServiceV128(employee,defaultDate)?esc(defaultDate):''}" ${employeeServiceDateInputV128(employee)} required></div>
    <div class="field"><label>نوع التسوية</label><select name="value_kind"><option value="money">مبلغ نقدي</option><option value="hours">ساعات دوام</option></select></div>
    <div class="field" data-money-entry><label>المبلغ (${esc(currencyLabel(currency))})</label><input name="amount" type="number" min="0.0001" max="1000000000000" step="any" inputmode="decimal" required></div>
    <div class="field" data-hours-entry hidden><label>عدد الساعات</label><input name="hours" type="number" min="0.01" max="744" step="0.01" inputmode="decimal" disabled></div>
    <div class="field full" data-hour-preview hidden aria-live="polite"></div>
    <div class="field full"><label>السبب (اختياري)</label><input name="reason" maxlength="120" placeholder="يمكن تركه فارغًا"></div>
    <div class="field full"><label>ملاحظة (اختياري)</label><textarea name="note" maxlength="500" rows="2"></textarea></div>
   </div>
   <div class="notice">قيمة الساعة بحسب الأجر المحفوظ وجدول الدوام للشهر المختار، مع استبعاد أيام الجمعة. يُضاف المبلغ أو يُخصم عند احتساب المسير، ولا تُسجل حركة نقدية الآن. لا تسجل خصم غياب سبق احتسابه تلقائيًا.</div>`,
  onSubmit:async fd=>{
   try{
    const valueKind=fd.get('value_kind');
    const value=fd.get(valueKind==='hours'?'hours':'amount');
    const number=Number(value);
    if(!String(value??'').trim()||!Number.isFinite(number)||number<=0||
       (valueKind==='hours'&&(number>744||Math.abs(number*100-Math.round(number*100))>1e-7)))
     throw Error('أدخل عدد الساعات أو المبلغ بشكل صحيح.');
    if(valueKind==='hours'&&!rateData)throw Error('لم يتم تحميل سعر الساعة من قاعدة البيانات. راجع تحديث SQL v1.0.27.');
    if(!dateInEmployeeServiceV128(employee,String(fd.get('date')||'')))throw Error('تاريخ التسوية خارج فترة خدمة الموظف.');
    await api.recordEmployeeAdjustmentV127({employeeId:employee.id,kind,valueKind,value,
      date:fd.get('date'),reason:optionalPayrollReasonV129(fd.get('reason')),note:fd.get('note')});
    toast('تم تسجيل التسوية في كشف الراتب.','success');
    await onSaved?.();return true;
   }catch(e){
    const text=String(e?.message||e||'');
    toast(/PGRST202|employee_hour_rate_v127|record_employee_adjustment_v127/.test(text)
     ?'يلزم تطبيق SQL v1.0.27 على Supabase قبل استخدام تسويات الساعات أو المبالغ.':friendlyError(e),'error');
    return false;
   }
  },
 });
 const form=m.form,mode=form.elements.namedItem('value_kind');
 const date=form.elements.namedItem('date'),hours=form.elements.namedItem('hours');
 const amount=form.elements.namedItem('amount');
 const preview=form.querySelector('[data-hour-preview]');
 let rateData=null,request=0;
 const update=async()=>{
  const token=++request,byHours=mode.value==='hours';
  form.querySelector('[data-hours-entry]').hidden=!byHours;
  form.querySelector('[data-money-entry]').hidden=byHours;
  hours.disabled=!byHours;hours.required=byHours;
  amount.disabled=byHours;amount.required=!byHours;
  preview.hidden=!byHours;
  if(!byHours){rateData=null;preview.textContent='';return;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date.value)){
   rateData=null;preview.textContent='اختر تاريخًا صحيحًا.';return;
  }
  preview.textContent='جاري حساب سعر الساعة...';rateData=null;
  try{
   const data=await api.employeeHourRateV127(employee.id,date.value);
   if(token!==request||!m.element.isConnected)return;
   if(!data||!(Number(data.hourly_rate)>0))throw Error('V127_HOURLY_RATE_INVALID');
   rateData=data;
   showPreview();
  }catch(e){
   if(token!==request||!m.element.isConnected)return;
   rateData=null;
   preview.textContent=/PGRST202|employee_hour_rate_v127/i.test(String(e?.message||''))
     ?'يلزم تطبيق تحديث SQL v1.0.27 لحساب ساعات الرواتب.':friendlyError(e);
  }
 };
 const fmt=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Number(value));
 function showPreview(){
  if(!rateData)return;
  const rate=Number(rateData.hourly_rate),quantity=Number(hours.value);
  const breakdown=rateData.pay_type==='monthly'
   ?`أيام العمل دون الجمعة: ${Number(rateData.working_days)} · الساعات المقررة لهذا الشهر: ${fmt(rateData.monthly_hours)}`
   :rateData.pay_type==='daily'?`ساعات اليوم: ${fmt(rateData.daily_hours)}`:'أجر الساعة المحدد للموظف';
  preview.innerHTML=`<div class="notice"><strong>${esc(breakdown)}</strong>
   <div>أجر الساعة: <strong>${fmt(rate)} ${esc(currencyLabel(currency))}</strong></div>
   ${Number.isFinite(quantity)&&quantity>0?`<div>المبلغ المتوقع: <strong>${fmt(Math.round(rate*quantity*10000)/10000)} ${esc(currencyLabel(currency))}</strong></div>`:''}
   <small>الحساب الرسمي يتم في قاعدة البيانات عند الحفظ، ويُحفظ سعر الساعة مع الحركة.</small></div>`;
 }
 mode.addEventListener('change',update);
 date.addEventListener('change',update);
 hours.addEventListener('input',showPreview);
}
