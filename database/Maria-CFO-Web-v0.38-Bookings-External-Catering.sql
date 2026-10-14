-- Maria CFO Web v0.38: clear booking prices and separately purchased hospitality.
-- Requires completed v0.34 FIXED, v0.35, v0.36, v0.37. Does not rewrite old bookings.
BEGIN;

-- Correct a legacy zero-valued reservation before taking its first payment.
-- Paid bookings can never have their original agreed amount silently changed.
CREATE OR REPLACE FUNCTION public.event_set_booking_amount_v038(
 p_booking_id uuid,p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_booking public.event_bookings%ROWTYPE;v_paid numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_booking FROM public.event_bookings WHERE id=p_booking_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_BOOKING_NOT_FOUND'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.events WHERE id=v_booking.event_id
   AND status IN('planning','open','confirmed'))
   THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF v_booking.status IN('cancelled','no_show') THEN RAISE EXCEPTION 'EVENT_BOOKING_NOT_EDITABLE'; END IF;
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>99999999999999
   THEN RAISE EXCEPTION 'EVENT_BOOKING_PRICE_INVALID'; END IF;
 SELECT COALESCE(paid_original,0) INTO v_paid FROM public.event_booking_balances
   WHERE booking_id=p_booking_id;
 IF COALESCE(v_paid,0)>0 THEN RAISE EXCEPTION 'EVENT_BOOKING_HAS_PAYMENTS'; END IF;
 UPDATE public.event_bookings SET agreed_amount_original=round(p_amount,4) WHERE id=p_booking_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_booking.event_id,'booking','تصحيح قيمة حجز '||v_booking.customer_name||' من '
 ||COALESCE(v_booking.agreed_amount_original,0)||' إلى '||round(p_amount,4));
END;$$;

-- Event-only outside-catered meals: these do NOT create recipe or inventory movements.
-- The purchase cost is accrued once; later cash settlement is NOT an extra cost.
CREATE TABLE IF NOT EXISTS public.event_external_dishes_v038(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150),
 unit_label text NOT NULL CHECK(length(btrim(unit_label)) BETWEEN 1 AND 60),
 vendor text,
 purchased_quantity numeric(16,4) NOT NULL CHECK(purchased_quantity>0),
 unit_cost_base numeric(20,4) NOT NULL CHECK(unit_cost_base>=0),
 total_cost_base numeric(20,4) GENERATED ALWAYS AS (round(purchased_quantity*unit_cost_base,4)) STORED,
 notes text,
 is_active boolean NOT NULL DEFAULT true,
 cashbox_transaction_id uuid UNIQUE REFERENCES public.cashbox_transactions(id) ON DELETE RESTRICT,
 paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_external_dishes_v038_event_idx ON public.event_external_dishes_v038(event_id,is_active);
ALTER TABLE public.event_external_dishes_v038 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_external_dishes_read_v038 ON public.event_external_dishes_v038;
CREATE POLICY event_external_dishes_read_v038 ON public.event_external_dishes_v038
 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_external_dishes_v038 TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_external_servings_v038(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 dish_id uuid NOT NULL REFERENCES public.event_external_dishes_v038(id) ON DELETE RESTRICT,
 group_id uuid REFERENCES public.event_main_plates_v036(id) ON DELETE SET NULL,
 rule_type text NOT NULL CHECK(rule_type IN('per_person','per_n_people','per_table','fixed_event')),
 quantity_per_distribution numeric(14,4) NOT NULL CHECK(quantity_per_distribution>0),
 people_per_rule integer,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT external_people_rule_v038 CHECK(
   (rule_type='per_n_people' AND people_per_rule BETWEEN 1 AND 10000)
   OR (rule_type<>'per_n_people' AND people_per_rule IS NULL))
);
CREATE INDEX IF NOT EXISTS event_external_servings_v038_event_idx ON public.event_external_servings_v038(event_id);
ALTER TABLE public.event_external_servings_v038 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_external_servings_read_v038 ON public.event_external_servings_v038;
CREATE POLICY event_external_servings_read_v038 ON public.event_external_servings_v038
 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_external_servings_v038 TO authenticated;

