-- Maria CFO Web v0.14.0 - Payroll payable/daily wage/cashbox safety
-- Requires original payroll RPCs and Maria CFO Web v0.13 cashbox helper.
-- Run ONCE in Supabase SQL Editor before deploying Web v0.14.0.
-- Does not rewrite existing payroll/payment history.
BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS payroll_cashbox_id uuid REFERENCES public.cashboxes(id) ON DELETE RESTRICT;

-- One daily settlement per employee/date, even with concurrent browser requests.
CREATE UNIQUE INDEX IF NOT EXISTS maria_daily_payroll_note_v014_uniq
ON public.payroll_runs (note)
WHERE note LIKE 'MARIA_DAILY_V014:%';

CREATE OR REPLACE FUNCTION public.set_payroll_cashbox_v014(p_cashbox_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_cashbox_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.cashboxes WHERE id = p_cashbox_id AND is_active
  ) THEN
    RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID';
  END IF;
  UPDATE public.app_settings SET payroll_cashbox_id = p_cashbox_id WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'APP_SETTINGS_NOT_FOUND'; END IF;
END;
$$;

-- Prevent overlapping, approved financial liabilities for a single employee.
-- Drafts remain editable. This deliberately stops (rather than silently duplicates)
-- an old all-employee monthly payroll covering already settled daily wages.
CREATE OR REPLACE FUNCTION public.guard_payroll_overlap_v014()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.note LIKE 'MARIA_MONTHLY_V014:%' AND EXISTS (
      SELECT 1 FROM public.payroll_items
      WHERE payroll_run_id = NEW.id AND pay_type_snapshot <> 'monthly'
    ) THEN
      RAISE EXCEPTION 'MONTHLY_PAYROLL_MONTHLY_ONLY';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.payroll_items mine
      JOIN public.payroll_items others ON others.employee_id = mine.employee_id
         AND others.payroll_run_id <> mine.payroll_run_id
      JOIN public.payroll_runs existing_run ON existing_run.id = others.payroll_run_id
      WHERE mine.payroll_run_id = NEW.id
        AND existing_run.status IN ('approved','closed')
        AND daterange(existing_run.period_start,existing_run.period_end,'[]')
          && daterange(NEW.period_start,NEW.period_end,'[]')
    ) THEN
      RAISE EXCEPTION 'PAYROLL_PERIOD_ALREADY_SETTLED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS maria_guard_payroll_overlap_v014 ON public.payroll_runs;
CREATE TRIGGER maria_guard_payroll_overlap_v014
BEFORE UPDATE OF status ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_overlap_v014();

