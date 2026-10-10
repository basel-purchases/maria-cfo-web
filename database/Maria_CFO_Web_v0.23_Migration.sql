-- Maria CFO: staged first-batch backend changes. combined backend migration; execute on a TEST copy first.
-- Never rewrite existing posted transactions or historic exchange snapshots.
BEGIN;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS default_order_discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_expenditure_tax_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS local_administration_tax_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_expense_cashbox_id uuid REFERENCES public.cashboxes(id);

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.app_settings'::regclass AND conname='maria_order_rates_v023') THEN
 ALTER TABLE public.app_settings ADD CONSTRAINT maria_order_rates_v023 CHECK (
 default_order_discount_percent BETWEEN 0 AND 100
 AND monthly_expenditure_tax_percent BETWEEN 0 AND 100
 AND local_administration_tax_percent BETWEEN 0 AND 100);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_order_settings_v023(
 p_discount_percent numeric,
 p_monthly_tax_percent numeric,
 p_local_tax_percent numeric,
 p_expense_cashbox_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_discount_percent IS NULL OR p_discount_percent NOT BETWEEN 0 AND 100
 OR p_monthly_tax_percent IS NULL OR p_monthly_tax_percent NOT BETWEEN 0 AND 100
 OR p_local_tax_percent IS NULL OR p_local_tax_percent NOT BETWEEN 0 AND 100
 THEN RAISE EXCEPTION 'INVALID_ORDER_RATE'; END IF;
 IF p_expense_cashbox_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.cashboxes WHERE id=p_expense_cashbox_id AND is_active
 ) THEN RAISE EXCEPTION 'EXPENSE_CASHBOX_NOT_ACTIVE'; END IF;
 UPDATE public.app_settings SET
 default_order_discount_percent=p_discount_percent,
 monthly_expenditure_tax_percent=p_monthly_tax_percent,
 local_administration_tax_percent=p_local_tax_percent,
 default_expense_cashbox_id=p_expense_cashbox_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_order_settings_v023(numeric,numeric,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_settings_v023(numeric,numeric,numeric,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_expense_category_v023(
 p_action text,
 p_category_id uuid DEFAULT NULL,
 p_name text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text:=btrim(coalesce(p_name,''));v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_action NOT IN ('add','rename','delete') THEN RAISE EXCEPTION 'INVALID_CATEGORY_ACTION'; END IF;
 IF p_action IN ('add','rename') THEN
   IF length(v_name)<2 OR length(v_name)>120 THEN RAISE EXCEPTION 'CATEGORY_NAME_INVALID'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('maria-expense-category:'||lower(v_name),0));
   IF EXISTS (SELECT 1 FROM public.expense_categories ec
     WHERE lower(btrim(ec.name))=lower(v_name) AND ec.id IS DISTINCT FROM p_category_id)
   THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_EXISTS'; END IF;
 END IF;
 IF p_action='add' THEN
   INSERT INTO public.expense_categories(code,name) VALUES ('CUSTOM_'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,18)),v_name) RETURNING id INTO v_id;
 ELSIF p_action='rename' THEN
   UPDATE public.expense_categories SET name=v_name WHERE id=p_category_id RETURNING id INTO v_id;
   IF v_id IS NULL THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_NOT_FOUND'; END IF;
 ELSE
   IF p_category_id IS NULL THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_NOT_FOUND'; END IF;
   IF EXISTS (SELECT 1 FROM public.expenses WHERE category_id=p_category_id) THEN
     RAISE EXCEPTION 'EXPENSE_CATEGORY_IN_USE';
   END IF;
   DELETE FROM public.expense_categories WHERE id=p_category_id RETURNING id INTO v_id;
   IF v_id IS NULL THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_NOT_FOUND'; END IF;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.manage_expense_category_v023(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_expense_category_v023(text,uuid,text) TO authenticated;

