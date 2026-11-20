-- Maria CFO Web v1.0.25 - Event internal orders, external markup and hospitality costs.
-- Apply after v1.0.24 on a staging copy, then production after a restorable backup.
-- Does not rewrite historical monetary values, bookings, inventory or cash entries.
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $preflight$
BEGIN
  IF to_regclass('public.event_extras_v034') IS NULL
     OR to_regclass('public.event_external_dishes_v038') IS NULL
     OR to_regclass('public.event_on_demand_v040') IS NULL
     OR to_regclass('public.event_financial_summary_historical') IS NULL
     OR to_regprocedure('public.cashbox_live_balance_base_v124(uuid,date)') IS NULL
  THEN RAISE EXCEPTION 'V125_REQUIRES_PREVIOUS_MIGRATIONS_THROUGH_V124'; END IF;
END;
$preflight$;

-- Defaults preserve the old meaning: existing purchases are hospitality;
-- existing extras remain explicitly "legacy", not guessed to be restaurant orders.
ALTER TABLE public.event_external_dishes_v038
  ADD COLUMN IF NOT EXISTS billing_mode_v125 text NOT NULL DEFAULT 'hospitality',
  ADD COLUMN IF NOT EXISTS unit_profit_base_v125 numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS request_key_v125 uuid,
  ADD COLUMN IF NOT EXISTS request_payload_v125 jsonb;
ALTER TABLE public.event_extras_v034
  ADD COLUMN IF NOT EXISTS source_v125 text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS external_dish_id_v125 uuid,
  ADD COLUMN IF NOT EXISTS request_key_v125 uuid,
  ADD COLUMN IF NOT EXISTS request_payload_v125 jsonb;

