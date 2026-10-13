-- Maria CFO Web v0.32: secure employee editing and financially linked bonuses.
-- REQUIREMENTS: apply v0.31 employee importer SQL and existing v0.14/v0.23 payroll migrations first.
-- Non-destructive: no modifications to existing payroll postings, advances or attendance.
BEGIN;

-- Guard schema drift BEFORE installing RPCs. The live v0.30 export confirms these objects.
DO $guard$
BEGIN
 IF to_regclass('public.employee_payroll_adjustments') IS NULL OR
    to_regprocedure('public.add_employee_payroll_adjustment(uuid,text,numeric,date,text,text)') IS NULL OR
    to_regprocedure('public.recalculate_payroll_run(uuid)') IS NULL OR
    to_regprocedure('public.recipe_key_normalize_v027(text)') IS NULL OR
    NOT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='employees' AND column_name='residence_v031')
 THEN RAISE EXCEPTION 'V032_REQUIRES_EXISTING_PAYROLL_AND_V031_MIGRATIONS'; END IF;
END $guard$;

-- Employees can be edited without deleting historical transactions. Existing payroll snapshots
-- retain their original wage, so changing today's salary never rewrites approved payroll.
CREATE OR REPLACE FUNCTION public.update_employee_profile_v032(
 p_employee_id uuid, p_name text, p_job_title text, p_department text,
 p_residence text, p_mobile_phone text, p_pay_type text, p_wage numeric,
 p_currency text, p_status text, p_hire_date date, p_termination_date date,
 p_notes text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old public.employees%ROWTYPE; v_name text := btrim(coalesce(p_name,''));
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_employee_id IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
 SELECT * INTO old FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
 IF length(v_name) NOT BETWEEN 1 AND 250 OR
    length(coalesce(p_job_title,''))>250 OR length(coalesce(p_department,''))>250 OR
    length(coalesce(p_residence,''))>200 OR length(coalesce(p_mobile_phone,''))>40 OR
    length(coalesce(p_notes,''))>2000 OR
    (nullif(btrim(coalesce(p_mobile_phone,'')),'') IS NOT NULL AND p_mobile_phone !~ '^[+0-9() .-]+$') OR
    p_pay_type IS NULL OR p_pay_type NOT IN ('monthly','daily','hourly','fixed') OR
    p_currency IS NULL OR p_currency NOT IN ('SYP','USD') OR
    p_status IS NULL OR p_status NOT IN ('active','inactive') OR
    p_wage IS NULL OR p_wage<=0 OR p_wage>1000000000000 OR
    (p_hire_date IS NOT NULL AND p_termination_date IS NOT NULL AND p_hire_date>p_termination_date)
 THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_PROFILE_V032'; END IF;
 IF EXISTS(SELECT 1 FROM public.employees e
   WHERE e.id<>old.id AND public.recipe_key_normalize_v027(e.name)=public.recipe_key_normalize_v027(v_name))
 THEN RAISE EXCEPTION 'EMPLOYEE_NAME_ALREADY_USED_V032'; END IF;
 IF (old.pay_type<>p_pay_type OR old.wage_currency_code<>p_currency) AND (
      EXISTS (SELECT 1 FROM public.employee_attendance WHERE employee_id=old.id) OR
      EXISTS (SELECT 1 FROM public.employee_payroll_adjustments WHERE employee_id=old.id AND status<>'voided') OR
      EXISTS (SELECT 1 FROM public.employee_advances WHERE employee_id=old.id) OR
      EXISTS (SELECT 1 FROM public.payroll_items WHERE employee_id=old.id) OR
      EXISTS (SELECT 1 FROM public.employee_fixed_payments_v023 WHERE employee_id=old.id)
 ) THEN RAISE EXCEPTION 'EMPLOYEE_PAY_BASIS_LOCKED_V032'; END IF;
 IF p_status='inactive' AND EXISTS (SELECT 1 FROM public.employee_payroll_adjustments
      WHERE employee_id=old.id AND adjustment_type='bonus' AND status='pending')
 THEN RAISE EXCEPTION 'EMPLOYEE_PENDING_BONUS_V032'; END IF;
 UPDATE public.employees SET
   name=v_name, job_title=nullif(btrim(coalesce(p_job_title,'')),''),
   department=nullif(btrim(coalesce(p_department,'')),''),
   residence_v031=nullif(btrim(coalesce(p_residence,'')),''),
   mobile_phone_v031=nullif(btrim(coalesce(p_mobile_phone,'')),''),
   pay_type=p_pay_type, wage_currency_code=p_currency, status=p_status,
   monthly_salary_original=CASE WHEN p_pay_type='monthly' THEN p_wage ELSE NULL END,
   daily_rate_original=CASE WHEN p_pay_type='daily' THEN p_wage ELSE NULL END,
   hourly_rate_original=CASE WHEN p_pay_type='hourly' THEN p_wage ELSE NULL END,
   fixed_pay_original_v023=CASE WHEN p_pay_type='fixed' THEN p_wage ELSE NULL END,
   hire_date=p_hire_date, termination_date=p_termination_date,
   notes=nullif(btrim(coalesce(p_notes,'')),'')
 WHERE id=old.id;
 RETURN old.id;
END; $$;
REVOKE ALL ON FUNCTION public.update_employee_profile_v032(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_employee_profile_v032(uuid,text,text,text,text,text,text,numeric,text,text,date,date,text) TO authenticated;

-- Record bonuses through the EXISTING payroll adjustment engine. No independent payout,
-- expense, cashbox transaction, or salary posting is created here.
CREATE OR REPLACE FUNCTION public.record_employee_bonus_v032(
 p_employee_id uuid, p_amount numeric, p_effective_date date,
 p_reason text, p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.employees%ROWTYPE; v_bonus uuid; v_today date;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_employee_id IS NULL OR p_effective_date IS NULL OR
    p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000000 OR
    nullif(btrim(coalesce(p_reason,'')),'') IS NULL OR
    length(p_reason)>150 OR length(coalesce(p_note,''))>500
 THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_BONUS_V032'; END IF;
 SELECT (now() AT TIME ZONE timezone)::date INTO v_today FROM public.app_settings WHERE id=1;
 IF p_effective_date < date '2000-01-01' OR p_effective_date > (v_today + interval '1 year')::date
 THEN RAISE EXCEPTION 'INVALID_BONUS_EFFECTIVE_DATE_V032'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria_bonus_v032:'||p_employee_id::text,0));
 SELECT * INTO e FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND OR e.status<>'active' THEN RAISE EXCEPTION 'BONUS_EMPLOYEE_NOT_ACTIVE_V032'; END IF;
 IF e.pay_type='fixed' THEN RAISE EXCEPTION 'BONUS_FIXED_PAY_UNSUPPORTED_V032'; END IF;
 IF e.pay_type NOT IN ('monthly','daily','hourly') THEN RAISE EXCEPTION 'BONUS_PAY_TYPE_UNSUPPORTED_V032'; END IF;
 IF e.hire_date IS NOT NULL AND p_effective_date<e.hire_date OR
    e.termination_date IS NOT NULL AND p_effective_date>e.termination_date
 THEN RAISE EXCEPTION 'BONUS_DATE_OUTSIDE_EMPLOYMENT_V032'; END IF;
 -- Do not backdate a monthly bonus into a closed period, even if this employee
 -- was absent from that month's approved items. Otherwise it could never be paid.
 IF EXISTS (SELECT 1 FROM public.payroll_runs pr
    WHERE pr.status IN ('approved','closed')
      AND p_effective_date BETWEEN pr.period_start AND pr.period_end
      AND ((e.pay_type='monthly' AND pr.note LIKE 'MARIA_MONTHLY_V014:%')
        OR EXISTS(SELECT 1 FROM public.payroll_items pi
             WHERE pi.payroll_run_id=pr.id AND pi.employee_id=e.id)))
 THEN RAISE EXCEPTION 'BONUS_PERIOD_ALREADY_APPROVED_V032'; END IF;
 -- Idempotency guard for double-clicks and repeated identical submissions.
 IF EXISTS (SELECT 1 FROM public.employee_payroll_adjustments a
   WHERE a.employee_id=e.id AND a.adjustment_type='bonus' AND a.status<>'voided'
     AND a.effective_date=p_effective_date AND a.amount_original=p_amount
     AND a.reason=btrim(p_reason) AND coalesce(a.note,'')=btrim(coalesce(p_note,'')))
 THEN RAISE EXCEPTION 'BONUS_ALREADY_RECORDED_V032'; END IF;
 v_bonus := public.add_employee_payroll_adjustment(e.id,'bonus',p_amount,
   p_effective_date,btrim(p_reason),nullif(btrim(coalesce(p_note,'')),''));
 RETURN v_bonus;
END; $$;
REVOKE ALL ON FUNCTION public.record_employee_bonus_v032(uuid,numeric,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_employee_bonus_v032(uuid,numeric,date,text,text) TO authenticated;

-- Correct unapproved mistakes without deleting historical adjustment evidence.
-- A voided bonus can never be 'applied'; the linked monthly draft is recalculated.
CREATE OR REPLACE FUNCTION public.void_pending_employee_bonus_v032(
 p_bonus_id uuid, p_reason text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.employee_payroll_adjustments%ROWTYPE; r public.payroll_runs%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_bonus_id IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 250
 THEN RAISE EXCEPTION 'BONUS_VOID_REASON_REQUIRED_V032'; END IF;
 SELECT * INTO a FROM public.employee_payroll_adjustments
   WHERE id=p_bonus_id AND adjustment_type='bonus' FOR UPDATE;
 IF NOT FOUND OR a.status<>'pending' THEN RAISE EXCEPTION 'BONUS_ALREADY_APPROVED_OR_VOID_V032'; END IF;
 IF a.payroll_item_id IS NOT NULL THEN
   SELECT pr.* INTO r FROM public.payroll_items pi
   JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
   WHERE pi.id=a.payroll_item_id FOR UPDATE OF pr;
   IF FOUND AND r.status<>'draft' THEN RAISE EXCEPTION 'BONUS_ALREADY_APPROVED_OR_VOID_V032'; END IF;
 END IF;
 UPDATE public.employee_payroll_adjustments SET status='voided',
   payroll_item_id=NULL, voided_at=now(), void_reason=btrim(p_reason)
 WHERE id=a.id;
 IF r.id IS NOT NULL AND r.note LIKE 'MARIA_MONTHLY_V014:%' THEN
   PERFORM public.recalculate_monthly_payroll_v014(r.id);
 END IF;
 RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION public.void_pending_employee_bonus_v032(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.void_pending_employee_bonus_v032(uuid,text) TO authenticated;

COMMIT;
