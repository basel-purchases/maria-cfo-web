-- Maria CFO Web v0.17 -- non-destructive agent approval queue + daily wage preflight
-- Prerequisite: successful v0.14 migration and existing payroll/inventory RPCs.
-- Run ONCE in Supabase SQL Editor. No existing payroll rows, employees, or financial ledgers are rewritten.
BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_action_queue_v017 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('post_order','post_purchase','pay_daily_wage','pay_approved_salary','record_expense','set_payroll_cashbox')),
  action_args jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  result jsonb,
  failure_message text
);
CREATE INDEX IF NOT EXISTS assistant_queue_v017_owner_status ON public.assistant_action_queue_v017(user_id,status,created_at DESC);
ALTER TABLE public.assistant_action_queue_v017 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_queue_v017_owner_only ON public.assistant_action_queue_v017;
CREATE POLICY assistant_queue_v017_owner_only ON public.assistant_action_queue_v017
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_app_owner())
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_app_owner());
REVOKE ALL ON public.assistant_action_queue_v017 FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.assistant_action_queue_v017 TO authenticated;

-- Estimate according to the actual attendance state, not 'the day was scheduled'.
-- A zero-hour day is NOT automatically paid. Only explicit 'paid_leave' can pay without hours.
-- Payroll payout still uses the original auditable payroll snapshot/RPC and may differ
-- when advances/bonuses/deductions exist.
CREATE OR REPLACE FUNCTION public.get_daily_wage_dues_v017()
RETURNS TABLE (
  employee_id uuid, work_date date, employee_name text, pay_type text,
  currency_code text, attendance_status text, expected_hours numeric,
  worked_hours numeric, estimated_due_original numeric, review_note text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT e.id, a.work_date, e.name, e.pay_type, e.wage_currency_code,
    a.status, a.expected_hours, a.worked_hours,
    round(greatest(0::numeric,
      CASE
        WHEN a.status IN ('absent','unpaid_leave','day_off','holiday') THEN 0::numeric
        WHEN a.status <> 'paid_leave' AND coalesce(a.worked_hours,0) <= 0 THEN 0::numeric
        WHEN e.pay_type = 'daily' THEN
          CASE WHEN a.status = 'paid_leave' THEN e.daily_rate_original
            ELSE e.daily_rate_original -
              least(greatest(coalesce(a.applied_shortage_hours,a.calculated_shortage_hours,0),0),greatest(a.expected_hours,0))
              * (e.daily_rate_original / nullif(e.required_daily_hours,0))
              * coalesce(e.shortage_multiplier,s.default_shortage_multiplier,1)
          END
        ELSE (CASE WHEN a.status='paid_leave' THEN a.expected_hours
                   ELSE least(a.worked_hours,a.expected_hours) END) * e.hourly_rate_original
      END
      + CASE WHEN (a.worked_hours>0 OR a.status='paid_leave')
          AND a.status NOT IN ('absent','unpaid_leave','day_off','holiday')
        THEN greatest(0,coalesce(a.approved_overtime_hours,a.calculated_overtime_hours,0))
          * (CASE WHEN e.pay_type='daily' THEN e.daily_rate_original/nullif(e.required_daily_hours,0)
                  ELSE e.hourly_rate_original END)
          * coalesce(e.overtime_multiplier,s.default_overtime_multiplier,1.5)
        ELSE 0 END
    ),4) AS estimated_due_original,
    CASE WHEN a.status NOT IN ('paid_leave','absent','unpaid_leave','holiday','day_off')
              AND coalesce(a.worked_hours,0)=0 AND a.expected_hours>0
         THEN 'صفر ساعات عمل مع حالة دوام؛ لا يستحق أجرًا حتى تصحيح السجل أو تحديد إجازة مدفوعة.'
         WHEN a.status='paid_leave' THEN 'إجازة مدفوعة صراحةً؛ لا تشترط ساعات عمل.'
         ELSE NULL END AS review_note
  FROM public.employee_attendance a
  JOIN public.employees e ON e.id=a.employee_id
  CROSS JOIN public.app_settings s
  WHERE s.id=1 AND public.is_app_owner()
    AND e.pay_type IN ('daily','hourly')
    AND a.work_date <= (now() AT TIME ZONE s.timezone)::date
    AND NOT EXISTS (
      SELECT 1 FROM public.payroll_items pi
      JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
      WHERE pi.employee_id=a.employee_id AND a.work_date BETWEEN pr.period_start AND pr.period_end
        AND pr.status IN ('approved','closed')
    )
  ORDER BY a.work_date DESC,e.name;
$$;

-- Reject zero-hour or unpaid day before the original payout RPC creates any financial records.
-- It does NOT automatically change attendance status or override an explicit paid leave.
CREATE OR REPLACE FUNCTION public.pay_daily_wage_v017(p_employee_id uuid,p_work_date date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_att public.employee_attendance%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_att FROM public.employee_attendance
    WHERE employee_id=p_employee_id AND work_date=p_work_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATTENDANCE_MUST_BE_RECORDED'; END IF;
  IF v_att.status IN ('absent','unpaid_leave','holiday','day_off')
     OR (v_att.status <> 'paid_leave' AND coalesce(v_att.worked_hours,0)<=0)
  THEN
     RAISE EXCEPTION 'NO_DAILY_WAGE_WITHOUT_WORK: سجل الدوام صفر ساعات أو حالة غير مدفوعة. إذا كانت إجازة مدفوعة، سجل paid_leave صراحة قبل الصرف.';
  END IF;
  RETURN public.pay_daily_wage_v014(p_employee_id,p_work_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_wage_dues_v017() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_daily_wage_v017(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_wage_dues_v017() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_daily_wage_v017(uuid,date) TO authenticated;

COMMIT;
