-- Maria CFO Web v1.0.24
-- Cashboxes retain their full balance when the business date changes.
-- No UPDATE/DELETE/TRUNCATE of existing cash, invoices, or transactions.
-- Apply AFTER v1.0.23. Take a restorable backup first.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- The last counted, CLOSED balance is the checkpoint if there is one.
-- Otherwise start at the FIRST session's original opening balance.
-- Include ALL non-void transactions in every subsequent OPEN daily session.
-- This also corrects the display for existing days whose opening was 0
-- without silently rewriting historical sessions or manufacturing cash entries.
CREATE OR REPLACE FUNCTION public.cashbox_live_balance_base_v124(
    p_cashbox_id uuid,
    p_through_date date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_checkpoint_date date;
  v_balance numeric := 0;
  v_net numeric := 0;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_cashbox_id IS NULL OR p_through_date IS NULL THEN
    RAISE EXCEPTION 'V124_CASHBOX_ARGUMENT_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cashboxes WHERE id = p_cashbox_id) THEN
    RAISE EXCEPTION 'V124_CASHBOX_NOT_FOUND';
  END IF;

  SELECT s.business_date, COALESCE(s.cash_left_base, 0)
    INTO v_checkpoint_date, v_balance
    FROM public.cashbox_sessions s
    WHERE s.cashbox_id = p_cashbox_id
      AND s.business_date <= p_through_date
      AND s.status = 'closed'
    ORDER BY s.business_date DESC, s.closed_at DESC NULLS LAST, s.id DESC
    LIMIT 1;

  IF v_checkpoint_date IS NULL THEN
    SELECT s.opening_balance_base
      INTO v_balance
      FROM public.cashbox_sessions s
      WHERE s.cashbox_id = p_cashbox_id AND s.business_date <= p_through_date
      ORDER BY s.business_date ASC, s.id ASC LIMIT 1;
    IF NOT FOUND THEN
      SELECT COALESCE(c.default_opening_balance,0)
        INTO v_balance FROM public.cashboxes c WHERE c.id = p_cashbox_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN t.direction = 'in' THEN t.amount_base
                          WHEN t.direction = 'out' THEN -t.amount_base
                          ELSE 0 END),0)
    INTO v_net
    FROM public.cashbox_transactions t
    JOIN public.cashbox_sessions s ON s.id = t.session_id
   WHERE t.cashbox_id = p_cashbox_id
     AND t.is_void = FALSE
     AND s.business_date <= p_through_date
     AND (v_checkpoint_date IS NULL OR s.business_date > v_checkpoint_date);
  RETURN COALESCE(v_balance,0) + COALESCE(v_net,0);
END;
$function$;
REVOKE ALL ON FUNCTION public.cashbox_live_balance_base_v124(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashbox_live_balance_base_v124(uuid,date) TO authenticated;

-- The core daily-session opener now carries the actual balance forward even
-- when yesterday was never closed. Existing sessions are left untouched.
CREATE OR REPLACE FUNCTION public.get_or_create_cashbox_session(
    p_cashbox_id uuid, p_business_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_today date;
  v_timezone text;
  v_opening numeric;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT COALESCE(NULLIF(s.timezone,''),'UTC') INTO v_timezone
    FROM public.app_settings s WHERE s.id = 1;
  v_today := COALESCE(p_business_date, (now() AT TIME ZONE COALESCE(v_timezone,'UTC'))::date);
  IF p_cashbox_id IS NULL THEN RAISE EXCEPTION 'V124_CASHBOX_ID_REQUIRED'; END IF;

  -- Serialize opening a new day for the same box.
  PERFORM 1 FROM public.cashboxes c
    WHERE c.id = p_cashbox_id AND COALESCE(c.is_active,TRUE)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V124_ACTIVE_CASHBOX_NOT_FOUND'; END IF;

  SELECT s.id INTO v_id FROM public.cashbox_sessions s
    WHERE s.cashbox_id = p_cashbox_id AND s.business_date = v_today
    ORDER BY s.id LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.ensure_cashbox_session_openings(v_id);
    RETURN v_id;
  END IF;

  v_opening := public.cashbox_live_balance_base_v124(p_cashbox_id, v_today - 1);
  INSERT INTO public.cashbox_sessions(cashbox_id,business_date,opening_balance_base)
    VALUES(p_cashbox_id,v_today,v_opening) RETURNING id INTO v_id;
  PERFORM public.ensure_cashbox_session_openings(v_id);
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_or_create_cashbox_session(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_cashbox_session(uuid,date) TO authenticated;

-- Ensure an explicit DATE never shifts into the previous day in a non-UTC
-- configured timezone. The prior implementation cast a UTC midnight timestamp.
CREATE OR REPLACE FUNCTION public.ensure_cashbox_day_v013(
    p_business_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_box record;
  v_count integer := 0;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_business_date IS NULL THEN RAISE EXCEPTION 'V124_BUSINESS_DATE_REQUIRED'; END IF;
  FOR v_box IN
    SELECT id FROM public.cashboxes
    WHERE COALESCE(is_active,TRUE) = TRUE
    ORDER BY display_order NULLS LAST, id
  LOOP
    v_id := public.get_or_create_cashbox_session(v_box.id,p_business_date);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.ensure_cashbox_day_v013(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_cashbox_day_v013(date) TO authenticated;

-- The business day is controlled by Supabase app_settings.timezone,
-- not the timezone of the user's browser or the UTC SQL server.
CREATE OR REPLACE FUNCTION public.cashbox_business_today_v124()
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE v_timezone text;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT COALESCE(NULLIF(s.timezone,''),'UTC') INTO v_timezone
    FROM public.app_settings s WHERE s.id=1;
  RETURN (now() AT TIME ZONE COALESCE(v_timezone,'UTC'))::date;
END;
$function$;
REVOKE ALL ON FUNCTION public.cashbox_business_today_v124() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashbox_business_today_v124() TO authenticated;

-- Read-only live overview with the same JSON shape as v0.13. Daily session
-- totals remain available for reporting, but the display reads the continuous
-- live balance instead of treating an empty new session as a zero cashbox.
CREATE OR REPLACE FUNCTION public.get_cashbox_overview_v124(
    p_business_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
DECLARE
  v_entry jsonb;
  v_summary jsonb;
  v_result jsonb := '[]'::jsonb;
  v_box_id uuid;
  v_balance numeric;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(public.get_cashbox_overview_v013(p_business_date))
  LOOP
    v_box_id := (v_entry->'cashbox'->>'id')::uuid;
    v_balance := public.cashbox_live_balance_base_v124(v_box_id,p_business_date);
    v_summary := CASE WHEN jsonb_typeof(v_entry->'summary')='object'
                  THEN v_entry->'summary' ELSE '{}'::jsonb END;
    v_entry := jsonb_set(v_entry,'{summary}',
      v_summary || jsonb_build_object('live_balance_base_v124',v_balance),TRUE);
    v_result := v_result || jsonb_build_array(v_entry);
  END LOOP;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_cashbox_overview_v124(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashbox_overview_v124(date) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
