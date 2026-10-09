-- Maria CFO Web v0.19 - Correct cashbox adjustment ledger transaction types.
-- Apply AFTER v0.18. Do not rerun old migrations. No schema constraints removed.
-- 'adjustment' was rejected by cashbox_transactions_transaction_type_check;
-- the existing financial ledger permits 'adjustment_in' and 'adjustment_out'.
BEGIN;

-- Fail closed if the live check constraint is different from the inspected snapshot.
DO $$
DECLARE v_rule text;
BEGIN
  SELECT pg_get_constraintdef(c.oid,true) INTO v_rule
  FROM pg_constraint c
  WHERE c.conrelid='public.cashbox_transactions'::regclass
    AND c.conname='cashbox_transactions_transaction_type_check';
  IF v_rule IS NULL OR position('adjustment_in' in v_rule)=0 OR position('adjustment_out' in v_rule)=0 THEN
    RAISE EXCEPTION 'CASHBOX_TYPES_NEED_REVIEW: live constraint does not permit adjustment_in and adjustment_out';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cashbox_adjustment_v013(
    p_cashbox_id uuid,
    p_direction text,
    p_amount numeric,
    p_currency_code text DEFAULT 'SYP',
    p_note text DEFAULT NULL,
    p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_direction text := lower(btrim(coalesce(p_direction,'')));
  v_currency text := upper(btrim(coalesce(p_currency_code,'SYP')));
  v_transaction_type text;
  v_id uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'INVALID_CASHBOX_ADJUSTMENT_DIRECTION';
  END IF;
  IF p_cashbox_id IS NULL THEN RAISE EXCEPTION 'CASHBOX_REQUIRED'; END IF;
  IF p_amount IS NULL OR p_amount<=0 THEN
    RAISE EXCEPTION 'CASHBOX_ADJUSTMENT_AMOUNT_REQUIRED';
  END IF;
  v_transaction_type := CASE v_direction
    WHEN 'in' THEN 'adjustment_in'
    ELSE 'adjustment_out' END;

  PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,coalesce(p_occurred_at,now()));
  v_id := public.record_cashbox_transaction(
      p_cashbox_id,
      v_direction,
      v_transaction_type,
      p_amount,
      v_currency,
      coalesce(p_occurred_at,now()),
      coalesce(nullif(btrim(p_note),''),'ضبط رصيد الصندوق'),
      'cashbox_adjustment',
      NULL
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_cashbox_adjustment_v013(uuid,text,numeric,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_cashbox_adjustment_v013(uuid,text,numeric,text,text,timestamptz) TO authenticated;
-- Signature above must match exactly: six args: uuid, text, numeric, text, text, timestamptz.
COMMIT;
