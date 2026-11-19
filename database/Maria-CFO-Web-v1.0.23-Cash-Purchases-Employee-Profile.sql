-- Maria CFO Web v1.0.23: single-transaction purchase posting/payment;
-- employee-ledger actions; no attendance screen, with full scheduled days
-- assumed for daily/hourly employees unless an explicit leave exception exists.
-- NO DESTRUCTIVE DATA RESETS. Apply after the v1.0.20 corrected SQL.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.post_purchase_invoice(uuid)') IS NULL
    OR to_regprocedure('public.record_supplier_invoice_payment(uuid,uuid,numeric,text,timestamp with time zone,numeric,text)') IS NULL
    OR to_regprocedure('public.record_employee_bonus_v032(uuid,numeric,date,text,text)') IS NULL
    OR to_regprocedure('public.set_employee_attendance(uuid,date,numeric,text,numeric,numeric,numeric,text)') IS NULL
    OR to_regprocedure('public.pay_daily_wage_v034(uuid,date,uuid)') IS NULL
    OR to_regclass('public.employee_payroll_adjustments') IS NULL
  THEN RAISE EXCEPTION 'V123_REQUIRED_PRIOR_MIGRATIONS_MISSING'; END IF;
  IF (SELECT count(*) FROM public.cashboxes WHERE is_general AND is_active) <> 1 THEN
    RAISE EXCEPTION 'V123_ONE_ACTIVE_GENERAL_CASHBOX_REQUIRED';
  END IF;
END;
$guard$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS archived_v123 boolean NOT NULL DEFAULT false;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS archived_at_v123 timestamptz;
CREATE INDEX IF NOT EXISTS employees_archived_v123_idx ON public.employees(archived_v123, status);

