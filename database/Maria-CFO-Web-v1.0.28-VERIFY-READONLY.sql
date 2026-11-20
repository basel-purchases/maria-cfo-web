-- Maria CFO Web v1.0.28: post-migration read-only verification.
-- Execute on a staging clone first. No INSERT, UPDATE, DELETE, or DDL.
SELECT
  to_regprocedure('public.create_monthly_payroll_v128(date)') IS NOT NULL AS payroll_period_rpc,
  to_regprocedure('public.recalculate_monthly_payroll_v128(uuid)') IS NOT NULL AS payroll_recalculate_rpc,
  to_regprocedure('public.approve_monthly_payroll_v128(uuid)') IS NOT NULL AS payroll_approval_rpc,
  to_regprocedure('public.record_employee_advance_v128(uuid,uuid,numeric,text,numeric,date,text)') IS NOT NULL AS dated_advance_rpc,
  to_regprocedure('public.employee_advance_outstanding_v128()') IS NOT NULL AS advance_balance_rpc;

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='payroll_items' AND column_name='service_start_v128') AS start_snapshot_column,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='payroll_items' AND column_name='service_end_v128') AS end_snapshot_column;

SELECT t.tgname AS trigger_name, c.relname AS table_name, NOT t.tgisinternal AS enabled
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND t.tgname IN (
  'maria_monthly_service_approval_v128',
  'maria_employee_advance_service_v128',
  'maria_employee_leave_service_v128',
  'maria_approved_service_dates_v128',
  'maria_fixed_pay_service_v128'
)
ORDER BY trigger_name;

-- Drafts created before v1.0.28 need explicit recalculation and service capture.
SELECT count(*) AS legacy_monthly_draft_items_needing_recalc
FROM public.payroll_items pi
JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
WHERE pr.status='draft' AND pr.note LIKE 'MARIA_MONTHLY_V014:%'
  AND (pi.service_start_v128 IS NULL OR pi.service_end_v128 IS NULL);

-- Historical records outside employment are counted for review only;
-- the migration intentionally does not rewrite or cancel them.
SELECT count(*) AS historical_advances_outside_employee_service
FROM public.employee_advances a
JOIN public.employees e ON e.id=a.employee_id
LEFT JOIN public.app_settings s ON s.id=1
WHERE (e.hire_date IS NOT NULL
       AND (a.occurred_at AT TIME ZONE coalesce(s.timezone,'UTC'))::date<e.hire_date)
   OR (e.termination_date IS NOT NULL
       AND (a.occurred_at AT TIME ZONE coalesce(s.timezone,'UTC'))::date>e.termination_date);

SELECT a.currency_code, count(*) AS open_advance_count, sum(a.remaining_original) AS total_outstanding
FROM public.employee_advances a
WHERE a.status='open' AND a.remaining_original>0
GROUP BY a.currency_code ORDER BY a.currency_code;
