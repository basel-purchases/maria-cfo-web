import { esc } from './utils.js?v=0.14.0';
export function loader(){ return '<div class="loader" aria-label="جاري التحميل"></div>'; }
export function empty(title, message='', action=''){ return `<div class="empty"><strong>${esc(title)}</strong>${message?`<div>${esc(message)}</div>`:''}${action}</div>`; }
export function toast(message, type=''){ let box=document.querySelector('.toast-box'); if(!box){box=document.createElement('div');box.className='toast-box';document.body.appendChild(box);} const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=message;box.appendChild(t);setTimeout(()=>t.remove(),4500); }
export function friendlyError(error, fallback='تعذر إكمال العملية الآن. حاول مرة أخرى.'){
  console.error(error);
  if(error?.name === 'MariaValidationError') return String(error.message);
  const msg=String(error?.message||error||'').toLowerCase();
  if(msg.includes('failed to fetch')||msg.includes('network')||msg.includes('socket')) return 'تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم حاول مرة أخرى.';
  if(msg.includes('401')||msg.includes('jwt')||msg.includes('session')) return 'انتهت جلسة الدخول. سجّل الدخول من جديد.';
  if(msg.includes('403')||msg.includes('access denied')) return 'ليست لديك صلاحية لتنفيذ هذه العملية.';
  if(msg.includes('recipe_unit_not_configured')) return 'هذه الوحدة غير مربوطة بالمادة بعد. اضغط «تحويل وحدة» وحدد العلاقة ثم حاول مجددًا.';
  if(msg.includes('purchase unit conversion not configured')) return 'تم تعريف الوحدة للمادة، لكن قاعدة البيانات ما زالت على منطق الشراء القديم. شغّل تحديث v0.10 مرة واحدة في Supabase ثم أعد المحاولة.';
  if(msg.includes('document_ocr_not_deployed')||msg.includes('document-ocr')&&msg.includes('not found')) return 'ميزة تحليل صورة الفاتورة لم تُنشر على Supabase بعد. انشر Edge Function باسم document-ocr ثم أعد المحاولة.';
  if(msg.includes('ai_jobs')||msg.includes('ai_jobs_unavailable')||msg.includes('mark_ai_job_seen_v012')) return 'ميزة المعالجة الخلفية تحتاج تشغيل تحديث قاعدة البيانات v0.12 مرة واحدة في Supabase.';
  if(msg.includes('payroll_cashbox_not_configured')) return 'اختر صندوق الرواتب من الإعدادات قبل الدفع.';
  if(msg.includes('payroll_cashbox_invalid')) return 'صندوق الرواتب المحدد غير نشط. اختر صندوقًا آخر من الإعدادات.';
  if(msg.includes('daily_wage_already_settled')||msg.includes('payroll_period_already_settled')) return 'هذا اليوم/الفترة مرتبط بالفعل براتب معتمد؛ لا يمكن صرفه مرتين.';
  if(msg.includes('daily_wage_already_prepared')) return 'يوجد مسير سابق لهذا اليوم. راجع سجل الرواتب قبل إعادة المحاولة.';
  if(msg.includes('daily_payroll_no_amount_due')) return 'لا يوجد مبلغ مستحق للدفع في هذا اليوم بعد حساب السلف والخصومات.';
  if(msg.includes('daily_payroll_no_valid_attendance')||msg.includes('attendance_must_be_recorded')) return 'سجّل دوام اليوم المطلوب ثم حاول صرف أجره.';
  if(msg.includes('monthly_payroll_already_exists')) return 'يوجد مسير لهذا الشهر بالفعل. افتحه من جدول المسيرات.';
  if(msg.includes('monthly_payroll_no_monthly_employees')) return 'لا يوجد موظفون شهريون ضمن الفترة المحددة.';
  if(msg.includes('payroll contains employees with missing attendance days')) return 'ما زالت هناك أيام دوام غير مسجلة. أكمل الدوام، وحدّث المسير ثم اعتمده.';
  if(msg.includes('attendance_payroll_locked')) return 'هذا الدوام دخل في راتب معتمد. لا يمكن تعديله مباشرة؛ يلزم إجراء تصحيح مالي موثق.';
  if(msg.includes('monthly_payroll_monthly_only')) return 'لا يمكن اعتماد المسير لأنه يحتوي موظفين يوميين أو ساعيين، وذلك لمنع تكرار الرواتب.';
  if(msg.includes('invalid_salary_payment_amount')) return 'مبلغ الدفعة يجب أن يكون أكبر من صفر ولا يتجاوز الرصيد المتبقي.';
  if(msg.includes('daily_payroll_requires_daily_or_hourly')) return 'الدفع اليومي مخصص للموظف اليومي أو الساعي. الشهري عبر مسير شهري.';
  if(msg.includes('work_date_outside_employment')||msg.includes('invalid_wage_work_date')) return 'تاريخ الدوام خارج فترة عمل الموظف أو بعد اليوم الحالي.';
  if(msg.includes('payroll must be approved before payment')) return 'اعتمد مسير الراتب قبل تسجيل الدفع.';
  if(msg.includes('employee_pay_rate_required')) return 'لم يتم حفظ أجر الموظف في الحقل الصحيح. حدث الصفحة إلى Web v0.14.0 ثم جرّب مجددًا.';
  if(msg.includes('wage_rate_original')&&msg.includes('employees')) return 'هذه نسخة قديمة من نموذج الموظف. حدّث الموقع إلى Web v0.14.0.';
  if(msg.includes('applied shortage hours cannot exceed calculated shortage hours')) return 'النقص المطبق أكبر من النقص المحسوب. عدّل الساعات أو سجل خصمًا إداريًا من قسم الرواتب.';
  if(msg.includes('could not find the function')&&msg.includes('create_event')) return 'استدعاء إنشاء الحفلة غير متوافق مع قاعدة البيانات. تأكد من تشغيل Web v0.14.0 بعد تحديث الصفحة.';
  if(msg.includes('order_item_compat_failed')||msg.includes('add_order_item_v013')) return 'تعذر حفظ الصنف بسبب عدم توافق خدمة الأوردرات. شغّل تحديث قاعدة البيانات v0.13 ثم أعد المحاولة.';
  if(msg.includes('order_item_quantity_required')) return 'أدخل كمية أكبر من صفر.';
  if(msg.includes('order_item_price_invalid')) return 'أدخل سعرًا صحيحًا للصنف.';
  if(msg.includes('order_not_draft')) return 'هذا الأوردر لم يعد مسودة ولا يمكن تعديل أصنافه.';
  if(msg.includes('order_has_no_items')) return 'أضف صنفًا واحدًا على الأقل قبل نشر الأوردر.';
  if(msg.includes('cashbox_session_create_failed')) return 'تعذر فتح جلسة الصندوق لهذا اليوم. شغّل تحديث v0.13 ثم أعد المحاولة.';
  if(msg.includes('order_post_failed')||msg.includes('order_post_not_confirmed')) return 'تعذر نشر الأوردر من قاعدة البيانات. لم نسجل بيعًا ناقصًا؛ راجع الوصفة والصندوق ثم أعد المحاولة.';
  if(msg.includes('cashbox_adjustment_amount_required')) return 'أدخل مبلغًا أكبر من صفر.';
  if(msg.includes('invalid_cashbox_adjustment_direction')) return 'اختر إضافة مبلغ أو سحب مبلغ من الصندوق.';
  if(msg.includes('cashbox')&&(msg.includes('required')||msg.includes('not set')||msg.includes('missing')||msg.includes('null'))) return 'حدد الصندوق قبل نشر الأوردر.';
  if(msg.includes('no_valid_order_images')) return 'اختر صورة أوردر صالحة بحجم أقل من 8 MB.';
  if(msg.includes('ocr_item_needs_review')) return 'هناك بند مستخرج يحتاج ربطه بمادة ووحدة قبل إضافته.';
  if(msg.includes('purchase_invoice_has_payments')) return 'لا يمكن إلغاء هذه الفاتورة قبل معالجة دفعات المورد المرتبطة بها.';
  if(msg.includes('purchase_invoice_already_voided')) return 'هذه الفاتورة ملغاة بالفعل.';
  if(msg.includes('only_draft_invoice_can_be_deleted')) return 'يمكن حذف المسودات فقط. الفاتورة المنشورة تُلغى بحركة عكسية.';
  if(msg.includes('recipe_material_already_exists')) return 'هذه المادة موجودة في الوصفة بالفعل. استخدم زر «تعديل» في السطر الموجود بدل إضافتها مرة ثانية.';
  if(msg.includes('recipe_save_verify_failed')) return 'لم يتم تأكيد حفظ المكوّن في قاعدة البيانات. لم نعرض نجاحًا وهميًا؛ أعد المحاولة بعد تحديث v0.7.';
  if(msg.includes('recipe_quantity_column_not_found')) return 'قاعدة البيانات تحتاج تحديث Maria CFO Web v0.7 قبل حفظ مكونات الوصفة.';
  if(msg.includes('save_menu_recipe_item_v07')&&msg.includes('not found')) return 'شغّل تحديث قاعدة البيانات v0.7 مرة واحدة في Supabase ثم أعد المحاولة.';
  if(msg.includes('unit_in_use')) return 'لا يمكن حذف هذه الوحدة لأنها مستخدمة حاليًا.';
  if(msg.includes('unit_name_required')) return 'اكتب اسم الوحدة.';
  if(msg.includes('function')&&msg.includes('not found')) return 'هذه الخدمة لم تُحدّث على الخادم بعد.';
  return fallback;
}
export function modal({title,subtitle='',body='',submitText='حفظ',onSubmit=async()=>true,wide=false,hideActions=false,onClose=null}){
  const back=document.createElement('div');
  back.className='modal-backdrop';
  back.innerHTML=`<div class="modal ${wide?'wide':''}"><div class="modal-head"><div><h3>${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button class="x-btn" type="button">×</button></div><form class="modal-form" autocomplete="off">${body}${hideActions?'':`<div class="modal-actions"><button class="btn" type="submit">${esc(submitText)}</button><button class="btn secondary cancel" type="button">إلغاء</button></div>`}</form></div>`;
  document.body.appendChild(back);
  let closed=false;
  const close=async()=>{
    if(closed) return;
    closed=true;
    back.remove();
    if(onClose){ try{ await onClose(); }catch(e){ console.error(e); } }
  };
  back.querySelector('.x-btn').onclick=close;
  back.querySelector('.cancel')?.addEventListener('click',close);
  back.addEventListener('click',e=>{if(e.target===back) close();});
  const form=back.querySelector('form');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=form.querySelector('[type=submit]');
    if(btn) btn.disabled=true;
    try{
      const ok=await onSubmit(new FormData(form),form);
      if(ok!==false) await close();
    }finally{
      if(btn && document.body.contains(btn)) btn.disabled=false;
    }
  });
  return {close,element:back,form};
}
export function confirmBox(message, yes='نعم'){ return new Promise(resolve=>{const m=modal({title:'تأكيد',body:`<div class="notice rose">${esc(message)}</div>`,submitText:yes,onSubmit:async()=>{resolve(true);return true;}}); const old=m.close;m.close=()=>{resolve(false);old()}; m.element.querySelector('.x-btn').onclick=m.close;m.element.querySelector('.cancel').onclick=m.close;}); }