-- Called ONCE per user action. Both posting inventory and disbursing supplier
-- payment roll back together if either step fails. A replay cannot pay twice.
CREATE OR REPLACE FUNCTION public.post_purchase_invoice_paid_v123(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_inv public.purchase_invoices%ROWTYPE; v_box uuid; v_payment uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_inv.status<>'draft' OR coalesce(v_inv.is_voided,false) THEN
    RAISE EXCEPTION 'V123_INVOICE_NOT_DRAFT_ALREADY_POSTED';
  END IF;
  SELECT id INTO v_box FROM public.cashboxes WHERE is_general AND is_active FOR UPDATE;
  IF v_box IS NULL THEN RAISE EXCEPTION 'V123_ACTIVE_GENERAL_CASHBOX_NOT_FOUND'; END IF;
  PERFORM public.post_purchase_invoice(p_invoice_id);
  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id=p_invoice_id;
  IF v_inv.status <> 'posted' THEN RAISE EXCEPTION 'V123_POSTING_NOT_CONFIRMED'; END IF;
  IF v_inv.total_original <= 0 THEN RAISE EXCEPTION 'V123_POSITIVE_INVOICE_TOTAL_REQUIRED'; END IF;
  v_payment := public.record_supplier_invoice_payment(
    p_invoice_id,v_box,v_inv.total_original,v_inv.currency_code,now(),v_inv.total_original,
    'V123_AUTO_FULL_PAYMENT_FROM_GENERAL_CASHBOX'
  );
  IF NOT EXISTS (SELECT 1 FROM public.supplier_payment_allocations a
                 WHERE a.payment_id=v_payment AND a.invoice_id=p_invoice_id
                   AND a.amount_invoice_currency=v_inv.total_original) THEN
    RAISE EXCEPTION 'V123_FULL_PAYMENT_ALLOCATION_NOT_CONFIRMED';
  END IF;
  RETURN v_payment;
END;
$fn$;

-- This adjusts only PENDING payroll calculations. Approved/paid payroll is
-- never rewritten, and salary/advance cash movements are not made here.
CREATE OR REPLACE FUNCTION public.record_employee_adjustment_v123(
  p_employee_id uuid,p_kind text,p_amount numeric,p_effective_date date,
  p_reason text,p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_emp public.employees%ROWTYPE; v_id uuid; v_reason text; v_today date;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_kind NOT IN ('addition','deduction') OR p_amount IS NULL OR p_amount<=0
     OR p_amount>1000000000000 OR p_effective_date IS NULL
     OR nullif(btrim(coalesce(p_reason,'')),'') IS NULL
     OR length(p_reason)>120 OR length(coalesce(p_note,''))>500 THEN
    RAISE EXCEPTION 'V123_INVALID_ADJUSTMENT';
  END IF;
  SELECT (now() at time zone timezone)::date INTO v_today FROM public.app_settings WHERE id=1;
  IF p_effective_date < date '2000-01-01' OR p_effective_date>v_today+365 THEN
    RAISE EXCEPTION 'V123_ADJUSTMENT_DATE_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('maria_employee_v123:'||p_employee_id::text,0));
  SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
  IF NOT FOUND OR v_emp.status<>'active' OR v_emp.archived_v123 THEN
    RAISE EXCEPTION 'V123_EMPLOYEE_NOT_ACTIVE';
  END IF;
  IF v_emp.pay_type='fixed' THEN RAISE EXCEPTION 'V123_FIXED_WAGE_ADJUSTMENT_UNSUPPORTED'; END IF;
  IF (v_emp.hire_date IS NOT NULL AND p_effective_date<v_emp.hire_date) OR
     (v_emp.termination_date IS NOT NULL AND p_effective_date>v_emp.termination_date) THEN
     RAISE EXCEPTION 'V123_DATE_OUTSIDE_EMPLOYMENT'; END IF;
  IF EXISTS(SELECT 1 FROM public.payroll_runs pr WHERE pr.status IN ('approved','closed')
     AND p_effective_date BETWEEN pr.period_start AND pr.period_end
     AND ((v_emp.pay_type='monthly' AND pr.note LIKE 'MARIA_MONTHLY_V014:%')
       OR EXISTS(SELECT 1 FROM public.payroll_items pi WHERE pi.payroll_run_id=pr.id AND pi.employee_id=p_employee_id))) THEN
     RAISE EXCEPTION 'V123_PAYROLL_PERIOD_ALREADY_APPROVED'; END IF;
  v_reason := CASE WHEN p_kind='addition' THEN 'ADDITION_V123: ' ELSE 'DEDUCTION_V123: ' END || btrim(p_reason);
  IF EXISTS(SELECT 1 FROM public.employee_payroll_adjustments a
       WHERE employee_id=p_employee_id
        AND adjustment_type=CASE WHEN p_kind='addition' THEN 'bonus' ELSE 'deduction' END
        AND amount_original=p_amount AND effective_date=p_effective_date AND reason=v_reason
        AND coalesce(note,'')=btrim(coalesce(p_note,'')) AND status <> 'voided') THEN
     RAISE EXCEPTION 'V123_DUPLICATE_ADJUSTMENT'; END IF;
  v_id:=public.add_employee_payroll_adjustment(
       p_employee_id,CASE WHEN p_kind='addition' THEN 'bonus' ELSE 'deduction' END,
       p_amount,p_effective_date,v_reason,nullif(btrim(coalesce(p_note,'')),''));
  RETURN v_id;
END;
$fn$;


-- Reversal is limited to pending, unapplied entries; no posted salary changes.
CREATE OR REPLACE FUNCTION public.void_employee_adjustment_v123(p_adjustment_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_row public.employee_payroll_adjustments%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'V123_VOID_REASON_REQUIRED'; END IF;
 SELECT * INTO v_row FROM public.employee_payroll_adjustments
 WHERE id=p_adjustment_id FOR UPDATE;
 IF NOT FOUND OR v_row.status<>'pending' THEN RAISE EXCEPTION 'V123_ADJUSTMENT_ALREADY_APPLIED'; END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
       WHERE pi.id=v_row.payroll_item_id AND pr.status<>'draft') THEN
   RAISE EXCEPTION 'V123_ADJUSTMENT_ALREADY_APPLIED'; END IF;
 UPDATE public.employee_payroll_adjustments SET status='voided',voided_at=now(),
   void_reason=btrim(p_reason),payroll_item_id=NULL WHERE id=p_adjustment_id;
 RETURN true;
END;
$fn$;

-- Paid/unpaid leave and absence are exceptions created from employee profile.
-- The legacy attendance table remains as internal payroll accounting evidence.
CREATE OR REPLACE FUNCTION public.record_employee_leave_v123(
 p_employee_id uuid,p_work_date date,p_kind text,p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_emp public.employees%ROWTYPE; v_prev text; v_expected numeric;
 v_att uuid; v_deduction numeric:=0; v_total_expected numeric; v_today date;
 v_reason text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_kind NOT IN ('paid_leave','unpaid_leave','absent') OR p_work_date IS NULL
    OR length(coalesce(p_note,''))>400 THEN RAISE EXCEPTION 'V123_INVALID_LEAVE'; END IF;
 SELECT (now() at time zone timezone)::date INTO v_today FROM public.app_settings WHERE id=1;
 IF p_work_date < date '2000-01-01' OR p_work_date>v_today+365 THEN
    RAISE EXCEPTION 'V123_LEAVE_DATE_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria_leave_v123:'||p_employee_id::text||':'||p_work_date::text,0));
 SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND OR v_emp.status <> 'active' OR v_emp.archived_v123 THEN
    RAISE EXCEPTION 'V123_EMPLOYEE_NOT_ACTIVE'; END IF;
 IF (v_emp.hire_date IS NOT NULL AND p_work_date<v_emp.hire_date) OR
    (v_emp.termination_date IS NOT NULL AND p_work_date>v_emp.termination_date) THEN
    RAISE EXCEPTION 'V123_DATE_OUTSIDE_EMPLOYMENT'; END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_runs pr JOIN public.payroll_items pi ON pi.payroll_run_id=pr.id
      WHERE pi.employee_id=p_employee_id AND pr.status IN ('approved','closed')
        AND p_work_date BETWEEN pr.period_start AND pr.period_end)
    OR EXISTS (SELECT 1 FROM public.payroll_runs pr
      WHERE pr.status IN ('approved','closed') AND pr.note LIKE 'MARIA_MONTHLY_V014:%'
        AND v_emp.pay_type='monthly' AND p_work_date BETWEEN pr.period_start AND pr.period_end)
 THEN RAISE EXCEPTION 'V123_LEAVE_PERIOD_ALREADY_APPROVED'; END IF;
 SELECT status INTO v_prev FROM public.employee_attendance
 WHERE employee_id=p_employee_id AND work_date=p_work_date FOR UPDATE;
 IF v_prev IS NOT NULL AND (v_prev NOT IN ('full','day_off') OR
       NOT EXISTS (SELECT 1 FROM public.employee_attendance
          WHERE employee_id=p_employee_id AND work_date=p_work_date AND note='MARIA_AUTO_WORKDAY_V123')) THEN
     RAISE EXCEPTION 'V123_LEAVE_DATE_ALREADY_RECORDED'; END IF;
 v_expected:=public.get_employee_expected_hours(p_employee_id,p_work_date);
 IF v_expected<=0 THEN RAISE EXCEPTION 'V123_LEAVE_NOT_SCHEDULED_DAY'; END IF;
 IF p_kind<>'paid_leave' AND v_emp.pay_type='monthly' THEN
   IF v_emp.pay_type='monthly' THEN
     SELECT coalesce(sum(public.get_employee_expected_hours(p_employee_id,gs::date)),0)
     INTO v_total_expected FROM pg_catalog.generate_series(
       date_trunc('month',p_work_date)::date,
       (date_trunc('month',p_work_date)+interval '1 month' - interval '1 day')::date,
       interval '1 day') AS gs;
     IF v_total_expected<=0 THEN RAISE EXCEPTION 'V123_MONTH_SCHEDULE_INVALID'; END IF;
     v_deduction:=round(v_emp.monthly_salary_original*v_expected/v_total_expected,4);
   END IF;
 END IF;
 v_att:=public.set_employee_attendance(p_employee_id,p_work_date,0,p_kind,v_expected,0,0,
       'MARIA_LEAVE_V123:'||p_kind||' '||coalesce(p_note,''));
 IF v_deduction>0 THEN
   v_reason:='LEAVE_V123:'||p_work_date::text||':'||p_kind;
   PERFORM public.add_employee_payroll_adjustment(p_employee_id,'deduction',v_deduction,
      p_work_date,v_reason,coalesce(nullif(btrim(p_note),''),'Automatic unpaid-day deduction'));
 END IF;
 RETURN v_att;
