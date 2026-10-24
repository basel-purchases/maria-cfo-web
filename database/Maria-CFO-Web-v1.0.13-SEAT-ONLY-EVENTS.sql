-- MARIA CFO WEB v1.0.13 - Seat-only events, legacy-safe migration.
-- PREREQUISITES: all prior event migrations through v0.40, pricing SQL v1.0.12.
-- IMPORTANT: preserves existing event_tables and booking/payment history.
-- An internal service ledger record may exist for compatibility with legacy
-- extra-order and on-demand RPCs; it is NOT a customer seating assignment.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='120s';

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS seat_only_v113 boolean NOT NULL DEFAULT true;
ALTER TABLE public.event_bookings ADD COLUMN IF NOT EXISTS seat_note_v113 text;
-- Existing live events switch to seat-only booking UI, while their historical
-- table allocations and financial records remain untouched.
UPDATE public.events SET seat_only_v113=true WHERE seat_only_v113 IS DISTINCT FROM true;

CREATE TABLE IF NOT EXISTS public.event_seat_guests_v113 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.event_bookings(id) ON DELETE RESTRICT,
  seat_index integer NOT NULL CHECK(seat_index>0),
  guest_name text NOT NULL CHECK(length(btrim(guest_name)) BETWEEN 1 AND 150),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,seat_index),
  UNIQUE(booking_id,seat_index)
);
CREATE INDEX IF NOT EXISTS event_seat_guests_booking_v113 ON public.event_seat_guests_v113(booking_id);
ALTER TABLE public.event_seat_guests_v113 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_seat_guests_v113 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_seat_guests_v113 TO authenticated;
DROP POLICY IF EXISTS event_seat_guests_owner_v113 ON public.event_seat_guests_v113;
CREATE POLICY event_seat_guests_owner_v113 ON public.event_seat_guests_v113
 FOR SELECT TO authenticated USING (public.is_app_owner());

