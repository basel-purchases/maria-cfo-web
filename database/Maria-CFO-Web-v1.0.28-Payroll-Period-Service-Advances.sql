-- Maria CFO Web v1.0.28: user-selected payroll period, inclusive employment
-- date guards, immutable draft period checks, and authoritative advance balances.
-- Requires all payroll migrations through v1.0.27.1 (SQL through v1.0.27).
-- Does NOT reset/approve/pay payrolls, create cash movements or alter old balances.
BEGIN;
DO $required$
BEGIN
 IF to_regprocedure('public.create_monthly_payroll_v117(integer,integer)') IS NULL
    OR to_regprocedure('public.recalculate_monthly_payroll_v117(uuid)') IS NULL
    OR to_regprocedure('public.approve_monthly_payroll_v117(uuid)') IS NULL
    OR to_regprocedure('public.record_employee_advance(uuid,uuid,numeric,text,numeric,timestamp with time zone,text)') IS NULL
    OR to_regprocedure('public.record_employee_leave_v123(uuid,date,text,text)') IS NULL
    OR to_regclass('public.payroll_items') IS NULL
    OR to_regclass('public.employee_advances') IS NULL
 THEN RAISE EXCEPTION 'V128_REQUIRED_PAYROLL_MIGRATIONS_MISSING'; END IF;
END;
$required$;

-- Snapshot the effective start/end of the EMPLOYEE's service in this payroll
-- month, not the date the manager presses Create. Existing payrolls remain as is.
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS service_start_v128 date;
ALTER TABLE public.payroll_items ADD COLUMN IF NOT EXISTS service_end_v128 date;

CREATE OR REPLACE FUNCTION public.capture_monthly_service_v128(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_run public.payroll_runs%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR v_run.status <> 'draft' OR coalesce(v_run.note,'') NOT LIKE 'MARIA_MONTHLY_V014:%' THEN
  RAISE EXCEPTION 'V128_MONTHLY_DRAFT_REQUIRED';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.payroll_items pi JOIN public.employees e ON e.id=pi.employee_id
  WHERE pi.payroll_run_id=v_run.id AND pi.pay_type_snapshot='monthly'
   AND (e.pay_type<>'monthly' OR
     GREATEST(v_run.period_start,coalesce(e.hire_date,v_run.period_start)) >
       LEAST(v_run.period_end,coalesce(e.termination_date,v_run.period_end)))
 ) THEN RAISE EXCEPTION 'V128_EMPLOYEE_OUTSIDE_SERVICE'; END IF;
 UPDATE public.payroll_items pi SET
  service_start_v128=GREATEST(v_run.period_start,coalesce(e.hire_date,v_run.period_start)),
  service_end_v128=LEAST(v_run.period_end,coalesce(e.termination_date,v_run.period_end))
 FROM public.employees e
 WHERE pi.payroll_run_id=v_run.id AND pi.employee_id=e.id
   AND pi.pay_type_snapshot='monthly';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.validate_monthly_service_v128(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_run public.payroll_runs%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_run_id;
 IF NOT FOUND OR coalesce(v_run.note,'') NOT LIKE 'MARIA_MONTHLY_V014:%' THEN
  RAISE EXCEPTION 'V128_MONTHLY_RUN_REQUIRED'; END IF;
 -- A newly hired/updated eligible employee cannot be silently omitted from a
 -- stale draft. The original calculator's eligibility conditions are reused.
 IF EXISTS (
  SELECT 1 FROM public.employees e
  WHERE e.pay_type='monthly'
    AND (e.status='active' OR e.termination_date IS NOT NULL)
    AND coalesce(e.archived_v123,false)=false
    AND (e.hire_date IS NULL OR e.hire_date<=v_run.period_end)
    AND (e.termination_date IS NULL OR e.termination_date>=v_run.period_start)
    AND NOT EXISTS (SELECT 1 FROM public.payroll_items pi
      WHERE pi.payroll_run_id=v_run.id AND pi.employee_id=e.id)
 ) THEN RAISE EXCEPTION 'V128_EMPLOYEE_MISSING_RECALCULATE'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.payroll_items pi
  LEFT JOIN public.employees e ON e.id=pi.employee_id
  WHERE pi.payroll_run_id=v_run.id AND (
   pi.pay_type_snapshot<>'monthly' OR e.id IS NULL OR e.pay_type<>'monthly' OR
   pi.service_start_v128 IS NULL OR pi.service_end_v128 IS NULL OR
   pi.service_start_v128 IS DISTINCT FROM GREATEST(v_run.period_start,coalesce(e.hire_date,v_run.period_start)) OR
   pi.service_end_v128 IS DISTINCT FROM LEAST(v_run.period_end,coalesce(e.termination_date,v_run.period_end)) OR
   pi.service_start_v128>pi.service_end_v128)
 ) THEN RAISE EXCEPTION 'V128_SERVICE_DATES_CHANGED_RECALCULATE'; END IF;
END;
$fn$;

