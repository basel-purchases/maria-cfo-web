-- Maria CFO Web v1.0.29: owner-only, atomic group salary payments and read-only
-- source explanations for allocated advances and bonuses. No data reset or backfill.
-- Requires payroll migrations through v1.0.28.
BEGIN;
DO $required$
BEGIN
 IF to_regprocedure('public.pay_approved_salary_v034(uuid,numeric,uuid,text)') IS NULL
    OR to_regprocedure('public.payroll_ready_v034(date)') IS NULL
    OR to_regclass('public.payroll_advance_deductions') IS NULL
    OR to_regclass('public.employee_payroll_adjustments') IS NULL
 THEN RAISE EXCEPTION 'V129_PAYROLL_PREREQUISITES_MISSING'; END IF;
END;
$required$;

-- A single RPC call = one PostgreSQL transaction. If ANY employee is invalid,
-- the entire batch rolls back, including previously written payment/cash rows.
-- Remaining amounts are read on the server under a payroll-item row lock.
CREATE OR REPLACE FUNCTION public.pay_approved_salaries_bulk_v129(
 p_month date, p_payroll_item_ids uuid[], p_cashbox_id uuid, p_note text DEFAULT NULL)
RETURNS TABLE(payroll_item_id uuid, employee_name text,
 amount_original numeric, currency_code text, payment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_count integer; v_item record; v_payment uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_count := COALESCE(cardinality(p_payroll_item_ids),0);
 IF p_month IS NULL OR p_month<date '2000-01-01' OR p_month>=date '2201-01-01'
     OR v_count<1 OR v_count>300 THEN RAISE EXCEPTION 'V129_INVALID_BATCH_SELECTION'; END IF;
 IF p_note IS NOT NULL AND length(p_note)>300 THEN RAISE EXCEPTION 'V129_NOTE_TOO_LONG'; END IF;
 IF p_cashbox_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active)
 THEN RAISE EXCEPTION 'PAYROLL_CASHBOX_INVALID'; END IF;
 IF (SELECT count(DISTINCT id) FROM unnest(p_payroll_item_ids) AS u(id))<>v_count
 THEN RAISE EXCEPTION 'V129_DUPLICATE_BATCH_ITEMS'; END IF;
 IF (SELECT count(*) FROM public.payroll_items pi JOIN public.payroll_runs pr
         ON pr.id=pi.payroll_run_id
         WHERE pi.id=ANY(p_payroll_item_ids) AND
          pr.period_start>=date_trunc('month',p_month)::date AND
          pr.period_start<(date_trunc('month',p_month)+interval '1 month')::date)<>v_count
 THEN RAISE EXCEPTION 'V129_BATCH_PERIOD_MISMATCH'; END IF;

 -- Lock in stable order to serialize concurrent attempts and prevent a second
 -- browser tab from re-paying an item included in this batch.
 FOR v_item IN
  SELECT pi.id,pi.employee_name_snapshot,pi.currency_code,
    pi.pay_type_snapshot,pi.missing_attendance_days,
    pr.status AS run_status,
    coalesce(b.remaining_original,pi.net_due_original) AS remaining
  FROM public.payroll_items pi
  JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
  LEFT JOIN public.payroll_item_balances b ON b.payroll_item_id=pi.id
  WHERE pi.id=ANY(p_payroll_item_ids)
  ORDER BY pi.id FOR UPDATE OF pi
 LOOP
  IF v_item.run_status NOT IN ('approved','closed')
    OR v_item.remaining IS NULL OR v_item.remaining<=0.0001
    OR (v_item.pay_type_snapshot<>'monthly' AND coalesce(v_item.missing_attendance_days,0)>0)
  THEN RAISE EXCEPTION 'V129_ITEM_NOT_PAYABLE: %',v_item.employee_name_snapshot; END IF;
  v_payment:=public.pay_approved_salary_v034(v_item.id,v_item.remaining,p_cashbox_id,
    'دفع جماعي للرواتب'||CASE WHEN nullif(btrim(coalesce(p_note,'')),'') IS NULL THEN ''
       ELSE ' | '||left(btrim(p_note),300) END);
  payroll_item_id:=v_item.id;
  employee_name:=v_item.employee_name_snapshot;
  currency_code:=v_item.currency_code;
  amount_original:=v_item.remaining;
  payment_id:=v_payment;
  RETURN NEXT;
 END LOOP;
END;
$fn$;

-- One output row per payroll item. Linked transaction comments are used for
-- hover descriptions; no invented names, notes, or allocations.
-- Includes payrolls paid this month even if they belong to an earlier month.
CREATE OR REPLACE FUNCTION public.payroll_item_explanations_v129(p_month date)
RETURNS TABLE(payroll_item_id uuid, employee_name text, currency_code text,
 bonus_details jsonb, advance_details jsonb, payment_ids jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
 SELECT pi.id,pi.employee_name_snapshot,pi.currency_code,
 COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'date',a.effective_date,'reason',a.reason,'note',a.note,
   'amount',a.amount_original) ORDER BY a.effective_date,a.id)
    FROM public.employee_payroll_adjustments a
    WHERE a.payroll_item_id=pi.id AND a.adjustment_type='bonus'
      AND a.status<>'voided'),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'date',(adv.occurred_at AT TIME ZONE COALESCE(s.timezone,'UTC'))::date,
   'note',adv.note,'amount',d.amount_original) ORDER BY adv.occurred_at,adv.id)
    FROM public.payroll_advance_deductions d
    JOIN public.employee_advances adv ON adv.id=d.advance_id
    WHERE d.payroll_item_id=pi.id),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(pp.id ORDER BY pp.occurred_at,pp.id)
    FROM public.payroll_payments pp
    WHERE pp.payroll_item_id=pi.id AND pp.status='posted'
      AND (pp.occurred_at AT TIME ZONE COALESCE(s.timezone,'UTC'))::date>=date_trunc('month',p_month)::date
      AND (pp.occurred_at AT TIME ZONE COALESCE(s.timezone,'UTC'))::date<(date_trunc('month',p_month)+interval '1 month')::date),'[]'::jsonb)
 FROM public.payroll_items pi
 JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
 JOIN public.app_settings s ON s.id=1
 WHERE public.is_app_owner() AND p_month IS NOT NULL AND
 ( (pr.period_start>=date_trunc('month',p_month)::date
    AND pr.period_start<(date_trunc('month',p_month)+interval '1 month')::date)
   OR EXISTS (SELECT 1 FROM public.payroll_payments pp WHERE pp.payroll_item_id=pi.id
     AND pp.status='posted'
     AND (pp.occurred_at AT TIME ZONE COALESCE(s.timezone,'UTC'))::date>=date_trunc('month',p_month)::date
     AND (pp.occurred_at AT TIME ZONE COALESCE(s.timezone,'UTC'))::date<(date_trunc('month',p_month)+interval '1 month')::date))
 ORDER BY pi.employee_name_snapshot,pi.id;
$fn$;

REVOKE ALL ON FUNCTION public.pay_approved_salaries_bulk_v129(date,uuid[],uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.payroll_item_explanations_v129(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_approved_salaries_bulk_v129(date,uuid[],uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payroll_item_explanations_v129(date) TO authenticated;
COMMIT;