-- Create an entire event atomically; one technical record preserves compatibility
-- with old event food, extras, and issue functions without exposing tables.
CREATE OR REPLACE FUNCTION public.event_create_seats_v113(
 p_name text,p_event_type text,p_event_date date,p_guests integer,
 p_currency_code text DEFAULT 'SYP',p_revenue_mode text DEFAULT 'bookings'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_guests IS NULL OR p_guests<1 OR p_guests>100000 THEN RAISE EXCEPTION 'EVENT_SEATS_INVALID'; END IF;
 v_id:=public.create_event(p_name,p_event_type,p_event_date,p_guests,p_guests,
   'per_person',NULL,p_currency_code,p_revenue_mode,NULL,NULL,NULL);
 UPDATE public.events SET seat_only_v113=true WHERE id=v_id;
 INSERT INTO public.event_tables(event_id,table_label,capacity,planned_guest_count,status)
 VALUES(v_id,'__SEAT_SERVICE_V113__',p_guests,p_guests,'available');
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(v_id,'note','خطة مقاعد بلا توزيع طاولات: '||p_guests||' كرسي');
 RETURN v_id;
END;$fn$;

CREATE OR REPLACE FUNCTION public.event_save_seats_v113(
 p_event_id uuid,p_guests integer,p_ticket_price numeric,p_notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_event public.events%ROWTYPE;v_reserved integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.status NOT IN('planning','open','confirmed') OR NOT v_event.seat_only_v113
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_guests IS NULL OR p_guests<1 OR p_guests>100000 OR p_ticket_price IS NULL OR p_ticket_price<0
 THEN RAISE EXCEPTION 'EVENT_SEATS_INVALID'; END IF;
 SELECT coalesce(sum(guest_count),0)::integer INTO v_reserved FROM public.event_bookings
 WHERE event_id=p_event_id AND status NOT IN ('cancelled','no_show');
 IF p_guests<v_reserved THEN RAISE EXCEPTION 'EVENT_SEATS_BELOW_RESERVED'; END IF;
 PERFORM public.save_event_plan_v034(p_event_id,p_guests,p_ticket_price,p_notes);
 UPDATE public.events SET capacity=p_guests WHERE id=p_event_id;
 -- Only resize the technical ledger bucket, never historical physical tables.
 UPDATE public.event_tables SET capacity=p_guests,planned_guest_count=p_guests
 WHERE event_id=p_event_id AND table_label='__SEAT_SERVICE_V113__';
END;$fn$;

-- User reserves seats, not physical tables; all cash and booking writes are one
-- server transaction, with a row lock on events to prevent double capacity sales.
CREATE OR REPLACE FUNCTION public.event_book_and_collect_seats_v113(
 p_event_id uuid,p_customer_name text,p_guest_count integer,p_amount numeric,
 p_guest_names jsonb DEFAULT '[]'::jsonb,p_phone text DEFAULT NULL,
 p_note text DEFAULT NULL,p_seat_note text DEFAULT NULL,
 p_collected boolean DEFAULT false,p_cashbox_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_event public.events%ROWTYPE;v_id uuid;v_reserved integer;v_seat_base integer;
 v_i integer;v_name text;v_names jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT v_event.seat_only_v113 OR v_event.status NOT IN ('planning','open','confirmed')
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF length(btrim(coalesce(p_customer_name,''))) NOT BETWEEN 2 AND 150
 OR p_guest_count IS NULL OR p_guest_count<1 OR p_guest_count>1000
 OR p_amount IS NULL OR p_amount<0 OR p_amount>1000000000000
 OR length(coalesce(p_seat_note,''))>200
 OR jsonb_typeof(p_guest_names) IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_guest_names)>p_guest_count
 THEN RAISE EXCEPTION 'EVENT_SEAT_BOOKING_INVALID'; END IF;
 IF p_collected AND p_amount<=0 THEN RAISE EXCEPTION 'EVENT_BOOKING_PRICE_INVALID'; END IF;
 IF p_collected AND (p_cashbox_id IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active))
 THEN RAISE EXCEPTION 'EVENT_CASHBOX_INVALID'; END IF;
 SELECT coalesce(sum(guest_count),0)::integer INTO v_reserved FROM public.event_bookings
 WHERE event_id=p_event_id AND status NOT IN ('cancelled','no_show');
 IF v_reserved+p_guest_count>coalesce(v_event.planned_guest_count,0)
 THEN RAISE EXCEPTION 'EVENT_SEATS_FULL'; END IF;
 v_names:=coalesce(p_guest_names,'[]'::jsonb);
 v_id:=public.create_event_booking(p_event_id,btrim(p_customer_name),p_guest_count,
   nullif(btrim(p_phone),''),'fixed',p_amount,v_event.price_currency_code,NULL,p_note);
 UPDATE public.event_bookings SET seat_note_v113=nullif(btrim(coalesce(p_seat_note,'')),'') WHERE id=v_id;
 SELECT coalesce(max(seat_index),0) INTO v_seat_base FROM public.event_seat_guests_v113 WHERE event_id=p_event_id;
 FOR v_i IN 1..p_guest_count LOOP
   v_name:=nullif(btrim(coalesce(v_names->>(v_i-1),'')),'');
   IF v_name IS NULL THEN
     IF v_i=1 THEN v_name:=btrim(p_customer_name);
     ELSE v_name:='مرافق '||(v_i-1)||' لـ '||btrim(p_customer_name); END IF;
   END IF;
   INSERT INTO public.event_seat_guests_v113(event_id,booking_id,seat_index,guest_name,is_primary)
   VALUES(p_event_id,v_id,v_seat_base+v_i,left(v_name,150),v_i=1);
 END LOOP;
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'booking','حجز مقاعد: '||btrim(p_customer_name)||' · '||p_guest_count||' شخص');
 IF p_collected THEN
   PERFORM public.ensure_cashbox_session_v013(p_cashbox_id,now());
   PERFORM public.record_event_booking_payment(v_id,p_cashbox_id,p_amount,
     v_event.price_currency_code,'payment',now(),p_amount,'تحصيل حجز مقاعد v1.0.13');
   INSERT INTO public.event_activity_v034(event_id,activity_type,description)
   VALUES(p_event_id,'payment','قبض حجز مقاعد: '||left(p_customer_name,120)||' · '||p_amount||' '||v_event.price_currency_code);
 END IF;
 RETURN v_id;
END;$fn$;