-- Dates entered in the dialog are period selectors; the server keeps created_at
-- as the actual creation timestamp. Passing Nov 18 in December creates Nov run.
CREATE OR REPLACE FUNCTION public.create_monthly_payroll_v128(p_period_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_period_date IS NULL OR p_period_date<date '2000-01-01' OR p_period_date>=date '2201-01-01' THEN
  RAISE EXCEPTION 'V128_INVALID_PERIOD_DATE'; END IF;
 v_id:=public.create_monthly_payroll_v117(extract(year from p_period_date)::integer,extract(month from p_period_date)::integer);
 PERFORM public.capture_monthly_service_v128(v_id);
 RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.recalculate_monthly_payroll_v128(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.recalculate_monthly_payroll_v117(p_run_id);
 PERFORM public.capture_monthly_service_v128(p_run_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_monthly_payroll_v128(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.validate_monthly_service_v128(p_run_id);
 PERFORM public.approve_monthly_payroll_v117(p_run_id);
END;
$fn$;

-- Protect approval even when an older browser still calls the v1.0.17 RPC.
CREATE OR REPLACE FUNCTION public.guard_monthly_service_approval_v128()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF OLD.status='draft' AND NEW.status IN ('approved','closed')
   AND coalesce(NEW.note,'') LIKE 'MARIA_MONTHLY_V014:%' THEN
  PERFORM public.validate_monthly_service_v128(NEW.id);
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS maria_monthly_service_approval_v128 ON public.payroll_runs;
CREATE TRIGGER maria_monthly_service_approval_v128
 BEFORE UPDATE OF status ON public.payroll_runs
 FOR EACH ROW EXECUTE FUNCTION public.guard_monthly_service_approval_v128();

-- All advance entry points (including legacy RPC) must respect service dates.
-- Repaid balances/old advance rows are not changed by this trigger.
CREATE OR REPLACE FUNCTION public.guard_employee_advance_service_v128()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_emp public.employees%ROWTYPE; v_timezone text; v_day date;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO v_emp FROM public.employees WHERE id=NEW.employee_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'V128_EMPLOYEE_NOT_FOUND'; END IF;
 SELECT timezone INTO v_timezone FROM public.app_settings WHERE id=1;
 v_day:=(NEW.occurred_at AT TIME ZONE coalesce(v_timezone,'UTC'))::date;
 IF v_day IS NULL OR (v_emp.hire_date IS NOT NULL AND v_day<v_emp.hire_date)
   OR (v_emp.termination_date IS NOT NULL AND v_day>v_emp.termination_date) THEN
  RAISE EXCEPTION 'V128_ADVANCE_OUTSIDE_EMPLOYMENT';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS maria_employee_advance_service_v128 ON public.employee_advances;
CREATE TRIGGER maria_employee_advance_service_v128
 BEFORE INSERT OR UPDATE OF employee_id,occurred_at ON public.employee_advances
 FOR EACH ROW EXECUTE FUNCTION public.guard_employee_advance_service_v128();

-- Typed DATE rather than browser-local timestamp: 12:00 is interpreted in
-- the restaurant's configured timezone. The legacy RPC still posts one cash
-- transaction and one advance in its original atomic transaction.
CREATE OR REPLACE FUNCTION public.record_employee_advance_v128(
 p_employee_id uuid,p_cashbox_id uuid,p_amount numeric,p_repayment_mode text,
 p_installment_amount numeric,p_work_date date,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_emp public.employees%ROWTYPE; v_timezone text; v_at timestamptz;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_work_date IS NULL THEN RAISE EXCEPTION 'V128_ADVANCE_DATE_REQUIRED'; END IF;
 SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND OR v_emp.status<>'active' OR coalesce(v_emp.archived_v123,false) THEN
  RAISE EXCEPTION 'V128_EMPLOYEE_NOT_ACTIVE'; END IF;
 IF (v_emp.hire_date IS NOT NULL AND p_work_date<v_emp.hire_date)
 OR (v_emp.termination_date IS NOT NULL AND p_work_date>v_emp.termination_date) THEN
  RAISE EXCEPTION 'V128_ADVANCE_OUTSIDE_EMPLOYMENT'; END IF;
 SELECT timezone INTO v_timezone FROM public.app_settings WHERE id=1;
 v_at:=(p_work_date::timestamp + interval '12 hours') AT TIME ZONE coalesce(v_timezone,'UTC');
 RETURN public.record_employee_advance(p_employee_id,p_cashbox_id,p_amount,p_repayment_mode,
  p_installment_amount,v_at,p_note);
END;
$fn$;

-- Leave entry points already guard range in record_employee_leave_v123;
-- enforce the same invariant for any direct attendance INSERT/UPDATE.
CREATE OR REPLACE FUNCTION public.guard_employee_leave_service_v128()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_hire date; v_end date;
BEGIN
 IF NEW.status NOT IN ('paid_leave','unpaid_leave','absent') THEN RETURN NEW; END IF;
 SELECT hire_date,termination_date INTO v_hire,v_end
 FROM public.employees WHERE id=NEW.employee_id FOR SHARE;
 IF NOT FOUND OR (v_hire IS NOT NULL AND NEW.work_date<v_hire)
  OR (v_end IS NOT NULL AND NEW.work_date>v_end) THEN
  RAISE EXCEPTION 'V128_LEAVE_OUTSIDE_EMPLOYMENT'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS maria_employee_leave_service_v128 ON public.employee_attendance;
CREATE TRIGGER maria_employee_leave_service_v128
 BEFORE INSERT OR UPDATE OF employee_id,work_date,status ON public.employee_attendance
 FOR EACH ROW EXECUTE FUNCTION public.guard_employee_leave_service_v128();

-- Do not show a planned deduction as if it already reduced the advance.
CREATE OR REPLACE FUNCTION public.employee_advance_outstanding_v128()
RETURNS TABLE(employee_id uuid,currency_code text,remaining_original numeric,open_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 RETURN QUERY SELECT a.employee_id,a.currency_code,
   sum(a.remaining_original)::numeric,count(*)::bigint
 FROM public.employee_advances a
 WHERE a.status='open' AND a.remaining_original>0
 GROUP BY a.employee_id,a.currency_code
 ORDER BY a.employee_id,a.currency_code;
END;
$fn$;

-- A change to a service boundary that would alter a *settled* monthly
-- payroll is not an ordinary profile edit; it requires a separately audited
-- historical payroll correction rather than rewriting financial history.
CREATE OR REPLACE FUNCTION public.guard_approved_service_dates_v128()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF OLD.hire_date IS NOT DISTINCT FROM NEW.hire_date
   AND OLD.termination_date IS NOT DISTINCT FROM NEW.termination_date THEN RETURN NEW; END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_runs pr
  WHERE pr.status IN ('approved','closed') AND pr.note LIKE 'MARIA_MONTHLY_V014:%'
   AND (
     GREATEST(pr.period_start,coalesce(OLD.hire_date,pr.period_start))
       <= LEAST(pr.period_end,coalesce(OLD.termination_date,pr.period_end))
     OR GREATEST(pr.period_start,coalesce(NEW.hire_date,pr.period_start))
       <= LEAST(pr.period_end,coalesce(NEW.termination_date,pr.period_end))
   ) AND (
    GREATEST(pr.period_start,coalesce(OLD.hire_date,pr.period_start))
      IS DISTINCT FROM GREATEST(pr.period_start,coalesce(NEW.hire_date,pr.period_start))
    OR LEAST(pr.period_end,coalesce(OLD.termination_date,pr.period_end))
      IS DISTINCT FROM LEAST(pr.period_end,coalesce(NEW.termination_date,pr.period_end))
   )
 ) THEN RAISE EXCEPTION 'V128_APPROVED_SERVICE_DATES_LOCKED'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS maria_approved_service_dates_v128 ON public.employees;
CREATE TRIGGER maria_approved_service_dates_v128
 BEFORE UPDATE OF hire_date,termination_date ON public.employees
 FOR EACH ROW EXECUTE FUNCTION public.guard_approved_service_dates_v128();

-- Fixed-pay work dates are also payroll evidence: their service range matters.
CREATE OR REPLACE FUNCTION public.guard_fixed_pay_service_v128()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_hire date;v_end date;
BEGIN
 SELECT hire_date,termination_date INTO v_hire,v_end
 FROM public.employees WHERE id=NEW.employee_id FOR SHARE;
 IF NOT FOUND OR NEW.work_date IS NULL
   OR (v_hire IS NOT NULL AND NEW.work_date<v_hire)
   OR (v_end IS NOT NULL AND NEW.work_date>v_end) THEN
  RAISE EXCEPTION 'V128_PAY_DATE_OUTSIDE_EMPLOYMENT'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS maria_fixed_pay_service_v128 ON public.employee_fixed_payments_v023;
CREATE TRIGGER maria_fixed_pay_service_v128
 BEFORE INSERT OR UPDATE OF employee_id,work_date ON public.employee_fixed_payments_v023
 FOR EACH ROW EXECUTE FUNCTION public.guard_fixed_pay_service_v128();

REVOKE ALL ON FUNCTION public.create_monthly_payroll_v128(date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.recalculate_monthly_payroll_v128(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_monthly_payroll_v128(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_employee_advance_v128(uuid,uuid,numeric,text,numeric,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.employee_advance_outstanding_v128() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.capture_monthly_service_v128(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_monthly_service_v128(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_employee_advance_service_v128() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_employee_leave_service_v128() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_monthly_service_approval_v128() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_approved_service_dates_v128() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_fixed_pay_service_v128() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_payroll_v128(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_monthly_payroll_v128(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_monthly_payroll_v128(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_employee_advance_v128(uuid,uuid,numeric,text,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_advance_outstanding_v128() TO authenticated;
COMMIT;
