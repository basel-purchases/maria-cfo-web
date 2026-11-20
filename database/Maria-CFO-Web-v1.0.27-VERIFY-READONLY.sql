-- Maria CFO Web v1.0.27 - READ ONLY verification, after installing migration.
-- No data is inserted/updated/deleted by this file.
SELECT 'hourly salary rate (preview)' AS component,
       to_regprocedure('public.employee_hour_rate_v127(uuid,date)') IS NOT NULL AS installed
UNION ALL SELECT 'hour or money salary adjustment',
       to_regprocedure('public.record_employee_adjustment_v127(uuid,text,text,numeric,date,text,text)') IS NOT NULL
UNION ALL SELECT 'employee profile + daily hours',
       to_regprocedure('public.save_employee_profile_hours_v127(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer,numeric)') IS NOT NULL;

SELECT column_name,data_type,numeric_precision,numeric_scale
FROM information_schema.columns
WHERE table_schema='public' AND table_name='employee_payroll_adjustments'
  AND column_name IN ('calc_mode_v127','entered_hours_v127','hourly_rate_v127',
    'monthly_hours_v127','monthly_workdays_v127','salary_basis_v127','pay_type_basis_v127')
ORDER BY column_name;

-- Read-only sample: materialize the eligible employees FIRST, so the preview
-- function is never invoked for inactive or fixed-wage employees.
WITH eligible AS MATERIALIZED (
 SELECT e.id,e.name,
   (now() AT TIME ZONE s.timezone)::date AS business_date
 FROM public.employees e JOIN public.app_settings s ON s.id=1
 WHERE e.pay_type='monthly' AND e.status='active'
   AND coalesce(e.archived_v123,false)=false
   AND (e.hire_date IS NULL OR e.hire_date<=(now() AT TIME ZONE s.timezone)::date)
   AND (e.termination_date IS NULL OR e.termination_date>=(now() AT TIME ZONE s.timezone)::date)
 ORDER BY e.name LIMIT 5
)
SELECT e.id,e.name,basis.currency_code,basis.salary_basis,
 basis.working_days,basis.monthly_hours,
 round(basis.hourly_rate,4) AS hourly_rate_preview
FROM eligible e
CROSS JOIN LATERAL public.employee_hour_rate_v127(e.id,e.business_date) AS basis;

-- Adjustment snapshots summary by entry mode (no amounts from disbursed salaries).
SELECT calc_mode_v127, status, COUNT(*) AS adjustments
FROM public.employee_payroll_adjustments
GROUP BY calc_mode_v127,status ORDER BY calc_mode_v127,status;
