-- Maria CFO v0.40: instant paid reservations and honest on-demand hospitality.
-- REQUIRES successful database migrations v0.34 FIXED through v0.39.
-- No previous bookings, cashbox entries or event-menu rules are deleted.
BEGIN;

-- Creating the reservation and collecting it is ONE database transaction.
-- An invalid cashbox, a conflicting table or a failed receipt rolls back the booking too.
CREATE OR REPLACE FUNCTION public.event_book_and_collect_v040(
 p_event_id uuid,p_customer_name text,p_guest_count integer,p_amount numeric,
 p_allocations jsonb,p_guest_names jsonb DEFAULT '[]'::jsonb,
 p_phone text DEFAULT NULL,p_note text DEFAULT NULL,
 p_collected boolean DEFAULT false,p_cashbox_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_currency text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_collected THEN
   IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'EVENT_BOOKING_PRICE_INVALID'; END IF;
   IF p_cashbox_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active)
   THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
   SELECT price_currency_code INTO v_currency FROM public.events
     WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
   IF v_currency IS NULL THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 END IF;
 v_id:=public.event_group_booking_v035(p_event_id,p_customer_name,p_guest_count,p_amount,
   p_allocations,p_guest_names,p_phone,p_note);
 IF p_collected THEN
   PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
   PERFORM public.record_event_booking_payment(
     v_id,p_cashbox_id,p_amount,v_currency,'payment',now(),p_amount,
     'قبض كامل للحجز عند الإنشاء v0.40');
   INSERT INTO public.event_activity_v034(event_id,activity_type,description)
   VALUES(p_event_id,'payment','قبض حجز مباشر: '||left(p_customer_name,120)||' · '||p_amount||' '||v_currency);
 END IF;
 RETURN v_id;
END;$$;

-- On-demand items are a QUOTA, not 100 consumed servings. Only delivered portions count as consumed.
CREATE TABLE IF NOT EXISTS public.event_on_demand_v040 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 external_dish_id uuid REFERENCES public.event_external_dishes_v038(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 150),
 unit_label text NOT NULL CHECK(length(btrim(unit_label)) BETWEEN 1 AND 60),
 servings_per_source_unit numeric(20,8) NOT NULL DEFAULT 1 CHECK(servings_per_source_unit>0),
 maximum_servings numeric(16,4) NOT NULL CHECK(maximum_servings>0),
 note text,
 posted_menu_rule_id uuid UNIQUE REFERENCES public.event_menu_rules(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT event_on_demand_one_source_v040 CHECK ((menu_item_id IS NULL)<>(external_dish_id IS NULL)),
 UNIQUE(event_id,menu_item_id),UNIQUE(event_id,external_dish_id)
);
CREATE INDEX IF NOT EXISTS event_on_demand_event_idx_v040 ON public.event_on_demand_v040(event_id);
CREATE TABLE IF NOT EXISTS public.event_on_demand_issues_v040(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 on_demand_id uuid NOT NULL REFERENCES public.event_on_demand_v040(id) ON DELETE RESTRICT,
 table_id uuid NOT NULL REFERENCES public.event_tables(id) ON DELETE RESTRICT,
 servings numeric(16,4) NOT NULL CHECK(servings>0),
 note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,
 void_reason text
);
CREATE INDEX IF NOT EXISTS event_on_demand_issues_idx_v040 ON public.event_on_demand_issues_v040(on_demand_id,created_at DESC);
ALTER TABLE public.event_on_demand_v040 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_on_demand_issues_v040 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_on_demand_read_v040 ON public.event_on_demand_v040;
DROP POLICY IF EXISTS event_on_demand_issues_read_v040 ON public.event_on_demand_issues_v040;
CREATE POLICY event_on_demand_read_v040 ON public.event_on_demand_v040 FOR SELECT TO authenticated USING(public.is_app_owner());
CREATE POLICY event_on_demand_issues_read_v040 ON public.event_on_demand_issues_v040 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_on_demand_v040,public.event_on_demand_issues_v040 TO authenticated;

