-- Maria CFO Web v1.0.27: additions/deductions in cash OR hours.
-- No cash payment is produced. Existing approved payroll and financial history are untouched.
-- Prerequisite: all migrations through v1.0.26, especially employee v1.0.23.
BEGIN;

DO $requirements$
BEGIN
 IF to_regclass('public.employee_payroll_adjustments') IS NULL
    OR to_regclass('public.employees') IS NULL
    OR to_regclass('public.employee_schedule_days') IS NULL
    OR to_regprocedure('public.get_employee_expected_hours(uuid,date)') IS NULL
    OR to_regprocedure('public.record_employee_adjustment_v123(uuid,text,numeric,date,text,text)') IS NULL
    OR to_regprocedure('public.save_employee_final_profile_v123(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer)') IS NULL
 THEN RAISE EXCEPTION 'V127_REQUIRES_PREVIOUS_EMPLOYEE_MIGRATIONS'; END IF;
END;
$requirements$;

-- Audit snapshot: later salary/shift changes never rewrite the original adjustment.
ALTER TABLE public.employee_payroll_adjustments
 ADD COLUMN IF NOT EXISTS calc_mode_v127 text NOT NULL DEFAULT 'money',
 ADD COLUMN IF NOT EXISTS entered_hours_v127 numeric(10,2),
 ADD COLUMN IF NOT EXISTS hourly_rate_v127 numeric(24,8),
 ADD COLUMN IF NOT EXISTS monthly_hours_v127 numeric(10,2),
 ADD COLUMN IF NOT EXISTS monthly_workdays_v127 integer,
 ADD COLUMN IF NOT EXISTS salary_basis_v127 numeric(20,4),
 ADD COLUMN IF NOT EXISTS pay_type_basis_v127 text;
DO $constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint
   WHERE conname='employee_adjustments_v127_mode_check'
     AND conrelid='public.employee_payroll_adjustments'::regclass) THEN
  ALTER TABLE public.employee_payroll_adjustments
   ADD CONSTRAINT employee_adjustments_v127_mode_check CHECK (
    (calc_mode_v127='money' AND entered_hours_v127 IS NULL AND hourly_rate_v127 IS NULL)
    OR (calc_mode_v127='hours' AND entered_hours_v127>0 AND hourly_rate_v127>0
        AND salary_basis_v127>0 AND pay_type_basis_v127 IN ('monthly','daily','hourly'))
   );
 END IF;
END;
$constraint$;