CREATE OR REPLACE FUNCTION public.event_add_external_dish_v038(
 p_event_id uuid,p_name text,p_unit_label text,p_quantity numeric,p_unit_cost_base numeric,
 p_vendor text DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 150
 OR length(btrim(COALESCE(p_unit_label,''))) NOT BETWEEN 1 AND 60
 OR p_quantity IS NULL OR p_quantity<0.0001 OR p_quantity>1000000
 OR p_quantity<>round(p_quantity,4)
 OR p_unit_cost_base IS NULL OR p_unit_cost_base<0 OR p_unit_cost_base>999999999999
 OR p_unit_cost_base<>round(p_unit_cost_base,4)
 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_INVALID'; END IF;
 INSERT INTO public.event_external_dishes_v038(event_id,name,unit_label,purchased_quantity,
 unit_cost_base,vendor,notes)
 VALUES(p_event_id,btrim(p_name),btrim(p_unit_label),p_quantity,p_unit_cost_base,
 left(NULLIF(btrim(COALESCE(p_vendor,'')),''),150),left(COALESCE(p_notes,''),500))
 RETURNING id INTO v_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'note','تسجيل شراء وجبة خارجية: '||btrim(p_name)||'، العدد '||p_quantity);
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.event_save_external_serving_v038(
 p_event_id uuid,p_rule_id uuid,p_dish_id uuid,p_group_id uuid,
 p_rule_type text,p_quantity numeric,p_people integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_external_dishes_v038
  WHERE id=p_dish_id AND event_id=p_event_id AND is_active)
  THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
 IF p_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_main_plates_v036
  WHERE id=p_group_id AND event_id=p_event_id) THEN RAISE EXCEPTION 'EVENT_GROUP_NOT_FOUND'; END IF;
 IF p_rule_type NOT IN('per_person','per_n_people','per_table','fixed_event')
 OR p_quantity IS NULL OR p_quantity<0.0001 OR p_quantity>100000
 OR p_quantity<>round(p_quantity,4)
 OR (p_rule_type='per_n_people' AND (p_people IS NULL OR p_people<1 OR p_people>10000))
 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_RULE_INVALID'; END IF;
 IF p_rule_id IS NULL THEN
  INSERT INTO public.event_external_servings_v038(event_id,dish_id,group_id,rule_type,
   quantity_per_distribution,people_per_rule)
  VALUES(p_event_id,p_dish_id,p_group_id,p_rule_type,p_quantity,
   CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END) RETURNING id INTO v_id;
 ELSE
  UPDATE public.event_external_servings_v038 SET dish_id=p_dish_id,group_id=p_group_id,
   rule_type=p_rule_type,quantity_per_distribution=p_quantity,
   people_per_rule=CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END
  WHERE id=p_rule_id AND event_id=p_event_id RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_EXTERNAL_RULE_NOT_FOUND'; END IF;
 END IF;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.event_delete_external_serving_v038(p_event_id uuid,p_rule_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 DELETE FROM public.event_external_servings_v038 WHERE id=p_rule_id AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_EXTERNAL_RULE_NOT_FOUND'; END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.event_void_external_dish_v038(p_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT v_dish.is_active THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
 IF v_dish.paid_at IS NOT NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ALREADY_PAID'; END IF;
 IF EXISTS (SELECT 1 FROM public.event_external_servings_v038 WHERE dish_id=p_id)
 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_IN_USE'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 UPDATE public.event_external_dishes_v038 SET is_active=false,notes=left(
  COALESCE(notes,'')||' | إلغاء: '||btrim(p_reason),500) WHERE id=p_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_dish.event_id,'note','إلغاء تسجيل الوجبة الخارجية '||v_dish.name||': '||left(p_reason,180));
END;$$;

CREATE OR REPLACE FUNCTION public.event_pay_external_dish_v038(p_id uuid,p_cashbox_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_dish public.event_external_dishes_v038%ROWTYPE;v_box uuid;v_cc text;v_tx uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_dish FROM public.event_external_dishes_v038 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT v_dish.is_active THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
 IF v_dish.paid_at IS NOT NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ALREADY_PAID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=v_dish.event_id AND status IN('planning','open','confirmed'))
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 SELECT id INTO v_box FROM public.cashboxes WHERE id=p_cashbox_id AND is_active;
 IF v_box IS NULL THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
 SELECT base_currency_code INTO v_cc FROM public.app_settings WHERE id=1;
 IF v_cc IS NULL THEN RAISE EXCEPTION 'EVENT_BASE_CURRENCY_MISSING'; END IF;
 IF v_dish.total_cost_base<=0 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_ZERO_COST'; END IF;
 PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
 v_tx:=public.record_cashbox_transaction(p_cashbox_id,'out','event',v_dish.total_cost_base,
  v_cc,now(),'شراء ضيافة خارجية للحفلة: '||v_dish.name,'event_external_v038',v_dish.id);
 UPDATE public.event_external_dishes_v038 SET cashbox_transaction_id=v_tx,paid_at=now() WHERE id=p_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_dish.event_id,'payment','سداد شراء ضيافة خارجية: '||v_dish.name||' · '||v_dish.total_cost_base||' '||v_cc);
 RETURN v_tx;
END;$$;

REVOKE ALL ON FUNCTION public.event_set_booking_amount_v038(uuid,numeric),
 public.event_add_external_dish_v038(uuid,text,text,numeric,numeric,text,text),
 public.event_save_external_serving_v038(uuid,uuid,uuid,uuid,text,numeric,integer),
 public.event_delete_external_serving_v038(uuid,uuid),
 public.event_void_external_dish_v038(uuid,text),
 public.event_pay_external_dish_v038(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_set_booking_amount_v038(uuid,numeric),
 public.event_add_external_dish_v038(uuid,text,text,numeric,numeric,text,text),
 public.event_save_external_serving_v038(uuid,uuid,uuid,uuid,text,numeric,integer),
 public.event_delete_external_serving_v038(uuid,uuid),
 public.event_void_external_dish_v038(uuid,text),
 public.event_pay_external_dish_v038(uuid,uuid) TO authenticated;
COMMIT;
