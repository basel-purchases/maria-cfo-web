-- Maria CFO Web v0.36 — reliable portion units + composed main course for events.
-- REQUIRE successful v0.34 FIXED and v0.35 migrations. No existing business data deleted.
-- Fractions of a menu item remain canonical event_menu_rules quantities; all existing
-- event_menu_requirements, pricing, historical recipe and inventory posting stay in use.
BEGIN;

CREATE TABLE IF NOT EXISTS public.menu_serving_conversions_v036 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 unit_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
 serving_label text NOT NULL CHECK(length(btrim(serving_label)) BETWEEN 1 AND 80),
 servings_per_menu_item numeric(20,4) NOT NULL CHECK(servings_per_menu_item >= 0.0001 AND servings_per_menu_item <= 100000),
 verified_by_owner boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(menu_item_id,serving_label)
);
CREATE INDEX IF NOT EXISTS menu_serving_conversions_v036_menu_idx ON public.menu_serving_conversions_v036(menu_item_id);
ALTER TABLE public.menu_serving_conversions_v036 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select_menu_serving_v036 ON public.menu_serving_conversions_v036;
CREATE POLICY owner_select_menu_serving_v036 ON public.menu_serving_conversions_v036 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.menu_serving_conversions_v036 TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_main_plates_v036 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_main_plates_v036 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select_main_plate_v036 ON public.event_main_plates_v036;
CREATE POLICY owner_select_main_plate_v036 ON public.event_main_plates_v036 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_main_plates_v036 TO authenticated;

CREATE TABLE IF NOT EXISTS public.event_serving_rules_v036 (
 rule_id uuid PRIMARY KEY REFERENCES public.event_menu_rules(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
 main_plate_id uuid REFERENCES public.event_main_plates_v036(id) ON DELETE RESTRICT,
 serving_unit_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
 serving_label text NOT NULL CHECK(length(btrim(serving_label)) BETWEEN 1 AND 80),
 servings_per_distribution numeric(20,4) NOT NULL CHECK(servings_per_distribution>0),
 servings_per_menu_item numeric(20,4) NOT NULL CHECK(servings_per_menu_item>0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_serving_rules_v036_event_idx ON public.event_serving_rules_v036(event_id,main_plate_id);
ALTER TABLE public.event_serving_rules_v036 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select_event_servings_v036 ON public.event_serving_rules_v036;
CREATE POLICY owner_select_event_servings_v036 ON public.event_serving_rules_v036 FOR SELECT TO authenticated USING(public.is_app_owner());
GRANT SELECT ON public.event_serving_rules_v036 TO authenticated;

CREATE OR REPLACE FUNCTION public.save_event_main_plate_v036(p_event_id uuid,p_name text DEFAULT 'الصحن الرئيسي')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'EVENT_PLATE_NAME_INVALID'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 INSERT INTO public.event_main_plates_v036(event_id,name) VALUES(p_event_id,btrim(p_name))
 ON CONFLICT(event_id) DO UPDATE SET name=excluded.name,updated_at=now() RETURNING id INTO v_id;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.save_event_serving_v036(
 p_event_id uuid,p_rule_id uuid,p_menu_item_id uuid,p_rule_type text,
 p_servings numeric,p_people numeric,p_serving_label text,p_unit_id uuid,
 p_servings_per_menu_item numeric,p_plate_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rule_id uuid; v_qty numeric; v_label text; v_ratio numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_servings IS NULL OR p_servings<=0 OR p_servings>10000
  OR p_servings_per_menu_item IS NULL OR p_servings_per_menu_item<0.0001 OR p_servings_per_menu_item>100000
  OR length(btrim(coalesce(p_serving_label,''))) NOT BETWEEN 1 AND 80 THEN
   RAISE EXCEPTION 'EVENT_SERVING_AMOUNT_INVALID'; END IF;
 IF p_plate_id IS NOT NULL THEN
  IF p_rule_type<>'per_person' OR NOT EXISTS(SELECT 1 FROM public.event_main_plates_v036 WHERE id=p_plate_id AND event_id=p_event_id)
  THEN RAISE EXCEPTION 'EVENT_PLATE_COMPONENT_INVALID'; END IF;
 END IF;
 v_label:=btrim(p_serving_label);
 IF p_unit_id IS NOT NULL THEN
  SELECT name INTO v_label FROM public.units WHERE id=p_unit_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_SERVING_UNIT_INVALID'; END IF;
 ELSIF v_label='وجبة من المنيو' AND p_servings_per_menu_item<>1 THEN
  RAISE EXCEPTION 'EVENT_SERVING_AMOUNT_INVALID';
 END IF;
 -- The canonical quantity is numeric(20,4). Refuse to round an unrepresentable
 -- conversion silently; otherwise recipe costing and inventory posting drift.
 v_ratio:=p_servings/p_servings_per_menu_item;
 v_qty:=round(v_ratio,4);
 IF v_qty<0.0001 OR v_qty>10000 OR abs(v_ratio-v_qty)/v_ratio>0.001 THEN
  RAISE EXCEPTION 'EVENT_PORTION_PRECISION'; END IF;
 -- Reuse the existing v0.34 validation and accounting source of truth.
 v_rule_id:=public.save_event_rule_v034(p_event_id,p_rule_id,p_menu_item_id,p_rule_type,v_qty,p_people);
 INSERT INTO public.event_serving_rules_v036(rule_id,event_id,main_plate_id,serving_unit_id,
   serving_label,servings_per_distribution,servings_per_menu_item)
 VALUES(v_rule_id,p_event_id,p_plate_id,p_unit_id,v_label,p_servings,p_servings_per_menu_item)
 ON CONFLICT(rule_id) DO UPDATE SET event_id=excluded.event_id,main_plate_id=excluded.main_plate_id,
  serving_unit_id=excluded.serving_unit_id,serving_label=excluded.serving_label,
  servings_per_distribution=excluded.servings_per_distribution,
  servings_per_menu_item=excluded.servings_per_menu_item,updated_at=now();
 -- Confirmed by the owner: reuse this mapping on future events, with editing allowed.
 IF p_unit_id IS NOT NULL OR v_label<>'وجبة من المنيو' THEN
  INSERT INTO public.menu_serving_conversions_v036(menu_item_id,unit_id,serving_label,servings_per_menu_item)
  VALUES(p_menu_item_id,p_unit_id,v_label,p_servings_per_menu_item)
  ON CONFLICT(menu_item_id,serving_label) DO UPDATE SET
   unit_id=excluded.unit_id,servings_per_menu_item=excluded.servings_per_menu_item,updated_at=now();
 END IF;
 RETURN v_rule_id;
END;$$;

CREATE OR REPLACE FUNCTION public.delete_event_main_plate_v036(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_plate uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 SELECT id INTO v_plate FROM public.event_main_plates_v036 WHERE event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_PLATE_NOT_FOUND'; END IF;
 -- Explicit confirmed removal of the composition also removes its source recipe rules.
 DELETE FROM public.event_menu_rules WHERE id IN
  (SELECT rule_id FROM public.event_serving_rules_v036 WHERE event_id=p_event_id AND main_plate_id=v_plate);
 DELETE FROM public.event_main_plates_v036 WHERE id=v_plate;
END;$$;

REVOKE ALL ON FUNCTION public.save_event_main_plate_v036(uuid,text),
 public.save_event_serving_v036(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid),
 public.delete_event_main_plate_v036(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_event_main_plate_v036(uuid,text),
 public.save_event_serving_v036(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid),
 public.delete_event_main_plate_v036(uuid) TO authenticated;
COMMIT;