-- The authoritative hourly divisor for monthly salaries is ALL scheduled hours
-- in the selected calendar month, EXCLUDING EVERY FRIDAY (ISO day 5).
-- Existing per-employee weekly schedules are honored on the other six days.
-- Daily/hourly employees use their actual pay basis; fixed pay is unsupported.
CREATE OR REPLACE FUNCTION public.employee_hour_rate_v127(p_employee_id uuid,p_effective_date date)
RETURNS TABLE(pay_type text,currency_code text,salary_basis numeric,
 hourly_rate numeric,monthly_hours numeric,working_days integer,daily_hours numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_employee public.employees%ROWTYPE; v_start date; v_end date;
 v_total numeric:=0; v_days integer:=0; v_day_hours numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_employee_id IS NULL OR p_effective_date IS NULL
    OR p_effective_date<DATE '2000-01-01' THEN RAISE EXCEPTION 'V127_INVALID_DATE'; END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id;
 IF NOT FOUND OR v_employee.status<>'active' OR v_employee.archived_v123 THEN
   RAISE EXCEPTION 'V127_EMPLOYEE_NOT_ACTIVE'; END IF;
 IF (v_employee.hire_date IS NOT NULL AND p_effective_date<v_employee.hire_date)
    OR (v_employee.termination_date IS NOT NULL AND p_effective_date>v_employee.termination_date) THEN
   RAISE EXCEPTION 'V127_DATE_OUTSIDE_EMPLOYMENT'; END IF;
 IF v_employee.pay_type NOT IN ('monthly','daily','hourly') THEN
   RAISE EXCEPTION 'V127_FIXED_WAGE_NOT_HOURLY'; END IF;
 pay_type:=v_employee.pay_type;
 currency_code:=v_employee.wage_currency_code;
 daily_hours:=v_employee.required_daily_hours;
 IF pay_type='monthly' THEN
   salary_basis:=v_employee.monthly_salary_original;
   v_start:=pg_catalog.date_trunc('month',p_effective_date::timestamp)::date;
   v_end:=(v_start+interval '1 month'-interval '1 day')::date;
   SELECT coalesce(sum(x.hours),0),count(*) FILTER (WHERE x.hours>0)
    INTO v_total,v_days
   FROM (
    SELECT CASE WHEN EXTRACT(ISODOW FROM g.d::date)=5 THEN 0::numeric
      ELSE greatest(coalesce(public.get_employee_expected_hours(p_employee_id,g.d::date),0),0)
      END AS hours
    FROM pg_catalog.generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') AS g(d)
   ) x;
   IF v_total<=0 OR salary_basis IS NULL OR salary_basis<=0 THEN
     RAISE EXCEPTION 'V127_MONTH_SCHEDULE_INVALID'; END IF;
   monthly_hours:=v_total;
   working_days:=v_days;
   hourly_rate:=salary_basis/v_total;
 ELSIF pay_type='daily' THEN
   salary_basis:=v_employee.daily_rate_original;
   v_day_hours:=CASE WHEN EXTRACT(ISODOW FROM p_effective_date)=5
     THEN v_employee.required_daily_hours
     ELSE public.get_employee_expected_hours(p_employee_id,p_effective_date) END;
   IF coalesce(v_day_hours,0)<=0 OR coalesce(salary_basis,0)<=0 THEN
     RAISE EXCEPTION 'V127_DAILY_HOURS_INVALID'; END IF;
   daily_hours:=v_day_hours;
   hourly_rate:=salary_basis/v_day_hours;
 ELSE
   salary_basis:=v_employee.hourly_rate_original;
   hourly_rate:=salary_basis;
 END IF;
 IF coalesce(hourly_rate,0)<=0 THEN RAISE EXCEPTION 'V127_HOURLY_RATE_INVALID'; END IF;
 RETURN NEXT;
END;
$fn$;

-- One atomic transaction: calculate the hourly amount, use the existing v1.0.23
-- payroll adjustment engine (approval-period checks, locks, deduplication), then
-- snapshot the hours/rate on the SAME ledger row.
CREATE OR REPLACE FUNCTION public.record_employee_adjustment_v127(
 p_employee_id uuid,p_kind text,p_value_kind text,p_value numeric,
 p_effective_date date,p_reason text,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_rate record; v_amount numeric; v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_kind NOT IN ('addition','deduction') OR p_value_kind NOT IN ('money','hours')
    OR p_value IS NULL OR p_value<=0 OR p_effective_date IS NULL THEN
   RAISE EXCEPTION 'V127_INVALID_ADJUSTMENT'; END IF;
 IF p_value_kind='hours' AND (p_value>744 OR p_value<>round(p_value,2)) THEN
   RAISE EXCEPTION 'V127_HOURS_OUT_OF_RANGE'; END IF;
 -- Respect the legacy employee-level locking order to avoid deadlocks.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('maria_employee_v123:'||p_employee_id::text,0));
 -- Lock the employee before reading the hourly basis; a concurrent salary edit
 -- must not change the wage between rate calculation and ledger insertion.
 PERFORM 1 FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF p_value_kind='hours' THEN
   SELECT * INTO v_rate FROM public.employee_hour_rate_v127(p_employee_id,p_effective_date);
   v_amount:=round(v_rate.hourly_rate*p_value,4);
 ELSE
   v_amount:=p_value;
 END IF;
 IF v_amount<=0 OR v_amount>1000000000000 THEN
   RAISE EXCEPTION 'V127_AMOUNT_OUT_OF_RANGE'; END IF;
 v_id:=public.record_employee_adjustment_v123(
    p_employee_id,p_kind,v_amount,p_effective_date,p_reason,p_note);
 IF p_value_kind='hours' THEN
  UPDATE public.employee_payroll_adjustments
    SET calc_mode_v127='hours',entered_hours_v127=p_value,
      hourly_rate_v127=round(v_rate.hourly_rate,8),
      monthly_hours_v127=v_rate.monthly_hours,
      monthly_workdays_v127=v_rate.working_days,
      salary_basis_v127=v_rate.salary_basis,
      pay_type_basis_v127=v_rate.pay_type
    WHERE id=v_id;
 END IF;
 RETURN v_id;
END;
$fn$;

-- Update a specific employee's daily hours together with all other profile
-- changes, in one PostgreSQL transaction. No paid salary is recalculated.
CREATE OR REPLACE FUNCTION public.save_employee_profile_hours_v127(
 p_employee_id uuid,p_name text,p_job_title text,p_department text,
 p_residence text,p_mobile_phone text,p_pay_type text,p_wage numeric,
 p_currency text,p_status text,p_hire_date date,p_termination_date date,
 p_notes text,p_paid_days integer,p_daily_hours numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_daily_hours IS NULL OR p_daily_hours<0.25 OR p_daily_hours>24
    OR p_daily_hours<>round(p_daily_hours,2) THEN
    RAISE EXCEPTION 'V127_DAILY_HOURS_INVALID'; END IF;
 PERFORM public.save_employee_final_profile_v123(p_employee_id,p_name,p_job_title,
  p_department,p_residence,p_mobile_phone,p_pay_type,p_wage,p_currency,
  p_status,p_hire_date,p_termination_date,p_notes,p_paid_days);
 UPDATE public.employees SET required_daily_hours=p_daily_hours
  WHERE id=p_employee_id AND required_daily_hours IS DISTINCT FROM p_daily_hours;
 RETURN p_employee_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.employee_hour_rate_v127(uuid,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_employee_adjustment_v127(uuid,text,text,numeric,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_employee_profile_hours_v127(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.employee_hour_rate_v127(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_employee_adjustment_v127(uuid,text,text,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_profile_hours_v127(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer,numeric) TO authenticated;
COMMIT;
