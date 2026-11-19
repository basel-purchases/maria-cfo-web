-- Maria CFO Web v1.0.23 | READ ONLY verification. No INSERT/UPDATE/DELETE.
-- Run AFTER the main v1.0.23 migration in Supabase SQL Editor.
WITH required(name,signature) AS (
 VALUES
 ('دفع فاتورة شراء من الصندوق العام','public.post_purchase_invoice_paid_v123(uuid)'),
 ('سلفة الموظف/حسم/مكافأة ضمن ملفه','public.record_employee_adjustment_v123(uuid,text,numeric,date,text,text)'),
 ('تسجيل إجازة/غياب','public.record_employee_leave_v123(uuid,date,text,text)'),
 ('اعتماد أيام العمل التلقائية','public.prepare_scheduled_workdays_v123(date,date)'),
 ('حذف أو أرشفة موظف','public.remove_employee_v123(uuid)'),
 ('حفظ ملف الموظف والتسوية النهائية','public.save_employee_final_profile_v123(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer)'),
 ('احتساب الشهر الأخير','public.apply_final_month_salary_v123(uuid,boolean)'),
 ('إنشاء مسير شهري','public.create_monthly_payroll_v117(integer,integer)'),
 ('إعادة احتساب مسير شهري','public.recalculate_monthly_payroll_v117(uuid)'),
 ('اعتماد مسير شهري','public.approve_monthly_payroll_v117(uuid)')
)
SELECT name, CASE WHEN to_regprocedure(signature) IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM required
UNION ALL
SELECT 'عمود الأيام المستحقة في شهر الانتهاء',CASE WHEN EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='employees'
 AND column_name='termination_paid_days_v123') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'حماية التعديل بعد اعتماد الراتب',CASE WHEN EXISTS (
 SELECT 1 FROM pg_catalog.pg_trigger
 WHERE tgrelid='public.employees'::regclass AND tgname='employees_guard_final_month_v123'
   AND NOT tgisinternal) THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT 'صندوق عام نشط واحد',CASE WHEN (SELECT COUNT(*) FROM public.cashboxes
 WHERE is_general AND is_active)=1 THEN 'OK' ELSE 'CHECK' END
ORDER BY name;

-- Counts only; does not expose employee names or confidential data.
SELECT
 (SELECT COUNT(*) FROM public.employees WHERE termination_paid_days_v123 IS NOT NULL) AS employees_with_explicit_final_days,
 (SELECT COUNT(*) FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
  WHERE pr.status='draft' AND pi.note LIKE '%FINAL_MONTH_V123:%') AS draft_explicit_final_month_items,
 (SELECT COUNT(*) FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
  WHERE pr.status IN ('approved','closed') AND pi.note LIKE '%FINAL_MONTH_V123:%') AS approved_final_month_items;