-- Save an availability cap in REAL serving units, optionally using existing menu/external conversions.
CREATE OR REPLACE FUNCTION public.event_save_on_demand_v040(
 p_event_id uuid,p_menu_item_id uuid,p_external_dish_id uuid,
 p_limit numeric,p_conversion_id uuid DEFAULT NULL,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_name text;v_unit text;v_yield numeric:=1;v_q numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF (p_menu_item_id IS NULL)=(p_external_dish_id IS NULL) OR
 p_limit IS NULL OR p_limit<=0 OR p_limit>1000000 OR p_limit<>round(p_limit,4)
 THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_INVALID'; END IF;
 IF p_menu_item_id IS NOT NULL THEN
   SELECT name INTO v_name FROM public.menu_items WHERE id=p_menu_item_id AND is_active;
   IF v_name IS NULL THEN RAISE EXCEPTION 'EVENT_MENU_ITEM_INVALID'; END IF;
   IF EXISTS (SELECT 1 FROM public.event_menu_rules WHERE event_id=p_event_id AND menu_item_id=p_menu_item_id)
   THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_DUPLICATE_PLAN'; END IF;
   v_unit:='وجبة';
   IF p_conversion_id IS NOT NULL THEN
     SELECT serving_label,servings_per_menu_item INTO v_unit,v_yield
       FROM public.menu_serving_conversions_v036 WHERE id=p_conversion_id AND menu_item_id=p_menu_item_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_UNIT_INVALID'; END IF;
   END IF;
 ELSE
   SELECT name,unit_label INTO v_name,v_unit FROM public.event_external_dishes_v038
     WHERE id=p_external_dish_id AND event_id=p_event_id AND is_active;
   IF v_name IS NULL THEN RAISE EXCEPTION 'EVENT_EXTERNAL_DISH_NOT_FOUND'; END IF;
   IF EXISTS(SELECT 1 FROM public.event_external_servings_v038 WHERE event_id=p_event_id AND dish_id=p_external_dish_id)
   THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_DUPLICATE_PLAN'; END IF;
   IF p_conversion_id IS NOT NULL THEN
     SELECT serving_label,servings_per_purchase_unit INTO v_unit,v_yield
       FROM public.event_external_unit_conversions_v039 WHERE id=p_conversion_id AND dish_id=p_external_dish_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_UNIT_INVALID'; END IF;
   END IF;
 END IF;
 IF v_yield IS NULL OR v_yield<=0 THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_UNIT_INVALID'; END IF;
 SELECT id INTO v_id FROM public.event_on_demand_v040 WHERE event_id=p_event_id AND
 ((p_menu_item_id IS NOT NULL AND menu_item_id=p_menu_item_id) OR
  (p_external_dish_id IS NOT NULL AND external_dish_id=p_external_dish_id)) FOR UPDATE;
 IF v_id IS NULL THEN
   INSERT INTO public.event_on_demand_v040(event_id,menu_item_id,external_dish_id,name,unit_label,servings_per_source_unit,maximum_servings,note)
   VALUES(p_event_id,p_menu_item_id,p_external_dish_id,v_name,v_unit,v_yield,p_limit,left(p_note,500)) RETURNING id INTO v_id;
 ELSE
   IF EXISTS(SELECT 1 FROM public.event_on_demand_issues_v040 WHERE on_demand_id=v_id AND voided_at IS NULL)
     AND EXISTS(SELECT 1 FROM public.event_on_demand_v040 WHERE id=v_id AND (servings_per_source_unit<>v_yield OR unit_label<>v_unit))
   THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_UNIT_IN_USE'; END IF;
   SELECT COALESCE(SUM(servings),0) INTO v_q FROM public.event_on_demand_issues_v040 WHERE on_demand_id=v_id AND voided_at IS NULL;
   IF p_limit<v_q THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_BELOW_ISSUED'; END IF;
   UPDATE public.event_on_demand_v040 SET maximum_servings=p_limit,unit_label=v_unit,servings_per_source_unit=v_yield,note=left(p_note,500) WHERE id=v_id;
 END IF;
 RETURN v_id;
END;$$;

-- Lock the offering before counting issued quantities: concurrent bar/waiter clicks cannot oversell.
CREATE OR REPLACE FUNCTION public.event_issue_on_demand_v040(
 p_on_demand_id uuid,p_table_id uuid,p_servings numeric,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_item public.event_on_demand_v040%ROWTYPE;v_event_id uuid;v_used numeric;v_purchased numeric;v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT event_id INTO v_event_id FROM public.event_on_demand_v040 WHERE id=p_on_demand_id;
 IF v_event_id IS NULL THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=v_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 SELECT * INTO v_item FROM public.event_on_demand_v040 WHERE id=p_on_demand_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_NOT_FOUND'; END IF;
 IF p_servings IS NULL OR p_servings<=0 OR p_servings<>round(p_servings,4) THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_tables WHERE id=p_table_id AND event_id=v_item.event_id AND status<>'cancelled')
 THEN RAISE EXCEPTION 'EVENT_TABLE_NOT_FOUND'; END IF;
 SELECT COALESCE(SUM(servings),0) INTO v_used FROM public.event_on_demand_issues_v040
 WHERE on_demand_id=v_item.id AND voided_at IS NULL;
 IF v_used+p_servings>v_item.maximum_servings+0.00001 THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_EXCEEDS_LIMIT'; END IF;
 IF v_item.external_dish_id IS NOT NULL THEN
   SELECT purchased_quantity INTO v_purchased FROM public.event_external_dishes_v038
     WHERE id=v_item.external_dish_id AND event_id=v_item.event_id AND is_active;
   IF v_purchased IS NULL OR (v_used+p_servings)/v_item.servings_per_source_unit>v_purchased+0.00001
   THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_EXCEEDS_PURCHASE'; END IF;
 END IF;
 INSERT INTO public.event_on_demand_issues_v040(event_id,on_demand_id,table_id,servings,note)
 VALUES(v_item.event_id,v_item.id,p_table_id,p_servings,left(p_note,500)) RETURNING id INTO v_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_item.event_id,'note','تقديم حسب الطلب: '||v_item.name||' · '||p_servings||' '||v_item.unit_label);
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.event_void_on_demand_issue_v040(p_issue_id uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_item public.event_on_demand_issues_v040%ROWTYPE;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 SELECT * INTO v_item FROM public.event_on_demand_issues_v040 WHERE id=p_issue_id FOR UPDATE;
 IF NOT FOUND OR v_item.voided_at IS NOT NULL THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_ISSUE_NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=v_item.event_id AND status IN('planning','open','confirmed'))
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 UPDATE public.event_on_demand_issues_v040 SET voided_at=now(),void_reason=left(btrim(p_reason),500) WHERE id=p_issue_id;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_item.event_id,'note','إلغاء تقديم حسب الطلب؛ السبب: '||left(btrim(p_reason),180));
END;$$;