ALTER TABLE public.event_extras_v034 DROP CONSTRAINT IF EXISTS event_extras_v034_status_check;
ALTER TABLE public.event_extras_v034 ADD CONSTRAINT event_extras_v034_status_check
  CHECK (status IN ('pending','paid','refunded','voided','complimentary'));

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.event_external_dishes_v038'::regclass AND conname='event_external_billing_v125') THEN
    ALTER TABLE public.event_external_dishes_v038 ADD CONSTRAINT event_external_billing_v125
      CHECK (billing_mode_v125 IN ('hospitality','sale') AND
        unit_profit_base_v125 BETWEEN 0 AND 999999999999 AND
        (billing_mode_v125='sale' OR unit_profit_base_v125=0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.event_extras_v034'::regclass AND conname='event_extra_source_v125') THEN
    ALTER TABLE public.event_extras_v034 ADD CONSTRAINT event_extra_source_v125
      CHECK (source_v125 IN ('legacy','internal','external') AND
        ((source_v125='external')=(external_dish_id_v125 IS NOT NULL)) AND
        (status<>'complimentary' OR (unit_price_original=0 AND external_dish_id_v125 IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.event_extras_v034'::regclass AND conname='event_extra_external_fk_v125') THEN
    ALTER TABLE public.event_extras_v034 ADD CONSTRAINT event_extra_external_fk_v125
      FOREIGN KEY (external_dish_id_v125) REFERENCES public.event_external_dishes_v038(id) ON DELETE RESTRICT;
  END IF;
END;
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS event_extra_request_v125
  ON public.event_extras_v034(event_id,request_key_v125) WHERE request_key_v125 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_external_request_v125
  ON public.event_external_dishes_v038(event_id,request_key_v125) WHERE request_key_v125 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_external_invoice_v125
  ON public.event_extras_v034(external_dish_id_v125) WHERE external_dish_id_v125 IS NOT NULL;

-- Private helper: every writer locks EVENT before ORDER/PURCHASE, matching event closing.
CREATE OR REPLACE FUNCTION public.event_order_bucket_v125(p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_id uuid; v_event public.events%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status NOT IN ('planning','open','confirmed') THEN
    RAISE EXCEPTION 'EVENT_NOT_EDITABLE';
  END IF;
  SELECT id INTO v_id FROM public.event_tables WHERE event_id=p_event_id AND status<>'cancelled'
    ORDER BY CASE WHEN table_label='__SEAT_SERVICE_V113__' THEN 0 ELSE 1 END,created_at,id LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.event_tables(event_id,table_label,capacity,planned_guest_count,status)
    VALUES(p_event_id,'__SEAT_SERVICE_V113__',greatest(1,coalesce(v_event.planned_guest_count,1)),
      greatest(0,coalesce(v_event.planned_guest_count,0)),'available') RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_order_bucket_v125(uuid) FROM PUBLIC,anon,authenticated;

-- New restaurant orders. The stored recipe cost is a snapshot, not a mutable live price.
-- A zero MANUAL cost must be entered explicitly; missing cost is never silently zero.
CREATE OR REPLACE FUNCTION public.event_add_internal_order_v125(
  p_event_id uuid, p_description text, p_quantity numeric, p_unit_price numeric,
  p_menu_item_id uuid, p_unit_cost_base numeric, p_billing_mode text,
  p_request_key uuid, p_note text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_event public.events%ROWTYPE; v_id uuid; v_bucket uuid; v_cost numeric;
  v_missing boolean; v_payload jsonb; v_existing_payload jsonb; v_price numeric;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'V125_REQUEST_KEY_REQUIRED'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  v_payload:=jsonb_build_object('description',btrim(p_description),'quantity',p_quantity,
    'price',p_unit_price,'menu',p_menu_item_id,'cost',p_unit_cost_base,
    'mode',p_billing_mode,'note',coalesce(p_note,''));
  SELECT id,request_payload_v125 INTO v_id,v_existing_payload
    FROM public.event_extras_v034 WHERE event_id=p_event_id AND request_key_v125=p_request_key;
  IF FOUND THEN
    IF v_existing_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'V125_REQUEST_REUSED_WITH_DIFFERENT_DATA'; END IF;
    RETURN v_id;
  END IF;
  IF v_event.status NOT IN ('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  IF p_billing_mode IS NULL OR p_billing_mode NOT IN ('sale','hospitality')
    OR length(btrim(coalesce(p_description,''))) NOT BETWEEN 2 AND 180
    OR p_quantity IS NULL OR NOT (p_quantity BETWEEN 0.001 AND 100000)
    OR p_quantity<>round(p_quantity,3)
    OR p_unit_price IS NULL OR NOT (p_unit_price BETWEEN 0 AND 999999999999)
    OR p_unit_price<>round(p_unit_price,4)
    OR (p_billing_mode='sale' AND p_unit_price<=0)
    OR (p_billing_mode='hospitality' AND p_unit_price<>0)
  THEN RAISE EXCEPTION 'V125_INTERNAL_ORDER_INVALID'; END IF;
  IF p_menu_item_id IS NOT NULL THEN
    SELECT recipe_cost_base,has_missing_cost INTO v_cost,v_missing
      FROM public.menu_item_costs WHERE id=p_menu_item_id AND is_active;
    IF NOT FOUND OR coalesce(v_missing,true) OR v_cost IS NULL
       OR NOT (v_cost BETWEEN 0 AND 999999999999)
    THEN RAISE EXCEPTION 'EVENT_EXTRA_FOOD_COST_INCOMPLETE'; END IF;
  ELSE
    IF p_unit_cost_base IS NULL OR NOT (p_unit_cost_base BETWEEN 0 AND 999999999999)
       OR p_unit_cost_base<>round(p_unit_cost_base,4)
    THEN RAISE EXCEPTION 'EVENT_EXTRA_COST_REQUIRED'; END IF;
    v_cost:=p_unit_cost_base;
  END IF;
  IF v_event.price_exchange_rate_to_base IS NULL OR NOT (v_event.price_exchange_rate_to_base BETWEEN 0.00000001 AND 999999999999.99999999) THEN
    RAISE EXCEPTION 'V125_EXCHANGE_RATE_REQUIRED';
  END IF;
  v_bucket:=public.event_order_bucket_v125(p_event_id);
  v_price:=CASE WHEN p_billing_mode='hospitality' THEN 0 ELSE p_unit_price END;
  INSERT INTO public.event_extras_v034(event_id,table_id,description,quantity,unit_price_original,
    menu_item_id,unit_cost_base,currency_code,exchange_rate_to_base,status,notes,source_v125,
    request_key_v125,request_payload_v125)
  VALUES(p_event_id,v_bucket,btrim(p_description),p_quantity,v_price,p_menu_item_id,round(v_cost,4),
    v_event.price_currency_code,v_event.price_exchange_rate_to_base,
    CASE WHEN p_billing_mode='hospitality' THEN 'complimentary' ELSE 'pending' END,
    left(p_note,500),'internal',p_request_key,v_payload) RETURNING id INTO v_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
  VALUES(p_event_id,'extra',CASE WHEN p_billing_mode='hospitality' THEN 'ضيافة مجانية إضافية: ' ELSE 'طلب داخلي من المطعم: ' END
    ||btrim(p_description)||' · الكمية '||p_quantity);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_add_internal_order_v125(uuid,text,numeric,numeric,uuid,numeric,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_add_internal_order_v125(uuid,text,numeric,numeric,uuid,numeric,text,uuid,text) TO authenticated;

-- Sell an entire external purchase once. Its cost remains on the PURCHASE.
-- The linked invoice stores the same cost for row-level profit display only;
-- the financial summary explicitly excludes that linked cost from extra costs.
CREATE OR REPLACE FUNCTION public.event_price_external_dish_v125(p_id uuid,p_unit_profit_base numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE; v_event public.events%ROWTYPE;
  v_event_id uuid; v_id uuid; v_status text; v_sale_base numeric; v_sale_original numeric; v_bucket uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT event_id INTO v_event_id FROM public.event_external_dishes_v038 WHERE id=p_id;
  SELECT * INTO v_event FROM public.events WHERE id=v_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.status NOT IN ('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_dish.is_active THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
  IF p_unit_profit_base IS NULL OR NOT (p_unit_profit_base BETWEEN 0 AND 999999999999)
    OR p_unit_profit_base<>round(p_unit_profit_base,4) THEN RAISE EXCEPTION 'V125_MARKUP_INVALID'; END IF;
  SELECT id,status INTO v_id,v_status FROM public.event_extras_v034 WHERE external_dish_id_v125=p_id;
  IF FOUND THEN
    IF v_dish.unit_profit_base_v125=p_unit_profit_base AND v_status IN ('pending','paid') THEN RETURN v_id; END IF;
    RAISE EXCEPTION 'V125_EXTERNAL_ALREADY_INVOICED';
  END IF;
  IF EXISTS(SELECT 1 FROM public.event_external_servings_v038 WHERE dish_id=p_id)
     OR EXISTS(SELECT 1 FROM public.event_on_demand_v040 WHERE external_dish_id=p_id) THEN
    RAISE EXCEPTION 'V125_EXTERNAL_IN_HOSPITALITY';
  END IF;
  IF v_event.price_exchange_rate_to_base IS NULL OR NOT (v_event.price_exchange_rate_to_base BETWEEN 0.00000001 AND 999999999999.99999999) THEN
    RAISE EXCEPTION 'V125_EXCHANGE_RATE_REQUIRED';
  END IF;
  v_sale_base:=round(v_dish.purchased_quantity*(v_dish.unit_cost_base+p_unit_profit_base),4);
  -- Keep 4 stored decimal places; never round the intended markup down during FX conversion.
  v_sale_original:=ceil(v_sale_base/v_event.price_exchange_rate_to_base*10000)/10000;
  IF v_sale_original<=0 OR v_sale_original>9999999999999999 THEN RAISE EXCEPTION 'V125_SALE_PRICE_REQUIRED'; END IF;
  v_bucket:=public.event_order_bucket_v125(v_event_id);
  UPDATE public.event_external_dishes_v038 SET billing_mode_v125='sale',unit_profit_base_v125=p_unit_profit_base WHERE id=p_id;
  INSERT INTO public.event_extras_v034(event_id,table_id,description,quantity,unit_price_original,
    unit_cost_base,currency_code,exchange_rate_to_base,status,notes,source_v125,external_dish_id_v125)
  VALUES(v_event_id,v_bucket,left('طلب خارجي: '||v_dish.name,180),1,v_sale_original,
    v_dish.total_cost_base,v_event.price_currency_code,v_event.price_exchange_rate_to_base,'pending',
    left('فاتورة لكامل الشراء: '||v_dish.purchased_quantity||' '||v_dish.unit_label
      ||'؛ تكلفة الشراء محتسبة مرة واحدة من سجل المشتريات.',500),'external',p_id)
  RETURNING id INTO v_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
  VALUES(v_event_id,'extra','تسعير شراء خارجي للبيع: '||v_dish.name||' · ربح الوحدة بالأساس '||p_unit_profit_base);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_price_external_dish_v125(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_price_external_dish_v125(uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.event_add_external_dish_v125(
  p_event_id uuid,p_name text,p_unit_label text,p_quantity numeric,p_unit_cost_base numeric,
  p_billing_mode text,p_unit_profit_base numeric,p_request_key uuid,p_vendor text DEFAULT NULL,p_notes text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_id uuid; v_payload jsonb; v_existing_payload jsonb; v_status text;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'V125_REQUEST_KEY_REQUIRED'; END IF;
  SELECT status INTO v_status FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
  v_payload:=jsonb_build_object('name',btrim(p_name),'unit',btrim(p_unit_label),'quantity',p_quantity,
    'cost',p_unit_cost_base,'mode',p_billing_mode,'markup',p_unit_profit_base,
    'vendor',coalesce(p_vendor,''),'notes',coalesce(p_notes,''));
  SELECT id,request_payload_v125 INTO v_id,v_existing_payload FROM public.event_external_dishes_v038
    WHERE event_id=p_event_id AND request_key_v125=p_request_key;
  IF FOUND THEN
    IF v_existing_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'V125_REQUEST_REUSED_WITH_DIFFERENT_DATA'; END IF;
    RETURN v_id;
  END IF;
  IF v_status NOT IN ('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  IF p_billing_mode IS NULL OR p_billing_mode NOT IN ('hospitality','sale')
    OR p_unit_profit_base IS NULL OR NOT (p_unit_profit_base BETWEEN 0 AND 999999999999)
    OR p_unit_profit_base<>round(p_unit_profit_base,4)
    OR (p_billing_mode='hospitality' AND p_unit_profit_base<>0)
    OR p_quantity IS NULL OR NOT (p_quantity BETWEEN 0.0001 AND 1000000)
    OR p_unit_cost_base IS NULL OR NOT (p_unit_cost_base BETWEEN 0 AND 999999999999)
  THEN RAISE EXCEPTION 'V125_EXTERNAL_ORDER_INVALID'; END IF;
  v_id:=public.event_add_external_dish_v038(p_event_id,p_name,p_unit_label,p_quantity,p_unit_cost_base,p_vendor,p_notes);
  UPDATE public.event_external_dishes_v038 SET request_key_v125=p_request_key,request_payload_v125=v_payload WHERE id=v_id;
  IF p_billing_mode='sale' THEN PERFORM public.event_price_external_dish_v125(v_id,p_unit_profit_base); END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_add_external_dish_v125(uuid,text,text,numeric,numeric,text,numeric,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_add_external_dish_v125(uuid,text,text,numeric,numeric,text,numeric,uuid,text,text) TO authenticated;

-- A purchase allocated for resale must never also be allocated to free hospitality.
-- Enforced at the table boundary, including calls from older clients.
CREATE OR REPLACE FUNCTION public.event_external_hospitality_guard_v125()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_dish_id uuid; v_dish public.event_external_dishes_v038%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='event_on_demand_v040' THEN v_dish_id:=NEW.external_dish_id;
  ELSE v_dish_id:=NEW.dish_id; END IF;
  IF v_dish_id IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.events WHERE id=NEW.event_id FOR UPDATE;
  SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=v_dish_id FOR UPDATE;
  IF NOT FOUND OR NOT v_dish.is_active OR v_dish.event_id<>NEW.event_id THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
  IF v_dish.billing_mode_v125<>'hospitality' THEN RAISE EXCEPTION 'V125_SALE_NOT_HOSPITALITY'; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_external_hospitality_guard_v125() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS event_external_hospitality_guard_v125 ON public.event_external_servings_v038;
CREATE TRIGGER event_external_hospitality_guard_v125 BEFORE INSERT OR UPDATE ON public.event_external_servings_v038
  FOR EACH ROW EXECUTE FUNCTION public.event_external_hospitality_guard_v125();
DROP TRIGGER IF EXISTS event_demand_hospitality_guard_v125 ON public.event_on_demand_v040;
CREATE TRIGGER event_demand_hospitality_guard_v125 BEFORE INSERT OR UPDATE ON public.event_on_demand_v040
  FOR EACH ROW EXECUTE FUNCTION public.event_external_hospitality_guard_v125();

-- Validate the link and prevent historical invoices being silently retargeted/repriced.
CREATE OR REPLACE FUNCTION public.event_extra_link_guard_v125()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.event_id,NEW.source_v125,NEW.external_dish_id_v125,NEW.quantity,
    NEW.unit_cost_base,NEW.unit_price_original,NEW.currency_code,NEW.exchange_rate_to_base,
    NEW.request_key_v125,NEW.request_payload_v125)
    IS DISTINCT FROM (OLD.event_id,OLD.source_v125,OLD.external_dish_id_v125,OLD.quantity,
    OLD.unit_cost_base,OLD.unit_price_original,OLD.currency_code,OLD.exchange_rate_to_base,
    OLD.request_key_v125,OLD.request_payload_v125)
  THEN RAISE EXCEPTION 'V125_ORDER_FINANCIAL_FIELDS_IMMUTABLE'; END IF;
  IF NEW.external_dish_id_v125 IS NOT NULL THEN
    SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=NEW.external_dish_id_v125;
    IF NOT FOUND OR v_dish.event_id<>NEW.event_id OR v_dish.billing_mode_v125<>'sale'
      OR NEW.quantity<>1 OR NEW.unit_cost_base<>v_dish.total_cost_base OR NEW.menu_item_id IS NOT NULL
      OR (NOT v_dish.is_active AND NEW.status<>'voided')
    THEN RAISE EXCEPTION 'V125_EXTERNAL_LINK_INVALID'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_extra_link_guard_v125() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS event_extra_link_guard_v125 ON public.event_extras_v034;
CREATE TRIGGER event_extra_link_guard_v125 BEFORE INSERT OR UPDATE ON public.event_extras_v034
  FOR EACH ROW EXECUTE FUNCTION public.event_extra_link_guard_v125();

CREATE OR REPLACE FUNCTION public.event_lock_extra_v125(p_extra_id uuid)
RETURNS public.event_extras_v034 LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_event_id uuid; v_status text; v_extra public.event_extras_v034%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT event_id INTO v_event_id FROM public.event_extras_v034 WHERE id=p_extra_id;
  SELECT status INTO v_status FROM public.events WHERE id=v_event_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('planning','open','confirmed') THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  SELECT * INTO v_extra FROM public.event_extras_v034 WHERE id=p_extra_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V125_ORDER_NOT_FOUND'; END IF;
  RETURN v_extra;
END;
$fn$;
REVOKE ALL ON FUNCTION public.event_lock_extra_v125(uuid) FROM PUBLIC,anon,authenticated;

-- Keep public function names used by historical pages, but protect closed events
-- and use the same lock ordering as creation and closing.
CREATE OR REPLACE FUNCTION public.pay_event_extra_v034(p_extra_id uuid,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_extra public.event_extras_v034%ROWTYPE;v_tx uuid;v_amount_base numeric;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  v_extra:=public.event_lock_extra_v125(p_extra_id);
  IF v_extra.status<>'pending' THEN RAISE EXCEPTION 'EVENT_EXTRA_ALREADY_SETTLED'; END IF;
  IF v_extra.amount_original<=0 THEN RAISE EXCEPTION 'V125_SALE_PRICE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active)
    THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
  PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
  v_tx:=public.record_cashbox_transaction(p_cashbox_id,'in','event',v_extra.amount_original,
    v_extra.currency_code,now(),'تحصيل طلب حفلة: '||v_extra.description,'event_extra_v034',v_extra.id);
  SELECT amount_base INTO v_amount_base FROM public.cashbox_transactions WHERE id=v_tx;
  UPDATE public.event_extras_v034 SET status='paid',cashbox_transaction_id=v_tx,
    paid_amount_base=v_amount_base,paid_at=now() WHERE id=v_extra.id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
    VALUES(v_extra.event_id,'payment','تحصيل طلب: '||v_extra.description||' · '||v_extra.amount_original||' '||v_extra.currency_code);
  RETURN v_tx;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.void_event_extra_v034(p_extra_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_extra public.event_extras_v034%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  v_extra:=public.event_lock_extra_v125(p_extra_id);
  IF v_extra.status NOT IN ('pending','complimentary') THEN RAISE EXCEPTION 'EVENT_EXTRA_ALREADY_SETTLED'; END IF;
  UPDATE public.event_extras_v034 SET status='voided',void_reason=left(btrim(p_reason),500),voided_at=now() WHERE id=p_extra_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
    VALUES(v_extra.event_id,'extra','إلغاء قيد طلب: '||v_extra.description||' · '||left(p_reason,300));
  -- A linked external purchase is NOT deleted: its incurred cost survives cancellation of customer billing.
END;
$fn$;
CREATE OR REPLACE FUNCTION public.refund_event_extra_v034(p_extra_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_extra public.event_extras_v034%ROWTYPE;v_box uuid;v_tx uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  v_extra:=public.event_lock_extra_v125(p_extra_id);
  IF v_extra.status<>'paid' THEN RAISE EXCEPTION 'EVENT_EXTRA_NOT_PAID'; END IF;
  SELECT cashbox_id INTO v_box FROM public.cashbox_transactions WHERE id=v_extra.cashbox_transaction_id AND NOT is_void;
  IF v_box IS NULL OR NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=v_box AND is_active) THEN
    RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
  PERFORM public.ensure_cashbox_session_v013(v_box,now());
  v_tx:=public.record_cashbox_transaction(v_box,'out','refund',v_extra.amount_original,v_extra.currency_code,now(),
    'استرداد طلب حفلة: '||left(btrim(p_reason),300),'event_extra_refund_v034',v_extra.id);
  UPDATE public.event_extras_v034 SET status='refunded',refund_transaction_id=v_tx,
    void_reason=left(btrim(p_reason),500),voided_at=now() WHERE id=p_extra_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
    VALUES(v_extra.event_id,'payment','استرداد طلب مع إبقاء تكلفته: '||v_extra.description||' · '||left(p_reason,250));
  RETURN v_tx;
END;
$fn$;

-- Supplier payment is a settlement, never a second cost.
CREATE OR REPLACE FUNCTION public.event_pay_external_dish_v038(p_id uuid,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE;v_event_id uuid;v_cc text;v_tx uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT event_id INTO v_event_id FROM public.event_external_dishes_v038 WHERE id=p_id;
  PERFORM 1 FROM public.events WHERE id=v_event_id AND status IN ('planning','open','confirmed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_dish.is_active THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
  IF v_dish.paid_at IS NOT NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ALREADY_PAID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active) THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
  SELECT base_currency_code INTO v_cc FROM public.app_settings WHERE id=1;
  IF v_cc IS NULL THEN RAISE EXCEPTION 'EVENT_BASE_CURRENCY_MISSING'; END IF;
  IF v_dish.total_cost_base<=0 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ZERO_COST'; END IF;
  PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
  v_tx:=public.record_cashbox_transaction(p_cashbox_id,'out','event',v_dish.total_cost_base,v_cc,now(),
    'دفع شراء خارجي للحفلة: '||v_dish.name,'event_external_v038',v_dish.id);
  UPDATE public.event_external_dishes_v038 SET cashbox_transaction_id=v_tx,paid_at=now() WHERE id=p_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
    VALUES(v_event_id,'payment','دفع المورد: '||v_dish.name||' · '||v_dish.total_cost_base||' '||v_cc);
  RETURN v_tx;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.event_void_external_dish_v038(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE;v_event_id uuid;v_extra public.event_extras_v034%ROWTYPE;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  SELECT event_id INTO v_event_id FROM public.event_external_dishes_v038 WHERE id=p_id;
  PERFORM 1 FROM public.events WHERE id=v_event_id AND status IN ('planning','open','confirmed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
  SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_dish.is_active THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
  IF v_dish.paid_at IS NOT NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ALREADY_PAID'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_external_servings_v038 WHERE dish_id=p_id)
    OR EXISTS(SELECT 1 FROM public.event_on_demand_v040 WHERE external_dish_id=p_id)
  THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_IN_USE'; END IF;
  SELECT * INTO v_extra FROM public.event_extras_v034 WHERE external_dish_id_v125=p_id FOR UPDATE;
  IF FOUND THEN
    IF v_extra.status IN ('paid','refunded') THEN RAISE EXCEPTION 'V125_EXTERNAL_CUSTOMER_SETTLED'; END IF;
    IF v_extra.status='pending' THEN PERFORM public.void_event_extra_v034(v_extra.id,p_reason); END IF;
  END IF;
  UPDATE public.event_external_dishes_v038 SET is_active=false,
    notes=left(coalesce(notes,'')||' | إلغاء: '||btrim(p_reason),500) WHERE id=p_id;
  INSERT INTO public.event_activity_v034(event_id,activity_type,description)
    VALUES(v_event_id,'note','إلغاء شراء غير منفذ: '||v_dish.name||' · '||left(p_reason,250));
END;
$fn$;
REVOKE ALL ON FUNCTION public.pay_event_extra_v034(uuid,uuid),
  public.void_event_extra_v034(uuid,text),public.refund_event_extra_v034(uuid,text),
  public.event_pay_external_dish_v038(uuid,uuid),public.event_void_external_dish_v038(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_event_extra_v034(uuid,uuid),
  public.void_event_extra_v034(uuid,text),public.refund_event_extra_v034(uuid,text),
  public.event_pay_external_dish_v038(uuid,uuid),public.event_void_external_dish_v038(uuid,text) TO authenticated;

-- Canonical, read-only event result. Accrued revenue uses the STORED sales FX rate,
-- not today's rate or cash collected. Complimentary hospitality earns no revenue.
CREATE OR REPLACE VIEW public.event_financial_summary_v125
WITH (security_invoker=true) AS
WITH extra AS (
  SELECT x.event_id,
    coalesce(sum(round(x.amount_original*x.exchange_rate_to_base,4)) FILTER (WHERE x.status IN ('pending','paid')),0) AS revenue,
    coalesce(sum(round(x.amount_original*x.exchange_rate_to_base,4)) FILTER (WHERE x.status IN ('pending','paid') AND x.external_dish_id_v125 IS NULL),0) AS internal_revenue,
    coalesce(sum(round(x.amount_original*x.exchange_rate_to_base,4)) FILTER (WHERE x.status IN ('pending','paid') AND x.external_dish_id_v125 IS NOT NULL),0) AS external_revenue,
    coalesce(sum(x.total_cost_base) FILTER (WHERE x.status IN ('pending','paid','refunded','complimentary') AND x.external_dish_id_v125 IS NULL),0) AS unlinked_cost,
    coalesce(sum(x.total_cost_base) FILTER (WHERE x.status IN ('pending','paid','refunded') AND x.external_dish_id_v125 IS NULL),0) AS internal_cost,
    coalesce(sum(x.total_cost_base) FILTER (WHERE x.status='complimentary'),0) AS complimentary_cost,
    coalesce(sum(x.paid_amount_base) FILTER (WHERE x.status='paid'),0) AS collected,
    coalesce(sum(x.paid_amount_base-round(x.amount_original*x.exchange_rate_to_base,4)) FILTER (WHERE x.status='paid'),0) AS collection_fx,
    coalesce(sum(x.amount_original) FILTER (WHERE x.status='pending' AND x.currency_code=e.price_currency_code),0) AS due_original,
    count(*) FILTER (WHERE x.status='pending') AS pending_count,
    count(*) FILTER (WHERE x.status='pending' AND x.currency_code<>e.price_currency_code) AS due_currency_mismatch
  FROM public.event_extras_v034 x JOIN public.events e ON e.id=x.event_id GROUP BY x.event_id
), outside_purchase AS (
  SELECT event_id,sum(total_cost_base) AS cost,
    coalesce(sum(total_cost_base) FILTER (WHERE billing_mode_v125='hospitality'),0) AS hospitality_cost,
    coalesce(sum(total_cost_base) FILTER (WHERE billing_mode_v125='sale'),0) AS sale_cost
  FROM public.event_external_dishes_v038 WHERE is_active GROUP BY event_id
), waste AS (
  SELECT event_id,sum(total_cost_base) AS cost FROM public.event_waste_v034 WHERE status='active' GROUP BY event_id
), demand AS (
  SELECT d.event_id,
    coalesce(sum(round(i.servings/d.servings_per_source_unit*m.recipe_cost_base,4)),0) AS unposted_cost,
    bool_or(m.id IS NULL OR coalesce(m.has_missing_cost,true) OR m.recipe_cost_base IS NULL) AS incomplete
  FROM public.event_on_demand_v040 d
    JOIN public.event_on_demand_issues_v040 i ON i.on_demand_id=d.id AND i.voided_at IS NULL
    LEFT JOIN public.menu_item_costs m ON m.id=d.menu_item_id
  WHERE d.menu_item_id IS NOT NULL AND d.posted_menu_rule_id IS NULL
  GROUP BY d.event_id
), historical AS (
  -- The legacy historical view deliberately zeroes hospitality in orders-only
  -- events. Explicit hospitality must still cost the event; in this legacy mode
  -- it remains an estimate because complete_event does not post its inventory.
  -- After closing, on-demand rules are included here, so the demand CTE excludes
  -- every row already linked to a menu rule, regardless of the revenue mode.
  SELECT h.*,
    CASE WHEN h.revenue_mode='orders'
      THEN coalesce(h.estimated_actual_included_food_cost_base,0) ELSE 0 END AS orders_mode_hospitality_base_v125
  FROM public.event_financial_summary_historical h
), calculated AS (
  SELECT h.*,
    coalesce(x.revenue,0) AS extra_revenue_base_v125,
    coalesce(x.internal_revenue,0) AS internal_revenue_base_v125,
    coalesce(x.internal_cost,0) AS internal_cost_base_v125,
    coalesce(x.internal_revenue,0)-coalesce(x.internal_cost,0) AS internal_profit_base_v125,
    coalesce(x.external_revenue,0) AS external_revenue_base_v125,
    coalesce(p.sale_cost,0) AS external_sale_cost_base_v125,
    coalesce(x.external_revenue,0)-coalesce(p.sale_cost,0) AS external_profit_base_v125,
    coalesce(p.cost,0) AS external_cost_base_v125,
    coalesce(p.hospitality_cost,0) AS external_hospitality_cost_base_v125,
    coalesce(x.complimentary_cost,0) AS additional_hospitality_cost_base_v125,
    coalesce(d.unposted_cost,0) AS unposted_hospitality_cost_base_v125,
    coalesce(h.included_food_cost_base,0)+h.orders_mode_hospitality_base_v125+coalesce(d.unposted_cost,0) AS kitchen_hospitality_cost_base_v125,
    coalesce(h.included_food_cost_base,0)+h.orders_mode_hospitality_base_v125+coalesce(d.unposted_cost,0)+coalesce(x.complimentary_cost,0)+coalesce(p.hospitality_cost,0) AS hospitality_cost_base_v125,
    coalesce(x.unlinked_cost,0) AS extra_cost_base_v125,
    coalesce(w.cost,0) AS waste_cost_base_v125,
    coalesce(x.collected,0) AS extra_collected_base_v125,
    coalesce(x.collection_fx,0) AS extra_collection_fx_base_v125,
    coalesce(x.due_original,0) AS extra_due_original_v125,
    coalesce(x.pending_count,0) AS pending_extra_count_v125,
    coalesce(x.due_currency_mismatch,0) AS extra_due_currency_mismatch_v125,
    coalesce(h.earned_revenue_base,0)+coalesce(x.revenue,0) AS revenue_base_v125,
    coalesce(h.actual_total_cost_historical_base,0)+h.orders_mode_hospitality_base_v125+coalesce(x.unlinked_cost,0)+coalesce(p.cost,0)+coalesce(w.cost,0)+coalesce(d.unposted_cost,0) AS cost_base_v125,
    coalesce(h.historical_cost_incomplete,false) OR (h.revenue_mode='orders' AND coalesce(h.has_missing_actual_food_cost,false)) OR coalesce(d.incomplete,false) AS cost_incomplete_v125
  FROM historical h
    LEFT JOIN extra x ON x.event_id=h.id LEFT JOIN outside_purchase p ON p.event_id=h.id
    LEFT JOIN waste w ON w.event_id=h.id LEFT JOIN demand d ON d.event_id=h.id
  WHERE public.is_app_owner()
)
SELECT calculated.*,
  revenue_base_v125-cost_base_v125 AS profit_base_v125,
  CASE WHEN actual_guest_count>0 THEN cost_base_v125/actual_guest_count ELSE NULL END AS cost_per_guest_base_v125
FROM calculated;
REVOKE ALL ON public.event_financial_summary_v125 FROM PUBLIC,anon;
GRANT SELECT ON public.event_financial_summary_v125 TO authenticated;
COMMENT ON VIEW public.event_financial_summary_v125 IS
  'v1.0.25: hospitality is cost-only; external purchase cost once; restaurant sales and external markup included; cash separate.';

-- Reassert read-only browser access to financial rows; mutation is through owner-checked RPCs.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.event_extras_v034,public.event_external_dishes_v038 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_extras_v034,public.event_external_dishes_v038 TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
