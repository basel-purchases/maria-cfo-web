# Maria CFO Web v0.23 — الدفعتان الأولى والثانية

- إضافة مواد بوحدات عامة مختلفة، وإغلاق النوافذ بالنقر خارجها.
- تفاصيل الأوردر: إجمالي البنود، ضيافة صفر إيراد، خصم، رسوم، والمبلغ المقبوض؛ تصحيح الأوردر المنشور بمسار محاسبي عكسي محمي.
- إدارة تصنيفات المصروفات، تصدير Excel المفلتر، سجل حركات الصندوق اليدوية، وتحويل رصيد الصندوق للصندوق العام.
- المخزون: الكمية الكاملة والباقي، وسعر آخر شراء فعلي.
- الموظفون: أجر مقطوع مستقل عن الدوام، ضبط ساعات العمل والإضافي، إجازة مدفوعة ضمن حصة سنوية.
- إصلاح تعارض فترة الرواتب اليومية المختلفة، سجل مدفوعات برواتب مؤرشف ومصفح، سلف الموظفين وأقساطها وإحصاءات الرواتب.
- الأساسيات والممتلكات مع تنبيهات الحد الأدنى؛ تصنيفات المواد والمينيو والأساسيات وإعداداتها وفلاترها.
- تبسيط صفحة الصور مع إبقاء محرك OCR.space ومسارات المراجعة.

## تنبيه محاسبي
التحديث يتضمن تغييرات بنيوية ومالية مهمة. اجتاز اختبارات كود محلية، لكنه لم يُجرب على قاعدة Supabase الحية أو على نسخة PostgreSQL متطابقة. نفّذ SQL وعمليات دفع الرواتب وعكس الأوردر وتصفير الصندوق على قاعدة اختبار مستنسخة قبل الإنتاج.

## Web v0.22 - OCR text-to-items correction

- New conservative parsing for Engine 3 receipts whose text contains a name column followed by numeric columns.
- No automatic creation of items during OCR. Button for manual conversion remains mandatory.
- Derived unit prices and inconsistent totals receive review notices.
- Engine 1 E201/Arabic error is mapped to a human-readable notice in OCR Edge Function.
- No new database migration and no financial ledger changes.
- Local regression tests for columnar receipts and mismatched alignment.

## Web v0.21 - OCR.space and Images UX

- New `ocr-space` authenticated Supabase Edge Function; secret `OCR_SPACE_API_KEY` stays on the server.
- Per-engine attempt counters (day and month) via owner-only audit table, not provider balance.
- Horizontal gallery, full-width review, cashbox in publish panel; fast/strong cloud OCR.
- OCR only updates editable text; user alone starts extracting draft items.
- Searchable catalog, explicit new-material base unit, new menu item dialog with recipe ingredients.
- Financial posting still requires explicit confirmation and uses existing RPCs.
- Previous account data and schema unaffected except audit-only v0.21 table.

# سجل التغييرات — Maria CFO Web v0.20

- عرض الرصيد بوحدات مفهومة متى كانت العلاقة مسجلة، مثل 34 كرتونة و14 ظرف، مع بقاء الرصيد الأصلي ظاهرًا.
- عرض علاقة الظرف والكرتونة بالاتجاه الأسهل: 1 كرتونة = 24 ظرفًا.
- إضافة خانة «اعكس العلاقة» في محرر الوحدات. تقليب العرض لا يغير قيمة التحويل المخزنة عند الحفظ إن لم يحرر المستخدم المقدار.
- إصلاح إنشاء البنود تلقائيًا عند OCR: النص فقط أولًا، والبنود باختيار صريح من المستخدم بعد مراجعة النص.
- إضافة مؤشر تقدم OCR كنسبة بجانب زر الاستخراج، وحذف بند أو حذف جميع البنود.
- اختيار منطقة القراءة من الصورة، مع تجربة ثلاث معالجات محلية في الوضع الدقيق، وتحذير بشأن ضعف التعرف على الخط العربي اليدوي.
- لا تغيير SQL أو بيانات المخزون أو Supabase Edge Functions؛ استمرار استخدام تخزين صور v0.19 المحلي.

---

# سجل التغييرات — Maria CFO Web v0.19

