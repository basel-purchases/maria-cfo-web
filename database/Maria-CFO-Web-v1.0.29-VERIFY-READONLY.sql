-- Read-only checks after applying v1.0.29 (do not run payments from SQL editor).
SELECT
 to_regprocedure('public.pay_approved_salaries_bulk_v129(date,uuid[],uuid,text)') IS NOT NULL AS batch_payment_rpc_installed,
 to_regprocedure('public.payroll_item_explanations_v129(date)') IS NOT NULL AS explanations_rpc_installed,
 to_regprocedure('public.pay_approved_salary_v034(uuid,numeric,uuid,text)') IS NOT NULL AS existing_atomic_payment_rpc;
SELECT p.proname,pg_get_function_arguments(p.oid) AS arguments,p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('pay_approved_salaries_bulk_v129','payroll_item_explanations_v129')
ORDER BY p.proname;
