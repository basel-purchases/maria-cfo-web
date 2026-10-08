import { esc } from './utils.js';
export function loader(){ return '<div class="loader" aria-label="جاري التحميل"></div>'; }
export function empty(title, message='', action=''){ return `<div class="empty"><strong>${esc(title)}</strong>${message?`<div>${esc(message)}</div>`:''}${action}</div>`; }
export function toast(message, type=''){ let box=document.querySelector('.toast-box'); if(!box){box=document.createElement('div');box.className='toast-box';document.body.appendChild(box);} const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=message;box.appendChild(t);setTimeout(()=>t.remove(),4500); }
export function friendlyError(error, fallback='تعذر إكمال العملية الآن. حاول مرة أخرى.'){
  console.error(error);
  const msg=String(error?.message||error||'').toLowerCase();
  if(msg.includes('failed to fetch')||msg.includes('network')||msg.includes('socket')) return 'تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم حاول مرة أخرى.';
  if(msg.includes('401')||msg.includes('jwt')||msg.includes('session')) return 'انتهت جلسة الدخول. سجّل الدخول من جديد.';
  if(msg.includes('403')||msg.includes('access denied')) return 'ليست لديك صلاحية لتنفيذ هذه العملية.';
  if(msg.includes('recipe_unit_not_configured')) return 'هذه الوحدة غير مربوطة بالمادة بعد. اضغط «تحويل وحدة» وحدد العلاقة ثم حاول مجددًا.';
  if(msg.includes('purchase unit conversion not configured')) return 'تم تعريف الوحدة للمادة، لكن قاعدة البيانات ما زالت على منطق الشراء القديم. شغّل تحديث v0.10 مرة واحدة في Supabase ثم أعد المحاولة.';
  if(msg.includes('document_ocr_not_deployed')||msg.includes('document-ocr')&&msg.includes('not found')) return 'ميزة تحليل صورة الفاتورة لم تُنشر على Supabase بعد. انشر Edge Function باسم document-ocr ثم أعد المحاولة.';
  if(msg.includes('ai_jobs')||msg.includes('ai_jobs_unavailable')||msg.includes('mark_ai_job_seen_v012')) return 'ميزة المعالجة الخلفية تحتاج تشغيل تحديث قاعدة البيانات v0.12 مرة واحدة في Supabase.';
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
