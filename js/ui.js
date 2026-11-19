import { esc } from './utils.js?v=1.0';
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
  if(msg.includes('ameen_order_review_required')) return 'هذا الأوردر مستورد من التقرير المستورد. راجع الصندوق والصافي واعتمد المطابقة أولًا من صفحة الإدخالات السريعة.';
  if(msg.includes('ameen_order_total_mismatch')) return 'صافي الأوردر لا يطابق صافي التقرير؛ صحح المبلغ أو اتركه للمراجعة.';
  if(msg.includes('ameen_order_items_changed_reapproval_required')) return 'تغيّرت أصناف الأوردر بعد الاعتماد. يجب إعادة مراجعتها واعتمادها قبل النشر.';
  if(msg.includes('ameen_order_cashbox_required')) return 'حدد صندوق هذا الأوردر قبل اعتماد بيانات المصدر.';
  if(msg.includes('ameen_source_conflict')) return 'يوجد تعارض بين الأوردر وسجل البيانات المستوردة ويحتاج مراجعة يدوية.';
  if(msg.includes('ameen_item_mapping_changed_review_required')) return 'تغيّرت مطابقة مادة مستوردة. لم نكتب على مادة أخرى تلقائيًا؛ راجع الاسم والوحدة.';
  if(msg.includes('daily_item_needs_explicit_create_or_alias')) return 'يوجد صنف غير معروف لم تحدد له إنشاء جديد أو اسمًا بديلًا. أعد المعاينة واختر القرار لكل صنف.';
  if(msg.includes('daily_alias_target_required')||msg.includes('menu_alias_target_not_found')) return 'اختر وجبة صحيحة من قائمة البحث لربط الاسم البديل بها.';
  if(msg.includes('daily_alias_conflict')||msg.includes('menu_alias_collides_with_menu_name')||msg.includes('menu_alias_used_by_another_item')||msg.includes('menu_name_collides_with_alias')) return 'هذا الاسم مستخدم بالفعل لوجبة أخرى. لا يمكن ربط الاسم بوجبتين؛ راجع الأسماء الأساسية والبديلة.';
  if(msg.includes('menu_name_already_exists')) return 'اسم الوجبة موجود مسبقًا؛ افتح الوجبة الحالية وأضف اسمًا بديلًا إن لزم.';
  if(msg.includes('menu_too_many_aliases')) return 'يمكن حفظ حتى 40 اسمًا بديلًا لكل وجبة.';
  if(msg.includes('menu_alias_invalid_name')) return 'الاسم البديل يجب ألا يكون فارغًا أو أطول من 180 حرفًا.';
  if(msg.includes('daily_ambiguous_menu')) return 'هناك أكثر من وجبة بنفس الاسم، ولا يمكن اختيار واحدة تلقائيًا. راجع أسماء المنيو المكررة أولًا.';
  if(msg.includes('daily_line_menu_not_resolved')) return 'تعذر تحديد وجبة أحد بنود الأوردر بأمان؛ لم يحفظ التقرير جزئيًا.';
  if(msg.includes('daily_item_already_matched')) return 'الصنف مرتبط بوجبة موجودة بالفعل. لا يمكن إنشاؤه مرة ثانية.';
  // v1.0.20 has its own migration; do not incorrectly show the older v1.0.10 guidance.
  if(msg.includes('v123_invoice_not_draft_already_posted'))return '\u062a\u0645 \u0646\u0634\u0631 \u0647\u0630\u0647 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0633\u0627\u0628\u0642\u064b\u0627\u061b \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0643\u0631\u0627\u0631 \u062f\u0641\u0639\u0647\u0627.';
  if(msg.includes('v123_active_general_cashbox_not_found')||msg.includes('v123_one_active_general_cashbox_required'))return '\u064a\u0644\u0632\u0645 \u0648\u062c\u0648\u062f \u0635\u0646\u062f\u0648\u0642 \u0639\u0627\u0645 \u0648\u0627\u062d\u062f \u0646\u0634\u0637 \u0642\u0628\u0644 \u0646\u0634\u0631 \u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u0634\u0631\u0627\u0621.';
  if(msg.includes('v123_payroll_period_already_approved')||msg.includes('v123_leave_period_already_approved'))return '\u0627\u0644\u0641\u062a\u0631\u0629 \u0645\u0639\u062a\u0645\u062f\u0629 \u0645\u0627\u0644\u064a\u064b\u0627\u061b \u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u063a\u064a\u064a\u0631\u0647\u0627 \u0628\u0623\u062b\u0631 \u0631\u062c\u0639\u064a.';
  if(msg.includes('v123_duplicate_adjustment')||msg.includes('v123_leave_date_already_recorded'))return '\u0647\u0630\u0647 \u0627\u0644\u062d\u0631\u0643\u0629 \u0645\u0633\u062c\u0644\u0629 \u0644\u0644\u0645\u0648\u0638\u0641 \u0648\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0646\u0641\u0633\u0647 \u0641\u0639\u0644\u064b\u0627.';
  if(msg.includes('v123_fixed_wage_adjustment_unsupported'))return '\u0627\u0644\u0623\u062c\u0631 \u0627\u0644\u0645\u0642\u0637\u0648\u0639 \u0644\u0627 \u064a\u062f\u0639\u0645 \u062a\u0633\u0648\u064a\u0627\u062a \u0627\u0644\u0645\u0633\u064a\u0631 \u0627\u0644\u062d\u0627\u0644\u064a.';
  if(msg.includes('v123_unpaid_workday_cannot_be_paid'))return '\u064a\u0648\u0645 \u0627\u0644\u0625\u062c\u0627\u0632\u0629 \u063a\u064a\u0631 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629 \u0644\u0627 \u064a\u064f\u0635\u0631\u0641 \u0639\u0646\u0647 \u0623\u062c\u0631.';
  if(msg.includes('v123_'))return '\u0647\u0630\u0647 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u062a\u062a\u0637\u0644\u0628 \u0645\u0631\u0627\u062c\u0639\u0629 \u0628\u064a\u0627\u0646\u0627\u062a\u0647\u0627 \u0623\u0648 \u062a\u0646\u0641\u064a\u0630 SQL v1.0.23.';
  if(msg.includes('purchase_revision_stale_invoice')) return 'تغيّرت الفاتورة بعد فتحها في هذه الصفحة. أعد تحميل الفاتورة ثم أدخل تصحيحك على آخر نسخة.';
  if(msg.includes('purchase_void_movements_mismatch')) return 'حركات مخزون الفاتورة لا تطابق بنودها. أُلغي التصحيح بالكامل حفاظًا على سلامة المخزون؛ راجع الحركات أولًا.';
  if(msg.includes('supplier_has_history_cannot_delete')) return 'لا يمكن حذف هذا المورد، لأن له فواتير أو دفعات أو مواد أو كشفًا محفوظًا؛ يمكنك تعديل بياناته بدل حذفه.';
  if(msg.includes('material_category_in_use')) return 'هذا التصنيف مرتبط بمواد بالفعل. انقل المواد إلى تصنيف آخر قبل حذفه.';
  if(msg.includes('material_category_exists')) return 'يوجد تصنيف مواد آخر بالاسم نفسه. اختره من الاقتراحات.';
  if(msg.includes('material_category_name_invalid')) return 'اسم تصنيف المواد مطلوب، ويجب ألا يتجاوز 120 حرفًا.';
  if(msg.includes('purchase_archive_requires_voided')) return 'يسمح بحذف الفواتير الملغاة فقط من قائمة العرض، لا الفواتير المنشورة أو المسودات.';
  if(msg.includes('archive_voided_purchase_invoice_v122')||msg.includes('manage_material_category_v122')) return 'يلزم تنفيذ ملف SQL v1.0.22 في Supabase ثم تحديث الصفحة.';
  if(msg.includes('fx_new_syp_rate_review_required')) return 'سعر الدولار المحفوظ يحتاج مراجعة: يجب أن يكون بالليرة السورية الجديدة، لا القديمة.';
  if(msg.includes('invalid_new_syp_exchange_rate')||msg.includes('invalid_new_syp_rate')) return 'أدخل سعر الدولار بالليرة السورية الجديدة مثل 149.5، وليس 14950.';
  if(msg.includes('revise_purchase_invoice_v120')||msg.includes('material_price_sync_current_fx_v120')||msg.includes('material_price_set_new_exchange_v120')||msg.includes('supplier_delete_if_unused_v120')) return 'نفّذ ملف SQL v1.0.20 من قاعدة Supabase ثم أعد فتح الموقع.';
  if(msg.includes('material_price_')||msg.includes('material_identity_create_priced_v110')||msg.includes('material_identity_update_priced_v110')) return 'هذه العملية تحتاج تشغيل ملف SQL الخاص بالإصدار v1.0.10 في Supabase أولًا، ثم تحديث الصفحة.';
  if(msg.includes('usd_rate_required')) return 'حدد سعر الدولار من الإعدادات قبل حفظ سعر المادة بالدولار.';
  if(msg.includes('material_aliases_v106_migration_required')||msg.includes('material_aliases_v106')) return 'يجب تشغيل ملف SQL الإصدار v1.0.6 في Supabase أولًا، ثم تحديث الموقع.';
  if(msg.includes('material_alias_collides')||msg.includes('material_alias_used_by_another')||msg.includes('material_name_collides_with_alias')) return 'هذا الاسم الثانوي مرتبط بمادة أخرى. راجع أسماء المواد والمرادفات قبل الحفظ.';
  if(msg.includes('material_too_many_aliases')) return 'يمكن وضع حتى 40 اسمًا ثانويًا للمادة.';
  if(msg.includes('material_alias_invalid_name')) return 'الاسم الثانوي يجب ألا يكون فارغًا أو أطول من 180 حرفًا.';
  if(msg.includes('menu_save_v104')||msg.includes('menu_item_search_v104')||msg.includes('menu_item_aliases_v104')) return 'تحتاج تشغيل تحديث قاعدة البيانات v1.0.4 قبل استخدام هذه النسخة.';
  if(msg.includes('ameen_')) return 'توقفت عملية الاستيراد حفاظًا على السجلات. راجع بيانات الملف وتحديث قاعدة Maria CFO v0.24.';
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
  if(msg.includes('employee_pay_rate_required')) return 'لم يتم حفظ أجر الموظف في الحقل الصحيح. حدث الصفحة إلى Web v0.17 ثم جرّب مجددًا.';
  if(msg.includes('wage_rate_original')&&msg.includes('employees')) return 'هذه نسخة قديمة من نموذج الموظف. حدّث الموقع إلى Web v0.17.';
  if(msg.includes('applied shortage hours cannot exceed calculated shortage hours')) return 'النقص المطبق أكبر من النقص المحسوب. عدّل الساعات أو سجل خصمًا إداريًا من قسم الرواتب.';
  if(msg.includes('could not find the function')&&msg.includes('create_event')) return 'استدعاء إنشاء الحفلة غير متوافق مع قاعدة البيانات. تأكد من تشغيل Web v0.17 بعد تحديث الصفحة.';
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
  if(msg.includes('purchase_revision_below_paid_amount')) return 'الإجمالي الجديد أقل من دفعات المورد المخصصة للفواتير؛ عدّل البند أو راجع الدفعات أولًا.';
  if(msg.includes('purchase_revision_paid_party_or_currency')) return 'الفاتورة مرتبطة بدفعة؛ لا يمكنك تغيير المورد أو العملة قبل معالجة تخصيص الدفعة.';
  if(msg.includes('purchase_revision_paid_exchange_rate')) return 'سعر صرف النسخة الجديدة لا يطابق سعر صرف الدفعات السابقة؛ أوقفنا التعديل دون أي تغيير.';
  if(msg.includes('purchase_revision_historic_locked')) return 'الفاتورة التاريخية المستوردة مرجعية، ولا يمكن تعديلها كفاتورة شراء حقيقية.';
  if(msg.includes('purchase_revision_old_version')) return 'هذه نسخة فاتورة مصححة/ملغاة؛ افتح النسخة الأحدث للتعديل.';
  if(msg.includes('purchase_revision_empty_posted')) return 'لا يمكن حذف كل بنود الفاتورة المنشورة. استخدم إلغاء الفاتورة بدلًا من ذلك.';
  if(msg.includes('purchase_revision_invalid_line')) return 'تأكد من الكمية والسعر والخصم: لا يجوز الخصم أكبر من قيمة البند.';
  if(msg.includes('revise_purchase_invoice_v119')||msg.includes('supplier_activity_v119')) return 'حدّث قاعدة Supabase بملف SQL الخاص بـ v1.0.19 قبل استخدام هذه الميزة.';
  if(msg.includes('purchase_invoice_has_payments')) return 'لا يمكن إلغاء هذه الفاتورة قبل معالجة دفعات المورد المرتبطة بها.';
  if(msg.includes('purchase_invoice_already_voided')) return 'هذه الفاتورة ملغاة بالفعل.';
  if(msg.includes('only_draft_invoice_can_be_deleted')) return 'يمكن حذف المسودات فقط. الفاتورة المنشورة تُلغى بحركة عكسية.';
  if(msg.includes('recipe_material_already_exists')) return 'هذه المادة موجودة في الوصفة بالفعل. استخدم زر «تعديل» في السطر الموجود بدل إضافتها مرة ثانية.';
  if(msg.includes('recipe_save_verify_failed')) return 'لم يتم تأكيد حفظ المكوّن في قاعدة البيانات. لم نعرض نجاحًا وهميًا؛ أعد المحاولة بعد تحديث v0.7.';
  if(msg.includes('recipe_quantity_column_not_found')) return 'قاعدة البيانات تحتاج تحديث Maria CFO Web v0.7 قبل حفظ مكونات الوصفة.';
  if(msg.includes('save_menu_recipe_item_v07')&&msg.includes('not found')) return 'شغّل تحديث قاعدة البيانات v0.7 مرة واحدة في Supabase ثم أعد المحاولة.';
  if(msg.includes('unit_name_too_generic')) return 'اسم الوحدة عام وقد يسبب الالتباس. اكتب اسم المادة معه مثل «ملعقة سكر». ';
  if(msg.includes('unit_name_exists')) return 'اسم الوحدة مكرر. استخدم اسمًا خاصًا بالمادة مثل «ملعقة سكر» أو «ملعقة سمنة».';
  if(msg.includes('unit_code_exists')) return 'كود الوحدة موجود بالفعل. جرّب اسمًا مختلفًا.';
  if(msg.includes('unit_belongs_to_other_material')) return 'الوحدة مرتبطة بمادة أخرى. أنشئ اسمًا جديدًا يوضح المادة، مثل «ملعقة سمنة».';
  if(msg.includes('unit_has_multiple_materials')) return 'هذه وحدة قديمة مرتبطة بأكثر من مادة. راجع التحويلات الحالية قبل حذفها أو تعديلها.';
  if(msg.includes('unit_has_global_conversions')) return 'هذه الوحدة لها تحويل عام يؤثر في عدة مواد، فلا يمكن تحويلها إلى وحدة خاصة تلقائيًا.';
  if(msg.includes('unit_system_readonly')) return 'الوحدات القياسية محمية. أنشئ وحدة جديدة باسم خاص بالمادة بدل تعديلها.';
  if(msg.includes('unit_base_factor_must_be_one')) return 'قيمة الوحدة الأساسية للمادة يجب أن تساوي 1.';
  if(msg.includes('unit_material_not_found')) return 'المادة المرتبطة لم تعد موجودة. حدّث الصفحة ثم جرّب مجددًا.';
  if(msg.includes('unit_relation_required')) return 'اختر المادة وأدخل قيمة الوحدة بالنسبة لوحدة مخزونها الأساسية.';
  if(msg.includes('invalid_material_unit_conversion')) return 'يجب أن تكون قيمة التحويل عددًا موجبًا صحيحًا.';
  if(msg.includes('unit_in_use')) return 'لا يمكن حذف هذه الوحدة لأنها مستخدمة في مواد أو معاملات حالية أو سابقة.';
  if(msg.includes('unit_name_required')) return 'اكتب اسم الوحدة.';
  if(msg.includes('function')&&msg.includes('not found')) return 'هذه الخدمة لم تُحدّث على الخادم بعد.';
  return fallback;
}
// Close dialogs with Escape, Cancel or the close button; not the backdrop.
// Never close while submitting: an accidental click must not duplicate a write.
export function modal({title,subtitle='',body='',submitText='\u062d\u0641\u0638',onSubmit=async()=>true,wide=false,hideActions=false,onClose=null}){
  const previouslyFocused=document.activeElement;
  const back=document.createElement('div');
  back.className='modal-backdrop';
  back.innerHTML=`<div class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><div><h3>${esc(title)}</h3>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div><button class="x-btn" type="button" aria-label="إغلاق النافذة">\u00d7</button></div><form class="modal-form" autocomplete="off">${body}${hideActions?'':`<div class="modal-actions"><button class="btn" type="submit">${esc(submitText)}</button><button class="btn secondary cancel" type="button">\u0625\u0644\u063a\u0627\u0621</button></div>`}</form></div>`;
  document.body.appendChild(back);
  let closed=false,busy=false;
  const onKey=e=>{
    if(e.key!=='Escape'||closed||busy)return;
    const dialogs=[...document.querySelectorAll('.modal-backdrop')];
    if(dialogs[dialogs.length-1]!==back)return;
    e.preventDefault();close();
  };
  const close=async()=>{
    if(closed||busy)return;
    closed=true;
    document.removeEventListener('keydown',onKey);
    back.remove();
    if(previouslyFocused?.isConnected&&typeof previouslyFocused.focus==='function')previouslyFocused.focus({preventScroll:true});
    if(onClose){try{await onClose();}catch(e){console.error(e);}}
  };
  back.querySelector('.x-btn').addEventListener('click',()=>close());
  back.querySelector('.cancel')?.addEventListener('click',()=>close());
  // v1.0.19: never close dialogs by clicking the backdrop.
  // Explicit close, Cancel, or Escape still work; accidental outside clicks
  // must never discard an edited purchase invoice or other form.
  document.addEventListener('keydown',onKey);
  const form=back.querySelector('form');
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(busy||closed)return;
    busy=true;
    const btn=form.querySelector('[type=submit]');
    if(btn)btn.disabled=true;
    let shouldClose=false;
    try{shouldClose=(await onSubmit(new FormData(form),form))!==false;}
    catch(error){console.error('Dialog action failed',error);toast(friendlyError(error),'error');}
    finally{busy=false;if(btn&&document.body.contains(btn))btn.disabled=false;}
    if(shouldClose)await close();
  });
  return {close,element:back,form};
}

// Resolve false on explicit dismissal (Escape, Cancel, close button).
export function confirmBox(message,yes='\u0646\u0639\u0645'){
  return new Promise(resolve=>{
    let decided=false;
    const finish=value=>{if(!decided){decided=true;resolve(value);}};
    modal({
      title:'\u062a\u0623\u0643\u064a\u062f',
      body:`<div class="notice rose">${esc(message)}</div>`,
      submitText:yes,
      onSubmit:async()=>{finish(true);return true;},
      onClose:()=>finish(false),
    });
  });
}