END;
$fn$;

-- Only an explicitly created, not-yet-approved leave may be canceled.
CREATE OR REPLACE FUNCTION public.cancel_employee_leave_v123(p_employee_id uuid,p_work_date date)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_att public.employee_attendance%ROWTYPE; v_expected numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_att FROM public.employee_attendance
 WHERE employee_id=p_employee_id AND work_date=p_work_date FOR UPDATE;
 IF NOT FOUND OR v_att.note NOT LIKE 'MARIA_LEAVE_V123:%' THEN
   RAISE EXCEPTION 'V123_LEAVE_NOT_CANCELLABLE'; END IF;
 IF EXISTS (SELECT 1 FROM public.payroll_runs pr JOIN public.payroll_items pi ON pi.payroll_run_id=pr.id
    WHERE pi.employee_id=p_employee_id AND pr.status IN ('approved','closed')
      AND p_work_date BETWEEN pr.period_start AND pr.period_end)
   OR EXISTS (SELECT 1 FROM public.payroll_runs pr JOIN public.employees e ON e.id=p_employee_id
    WHERE e.pay_type='monthly' AND pr.note LIKE 'MARIA_MONTHLY_V014:%'
      AND pr.status IN ('approved','closed') AND p_work_date BETWEEN pr.period_start AND pr.period_end)
 THEN RAISE EXCEPTION 'V123_LEAVE_PERIOD_ALREADY_APPROVED'; END IF;
 UPDATE public.employee_payroll_adjustments SET status='voided',voided_at=now(),void_reason='V123_LEAVE_CANCELED'
 WHERE employee_id=p_employee_id AND effective_date=p_work_date AND status='pending'
   AND reason IN ('LEAVE_V123:'||p_work_date::text||':unpaid_leave','LEAVE_V123:'||p_work_date::text||':absent');
 v_expected:=public.get_employee_expected_hours(p_employee_id,p_work_date);
 PERFORM public.set_employee_attendance(p_employee_id,p_work_date,v_expected,'full',v_expected,0,0,'MARIA_AUTO_WORKDAY_V123');
 RETURN true;