-- Monetary policies saved on drafts for review. Posting with nonzero order-level
-- policy is BLOCKED by the client until the original posting RPC has a verified
-- ledger-integrated implementation; never quietly claim a paid total is posted.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_discount_percent_v023 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expenditure_tax_percent_v023 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS local_administration_tax_percent_v023 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_discount_amount_original_v023 numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expenditure_tax_amount_original_v023 numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS local_administration_tax_amount_original_v023 numeric(20,4) NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='maria_order_rates_v023') THEN
 ALTER TABLE public.orders ADD CONSTRAINT maria_order_rates_v023 CHECK (
 order_discount_percent_v023 BETWEEN 0 AND 100
 AND expenditure_tax_percent_v023 BETWEEN 0 AND 100
 AND local_administration_tax_percent_v023 BETWEEN 0 AND 100);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_order_rates_v023(
 p_order_id uuid,p_discount_percent numeric,p_expenditure_tax_percent numeric,p_local_tax_percent numeric
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT status INTO v_status FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'ORDER_NOT_DRAFT'; END IF;
 IF p_discount_percent IS NULL OR p_discount_percent NOT BETWEEN 0 AND 100
 OR p_expenditure_tax_percent IS NULL OR p_expenditure_tax_percent NOT BETWEEN 0 AND 100
 OR p_local_tax_percent IS NULL OR p_local_tax_percent NOT BETWEEN 0 AND 100
 THEN RAISE EXCEPTION 'INVALID_ORDER_RATE'; END IF;
 UPDATE public.orders SET order_discount_percent_v023=p_discount_percent,
 expenditure_tax_percent_v023=p_expenditure_tax_percent,
 local_administration_tax_percent_v023=p_local_tax_percent WHERE id=p_order_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_order_rates_v023(uuid,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_order_rates_v023(uuid,numeric,numeric,numeric) TO authenticated;

-- Snapshot current policy once, at draft creation, including orders created by OCR.
CREATE OR REPLACE FUNCTION public.initialize_order_rates_v023() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_policy record;
BEGIN
  SELECT default_order_discount_percent, monthly_expenditure_tax_percent,
    local_administration_tax_percent INTO v_policy FROM public.app_settings LIMIT 1;
  IF FOUND THEN
    NEW.order_discount_percent_v023:=coalesce(v_policy.default_order_discount_percent,0);
    NEW.expenditure_tax_percent_v023:=coalesce(v_policy.monthly_expenditure_tax_percent,0);
    NEW.local_administration_tax_percent_v023:=coalesce(v_policy.local_administration_tax_percent,0);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS initialize_order_rates_v023_trg ON public.orders;
CREATE TRIGGER initialize_order_rates_v023_trg BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_rates_v023();

-- One atomic, auditable cashbox transfer: the underlying ledger remains RPC-only.
CREATE TABLE IF NOT EXISTS public.cashbox_manual_transfers_v023(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_cashbox_id uuid NOT NULL REFERENCES public.cashboxes(id),
 destination_cashbox_id uuid NOT NULL REFERENCES public.cashboxes(id),
 currency_code text NOT NULL,
 amount_original numeric NOT NULL CHECK(amount_original>0),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 source_transaction_id uuid,
 destination_transaction_id uuid,
 CHECK(source_cashbox_id<>destination_cashbox_id)
);
ALTER TABLE public.cashbox_manual_transfers_v023 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cashbox_manual_transfers_v023 FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.zero_cashbox_to_general_v023(p_source_cashbox_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_target uuid;v_source_session uuid;v_target_session uuid;v_transfer uuid;v_out uuid;v_in uuid;
 v_item record;v_rows integer:=0;v_json jsonb:='[]'::jsonb;v_unknown integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_source_cashbox_id IS NULL THEN RAISE EXCEPTION 'CASHBOX_REQUIRED'; END IF;
 SELECT id INTO v_target FROM public.cashboxes
 WHERE is_general IS TRUE AND is_active IS TRUE ORDER BY id LIMIT 1;
 IF v_target IS NULL THEN RAISE EXCEPTION 'GENERAL_CASHBOX_REQUIRED'; END IF;
 IF v_target=p_source_cashbox_id THEN RAISE EXCEPTION 'CANNOT_ZERO_GENERAL_CASHBOX'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_source_cashbox_id AND is_active IS TRUE)
 THEN RAISE EXCEPTION 'SOURCE_CASHBOX_NOT_ACTIVE'; END IF;
 -- Lock by ids, independently of which order users selected them in.
 PERFORM pg_advisory_xact_lock(hashtextextended('cashbox-zero:'||least(p_source_cashbox_id::text,v_target::text),0));
 PERFORM pg_advisory_xact_lock(hashtextextended('cashbox-zero:'||greatest(p_source_cashbox_id::text,v_target::text),0));
 v_source_session:=public.ensure_cashbox_session_v013(p_source_cashbox_id,now());
 v_target_session:=public.ensure_cashbox_session_v013(v_target,now());
 IF v_source_session IS NULL OR v_target_session IS NULL THEN RAISE EXCEPTION 'CASHBOX_SESSION_REQUIRED'; END IF;
 -- Never guess the opening field: abort if the live schema cannot be recognized.
 SELECT count(*) INTO v_unknown FROM public.cashbox_session_openings o
 WHERE o.session_id=v_source_session AND coalesce(
  to_jsonb(o)->>'opening_balance_original',to_jsonb(o)->>'opening_amount_original',
  to_jsonb(o)->>'amount_original',to_jsonb(o)->>'opening_original',
  to_jsonb(o)->>'opening_balance',to_jsonb(o)->>'opening_amount',to_jsonb(o)->>'amount'
 ) IS NULL;
 IF v_unknown>0 THEN RAISE EXCEPTION 'OPENING_BALANCE_SCHEMA_REVIEW_REQUIRED'; END IF;
 FOR v_item IN
 WITH movement AS (
   SELECT t.currency_code::text AS currency_code,
    CASE WHEN t.direction='out' THEN -t.amount_original ELSE t.amount_original END::numeric AS amount
   FROM public.cashbox_transactions t WHERE t.session_id=v_source_session AND t.is_void IS NOT TRUE
   UNION ALL
   SELECT (to_jsonb(o)->>'currency_code')::text AS currency_code,
    nullif(coalesce(to_jsonb(o)->>'opening_balance_original',to_jsonb(o)->>'opening_amount_original',
     to_jsonb(o)->>'amount_original',to_jsonb(o)->>'opening_original',
     to_jsonb(o)->>'opening_balance',to_jsonb(o)->>'opening_amount',to_jsonb(o)->>'amount'),'')::numeric AS amount
   FROM public.cashbox_session_openings o WHERE o.session_id=v_source_session
 ) SELECT currency_code,sum(amount) AS balance
   FROM movement WHERE currency_code IS NOT NULL GROUP BY currency_code ORDER BY currency_code
 LOOP
   IF v_item.balance < -0.00001 THEN RAISE EXCEPTION 'CASHBOX_HAS_NEGATIVE_BALANCE'; END IF;
   IF coalesce(v_item.balance,0)<=0.00001 THEN CONTINUE; END IF;
   IF v_item.currency_code NOT IN ('SYP','USD') THEN RAISE EXCEPTION 'UNSUPPORTED_TRANSFER_CURRENCY'; END IF;
   v_transfer:=gen_random_uuid();
   INSERT INTO public.cashbox_manual_transfers_v023(id,source_cashbox_id,destination_cashbox_id,currency_code,amount_original)
     VALUES(v_transfer,p_source_cashbox_id,v_target,v_item.currency_code,v_item.balance);
   v_out:=public.record_cashbox_transaction(p_source_cashbox_id,'out','transfer_out',v_item.balance,v_item.currency_code,now(),
      'Cashbox zero to general','cashbox_transfer',v_transfer);
   v_in:=public.record_cashbox_transaction(v_target,'in','transfer_in',v_item.balance,v_item.currency_code,now(),
      'Cashbox zero from source','cashbox_transfer',v_transfer);
   UPDATE public.cashbox_manual_transfers_v023 SET source_transaction_id=v_out,destination_transaction_id=v_in WHERE id=v_transfer;
   v_json:=v_json||jsonb_build_array(jsonb_build_object('currency',v_item.currency_code,'amount',v_item.balance));
   v_rows:=v_rows+1;
 END LOOP;
 IF v_rows=0 THEN RAISE EXCEPTION 'CASHBOX_ALREADY_EMPTY'; END IF;
 RETURN jsonb_build_object('ok',true,'transfers',v_json);
END $$;
REVOKE ALL ON FUNCTION public.zero_cashbox_to_general_v023(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zero_cashbox_to_general_v023(uuid) TO authenticated;

-- Monetary order posting: preserve the original post_order inventory/cost snapshots.
-- It is invoked without automatic payment; a single receipt with discounted/taxed
-- total is then posted atomically, using the original ledger RPC.
CREATE OR REPLACE FUNCTION public.post_order_v023(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_before public.orders%rowtype; v_after public.orders%rowtype;
 v_discount numeric;v_subtotal numeric;v_tax numeric;v_local numeric;v_paid numeric;
 v_payment uuid;v_ledger uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_before FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF v_before.status<>'draft' THEN RAISE EXCEPTION 'ORDER_NOT_DRAFT'; END IF;
 IF v_before.cashbox_id IS NULL THEN RAISE EXCEPTION 'ORDER_CASHBOX_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=p_order_id AND status='posted') THEN
   RAISE EXCEPTION 'ORDER_HAS_PRIOR_PAYMENT';
 END IF;
 PERFORM public.ensure_cashbox_session_v013(v_before.cashbox_id,v_before.occurred_at);
 -- Prevent an older client from bypassing totals integration (trigger below).
 PERFORM set_config('maria.post_v023','1',true);
 PERFORM public.post_order(p_order_id,false);
 PERFORM set_config('maria.post_v023','0',true);
 SELECT * INTO v_after FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF v_after.status<>'posted' THEN RAISE EXCEPTION 'ORDER_POST_NOT_CONFIRMED'; END IF;
 v_discount:=round(v_after.net_total_original*v_before.order_discount_percent_v023/100,4);
 v_subtotal:=greatest(0,v_after.net_total_original-v_discount);
 v_tax:=round(v_subtotal*v_before.expenditure_tax_percent_v023/100,4);
 -- The local administration charge is a percentage of the expenditure tax.
 v_local:=round(v_tax*v_before.local_administration_tax_percent_v023/100,4);
 v_paid:=round(v_subtotal+v_tax+v_local,4);
 UPDATE public.orders SET
  discount_total_original=discount_total_original+v_discount,
  net_total_original=v_paid,
  net_total_base=round(v_paid*v_before.exchange_rate_to_base,4),
  order_discount_amount_original_v023=v_discount,
  expenditure_tax_amount_original_v023=v_tax,
  local_administration_tax_amount_original_v023=v_local
 WHERE id=p_order_id;
 IF v_paid>0 THEN
   v_payment:=gen_random_uuid();
   v_ledger:=public.record_cashbox_transaction(v_before.cashbox_id,'in','sale',v_paid,
    v_before.currency_code,v_before.occurred_at,'Order paid with charges','order_payment',v_payment);
   INSERT INTO public.order_payments(id,order_id,cashbox_id,cashbox_transaction_id,
      currency_code,amount_original,exchange_rate_to_base,occurred_at)
   VALUES(v_payment,p_order_id,v_before.cashbox_id,v_ledger,v_before.currency_code,
      v_paid,v_before.exchange_rate_to_base,v_before.occurred_at);
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.post_order_v023(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_order_v023(uuid) TO authenticated;

-- Posted non-zero policies MUST go through the updated posting workflow.
CREATE OR REPLACE FUNCTION public.guard_order_post_with_charges_v023()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF new.status='posted' AND old.status IS DISTINCT FROM 'posted'
    AND (new.order_discount_percent_v023>0
      OR new.expenditure_tax_percent_v023>0
      OR new.local_administration_tax_percent_v023>0)
    AND coalesce(current_setting('maria.post_v023',true),'')<>'1'
 THEN RAISE EXCEPTION 'USE_POST_ORDER_V023'; END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_order_post_with_charges_v023_trg ON public.orders;
CREATE TRIGGER guard_order_post_with_charges_v023_trg
 BEFORE UPDATE OF status ON public.orders FOR EACH ROW
 EXECUTE FUNCTION public.guard_order_post_with_charges_v023();

-- Items marked complimentary still consume the recipe at post time, but sell for zero.
CREATE OR REPLACE FUNCTION public.add_complimentary_order_item_v023(
 p_order_id uuid,p_menu_item_id uuid,p_quantity numeric,p_unit_price_original numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_menu_item_id IS NULL OR p_quantity<=0 OR p_unit_price_original<0 THEN
   RAISE EXCEPTION 'INVALID_COMPLIMENTARY_ITEM'; END IF;
 v_item:=public.add_order_item(p_order_id=>p_order_id,p_menu_item_id=>p_menu_item_id,
   p_quantity=>p_quantity,p_unit_price_original=>p_unit_price_original,
   p_adjustment_type=>'complimentary',p_adjustment_value=>0);
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE id=v_item
   AND adjustment_type='complimentary' AND line_net_original=0)
 THEN RAISE EXCEPTION 'COMPLIMENTARY_NOT_CONFIRMED'; END IF;
 RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.add_complimentary_order_item_v023(uuid,uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_complimentary_order_item_v023(uuid,uuid,numeric,numeric) TO authenticated;

-- Financial correction workflow: refund cash, restore consumed inventory, void
-- posted history, and create a fresh editable draft. All done in ONE transaction.
-- Never delete a posted order or a historical cashbox/inventory ledger row.
CREATE OR REPLACE FUNCTION public.reopen_posted_order_v023(
 p_order_id uuid,p_reason text DEFAULT 'Correction requested by owner'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_old public.orders%rowtype;v_new uuid;v_payment record;v_mat record;v_item record;
 v_inventory record;v_refund uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'REVERSAL_REASON_REQUIRED'; END IF;
 SELECT * INTO v_old FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
 IF v_old.status<>'posted' THEN RAISE EXCEPTION 'ORDER_NOT_POSTED'; END IF;
 IF v_old.event_id IS NOT NULL THEN RAISE EXCEPTION 'EVENT_ORDER_REVERSAL_REQUIRES_REVIEW'; END IF;
 FOR v_payment IN SELECT * FROM public.order_payments
   WHERE order_id=p_order_id AND status='posted' ORDER BY id FOR UPDATE
 LOOP
   IF v_payment.amount_original>0 THEN
     v_refund:=public.record_cashbox_transaction(v_payment.cashbox_id,'out','refund',
       v_payment.amount_original,v_payment.currency_code,now(),
       'Refund for corrected order','order_refund',v_payment.id);
   END IF;
   UPDATE public.order_payments SET status='voided',voided_at=now(),void_reason=p_reason
   WHERE id=v_payment.id;
 END LOOP;
 FOR v_mat IN
   SELECT oi.id AS line_id, snap.id AS snapshot_id,snap.material_id,
     snap.unit_cost_base_snapshot,snap.inventory_movement_id
   FROM public.order_items oi JOIN public.order_item_materials snap ON snap.order_item_id=oi.id
   WHERE oi.order_id=p_order_id ORDER BY snap.id
 LOOP
   IF v_mat.inventory_movement_id IS NULL THEN RAISE EXCEPTION 'ORDER_INVENTORY_SNAPSHOT_MISSING'; END IF;
   SELECT * INTO v_inventory FROM public.inventory_movements WHERE id=v_mat.inventory_movement_id;
   IF NOT FOUND OR v_inventory.material_id<>v_mat.material_id OR v_inventory.quantity_delta_base>=0 THEN
     RAISE EXCEPTION 'ORDER_INVENTORY_REVERSAL_MISMATCH';
   END IF;
   PERFORM public.record_inventory_movement(v_mat.material_id,'adjustment_in',
    -v_inventory.quantity_delta_base,v_mat.unit_cost_base_snapshot,now(),
    'order_void',p_order_id,v_mat.snapshot_id,'Restoration for corrected order');
 END LOOP;
 UPDATE public.orders SET status='voided',voided_at=now(),void_reason=p_reason WHERE id=p_order_id;
 v_new:=public.create_order(p_cashbox_id=>v_old.cashbox_id,
  p_external_order_number=>v_old.external_order_number,
  p_currency_code=>v_old.currency_code,p_occurred_at=>now(),p_entry_method=>'manual',
  p_notes=>'Corrected draft for order '||p_order_id::text);
 FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY created_at,id
 LOOP
   PERFORM public.add_order_item(p_order_id=>v_new,p_menu_item_id=>v_item.menu_item_id,
    p_raw_item_name=>v_item.raw_item_name,p_quantity=>v_item.quantity,
    p_unit_price_original=>v_item.unit_price_original,
    p_adjustment_type=>v_item.adjustment_type,p_adjustment_value=>v_item.adjustment_value,
    p_adjustment_reason_id=>v_item.adjustment_reason_id,p_notes=>v_item.notes);
 END LOOP;
 UPDATE public.orders SET order_discount_percent_v023=v_old.order_discount_percent_v023,
  expenditure_tax_percent_v023=v_old.expenditure_tax_percent_v023,
  local_administration_tax_percent_v023=v_old.local_administration_tax_percent_v023
 WHERE id=v_new;
 RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.reopen_posted_order_v023(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_posted_order_v023(uuid,text) TO authenticated;



-- BATCH TWO: payroll, paid leave, staff policy, advances, assets and classifications
-- Maria CFO v0.23 - batch two payroll, leave, asset register and catalogs.
-- Prerequisites: original database plus v0.14/v0.17 and v0.23 batch one.
-- This migration DOES NOT rewrite posted payroll/cash ledgers.
-- Staff policy and flat wages
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS paid_leave_days_per_year_v023 integer NOT NULL DEFAULT 12;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.app_settings'::regclass AND conname='app_settings_paid_leave_days_v023_check') THEN
  ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_paid_leave_days_v023_check CHECK (paid_leave_days_per_year_v023 BETWEEN 0 AND 366);
 END IF;
END $$;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS fixed_pay_original_v023 numeric(20,4);
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_pay_type_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_pay_type_check
  CHECK (pay_type IN ('hourly','daily','monthly','fixed'));
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employee_pay_rate_required;
ALTER TABLE public.employees ADD CONSTRAINT employee_pay_rate_required CHECK (
 (pay_type='hourly' AND hourly_rate_original IS NOT NULL)
 OR (pay_type='daily' AND daily_rate_original IS NOT NULL)
 OR (pay_type='monthly' AND monthly_salary_original IS NOT NULL)
 OR (pay_type='fixed' AND fixed_pay_original_v023 IS NOT NULL)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.employees'::regclass AND conname='employees_fixed_pay_v023_positive') THEN
  ALTER TABLE public.employees ADD CONSTRAINT employees_fixed_pay_v023_positive CHECK (fixed_pay_original_v023 IS NULL OR fixed_pay_original_v023>0);
 END IF;
END $$;

-- Fixed workers have no attendance requirement and should never be inserted
-- into the existing hourly/daily/monthly payroll calculator.
DO $guard$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.recalculate_payroll_run(uuid)'::regprocedure) INTO d;
 IF position('IF v_employee.pay_type = ''fixed'' THEN CONTINUE; END IF;' IN d)=0 THEN
  IF position('v_eligible_start :=' IN d)=0 THEN RAISE EXCEPTION 'PAYROLL_CALCULATOR_CHANGED_REVIEW_REQUIRED'; END IF;
  d:=replace(d,'v_eligible_start :=','IF v_employee.pay_type = ''fixed'' THEN CONTINUE; END IF; '||chr(10)||'v_eligible_start :=');
  EXECUTE d;
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.save_staff_policy_v023(
 p_daily_hours numeric,p_overtime_multiplier numeric,p_paid_leave_days integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_hours numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_daily_hours IS NULL OR p_daily_hours<=0 OR p_daily_hours>24
  OR p_overtime_multiplier IS NULL OR p_overtime_multiplier<0 OR p_overtime_multiplier>20
  OR p_paid_leave_days IS NULL OR p_paid_leave_days<0 OR p_paid_leave_days>366
 THEN RAISE EXCEPTION 'INVALID_STAFF_POLICY'; END IF;
 SELECT default_required_daily_hours INTO old_hours FROM public.app_settings WHERE id=1 FOR UPDATE;
 UPDATE public.app_settings SET default_required_daily_hours=p_daily_hours,
  default_overtime_multiplier=p_overtime_multiplier,
  paid_leave_days_per_year_v023=p_paid_leave_days WHERE id=1;
 -- Change only existing employees who inherited the old default; preserve custom schedules.
 UPDATE public.employees SET required_daily_hours=p_daily_hours
  WHERE required_daily_hours=old_hours;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.save_staff_policy_v023(numeric,numeric,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_staff_policy_v023(numeric,numeric,integer) TO authenticated;

-- Exclude fixed-rate employees from automatic daily attendance generation.
-- Their compensation is independent of attendance and has its own payment log.
DO $skip_fixed$
DECLARE def text;
BEGIN
 SELECT pg_get_functiondef('public.initialize_daily_attendance(date)'::regprocedure) INTO def;
 IF position('pay_type <> ''fixed''' IN def)=0 THEN
  IF position('where status = ''active''' IN def)=0 THEN RAISE EXCEPTION 'ATTENDANCE_INITIALIZER_CHANGED_REVIEW_REQUIRED'; END IF;
  def:=replace(def,'where status = ''active''','where status = ''active'' AND pay_type <> ''fixed''');
  EXECUTE def;
 END IF;
END $skip_fixed$;

-- Leave allowance is a calendar-year cap. All paid leaves have zero shortage.
CREATE OR REPLACE FUNCTION public.enforce_paid_leave_allowance_v023()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE allowed integer; taken integer;
BEGIN
 IF NEW.status <> 'paid_leave' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('paid_leave:'||NEW.employee_id::text||':'||extract(year from NEW.work_date)::text));
 SELECT paid_leave_days_per_year_v023 INTO allowed FROM public.app_settings WHERE id=1;
 SELECT count(*) INTO taken FROM public.employee_attendance a
  WHERE a.employee_id=NEW.employee_id AND a.status='paid_leave'
  AND extract(year from a.work_date)=extract(year from NEW.work_date)
  AND a.id IS DISTINCT FROM NEW.id;
 IF taken>=coalesce(allowed,0) THEN RAISE EXCEPTION 'PAID_LEAVE_ANNUAL_ALLOWANCE_EXHAUSTED'; END IF;
 NEW.worked_hours:=0;
 NEW.approved_overtime_hours:=0;
 NEW.applied_shortage_hours:=0;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS maria_paid_leave_allowance_v023 ON public.employee_attendance;
CREATE TRIGGER maria_paid_leave_allowance_v023
BEFORE INSERT OR UPDATE ON public.employee_attendance
FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_leave_allowance_v023();

-- The old index prohibited TWO different staff members from daily payroll on one date.
-- Preserve uniqueness of monthly/non-daily payroll, while the existing unique
-- MARIA_DAILY_V014:<employee>:<date> note + overlap guard prevent duplicate payouts.
DROP INDEX IF EXISTS public.payroll_runs_active_period_unique_idx;
CREATE UNIQUE INDEX payroll_runs_active_period_unique_idx
 ON public.payroll_runs(period_start,period_end)
 WHERE status<>'voided' AND (note IS NULL OR note NOT LIKE 'MARIA_DAILY_V014:%');
CREATE UNIQUE INDEX IF NOT EXISTS maria_daily_payroll_note_v023_unique
 ON public.payroll_runs(note)
 WHERE status<>'voided' AND note LIKE 'MARIA_DAILY_V014:%';

-- Flat salary: a standalone, auditable one-off payment not dependent on attendance.
-- The fixed gross rate is snapshotted. Advance repayments are kept separately.
CREATE TABLE IF NOT EXISTS public.employee_fixed_payments_v023 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
 cashbox_id uuid NOT NULL REFERENCES public.cashboxes(id) ON DELETE RESTRICT,
 cashbox_transaction_id uuid UNIQUE REFERENCES public.cashbox_transactions(id) ON DELETE RESTRICT,
 work_date date NOT NULL,
 currency_code text NOT NULL REFERENCES public.currencies(code),
 gross_original numeric(20,4) NOT NULL CHECK (gross_original>0),
 advance_deducted_original numeric(20,4) NOT NULL DEFAULT 0 CHECK (advance_deducted_original>=0),
 paid_original numeric(20,4) NOT NULL CHECK (paid_original>=0),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fixed_salary_once_per_employee_day UNIQUE(employee_id,work_date),
 CONSTRAINT fixed_salary_due_check CHECK (gross_original=paid_original+advance_deducted_original)
);
ALTER TABLE public.employee_fixed_payments_v023 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_fixed_payments_v023_owner ON public.employee_fixed_payments_v023;
CREATE POLICY employee_fixed_payments_v023_owner ON public.employee_fixed_payments_v023
 FOR SELECT TO authenticated USING (public.is_app_owner());
REVOKE ALL ON public.employee_fixed_payments_v023 FROM anon,authenticated;
GRANT SELECT ON public.employee_fixed_payments_v023 TO authenticated;

CREATE TABLE IF NOT EXISTS public.employee_fixed_advance_deductions_v023 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL REFERENCES public.employee_fixed_payments_v023(id) ON DELETE RESTRICT,
 advance_id uuid NOT NULL REFERENCES public.employee_advances(id) ON DELETE RESTRICT,
 amount_original numeric(20,4) NOT NULL CHECK (amount_original>0),
 UNIQUE(payment_id,advance_id)
);
ALTER TABLE public.employee_fixed_advance_deductions_v023 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_fixed_advance_v023_owner ON public.employee_fixed_advance_deductions_v023;
CREATE POLICY employee_fixed_advance_v023_owner ON public.employee_fixed_advance_deductions_v023
 FOR SELECT TO authenticated USING (public.is_app_owner());
REVOKE ALL ON public.employee_fixed_advance_deductions_v023 FROM anon,authenticated;
GRANT SELECT ON public.employee_fixed_advance_deductions_v023 TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_fixed_employee_v023(
 p_employee_id uuid,p_cashbox_id uuid,p_work_date date,p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.employees%ROWTYPE; a record; gross numeric; take numeric; withheld numeric:=0;
 net numeric; id_out uuid:=gen_random_uuid(); trans uuid; paid_at timestamptz:=now();
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_work_date IS NULL THEN RAISE EXCEPTION 'PAYMENT_DATE_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('maria_fixed:'||p_employee_id::text||':'||p_work_date::text));
 SELECT * INTO e FROM public.employees WHERE id=p_employee_id AND status='active' FOR UPDATE;
 IF NOT FOUND OR e.pay_type<>'fixed' THEN RAISE EXCEPTION 'FIXED_EMPLOYEE_NOT_FOUND'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active) THEN RAISE EXCEPTION 'CASHBOX_NOT_ACTIVE'; END IF;
 IF EXISTS (SELECT 1 FROM public.employee_fixed_payments_v023 WHERE employee_id=p_employee_id AND work_date=p_work_date)
 THEN RAISE EXCEPTION 'FIXED_PAYMENT_ALREADY_RECORDED_FOR_DATE'; END IF;
 gross:=e.fixed_pay_original_v023;
 IF gross IS NULL OR gross<=0 THEN RAISE EXCEPTION 'FIXED_WAGE_NOT_SET'; END IF;
 -- Advance repayment suggested from existing policies. Lock the actual balance.
 INSERT INTO public.employee_fixed_payments_v023 (
  id,employee_id,cashbox_id,work_date,currency_code,gross_original,
  paid_original,advance_deducted_original,occurred_at,note)
 VALUES(id_out,p_employee_id,p_cashbox_id,p_work_date,e.wage_currency_code,gross,gross,0,paid_at,p_note);
 FOR a IN SELECT * FROM public.employee_advances
  WHERE employee_id=p_employee_id AND status='open' AND remaining_original>0
  AND occurred_at::date<=p_work_date ORDER BY occurred_at,id FOR UPDATE
 LOOP
  IF a.repayment_mode='installments' THEN take:=least(a.remaining_original,coalesce(a.installment_amount_original,0));
  ELSIF a.repayment_mode='full_next_payroll' THEN take:=a.remaining_original;
  ELSE take:=0; END IF;
  take:=least(take,greatest(0,gross-withheld));
  IF take>0 THEN
   INSERT INTO public.employee_fixed_advance_deductions_v023(payment_id,advance_id,amount_original) VALUES(id_out,a.id,take);
   UPDATE public.employee_advances SET remaining_original=remaining_original-take,
    status=CASE WHEN remaining_original-take<=0 THEN 'settled' ELSE 'open' END WHERE id=a.id;
   withheld:=withheld+take;
  END IF;
 END LOOP;
 net:=gross-withheld;
 -- A zero-net settlement has no cashbox movement; never insert a zero cash transaction.
 IF net>0 THEN
  trans:=public.record_cashbox_transaction(p_cashbox_id,'out','salary',net,
   e.wage_currency_code,paid_at,'Fixed pay: '||e.name,'employee_fixed_payment',id_out);
 END IF;
 UPDATE public.employee_fixed_payments_v023 SET paid_original=net,
  advance_deducted_original=withheld,cashbox_transaction_id=trans WHERE id=id_out;
 RETURN id_out;
END $$;
REVOKE ALL ON FUNCTION public.pay_fixed_employee_v023(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_fixed_employee_v023(uuid,uuid,date,text) TO authenticated;

-- Paginated, historical salary payouts from both payroll items and flat wages.
CREATE OR REPLACE FUNCTION public.get_salary_payment_page_v023(
 p_start_date date,p_end_date date,p_offset integer DEFAULT 0,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer; v_rows jsonb; v_totals jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date>p_end_date
 OR p_offset<0 OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'INVALID_REPORT_RANGE'; END IF;
 WITH combined AS (
 SELECT pp.id,pp.employee_id,pp.cashbox_id,pp.occurred_at,pp.currency_code,
  pp.amount_original,pp.status,'regular'::text AS kind,
  0::numeric AS advance_deducted_original
 FROM public.payroll_payments pp
 WHERE pp.occurred_at::date BETWEEN p_start_date AND p_end_date
 UNION ALL
 SELECT fp.id,fp.employee_id,fp.cashbox_id,fp.occurred_at,fp.currency_code,
  fp.paid_original AS amount_original,'posted'::text AS status,'fixed'::text AS kind,
  fp.advance_deducted_original
 FROM public.employee_fixed_payments_v023 fp
 WHERE fp.occurred_at::date BETWEEN p_start_date AND p_end_date
 )
 SELECT count(*) INTO v_count FROM combined;
 WITH combined AS (
 SELECT pp.id,pp.employee_id,pp.cashbox_id,pp.occurred_at,pp.currency_code,
  pp.amount_original,pp.status,'regular'::text AS kind,0::numeric AS advance_deducted_original
 FROM public.payroll_payments pp WHERE pp.occurred_at::date BETWEEN p_start_date AND p_end_date
 UNION ALL
 SELECT fp.id,fp.employee_id,fp.cashbox_id,fp.occurred_at,fp.currency_code,
  fp.paid_original,'posted'::text,'fixed'::text,fp.advance_deducted_original
 FROM public.employee_fixed_payments_v023 fp WHERE fp.occurred_at::date BETWEEN p_start_date AND p_end_date
 )
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.occurred_at DESC,s.id DESC),'[]'::jsonb)
 INTO v_rows FROM (
  SELECT * FROM combined ORDER BY occurred_at DESC,id DESC LIMIT p_limit OFFSET p_offset
 ) s;
 WITH all_payments AS (
 SELECT pp.currency_code,pp.amount_original,pp.status FROM public.payroll_payments pp
 WHERE pp.occurred_at::date BETWEEN p_start_date AND p_end_date
 UNION ALL
 SELECT fp.currency_code,fp.paid_original AS amount_original,'posted'::text FROM public.employee_fixed_payments_v023 fp
 WHERE fp.occurred_at::date BETWEEN p_start_date AND p_end_date
 ), summarized AS (
 SELECT currency_code,sum(amount_original) AS amount FROM all_payments WHERE status='posted' GROUP BY currency_code
 ) SELECT coalesce(jsonb_object_agg(currency_code,amount),'{}'::jsonb) INTO v_totals FROM summarized;
 RETURN jsonb_build_object('total',v_count,'rows',v_rows,'totals_by_currency',v_totals);
END $$;
REVOKE ALL ON FUNCTION public.get_salary_payment_page_v023(date,date,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_salary_payment_page_v023(date,date,integer,integer) TO authenticated;

-- Categories: reuse existing menu_categories, avoid a parallel menu classification.
CREATE TABLE IF NOT EXISTS public.material_categories_v023 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_categories_v023_name_uq ON public.material_categories_v023(lower(btrim(name)));
CREATE TABLE IF NOT EXISTS public.asset_categories_v023 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_v023_name_uq ON public.asset_categories_v023(lower(btrim(name)));
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS category_id_v023 uuid REFERENCES public.material_categories_v023(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS materials_category_id_v023_idx ON public.materials(category_id_v023);

CREATE TABLE IF NOT EXISTS public.restaurant_assets_v023 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name))>0),
 category_id uuid REFERENCES public.asset_categories_v023(id) ON DELETE SET NULL,
 quantity integer NOT NULL DEFAULT 0 CHECK (quantity>=0),
 minimum_quantity integer NOT NULL DEFAULT 0 CHECK (minimum_quantity>=0),
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_assets_v023_name_uq ON public.restaurant_assets_v023(lower(btrim(name)));
CREATE INDEX IF NOT EXISTS restaurant_assets_v023_category_idx ON public.restaurant_assets_v023(category_id);

-- Owner-only policies. Direct writes allowed only for master data, never ledgers.
ALTER TABLE public.material_categories_v023 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_categories_v023 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_assets_v023 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maria_material_categories_owner_v023 ON public.material_categories_v023;
CREATE POLICY maria_material_categories_owner_v023 ON public.material_categories_v023 FOR ALL TO authenticated
 USING (public.is_app_owner()) WITH CHECK (public.is_app_owner());
DROP POLICY IF EXISTS maria_asset_categories_owner_v023 ON public.asset_categories_v023;
CREATE POLICY maria_asset_categories_owner_v023 ON public.asset_categories_v023 FOR ALL TO authenticated
 USING (public.is_app_owner()) WITH CHECK (public.is_app_owner());
DROP POLICY IF EXISTS maria_restaurant_assets_owner_v023 ON public.restaurant_assets_v023;
CREATE POLICY maria_restaurant_assets_owner_v023 ON public.restaurant_assets_v023 FOR ALL TO authenticated
 USING (public.is_app_owner()) WITH CHECK (public.is_app_owner());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.material_categories_v023 TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.asset_categories_v023 TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.restaurant_assets_v023 TO authenticated;
-- Existing menu_categories already uses the application's owner policies.

-- Combined payroll/advance/attendance statistics for the reporting tab.
CREATE OR REPLACE FUNCTION public.get_payroll_statistics_v023(
 p_start_date date,p_end_date date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;v_standard numeric;v_fixed numeric;v_advance numeric;
 v_deduction numeric;v_open numeric;v_paid_leave integer;v_absent integer;
 v_employees integer;v_paid_count integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date THEN RAISE EXCEPTION 'INVALID_REPORT_RANGE'; END IF;
 SELECT coalesce(sum(amount_base),0),count(*) INTO v_standard,v_paid_count
  FROM public.payroll_payments WHERE status='posted' AND occurred_at::date BETWEEN p_start_date AND p_end_date;
 SELECT coalesce(sum(f.paid_original*public.get_exchange_rate(f.currency_code,f.occurred_at)),0)
 INTO v_fixed FROM public.employee_fixed_payments_v023 f WHERE f.occurred_at::date BETWEEN p_start_date AND p_end_date;
 SELECT coalesce(sum(a.principal_base),0) INTO v_advance FROM public.employee_advances a
  WHERE a.status<>'voided' AND a.occurred_at::date BETWEEN p_start_date AND p_end_date;
 SELECT coalesce(sum(d.amount_original*pi.exchange_rate_to_base),0) INTO v_deduction
  FROM public.payroll_advance_deductions d JOIN public.payroll_items pi ON pi.id=d.payroll_item_id
  JOIN public.payroll_runs pr ON pr.id=pi.payroll_run_id
  WHERE d.status='applied' AND pr.approved_at::date BETWEEN p_start_date AND p_end_date;
 SELECT v_deduction+coalesce(sum(d.amount_original*public.get_exchange_rate(f.currency_code,f.occurred_at)),0)
 INTO v_deduction FROM public.employee_fixed_advance_deductions_v023 d
 JOIN public.employee_fixed_payments_v023 f ON f.id=d.payment_id
 WHERE f.occurred_at::date BETWEEN p_start_date AND p_end_date;
 SELECT coalesce(sum(a.remaining_original*a.exchange_rate_to_base),0) INTO v_open
  FROM public.employee_advances a WHERE a.status='open';
 SELECT count(*) FILTER(WHERE status='paid_leave'),count(*) FILTER(WHERE status='absent')
 INTO v_paid_leave,v_absent FROM public.employee_attendance WHERE work_date BETWEEN p_start_date AND p_end_date;
 SELECT count(*) INTO v_employees FROM public.employees WHERE status='active';
 RETURN jsonb_build_object(
  'regular_cash_paid_base',v_standard,'fixed_cash_paid_base',v_fixed,
  'total_salary_cash_paid_base',v_standard+v_fixed,
  'advances_disbursed_base',v_advance,'advances_applied_base',v_deduction,
  'advances_open_base',v_open,'paid_leave_days',v_paid_leave,'absent_days',v_absent,
  'active_employees',v_employees,'regular_payment_count',v_paid_count,
  'period_start',p_start_date,'period_end',p_end_date
 );
END $$;
REVOKE ALL ON FUNCTION public.get_payroll_statistics_v023(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payroll_statistics_v023(date,date) TO authenticated;



-- FINANCIAL REPORTS: created AFTER fixed-payment tables to preserve dependency order.
-- Exclude collected taxes from accounting revenue and profit while keeping them
-- in cashflow and the order's amount collected. Original report remains unchanged.
CREATE OR REPLACE FUNCTION public.get_financial_statistics_v023(
 p_start_date date,p_end_date date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_data jsonb;v_tax numeric;v_fixed numeric:=0;v_key text;v_path text[];v_old text;v_count numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_data:=public.get_financial_statistics(p_start_date,p_end_date);
 SELECT coalesce(sum((coalesce(o.expenditure_tax_amount_original_v023,0)+
   coalesce(o.local_administration_tax_amount_original_v023,0))*o.exchange_rate_to_base),0)
 INTO v_tax FROM public.orders o WHERE o.status='posted'
   AND o.business_date BETWEEN p_start_date AND p_end_date;
 FOREACH v_key IN ARRAY ARRAY[
  'total_revenue_base','order_sales_base','provisional_gross_profit_base',
  'gross_profit_base','net_result_base','provisional_net_result_base']
 LOOP
   v_path:=ARRAY['kpis',v_key];v_old:=v_data#>>v_path;
   IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
     v_data:=jsonb_set(v_data,v_path,to_jsonb((v_old::numeric-v_tax)),true);
   END IF;
 END LOOP;
 v_old:=v_data#>>'{sales,sales_base}';
 IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
   v_data:=jsonb_set(v_data,'{sales,sales_base}',to_jsonb(v_old::numeric-v_tax),true);
 END IF;
 v_count:=coalesce(nullif(v_data#>>'{kpis,order_count}','')::numeric,0);
 IF v_count>0 THEN
   v_old:=v_data#>>'{kpis,average_ticket_base}';
   IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
     v_data:=jsonb_set(v_data,'{kpis,average_ticket_base}',to_jsonb(round(v_old::numeric-v_tax/v_count,4)),true);
   END IF;
   v_old:=v_data#>>'{sales,average_ticket_base}';
   IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
     v_data:=jsonb_set(v_data,'{sales,average_ticket_base}',to_jsonb(round(v_old::numeric-v_tax/v_count,4)),true);
   END IF;
 END IF;
 -- A fixed salary is approved and snapshotted at payment, including any
 -- advance repayment. It is an expense on this date, not extra net cash outflow.
 SELECT coalesce(sum(fp.gross_original*public.get_exchange_rate(fp.currency_code,fp.occurred_at)),0)
 INTO v_fixed FROM public.employee_fixed_payments_v023 fp
 WHERE fp.occurred_at::date BETWEEN p_start_date AND p_end_date;
 FOREACH v_key IN ARRAY ARRAY['payroll_expense_base','net_result_base','provisional_net_result_base']
 LOOP
   v_path:=ARRAY['kpis',v_key];v_old:=v_data#>>v_path;
   IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
     IF v_key='payroll_expense_base' THEN
       v_data:=jsonb_set(v_data,v_path,to_jsonb(v_old::numeric+v_fixed),true);
     ELSE
       v_data:=jsonb_set(v_data,v_path,to_jsonb(v_old::numeric-v_fixed),true);
     END IF;
   END IF;
 END LOOP;
 v_old:=v_data#>>'{payroll,allocated_payroll_expense_base}';
 IF v_old IS NOT NULL AND v_old ~ '^[-]?[0-9]+(\.[0-9]+)?$' THEN
   v_data:=jsonb_set(v_data,'{payroll,allocated_payroll_expense_base}',to_jsonb(v_old::numeric+v_fixed),true);
 END IF;
 v_data:=jsonb_set(v_data,'{payroll,fixed_payroll_gross_base}',to_jsonb(v_fixed),true);
 RETURN v_data||jsonb_build_object('taxes',jsonb_build_object('collected_base',round(v_tax,4)));
END $$;
REVOKE ALL ON FUNCTION public.get_financial_statistics_v023(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_financial_statistics_v023(date,date) TO authenticated;

-- Efficient latest real purchase cost per material, ignoring voided invoices.
-- Read-only calculation; never rewrites the material snapshot or inventory ledger.
CREATE OR REPLACE FUNCTION public.get_latest_material_purchase_prices_v023()
RETURNS TABLE(material_id uuid,price_per_base numeric,occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (im.material_id) im.material_id,
         im.unit_cost_base_per_base_unit, im.occurred_at
  FROM public.inventory_movements im
  LEFT JOIN public.purchase_invoices pi
    ON pi.id=im.source_id AND im.source_type='purchase_invoice'
  WHERE public.is_app_owner()
    AND im.movement_type='purchase'
    AND im.quantity_delta_base>0
    AND im.unit_cost_base_per_base_unit IS NOT NULL
    AND (pi.id IS NULL OR coalesce(pi.is_voided,false)=false)
  ORDER BY im.material_id,im.occurred_at DESC, im.created_at DESC, im.id DESC;
$$;
REVOKE ALL ON FUNCTION public.get_latest_material_purchase_prices_v023() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_material_purchase_prices_v023() TO authenticated;



COMMIT;