-- New events have one internal technical record; historical events keep their
-- old records intact. These procedures never erase previous seating history.
CREATE OR REPLACE FUNCTION public.event_complete_seats_v113(
 p_event_id uuid,p_actual_guests integer,p_notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_event public.events%ROWTYPE;v_item record;v_quantity numeric;v_rule_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT v_event.seat_only_v113 OR v_event.status NOT IN ('planning','open','confirmed')
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_actual_guests IS NULL OR p_actual_guests<0 OR p_actual_guests>100000
 THEN RAISE EXCEPTION 'EVENT_GUEST_COUNT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_extras_v034 WHERE event_id=p_event_id AND status='pending')
 THEN RAISE EXCEPTION 'EVENT_HAS_UNPAID_EXTRAS'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_booking_balances WHERE event_id=p_event_id
   AND booking_status NOT IN('cancelled','no_show') AND balance_original>0.0001)
 THEN RAISE EXCEPTION 'EVENT_HAS_UNPAID_BOOKINGS'; END IF;
 -- Mirrors the v0.40 on-demand posting (only delivered portions are posted).
 FOR v_item IN SELECT d.id,d.menu_item_id,d.servings_per_source_unit,d.posted_menu_rule_id,
   coalesce(sum(i.servings) FILTER(WHERE i.voided_at IS NULL),0) AS issued
   FROM public.event_on_demand_v040 d LEFT JOIN public.event_on_demand_issues_v040 i ON i.on_demand_id=d.id
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
     ELSE UPDATE public.event_menu_rules SET quantity_per_rule=v_quantity WHERE id=v_item.posted_menu_rule_id; END IF;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.event_menu_requirements
   WHERE event_id=p_event_id AND has_missing_cost AND required_quantity>0)
 THEN RAISE EXCEPTION 'EVENT_FOOD_COST_INCOMPLETE'; END IF;
 UPDATE public.events SET actual_guest_count=p_actual_guests WHERE id=p_event_id;
 UPDATE public.event_tables SET actual_guest_count=p_actual_guests
 WHERE event_id=p_event_id AND table_label='__SEAT_SERVICE_V113__';
 PERFORM public.complete_event(p_event_id,p_actual_guests,now(),left(p_notes,500));
 INSERT INTO public.event_activity_v034(event_id,activity_type,description)
 VALUES(p_event_id,'closing','إقفال حفلة بالمقاعد: '||p_actual_guests||' ضيف فعلي');
END;$fn$;