END;
$fn$;

-- Auto-assume the normal schedule for daily/hourly workers (without a public
-- attendance-approval step). Explicit existing records always win.
CREATE OR REPLACE FUNCTION public.prepare_scheduled_workdays_v123(p_start date,p_end date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_today date; v_count integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT (now() at time zone timezone)::date INTO v_today FROM public.app_settings WHERE id=1;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>34
    OR p_start>v_today THEN RAISE EXCEPTION 'V123_WORKDAY_RANGE_INVALID'; END IF;
 INSERT INTO public.employee_attendance(employee_id,work_date,status,expected_hours,
    worked_hours,approved_overtime_hours,applied_shortage_hours,note)
 SELECT e.id,gs.d::date,'full',public.get_employee_expected_hours(e.id,gs.d::date),
    public.get_employee_expected_hours(e.id,gs.d::date),0,0,'MARIA_AUTO_WORKDAY_V123'
 FROM public.employees e
 CROSS JOIN LATERAL pg_catalog.generate_series(p_start,least(p_end,v_today),interval '1 day') AS gs(d)
 WHERE (e.status='active' OR e.termination_date IS NOT NULL) AND NOT e.archived_v123 AND e.pay_type IN ('daily','hourly')
   AND (e.hire_date IS NULL OR gs.d::date>=e.hire_date)
   AND (e.termination_date IS NULL OR gs.d::date<=e.termination_date)
   AND public.get_employee_expected_hours(e.id,gs.d::date)>0
   AND NOT EXISTS(SELECT 1 FROM public.payroll_items pi JOIN public.payroll_runs pr
     ON pr.id=pi.payroll_run_id WHERE pi.employee_id=e.id
      AND gs.d::date BETWEEN pr.period_start AND pr.period_end AND pr.status IN ('approved','closed'))
 ON CONFLICT(employee_id,work_date) DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count;
END;
$fn$;

-- For daily wage payments, independently ensure the standard workday exists.
CREATE OR REPLACE FUNCTION public.pay_daily_wage_v123(p_employee_id uuid,p_work_date date,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_status text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_work_date IS NULL THEN RAISE EXCEPTION 'V123_WORKDAY_RANGE_INVALID'; END IF;
 PERFORM public.prepare_scheduled_workdays_v123(p_work_date,p_work_date);
 SELECT status INTO v_status FROM public.employee_attendance
 WHERE employee_id=p_employee_id AND work_date=p_work_date;
 IF v_status IN ('absent','unpaid_leave','holiday','day_off') THEN
   RAISE EXCEPTION 'V123_UNPAID_WORKDAY_CANNOT_BE_PAID'; END IF;
 RETURN public.pay_daily_wage_v034(p_employee_id,p_work_date,p_cashbox_id);
END;
$fn$;

-- Delete truly unused employees; archive linked employees to preserve posted
-- payroll, advances, supplier/event records, and cashbox auditability.
CREATE OR REPLACE FUNCTION public.remove_employee_v123(p_employee_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_emp public.employees%ROWTYPE; v_has_history boolean;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'V123_EMPLOYEE_NOT_FOUND'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.employee_advances WHERE employee_id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.employee_payroll_adjustments WHERE employee_id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.payroll_items WHERE employee_id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.payroll_payments WHERE employee_id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.employee_fixed_payments_v023 WHERE employee_id=p_employee_id)
  OR EXISTS(SELECT 1 FROM public.event_labor_entries WHERE employee_id=p_employee_id)
 INTO v_has_history;
 IF v_has_history THEN
  UPDATE public.employees SET archived_v123=true,archived_at_v123=now(),status='inactive'
  WHERE id=p_employee_id;
  RETURN 'archived_financial_history';
 END IF;
 DELETE FROM public.employee_attendance WHERE employee_id=p_employee_id;
 DELETE FROM public.employee_schedule_days WHERE employee_id=p_employee_id;
 DELETE FROM public.employees WHERE id=p_employee_id;
 RETURN 'deleted_permanently';
END;
$fn$;

-- Protected RPCs: authenticated owner only, never anonymous clients.
REVOKE ALL ON FUNCTION public.post_purchase_invoice_paid_v123(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_employee_adjustment_v123(uuid,text,numeric,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.void_employee_adjustment_v123(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_employee_leave_v123(uuid,date,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.cancel_employee_leave_v123(uuid,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.prepare_scheduled_workdays_v123(date,date) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pay_daily_wage_v123(uuid,date,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.remove_employee_v123(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice_paid_v123(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_employee_adjustment_v123(uuid,text,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_employee_adjustment_v123(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_employee_leave_v123(uuid,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_employee_leave_v123(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_scheduled_workdays_v123(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_daily_wage_v123(uuid,date,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_employee_v123(uuid) TO authenticated;
-- Final-month salary settlement, included in the SAME v1.0.23 transaction.
-- Existing posted/approved payroll, cashbox, prior payments are never recalculated.
DO $ensure_final_month$
BEGIN
 IF to_regprocedure('public.create_monthly_payroll_v117(integer,integer)') IS NULL
    OR to_regprocedure('public.recalculate_monthly_payroll_v117(uuid)') IS NULL
    OR to_regprocedure('public.approve_monthly_payroll_v117(uuid)') IS NULL
    OR to_regprocedure('public.update_employee_profile_v032(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text)') IS NULL
 THEN RAISE EXCEPTION 'V123_FINAL_MONTH_REQUIRES_V117_V032_MIGRATIONS'; END IF;
END;
$ensure_final_month$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS termination_paid_days_v123 integer;
-- NULL = existing automatic proration. Explicit 0-31 = monthly settlement override.
DO $constraint_v123$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
   WHERE conname='employees_final_month_days_v123_chk'
     AND conrelid='public.employees'::regclass) THEN
  ALTER TABLE public.employees ADD CONSTRAINT employees_final_month_days_v123_chk CHECK (
   termination_paid_days_v123 IS NULL OR
   (pay_type='monthly' AND termination_date IS NOT NULL
    AND termination_paid_days_v123 BETWEEN 0 AND 31
    AND (hire_date IS NULL OR hire_date<=termination_date)
    AND termination_paid_days_v123 <= (
      termination_date - GREATEST(date_trunc('month',termination_date::timestamp)::date,
         COALESCE(hire_date,date_trunc('month',termination_date::timestamp)::date)) + 1)
   )
  );
 END IF;
END;
$constraint_v123$;

-- Prevent modifying the already settled end-of-service month (including via
-- the older profile RPC or a direct authenticated table UPDATE).
CREATE OR REPLACE FUNCTION public.guard_final_month_change_v123()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_earliest date;
BEGIN
 IF OLD.termination_date IS NOT DISTINCT FROM NEW.termination_date
    AND OLD.termination_paid_days_v123 IS NOT DISTINCT FROM NEW.termination_paid_days_v123 THEN
   RETURN NEW;
 END IF;
 v_earliest := CASE
   WHEN OLD.termination_date IS NULL THEN NEW.termination_date
   WHEN NEW.termination_date IS NULL THEN OLD.termination_date
   ELSE LEAST(OLD.termination_date,NEW.termination_date)
 END;
 IF v_earliest IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.payroll_items pi JOIN public.payroll_runs pr
       ON pr.id=pi.payroll_run_id
   WHERE pi.employee_id=OLD.id AND pr.status IN ('approved','closed')
     AND pr.period_end >= date_trunc('month',v_earliest::timestamp)::date
 ) THEN RAISE EXCEPTION 'V123_FINAL_MONTH_ALREADY_APPROVED'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS employees_guard_final_month_v123 ON public.employees;
CREATE TRIGGER employees_guard_final_month_v123
 BEFORE UPDATE OF termination_date, termination_paid_days_v123 ON public.employees
 FOR EACH ROW EXECUTE FUNCTION public.guard_final_month_change_v123();

-- Single atomic update: v0.32 still validates identity, wage currency and all
-- historical payroll protection. The additional days are set in this transaction.
CREATE OR REPLACE FUNCTION public.save_employee_final_profile_v123(
 p_employee_id uuid,p_name text,p_job_title text,p_department text,
 p_residence text,p_mobile_phone text,p_pay_type text,p_wage numeric,
 p_currency text,p_status text,p_hire_date date,p_termination_date date,
 p_notes text,p_paid_days integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_old public.employees%ROWTYPE; v_max integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_old FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
 IF p_paid_days IS NOT NULL THEN
   IF p_pay_type<>'monthly' OR p_termination_date IS NULL OR
      (p_hire_date IS NOT NULL AND p_hire_date>p_termination_date) THEN
      RAISE EXCEPTION 'V123_FINAL_MONTH_DAYS_INVALID'; END IF;
   v_max:=p_termination_date-GREATEST(date_trunc('month',p_termination_date::timestamp)::date,
      COALESCE(p_hire_date,date_trunc('month',p_termination_date::timestamp)::date))+1;
   IF p_paid_days<0 OR p_paid_days>v_max THEN
      RAISE EXCEPTION 'V123_FINAL_MONTH_DAYS_INVALID'; END IF;
 END IF;
 -- Clear days first when removing an end date; the relational CHECK stays valid.
 IF p_termination_date IS NULL AND v_old.termination_paid_days_v123 IS NOT NULL THEN
   UPDATE public.employees SET termination_paid_days_v123=NULL WHERE id=p_employee_id;
 END IF;
 PERFORM public.update_employee_profile_v032(p_employee_id,p_name,p_job_title,p_department,
   p_residence,p_mobile_phone,p_pay_type,p_wage,p_currency,p_status,p_hire_date,
   p_termination_date,p_notes);
 UPDATE public.employees SET termination_paid_days_v123=p_paid_days
   WHERE id=p_employee_id AND termination_paid_days_v123 IS DISTINCT FROM p_paid_days;
 RETURN p_employee_id;
END;
$fn$;

-- This routine only operates on DRAFT monthly payroll items, after the existing
-- recalc creates a full ledger and allocates bonuses, deductions and advances.
-- Historical settled payrolls and cashbox movements are never touched.
CREATE OR REPLACE FUNCTION public.apply_final_month_salary_v123(
 p_payroll_run_id uuid,p_apply boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_run public.payroll_runs%ROWTYPE; v_row record; v_adv record;
 v_days integer; v_base numeric; v_available numeric; v_total_adv numeric;
 v_suggested numeric; v_take numeric; v_count integer:=0; v_marker text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_payroll_run_id FOR UPDATE;
 IF NOT FOUND OR v_run.status<>'draft' OR
    v_run.note NOT LIKE 'MARIA_MONTHLY_V014:%' THEN
   RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_REQUIRED'; END IF;
 -- A changed end date can make an employee newly eligible for a draft.
 -- Never silently approve a draft without their required row.
 IF EXISTS (
    SELECT 1 FROM public.employees e WHERE e.pay_type='monthly'
      AND e.termination_paid_days_v123 IS NOT NULL
      AND e.termination_date BETWEEN v_run.period_start AND v_run.period_end
      AND NOT e.archived_v123
      AND NOT EXISTS (SELECT 1 FROM public.payroll_items pi
        WHERE pi.employee_id=e.id AND pi.payroll_run_id=v_run.id)
 ) THEN RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_NEEDS_RECALC'; END IF;
 FOR v_row IN
   SELECT pi.*,e.termination_paid_days_v123 AS final_days,
          e.termination_date AS final_date, e.monthly_salary_original AS current_salary
   FROM public.payroll_items pi
   JOIN public.employees e ON e.id=pi.employee_id
   WHERE pi.payroll_run_id=v_run.id AND pi.pay_type_snapshot='monthly'
   ORDER BY pi.employee_id FOR UPDATE OF pi
 LOOP
   -- A draft can become stale when service dates change after its calculation.
   IF v_row.final_date IS NOT NULL AND v_row.final_date < v_run.period_start THEN
      RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_NEEDS_RECALC';
   END IF;
   IF v_row.final_date IS NULL OR v_row.final_date > v_run.period_end THEN
      IF COALESCE(v_row.note,'') LIKE '%FINAL_MONTH_V123:%'
         OR COALESCE(v_row.note,'') LIKE '%FINAL_MONTH_AUTO_V123:%' THEN
         RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_NEEDS_RECALC';
      END IF;
      CONTINUE;
   END IF;
   IF v_row.final_days IS NULL THEN
     -- Legacy automatic proration still applies, but date changes after draft
     -- creation must be reviewed/recalculated before approval.
     v_marker:='FINAL_MONTH_AUTO_V123:'||v_row.final_date::text;
     IF p_apply THEN
        UPDATE public.payroll_items
          SET note=concat_ws(' | ',NULLIF(v_row.note,''),v_marker)
          WHERE id=v_row.id;
     ELSIF POSITION(v_marker IN COALESCE(v_row.note,''))=0
        OR v_row.monthly_salary_snapshot IS DISTINCT FROM v_row.current_salary THEN
        RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_NEEDS_RECALC';
     END IF;
     CONTINUE;
   END IF;
   v_days := v_run.period_end-v_run.period_start+1;
   v_base := ROUND(v_row.monthly_salary_snapshot*v_row.final_days/v_days,4);
   v_marker := 'FINAL_MONTH_V123:'||v_row.final_date::text||':'||
        v_row.final_days::text||'/'||v_days::text;
   IF NOT p_apply THEN
     IF abs(v_row.base_pay_original-v_base)>0.0001
       OR v_row.monthly_salary_snapshot IS DISTINCT FROM v_row.current_salary
       OR POSITION(v_marker IN COALESCE(v_row.note,''))=0 THEN
       RAISE EXCEPTION 'V123_FINAL_MONTH_DRAFT_NEEDS_RECALC';
     END IF;
     CONTINUE;
   END IF;
   v_available:=v_base+v_row.overtime_pay_original+v_row.bonus_original-
                  v_row.shortage_deduction_original-v_row.manual_deduction_original;
   IF v_available < -0.0001 THEN
      RAISE EXCEPTION 'V123_FINAL_MONTH_DEDUCTIONS_EXCEED_PAY'; END IF;
   v_available:=GREATEST(0,v_available);
   -- Draft advances are planned, not paid. Reallocate using the same order,
   -- mode and cap as recalculate_payroll_run; no open balance is modified.
   DELETE FROM public.payroll_advance_deductions WHERE payroll_item_id=v_row.id;
   v_total_adv:=0;
   FOR v_adv IN SELECT * FROM public.employee_advances
     WHERE employee_id=v_row.employee_id AND status='open'
       AND remaining_original>0 AND occurred_at::date<=v_run.period_end
     ORDER BY occurred_at,created_at,id
   LOOP
     v_suggested:=CASE v_adv.repayment_mode
       WHEN 'full_next_payroll' THEN v_adv.remaining_original
       WHEN 'installments' THEN LEAST(v_adv.remaining_original,
                                      COALESCE(v_adv.installment_amount_original,0))
       ELSE 0 END;
     v_take:=GREATEST(0,LEAST(v_suggested,v_available-v_total_adv));
     IF v_take>0 THEN
       INSERT INTO public.payroll_advance_deductions(payroll_item_id,advance_id,amount_original)
       VALUES(v_row.id,v_adv.id,v_take);
       v_total_adv:=v_total_adv+v_take;
     END IF;
   END LOOP;
   UPDATE public.payroll_items SET base_pay_original=v_base,
      gross_earnings_original=v_base+v_row.overtime_pay_original+v_row.bonus_original,
      advance_deduction_original=v_total_adv,
      total_deductions_original=v_row.shortage_deduction_original+
        v_row.manual_deduction_original+v_total_adv,
      net_due_original=v_available-v_total_adv,
      note=concat_ws(' | ',NULLIF(v_row.note,''),v_marker),calculated_at=now()
   WHERE id=v_row.id;
   v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END;
$fn$;

-- Retain the v1.0.17 attendance-default and approval safeguards; add a
-- monetary post-processing pass ONLY for final-month employees.
CREATE OR REPLACE FUNCTION public.create_monthly_payroll_v117(p_year integer,p_month integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_id:=public.create_monthly_payroll_v014(p_year,p_month);
 PERFORM public.monthly_attendance_default_v117(v_id);
 PERFORM public.apply_final_month_salary_v123(v_id,true);
 RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.recalculate_monthly_payroll_v117(p_payroll_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.recalculate_monthly_payroll_v014(p_payroll_run_id);
 PERFORM public.monthly_attendance_default_v117(p_payroll_run_id);
 PERFORM public.apply_final_month_salary_v123(p_payroll_run_id,true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_monthly_payroll_v117(p_payroll_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.monthly_attendance_default_v117(p_payroll_run_id);
 -- Approval cannot silently reprice a reviewed draft.
 PERFORM public.apply_final_month_salary_v123(p_payroll_run_id,false);
 PERFORM public.approve_payroll_run(p_payroll_run_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_final_month_change_v123() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_employee_final_profile_v123(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.apply_final_month_salary_v123(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_employee_final_profile_v123(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text,integer) TO authenticated;
-- Internal helper and trigger are SECURITY DEFINER; no direct client invoke.

COMMIT;
