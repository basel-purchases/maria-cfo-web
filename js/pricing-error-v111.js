// Pricing errors are not generic network failures: show a safe, actionable Supabase summary.
// Do not print full HTTP requests, SQL statements or credentials in the UI.
export function materialPricingErrorV111(error){
 const code=String(error?.code||'').trim();
 const msg=String(error?.message||error?.details||'').trim();
 const low=(code+' '+msg).toLowerCase();
 if(low.includes('pgrst202')||low.includes('could not find the function')||low.includes('not found in the schema cache')||low.includes('undefined_function'))
   return 'تعذر تنفيذ التسعير: دالة قاعدة البيانات غير متاحة. شغّل SQL v1.0.11 ثم أعد تحميل الصفحة.';
 if(low.includes('42501')||low.includes('access denied')||low.includes('permission denied'))
   return 'تعذر اعتماد التسعير: حساب الدخول لا يملك صلاحية المدير/المالك المطلوبة.';
 if(low.includes('57014')||low.includes('timeout')||low.includes('statement timeout'))
   return 'انتهت مهلة عملية التسعير. حدّث صفحة المواد وتحقق من الأسعار قبل إعادة الاعتماد؛ لم نُسجّل نجاحًا غير مؤكد.';
 if(low.includes('23514')||low.includes('check constraint')||low.includes('numeric field overflow')||low.includes('22003'))
   return 'رفضت قاعدة البيانات سعرًا أو قيدًا غير صالح. راجع قيمة الصرف وتأكد من تثبيت تحديث SQL v1.0.11.';
 if(low.includes('failed to fetch')||low.includes('network'))
   return 'تعذر الاتصال بـ Supabase. حدّث الصفحة وتحقق من العملية قبل تكرارها.';
 if(low.includes('invalid_usd_exchange_rate'))return 'أدخل سعر دولار موجبًا وصحيحًا.';
 if(low.includes('usd_rate_required'))return 'سجّل سعر الدولار في الإعدادات أولًا.';
 const safe=msg.replace(/(?:Bearer\s+|eyJ[A-Za-z0-9_-]{20,})\S*/g,'[مخفي]')
  .replace(/[\r\n]+/g,' ').slice(0,190);
 return `لم تُؤكَّد عملية التسعير${code?' ('+code+')':''}${safe?': '+safe:''}. تحقّق من النتيجة قبل إعادة المحاولة.`;
}