-- Only DELIVERED menu servings join canonical food posting at event closing.
-- Unsold/unserved capacity never becomes an inventory movement or an incurred food cost.
-- Outsourced dishes were purchased separately, so no inventory post is manufactured for them.
CREATE OR REPLACE FUNCTION public.complete_event_with_demand_v040(p_event_id uuid,p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_item record;v_quantity numeric;v_rule_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 FOR v_item IN SELECT d.id,d.menu_item_id,d.servings_per_source_unit,d.posted_menu_rule_id,
   COALESCE(SUM(i.servings) FILTER(WHERE i.voided_at IS NULL),0) AS issued
   FROM public.event_on_demand_v040 d
   LEFT JOIN public.event_on_demand_issues_v040 i ON i.on_demand_id=d.id
   WHERE d.event_id=p_event_id AND d.menu_item_id IS NOT NULL
   GROUP BY d.id,d.menu_item_id,d.servings_per_source_unit,d.posted_menu_rule_id LOOP
   IF v_item.issued>0 THEN
     v_quantity:=round(v_item.issued/v_item.servings_per_source_unit,4);
     IF v_quantity<=0 OR abs(v_quantity*v_item.servings_per_source_unit-v_item.issued)>0.00005
     THEN RAISE EXCEPTION 'EVENT_ON_DEMAND_PRECISION'; END IF;
     IF v_item.posted_menu_rule_id IS NULL THEN
       INSERT INTO public.event_menu_rules(event_id,menu_item_id,rule_type,quantity_per_rule,people_per_rule)
       VALUES(p_event_id,v_item.menu_item_id,'fixed_event',v_quantity,NULL) RETURNING id INTO v_rule_id;
       UPDATE public.event_on_demand_v040 SET posted_menu_rule_id=v_rule_id WHERE id=v_item.id;
     ELSE
       UPDATE public.event_menu_rules SET quantity_per_rule=v_quantity WHERE id=v_item.posted_menu_rule_id;
     END IF;
   END IF;
 END LOOP;
 PERFORM public.complete_event_safe_v034(p_event_id,p_notes);
END;$$;

REVOKE ALL ON FUNCTION public.event_book_and_collect_v040(uuid,text,integer,numeric,jsonb,jsonb,text,text,boolean,uuid),
 public.event_save_on_demand_v040(uuid,uuid,uuid,numeric,uuid,text),
 public.event_issue_on_demand_v040(uuid,uuid,numeric,text),
 public.event_void_on_demand_issue_v040(uuid,text),
 public.complete_event_with_demand_v040(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_book_and_collect_v040(uuid,text,integer,numeric,jsonb,jsonb,text,text,boolean,uuid),
 public.event_save_on_demand_v040(uuid,uuid,uuid,numeric,uuid,text),
 public.event_issue_on_demand_v040(uuid,uuid,numeric,text),
 public.event_void_on_demand_issue_v040(uuid,text),
 public.complete_event_with_demand_v040(uuid,text) TO authenticated;
COMMIT;