- إصلاح خطأ `cashbox_transactions_transaction_type_check` عبر تحديث الدالة المحمية لتسجيل `adjustment_in` و`adjustment_out` بدل `adjustment` دون حذف القيود.
- عرض علاقات الوحدات بالغرام/الكيلوغرام والملليلتر/اللتر حسب المقدار، مع تبديل الوحدة داخل محرر التحويلات دون إعادة كتابة وحدة المخزون الأساسية.
- إضافة صفحة «الصور» مع IndexedDB في المتصفح، وOCR محلي عربي/إنجليزي بوضعَي عادي ودقيق.
- مراجعة صورة ومستند على جانبي الشاشة، وتغيير النوع بين أوردر وفاتورة، وتحرير البنود وربطها بالمواد أو الوجبات الموجودة.
- دعم حفظ النتيجة محليًا ثم إنشاء مسودة أو نشر محمي؛ والنشر الجماعي للمستندات المكتملة فقط، مع حالات مميزة لغير المعالج والناقص والمنشور.
- تجنب إعادة محاولة التسجيل المالي تلقائيًا عند عدم اليقين بحدوثه؛ إظهار طلب مراجعة لتفادي التكرار.
- تطوير الاختبارات والوثائق؛ لا تغيير على `config.js` أو دوال OCR/AI المنشورة.

---

# Maria CFO Web v0.13

## الأوردرات
- إضافة طبقة توافق جديدة `add_order_item_v013` حتى لا يعتمد الموقع على توقيع قديم محدد لـ `add_order_item`.
- نشر الأوردر أصبح يمر عبر `post_order_v013`، والذي يضمن وجود جلسة الصندوق قبل استدعاء منطق النشر الأصلي.
- رسائل أوضح عند تعذر إضافة صنف أو نشر الأوردر بدل الخطأ العام قدر الإمكان.
- تحديث `document-ocr` ليستخدم نفس طبقة حفظ الأصناف الجديدة عند إنشاء أوردر من صورة.

## الصناديق
- فتح جلسات اليوم تلقائيًا للصناديق النشطة.
- عرض الرصيد المتوقع الحالي بدل بطاقات أسماء فقط.
- إضافة زر «إضافة / سحب رصيد» لتسجيل الرصيد الافتتاحي أو أي حركة نقدية يدوية حقيقية عبر Ledger محمي.
- شرح واضح أن المبيعات تزيد الصندوق والمصروفات والدفعات تخفضه تلقائيًا.
- عرض جلسات اليوم وحالتها ورصيدها المتوقع.

## المصروفات
- عرض المبلغ والعملة والتصنيف والصندوق والمدفوع له والتفاصيل والتاريخ.
- إضافة ملخص إجمالي SYP وUSD وعدد العمليات.
- إضافة نافذة تفاصيل لكل مصروف.
- إضافة حقل تفاصيل إضافية عند تسجيل المصروف.
- التأكد من وجود جلسة الصندوق قبل تسجيل المصروف.

## الذكاء الاصطناعي
- الإبقاء على نظام المهام الخلفية من v0.12.
- إصلاح مسار إنشاء مسودة أوردر من OCR ليستخدم `add_order_item_v013` بدل استدعاء `add_order_item` القديم مباشرة.

## قاعدة البيانات
- يجب تشغيل `database/Maria_CFO_Web_v0.13_Migration.sql` مرة واحدة قبل اختبار الأوردرات والصناديق.
- بعد تشغيله يجب إعادة نشر `document-ocr` من ملف v0.13.

## Web v0.13.2 — توافق الموظفين والدوام والحفلات

- تصحيح إنشاء الموظف بحيث يُحفظ `hourly_rate_original` أو `daily_rate_original` أو `monthly_salary_original` حسب `pay_type`، دون إعادة المحاولة بموظف ناقص الأجر.
- عرض حقل الأجر الحقيقي في قائمة الموظفين للتأكد من صحة البيانات المحفوظة.
- فحص النقص المطبق قبل حفظ الدوام وفق الحساب نفسه المستخدم في قاعدة البيانات؛ مع رسالة عربية تشرح أن الخصم الإداري الإضافي يخص قسم الرواتب.
- تصحيح `create_event`: استخدام `p_default_price` وتوفير كامل أسماء معاملات RPC الحية الاثني عشر بدل `p_default_price_original`.
- تغيير معرّف الإصدارات في HTML وجميع روابط وحدات JavaScript المحلية لمنع استخدام الكود القديم المخزّن في المتصفح.
- تحسين رسائل أخطاء Supabase لهذه العمليات؛ دون تغيير قاعدة البيانات أو Edge Functions.