-- Once payroll is approved, its supporting attendance cannot be retroactively
-- changed without an explicit payroll correction/void workflow.
CREATE OR REPLACE FUNCTION public.guard_paid_attendance_v014()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_changed := true;
  ELSE
    v_changed := (
      NEW.employee_id,NEW.work_date,NEW.status,NEW.expected_hours,NEW.worked_hours,
      NEW.approved_overtime_hours,NEW.applied_shortage_hours
    ) IS DISTINCT FROM (
      OLD.employee_id,OLD.work_date,OLD.status,OLD.expected_hours,OLD.worked_hours,
      OLD.approved_overtime_hours,OLD.applied_shortage_hours
    );
  END IF;
  IF v_changed AND EXISTS (
    SELECT 1 FROM public.payroll_items pi
    JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
    WHERE pi.employee_id=OLD.employee_id
      AND OLD.work_date BETWEEN pr.period_start AND pr.period_end
      AND pr.status IN ('approved','closed')
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_PAYROLL_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS maria_guard_paid_attendance_v014 ON public.employee_attendance;
CREATE TRIGGER maria_guard_paid_attendance_v014
BEFORE UPDATE OR DELETE ON public.employee_attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_attendance_v014();

-- Read-only dues. These are estimates before a financial payroll snapshot is
-- calculated, particularly if advances or manual adjustments are outstanding.
CREATE OR REPLACE FUNCTION public.get_daily_wage_dues_v014()
RETURNS TABLE (
  employee_id uuid, work_date date, employee_name text, pay_type text,
  currency_code text, attendance_status text, expected_hours numeric,
  worked_hours numeric, estimated_due_original numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT e.id, a.work_date, e.name, e.pay_type, e.wage_currency_code,
    a.status, a.expected_hours, a.worked_hours,
    round(greatest(0::numeric,
      CASE WHEN e.pay_type = 'daily'
        THEN (CASE WHEN a.expected_hours > 0 THEN e.daily_rate_original ELSE 0 END)
        ELSE (CASE
          WHEN a.status = 'paid_leave' THEN a.expected_hours
          WHEN a.status IN ('holiday','day_off','absent','unpaid_leave') THEN 0
          ELSE least(a.worked_hours,a.expected_hours) END) * e.hourly_rate_original
      END
      + coalesce(a.approved_overtime_hours,a.calculated_overtime_hours,0)
        * (CASE WHEN e.pay_type = 'daily'
          THEN e.daily_rate_original / nullif(e.required_daily_hours,0)
          ELSE e.hourly_rate_original END)
        * coalesce(e.overtime_multiplier,s.default_overtime_multiplier,1.5)
      - CASE WHEN e.pay_type = 'daily'
        THEN coalesce(a.applied_shortage_hours,a.calculated_shortage_hours,0)
          * (e.daily_rate_original / nullif(e.required_daily_hours,0))
          * coalesce(e.shortage_multiplier,s.default_shortage_multiplier,1)
        ELSE 0 END
    ),4) AS estimated_due_original
  FROM public.employee_attendance a
  JOIN public.employees e ON e.id=a.employee_id
  CROSS JOIN public.app_settings s
  WHERE s.id=1 AND public.is_app_owner()
    AND e.pay_type IN ('daily','hourly')
    AND a.work_date <= (now() at time zone s.timezone)::date
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_items pi
      JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
      WHERE pi.employee_id=a.employee_id
        AND a.work_date BETWEEN pr.period_start AND pr.period_end
        AND pr.status IN ('approved','closed')
    )
  ORDER BY a.work_date DESC,e.name;
$$;

-- Atomic daily wage payout: make a one-day payroll snapshot using the existing
-- payroll calculator (adjustments, FX and advances), keep only target employee,
-- approve it, and pay through the protected salary cashbox RPC.
CREATE OR REPLACE FUNCTION public.pay_daily_wage_v014(
  p_employee_id uuid, p_work_date date
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_emp public.employees%ROWTYPE;
  v_att public.employee_attendance%ROWTYPE;
  v_box uuid;
  v_run uuid;
  v_item record;
  v_payment uuid;
  v_note text;
  v_today date;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT payroll_cashbox_id,(now() at time zone timezone)::date
  INTO v_box,v_today FROM public.app_settings WHERE id=1;
  IF v_box IS NULL THEN RAISE EXCEPTION 'PAYROLL_CASHBOX_NOT_CONFIGURED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cashboxes WHERE id=v_box AND is_active) THEN
    RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID';
  END IF;
  IF p_work_date IS NULL OR p_work_date > v_today THEN
    RAISE EXCEPTION 'INVALID_WAGE_WORK_DATE';
  END IF;
  -- Serialise duplicate clicks before touching financial records.
  PERFORM pg_advisory_xact_lock(hashtext('maria_daily_v014:'||p_employee_id::text||':'||p_work_date::text));
  SELECT * INTO v_emp FROM public.employees WHERE id=p_employee_id FOR UPDATE;
  IF NOT FOUND OR v_emp.pay_type NOT IN ('daily','hourly') THEN
    RAISE EXCEPTION 'DAILY_PAYROLL_REQUIRES_DAILY_OR_HOURLY';
  END IF;
  SELECT * INTO v_att FROM public.employee_attendance
  WHERE employee_id=p_employee_id AND work_date=p_work_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_MUST_BE_RECORDED'; END IF;
  IF (v_emp.hire_date IS NOT NULL AND p_work_date<v_emp.hire_date) OR
     (v_emp.termination_date IS NOT NULL AND p_work_date>v_emp.termination_date) THEN
    RAISE EXCEPTION 'WORK_DATE_OUTSIDE_EMPLOYMENT';
  END IF;
  -- Includes historical monthly runs: same work date can never be paid twice.
  IF EXISTS (
    SELECT 1 FROM public.payroll_items pi
    JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
    WHERE pi.employee_id=p_employee_id
      AND p_work_date BETWEEN pr.period_start AND pr.period_end
      AND pr.status IN ('approved','closed')
  ) THEN RAISE EXCEPTION 'DAILY_WAGE_ALREADY_SETTLED'; END IF;
  v_note := 'MARIA_DAILY_V014:'||p_employee_id::text||':'||p_work_date::text;
  IF EXISTS (SELECT 1 FROM public.payroll_runs WHERE note=v_note) THEN
    RAISE EXCEPTION 'DAILY_WAGE_ALREADY_PREPARED';
  END IF;
  INSERT INTO public.payroll_runs(period_start,period_end,note)
  VALUES(p_work_date,p_work_date,v_note) RETURNING id INTO v_run;
  PERFORM public.recalculate_payroll_run(v_run);
  -- The existing calculator includes all employees. Discard *draft* lines for
  -- everyone else, including their planned (not yet applied) deductions.
  UPDATE public.employee_payroll_adjustments a SET payroll_item_id=NULL
  WHERE a.status='pending' AND a.payroll_item_id IN (
    SELECT id FROM public.payroll_items
    WHERE payroll_run_id=v_run AND employee_id<>p_employee_id
  );
  DELETE FROM public.payroll_items
  WHERE payroll_run_id=v_run AND employee_id<>p_employee_id;
  SELECT pi.* INTO v_item FROM public.payroll_items pi
  WHERE payroll_run_id=v_run AND employee_id=p_employee_id;
  IF NOT FOUND OR v_item.missing_attendance_days>0 THEN
    RAISE EXCEPTION 'DAILY_PAYROLL_NO_VALID_ATTENDANCE';
  END IF;
  IF v_item.net_due_original <= 0 THEN
    RAISE EXCEPTION 'DAILY_PAYROLL_NO_AMOUNT_DUE';
  END IF;
  PERFORM public.approve_payroll_run(v_run);
  PERFORM public.ensure_cashbox_session_v013(v_box,now());
  v_payment := public.record_payroll_payment(
    v_item.id,v_box,v_item.net_due_original,v_item.currency_code,
    now(),v_item.net_due_original,'صرف أجر يوم '||p_work_date::text
  );
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.pay_approved_salary_v014(
  p_payroll_item_id uuid, p_amount numeric DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_box uuid;
  v_item record;
  v_balance numeric;
  v_amount numeric;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT payroll_cashbox_id INTO v_box FROM public.app_settings WHERE id=1;
  IF v_box IS NULL THEN RAISE EXCEPTION 'PAYROLL_CASHBOX_NOT_CONFIGURED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cashboxes WHERE id=v_box AND is_active) THEN
    RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID';
  END IF;
  SELECT pi.id,pi.currency_code,pr.status INTO v_item
  FROM public.payroll_items pi
  JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
  WHERE pi.id=p_payroll_item_id FOR UPDATE OF pi;
  IF NOT FOUND OR v_item.status NOT IN ('approved','closed') THEN
    RAISE EXCEPTION 'PAYROLL_NOT_APPROVED';
  END IF;
  SELECT remaining_original INTO v_balance
  FROM public.payroll_item_balances WHERE payroll_item_id=p_payroll_item_id;
  v_amount:=coalesce(p_amount,v_balance);
  IF v_amount IS NULL OR v_amount<=0 OR v_amount>v_balance+0.001 THEN
    RAISE EXCEPTION 'INVALID_SALARY_PAYMENT_AMOUNT';
  END IF;
  PERFORM public.ensure_cashbox_session_v013(v_box,now());
  RETURN public.record_payroll_payment(
    p_payroll_item_id,v_box,v_amount,v_item.currency_code,now(),v_amount,'دفع مستحق راتب'
  );
END;
$$;

-- Monthly payroll from this UI includes MONTHLY employees only. Daily/hourly
-- workers are settled using the one-day flow and never duplicated here.
CREATE OR REPLACE FUNCTION public.create_monthly_payroll_v014(
  p_year integer, p_month integer
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_start date;
  v_end date;
  v_run uuid;
  v_note text;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_year NOT BETWEEN 2000 AND 2200 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'INVALID_PAYROLL_MONTH';
  END IF;
  v_start:=make_date(p_year,p_month,1);
  v_end:=(v_start+interval '1 month' - interval '1 day')::date;
  PERFORM pg_advisory_xact_lock(hashtext('maria_month_v014:'||v_start::text));
  IF EXISTS (SELECT 1 FROM public.payroll_runs
             WHERE period_start=v_start AND period_end=v_end AND status<>'voided') THEN
    RAISE EXCEPTION 'MONTHLY_PAYROLL_ALREADY_EXISTS';
  END IF;
  v_note:='MARIA_MONTHLY_V014:'||to_char(v_start,'YYYY-MM');
  v_run:=public.create_monthly_payroll(p_year,p_month,v_note);
  UPDATE public.employee_payroll_adjustments a SET payroll_item_id=NULL
  WHERE a.status='pending' AND a.payroll_item_id IN (
    SELECT id FROM public.payroll_items
    WHERE payroll_run_id=v_run AND pay_type_snapshot<>'monthly'
  );
  DELETE FROM public.payroll_items
  WHERE payroll_run_id=v_run AND pay_type_snapshot<>'monthly';
  IF NOT EXISTS (SELECT 1 FROM public.payroll_items WHERE payroll_run_id=v_run) THEN
    RAISE EXCEPTION 'MONTHLY_PAYROLL_NO_MONTHLY_EMPLOYEES';
  END IF;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_monthly_payroll_v014(p_payroll_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_run record;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_run FROM public.payroll_runs WHERE id=p_payroll_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status<>'draft' OR v_run.note NOT LIKE 'MARIA_MONTHLY_V014:%' THEN
    RAISE EXCEPTION 'MONTHLY_PAYROLL_NOT_EDITABLE';
  END IF;
  PERFORM public.recalculate_payroll_run(p_payroll_run_id);
  UPDATE public.employee_payroll_adjustments a SET payroll_item_id=NULL
  WHERE a.status='pending' AND a.payroll_item_id IN (
    SELECT id FROM public.payroll_items
    WHERE payroll_run_id=p_payroll_run_id AND pay_type_snapshot<>'monthly'
  );
  DELETE FROM public.payroll_items
  WHERE payroll_run_id=p_payroll_run_id AND pay_type_snapshot<>'monthly';
END;
$$;

REVOKE ALL ON FUNCTION public.set_payroll_cashbox_v014(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_wage_dues_v014() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_daily_wage_v014(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_approved_salary_v014(uuid,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_monthly_payroll_v014(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_monthly_payroll_v014(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_payroll_cashbox_v014(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_wage_dues_v014() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_daily_wage_v014(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_approved_salary_v014(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_monthly_payroll_v014(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_monthly_payroll_v014(uuid) TO authenticated;

COMMIT;
