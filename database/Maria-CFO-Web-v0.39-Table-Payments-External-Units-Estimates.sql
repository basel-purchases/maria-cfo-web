-- Maria CFO v0.39: atomic table collection, arbitrary external serving-unit conversions,
-- and GLOBAL menu-item provisional cost references for planning (NOT inventory valuation).
-- Requires successful v0.34 FIXED, v0.35, v0.36, v0.37, and v0.38 migrations.
-- Safe to re-run; never deletes bookings, cashbook entries, servings or purchases.
BEGIN;

-- A missing recipe has an OPTIONAL estimate saved once for later events.
-- This value never modifies recipes, material prices, stock or actual cost postings.
CREATE TABLE IF NOT EXISTS public.event_menu_cost_estimates_v039 (
 menu_item_id uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
 estimated_unit_cost_base numeric(20,4) NOT NULL CHECK(estimated_unit_cost_base>=0),
 note text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_menu_cost_estimates_v039 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_menu_estimates_owner_v039 ON public.event_menu_cost_estimates_v039;
CREATE POLICY event_menu_estimates_owner_v039 ON public.event_menu_cost_estimates_v039
 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_menu_cost_estimates_v039 TO authenticated;

CREATE OR REPLACE FUNCTION public.event_save_cost_estimate_v039(
 p_menu_item_id uuid,p_cost numeric,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_cost IS NULL OR p_cost<0 OR p_cost>999999999999 OR p_cost<>round(p_cost,4)
 THEN RAISE EXCEPTION 'EVENT_ESTIMATE_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_item_id)
 THEN RAISE EXCEPTION 'EVENT_MENU_ITEM_INVALID'; END IF;
 INSERT INTO public.event_menu_cost_estimates_v039(menu_item_id,estimated_unit_cost_base,note)
 VALUES(p_menu_item_id,p_cost,left(p_note,300))
 ON CONFLICT(menu_item_id) DO UPDATE SET estimated_unit_cost_base=EXCLUDED.estimated_unit_cost_base,
 note=EXCLUDED.note,updated_at=now();
END;$$;

-- One transaction either saves both the serving rule AND the optional global estimate,
-- or reverts both. A blank estimate leaves the global reference unchanged.
CREATE OR REPLACE FUNCTION public.event_save_group_serving_v039(
 p_event_id uuid,p_rule_id uuid,p_menu_item_id uuid,p_rule_type text,
 p_servings numeric,p_people numeric,p_serving_label text,p_unit_id uuid,
 p_servings_per_menu_item numeric,p_group_id uuid DEFAULT NULL,p_estimate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rule uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_rule:=public.save_event_group_serving_v037(p_event_id,p_rule_id,p_menu_item_id,p_rule_type,
  p_servings,p_people,p_serving_label,p_unit_id,p_servings_per_menu_item,p_group_id);
 IF p_estimate IS NOT NULL THEN
  PERFORM public.event_save_cost_estimate_v039(p_menu_item_id,p_estimate,'تكلفة تقديرية للتخطيط');
 END IF;
 RETURN v_rule;
END;$$;

-- Every external PURCHASE unit can yield a large number of SERVING units.
-- Ex: one cake => 200 slices; one box => 36 pieces; one platter => 5 bowls.
CREATE TABLE IF NOT EXISTS public.event_external_unit_conversions_v039 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dish_id uuid NOT NULL REFERENCES public.event_external_dishes_v038(id) ON DELETE CASCADE,
 serving_label text NOT NULL CHECK(length(btrim(serving_label)) BETWEEN 1 AND 60),
 servings_per_purchase_unit numeric(20,6) NOT NULL
  CHECK(servings_per_purchase_unit>=0.000001 AND servings_per_purchase_unit<=1000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dish_id,serving_label)
);
CREATE INDEX IF NOT EXISTS event_external_unit_conv_dish_v039 ON public.event_external_unit_conversions_v039(dish_id);
ALTER TABLE public.event_external_unit_conversions_v039 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_external_unit_conv_owner_v039 ON public.event_external_unit_conversions_v039;
CREATE POLICY event_external_unit_conv_owner_v039 ON public.event_external_unit_conversions_v039
 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_external_unit_conversions_v039 TO authenticated;

ALTER TABLE public.event_external_servings_v038
 ALTER COLUMN quantity_per_distribution TYPE numeric(22,10);
ALTER TABLE public.event_external_servings_v038
 ADD COLUMN IF NOT EXISTS serving_conversion_id uuid REFERENCES public.event_external_unit_conversions_v039(id) ON DELETE RESTRICT;
ALTER TABLE public.event_external_servings_v038
 ADD COLUMN IF NOT EXISTS servings_per_distribution numeric(20,6);

CREATE OR REPLACE FUNCTION public.event_add_external_unit_v039(
 p_dish_id uuid,p_label text,p_per_purchase_unit numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.event_external_dishes_v038 d
 JOIN public.events e ON e.id=d.event_id
 WHERE d.id=p_dish_id AND d.is_active AND e.status IN('planning','open','confirmed') FOR UPDATE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
 IF length(btrim(coalesce(p_label,''))) NOT BETWEEN 1 AND 60
 OR p_per_purchase_unit IS NULL OR p_per_purchase_unit<0.000001
 OR p_per_purchase_unit>1000000 OR p_per_purchase_unit<>round(p_per_purchase_unit,6)
 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_CONVERSION_INVALID'; END IF;
 -- Existing conversions may be reused, but never silently repriced once used in a rule.
 SELECT id INTO v_id FROM public.event_external_unit_conversions_v039
 WHERE dish_id=p_dish_id AND serving_label=btrim(p_label) FOR UPDATE;
 IF FOUND THEN
  IF EXISTS(SELECT 1 FROM public.event_external_servings_v038 r
   JOIN public.event_external_unit_conversions_v039 c ON c.id=r.serving_conversion_id
   WHERE c.id=v_id AND c.servings_per_purchase_unit<>p_per_purchase_unit)
  THEN RAISE EXCEPTION 'EVENT_EXTERNAL_UNIT_IN_USE'; END IF;
  UPDATE public.event_external_unit_conversions_v039
  SET servings_per_purchase_unit=p_per_purchase_unit WHERE id=v_id;
 ELSE
  INSERT INTO public.event_external_unit_conversions_v039(dish_id,serving_label,servings_per_purchase_unit)
  VALUES(p_dish_id,btrim(p_label),p_per_purchase_unit) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.event_save_external_serving_v039(
 p_event_id uuid,p_rule_id uuid,p_dish_id uuid,p_group_id uuid,
 p_rule_type text,p_servings numeric,p_people integer DEFAULT NULL,p_conversion_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_yield numeric:=1;v_base numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_external_dishes_v038
  WHERE id=p_dish_id AND event_id=p_event_id AND is_active) THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
 IF p_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_main_plates_v036
  WHERE id=p_group_id AND event_id=p_event_id) THEN RAISE EXCEPTION 'EVENT_GROUP_NOT_FOUND'; END IF;
 IF p_conversion_id IS NOT NULL THEN
  SELECT servings_per_purchase_unit INTO v_yield FROM public.event_external_unit_conversions_v039
  WHERE id=p_conversion_id AND dish_id=p_dish_id;
  IF v_yield IS NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_CONVERSION_INVALID'; END IF;
 END IF;
 IF p_rule_type NOT IN('per_person','per_n_people','per_table','fixed_event')
 OR p_servings IS NULL OR p_servings<0.000001 OR p_servings>1000000
 OR p_servings<>round(p_servings,6)
 OR (p_rule_type='per_n_people' AND (p_people IS NULL OR p_people<1 OR p_people>10000))
 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_RULE_INVALID'; END IF;
 v_base:=round(p_servings/v_yield,10);
 IF v_base<=0 THEN RAISE EXCEPTION 'EVENT_EXTERNAL_CONVERSION_PRECISION'; END IF;
 IF p_rule_id IS NULL THEN
  INSERT INTO public.event_external_servings_v038(event_id,dish_id,group_id,rule_type,
   quantity_per_distribution,people_per_rule,serving_conversion_id,servings_per_distribution)
  VALUES(p_event_id,p_dish_id,p_group_id,p_rule_type,v_base,
   CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END,p_conversion_id,p_servings)
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.event_external_servings_v038 SET dish_id=p_dish_id,group_id=p_group_id,
   rule_type=p_rule_type,quantity_per_distribution=v_base,
   people_per_rule=CASE WHEN p_rule_type='per_n_people' THEN p_people ELSE NULL END,
   serving_conversion_id=p_conversion_id,servings_per_distribution=p_servings
  WHERE id=p_rule_id AND event_id=p_event_id RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_EXTERNAL_RULE_NOT_FOUND'; END IF;
 END IF;
 RETURN v_id;
END;$$;

-- One button, one database transaction: all pending extras on ONE table are paid,
-- or NOTHING is posted. Each original invoice preserves its own traceable cash entry
-- and refund path under the legacy cashbox ledger schema.
CREATE OR REPLACE FUNCTION public.pay_event_table_extras_v039(
 p_event_id uuid,p_table_id uuid,p_cashbox_id uuid)
RETURNS TABLE(payment_count integer,total_original numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_extra record;v_count integer:=0;v_total numeric:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_FOUND'; END IF;
 PERFORM 1 FROM public.event_tables WHERE id=p_table_id AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_TABLE_NOT_FOUND'; END IF;
 IF p_cashbox_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.cashboxes
  WHERE id=p_cashbox_id AND is_active) THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
 -- payment function itself re-checks owner, sessions, currency and paid status.
 FOR v_extra IN SELECT id,amount_original FROM public.event_extras_v034
  WHERE event_id=p_event_id AND table_id=p_table_id AND status='pending' ORDER BY id FOR UPDATE LOOP
  PERFORM public.pay_event_extra_v034(v_extra.id,p_cashbox_id);
  v_count:=v_count+1;v_total:=v_total+v_extra.amount_original;
 END LOOP;
 IF v_count=0 THEN RAISE EXCEPTION 'EVENT_TABLE_NO_UNPAID_EXTRAS'; END IF;
 RETURN QUERY SELECT v_count,v_total;
END;$$;

REVOKE ALL ON FUNCTION public.event_save_cost_estimate_v039(uuid,numeric,text),
 public.event_save_group_serving_v039(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid,numeric),
 public.event_add_external_unit_v039(uuid,text,numeric),
 public.event_save_external_serving_v039(uuid,uuid,uuid,uuid,text,numeric,integer,uuid),
 public.pay_event_table_extras_v039(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_save_cost_estimate_v039(uuid,numeric,text),
 public.event_save_group_serving_v039(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid,numeric),
 public.event_add_external_unit_v039(uuid,text,numeric),
 public.event_save_external_serving_v039(uuid,uuid,uuid,uuid,text,numeric,integer,uuid),
 public.pay_event_table_extras_v039(uuid,uuid,uuid) TO authenticated;
COMMIT;