-- Compatibility service ledger for legacy extras/on-demand RPCs. It is not a table assignment.
CREATE OR REPLACE FUNCTION public.event_service_bucket_v113(p_event_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_event public.events%ROWTYPE;v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR NOT v_event.seat_only_v113 OR v_event.status NOT IN('planning','open','confirmed')
 THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 SELECT id INTO v_id FROM public.event_tables WHERE event_id=p_event_id AND status<>'cancelled'
 ORDER BY CASE WHEN table_label='__SEAT_SERVICE_V113__' THEN 0 ELSE 1 END,created_at LIMIT 1;
 IF v_id IS NULL THEN
   INSERT INTO public.event_tables(event_id,table_label,capacity,planned_guest_count,status)
   VALUES(p_event_id,'__SEAT_SERVICE_V113__',greatest(1,coalesce(v_event.planned_guest_count,1)),
     greatest(0,coalesce(v_event.planned_guest_count,0)),'available') RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END;$fn$;

-- Only new edits and bulk repricing round to three decimals; installation
-- intentionally does NOT rewrite old prices/transaction histories.
CREATE OR REPLACE FUNCTION public.material_price_set_one_v110(p_material_id uuid,p_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_rate numeric;v_old public.materials%ROWTYPE;v_syp numeric;v_usd numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_usd IS NOT NULL AND (p_usd<=0 OR p_usd>100000000000)
 THEN RAISE EXCEPTION 'INVALID_MATERIAL_USD_PRICE'; END IF;
 v_usd:=CASE WHEN p_usd IS NULL THEN NULL ELSE ceil(p_usd*1000)/1000 END;
 SELECT usd_to_base_rate INTO v_rate FROM public.app_settings WHERE id=1;
 IF v_usd IS NOT NULL AND (v_rate IS NULL OR v_rate<=0)
 THEN RAISE EXCEPTION 'USD_RATE_REQUIRED'; END IF;
 SELECT * INTO v_old FROM public.materials WHERE id=p_material_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_FOUND'; END IF;
 v_syp:=CASE WHEN v_usd IS NULL THEN NULL ELSE round(v_usd*v_rate,8) END;
 IF v_old.price_usd_v110 IS NOT DISTINCT FROM v_usd AND v_old.price_syp_v110 IS NOT DISTINCT FROM v_syp THEN RETURN; END IF;
 UPDATE public.materials SET price_usd_v110=v_usd,price_syp_v110=v_syp,
   price_fx_rate_v110=CASE WHEN v_usd IS NULL THEN NULL ELSE v_rate END,price_updated_at_v110=now()
 WHERE id=p_material_id;
 INSERT INTO public.material_price_history_v110(material_id,action,previous_usd,new_usd,previous_syp,new_syp,fx_rate)
 VALUES(p_material_id,'edit_usd',v_old.price_usd_v110,v_usd,v_old.price_syp_v110,v_syp,v_rate);
END;$fn$;

-- Authoritative CREATE/UPDATE material IDs call material_price_set_one_v110.
-- Bulk initialization uses original v1.0.12 atomic implementation with this
-- isolated precision adjustment. Rerun after v1.0.12.
CREATE OR REPLACE FUNCTION public.material_price_initialize_usd_v110(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_priced bigint:=0;v_changed bigint:=0;v_audited bigint:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>10000000000 THEN RAISE EXCEPTION 'INVALID_USD_EXCHANGE_RATE'; END IF;
 PERFORM 1 FROM public.app_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APP_SETTINGS_MISSING'; END IF;
 PERFORM m.id FROM public.materials AS m
   WHERE coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0))>0
   ORDER BY m.id FOR UPDATE;
 WITH eligible AS MATERIALIZED (
   SELECT m.id,m.price_usd_v110 AS old_usd,m.price_syp_v110 AS old_syp,
          coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0)) AS syp,
          ceil(coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0))/p_rate*1000)/1000 AS usd
   FROM public.materials AS m
   WHERE coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0))>0
 ), changed AS (
   UPDATE public.materials AS m SET price_usd_v110=e.usd,price_syp_v110=e.syp,
     price_fx_rate_v110=p_rate,price_updated_at_v110=now()
   FROM eligible AS e WHERE m.id=e.id AND e.usd>0 AND
   (m.price_usd_v110 IS DISTINCT FROM e.usd OR m.price_syp_v110 IS DISTINCT FROM e.syp
   OR m.price_fx_rate_v110 IS DISTINCT FROM p_rate) RETURNING m.id
 ), audit AS (
   INSERT INTO public.material_price_history_v110(material_id,action,previous_usd,new_usd,previous_syp,new_syp,fx_rate)
   SELECT e.id,'initialize_usd',e.old_usd,e.usd,e.old_syp,e.syp,p_rate
   FROM eligible e JOIN changed c ON c.id=e.id RETURNING id
 )
 SELECT (SELECT count(*) FROM eligible WHERE usd>0),(SELECT count(*) FROM changed),(SELECT count(*) FROM audit)
 INTO v_priced,v_changed,v_audited;
 IF v_changed<>v_audited THEN RAISE EXCEPTION 'PRICING_AUDIT_MISMATCH'; END IF;
 PERFORM public.set_exchange_rate('USD',p_rate,now(),'تسعير المواد بالدولار v1.0.13');
 RETURN jsonb_build_object('priced',v_priced,'updated',v_changed,'without_known_syp_price',
 (SELECT count(*) FROM public.materials)-v_priced,'rate',p_rate);
END;$fn$;

REVOKE ALL ON FUNCTION public.event_create_seats_v113(text,text,date,integer,text,text),
 public.event_save_seats_v113(uuid,integer,numeric,text),
 public.event_book_and_collect_seats_v113(uuid,text,integer,numeric,jsonb,text,text,text,boolean,uuid),
 public.event_complete_seats_v113(uuid,integer,text),
 public.event_service_bucket_v113(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_create_seats_v113(text,text,date,integer,text,text),
 public.event_save_seats_v113(uuid,integer,numeric,text),
 public.event_book_and_collect_seats_v113(uuid,text,integer,numeric,jsonb,text,text,text,boolean,uuid),
 public.event_complete_seats_v113(uuid,integer,text),
 public.event_service_bucket_v113(uuid) TO authenticated;
COMMIT;

-- Verification only (returns signatures, no data changes).
SELECT proname, pg_get_function_identity_arguments(oid) AS arguments
FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('event_create_seats_v113','event_save_seats_v113','event_book_and_collect_seats_v113','event_complete_seats_v113','event_service_bucket_v113')
ORDER BY proname;