## v0.14.0 — الرواتب والتقارير

- إصلاح جذر ظهور رواتب فارغة: كانت الصفحة تعرض `payroll_run_summary` فقط، رغم وجود دوام يومي/ساعي.
- إضافة قوائم المستحقات اليومية والساعية المستمدة من الدوام مع تسوية مالية داخل معاملة واحدة تعتمد على وظائف payroll وcashbox الأصلية.
- منع تداخل المسيرات المعتمدة لنفس الموظف والمدة ومنع تعديل دوام راتب معتمد، وصندوق راتب محدد في إعدادات Supabase.
- سجل دفعات وسداد جزئي ومسيرات شهرية للموظفين الشهريين.
- ألوان موحدة لأنواع أجور الموظفين.
- لوحة مدير موسّعة، وتقرير متكامل يقرأ أسماء مفاتيح JSON الحقيقية مع تحذيرات الربح المؤقت.
- استبدال «جاري المحاولة» بـ «جاري الإجابة» في المساعد.
- Migration جديد v0.14؛ لا يغير migrations التاريخية.

## Maria CFO Web v0.17 — الوكيل التشغيلي المستقل بضوابط مالية

- ترقية `assistant` إلى وكيل بصلاحيات المالك، وأدوات قراءة مالية وإدخالات مباشرة للموظفين والموردين والمواد والحفلات والدوام ومسودات المبيعات والمشتريات.
- دعم سياق المشروع، طرح أسئلة عن الحقول المطلوبة، تنفيذ سلاسل أدوات محدودة، وروابط التنقل إلى الأقسام.
- OCR صور أوردرات وفواتير مع جدول مراجعة وتعديل الكمية والسعر والخصم والوحدة، والتنبيه إلى الثقة المنخفضة؛ حفظ مسودة فقط بعد موافقة.
- اقتراحات مالية بمدة صلاحية 15 دقيقة وموافقة مستقلة وتسجيل نتيجة التنفيذ في جدول صاحب الحساب.
- رسالة سبب محدد عند تعطل Gemini، ونماذج بديلة عند توفرها، وتنفيذ مباشر لأوامر الموظفين وقراءات شائعة دون الاعتماد على النموذج.
- `get_daily_wage_dues_v017` و`pay_daily_wage_v017` يحميان من صرف أجر يومي عند صفر ساعات فعلية دون إجازة مدفوعة صريحة، مع بقاء سجلات الرواتب القديمة والتكاليف التاريخية دون تغيير.
- إصدار الواجهة ومراجع وحدات JavaScript محدثة إلى v0.17؛ لا ملفات config أو Git ضمن التسليم.
- أضيف ملف نشر Edge Function موحد `dashboard-single-file.ts` لسهولة اللصق في محرر Supabase دون الحاجة إلى CLI.

**ملاحظة النشر:** يتطلب SQL v0.17 ونشر Edge Function `assistant` ونشر ملفات الموقع؛ لا يكفي GitHub Pages وحده.

## Maria CFO Web v0.17 — الوكيل التشغيلي المستقل بضوابط مالية

- ترقية `assistant` إلى وكيل بصلاحيات المالك، وأدوات قراءة مالية وإدخالات مباشرة للموظفين والموردين والمواد والحفلات والدوام ومسودات المبيعات والمشتريات.
- دعم سياق المشروع، طرح أسئلة عن الحقول المطلوبة، تنفيذ سلاسل أدوات محدودة، وروابط التنقل إلى الأقسام.
- OCR صور أوردرات وفواتير مع جدول مراجعة وتعديل الكمية والسعر والخصم والوحدة، والتنبيه إلى الثقة المنخفضة؛ حفظ مسودة فقط بعد موافقة.
- اقتراحات مالية بمدة صلاحية 15 دقيقة وموافقة مستقلة وتسجيل نتيجة التنفيذ في جدول صاحب الحساب.
- رسالة سبب محدد عند تعطل Gemini، ونماذج بديلة عند توفرها، وتنفيذ مباشر لأوامر الموظفين وقراءات شائعة دون الاعتماد على النموذج.
- `get_daily_wage_dues_v017` و`pay_daily_wage_v017` يحميان من صرف أجر يومي عند صفر ساعات فعلية دون إجازة مدفوعة صريحة، مع بقاء سجلات الرواتب القديمة والتكاليف التاريخية دون تغيير.
- إصدار الواجهة ومراجع وحدات JavaScript محدثة إلى v0.17؛ لا ملفات config أو Git ضمن التسليم.
- أضيف ملف نشر Edge Function موحد `dashboard-single-file.ts` لسهولة اللصق في محرر Supabase دون الحاجة إلى CLI.

**ملاحظة النشر:** يتطلب SQL v0.17 ونشر Edge Function `assistant` ونشر ملفات الموقع؛ لا يكفي GitHub Pages وحده.

---

## Maria CFO Web v0.18 — دليل الوحدات والعلاقات

- إضافة جدول تفصيلي في **الإعدادات ← الوحدات وعلاقاتها** يعرض مقدار الوحدة ووحدة مخزون المادة المرتبطة بها (مثال: 1 ملعقة سكر = 5 غرام من السكر)، والتحويلات العامة المخزنة في `unit_conversions`.
- إضافة/تعديل/حذف الوحدات الخاصة مع علاقة المادة وقيمتها من نافذة واحدة، والحماية من حذف الوحدات المستخدمة.
- أسماء الوحدات الجديدة لا تتكرر بعد تطبيع الحروف والمسافات والتشكيل، مع الحفاظ على أسماء قديمة متكررة للمراجعة دون دمج خطر.
- الوحدة الخاصة بمادة واحدة لا يمكن استخدامها مادة أخرى؛ يُطلب اسم واضح مثل «ملعقة سمنة» بدلاً من «ملعقة» عندما تختلف القيمة.
- الوحدات القياسية العامة مثل الغرام والكيلوغرام تبقى مشتركة ولا تسمح الصفحة بتعديل قيمها القياسية.
- تحديث مسار التحويلات داخل صفحة المواد ليستخدم RPC ذرية للوحدات المخصصة بدل إنشاء وحدة غامضة ثم ربطها لاحقًا.
- إبقاء بيانات المبيعات والمشتريات المنشورة والتكاليف التاريخية والصناديق دون تغيير.
- هذا الإصدار لا يتطلب تحديث `assistant` أو `document-ocr`، ولا يتضمن `config.js` أو ملفات Git.

## Web v0.24 - Al-Ameen Excel quick imports
- New Quick Imports page: manual XLSX, mandatory type check, preview, confirmation, progress, recent imports.
- New toolbar Refresh with permission-based Chrome/Edge desktop folder selection.
- Inventory sections map to menu/material/essential-assets catalogs, preserving three source warehouses.
- Daily orders are staged as review-required drafts, never posted or paid automatically.
- Supplier statements are stored as source balances/entries without new financial transactions.
- Owner-only atomic import RPC, SHA256 + source-key idempotency, snapshot reconciliation and posting guards.
- Vendored JSZip (MIT) and v0.24 database migration. See `README_v024.md` for deployment limitations.

## Web v0.25 — Tables, pagination and full Al-Ameen statement visibility

- Corrected material-list column compression (button labels no longer stack vertically).
- Unified RTL dropdown styling across application forms.
- Server-side pagination for menu (18/page) and orders (25/page), plus client pagination for essentials and suppliers.
- Show imported warehouse snapshots and reference prices in materials/essentials, with complete source detail dialogs.
- Unified supplier table and supplier statement balances, supporting overdue-positive-balance filters and source movement drill-down.
- New nullable `uncollected_papers_v025` report field, populated from Excel via owner-checked `import_ameen_v024` and safe same-file supplementary-field refresh.
- No automatic supplier payment or order posting is added.
