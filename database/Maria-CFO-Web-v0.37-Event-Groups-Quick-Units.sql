-- Maria CFO Web v0.37: named hospitality groups and in-context serving units.
-- Requires v0.18, v0.34 FIXED, v0.35 and v0.36. This migration is transactional.
-- Existing "main course" group and its recipe rules are preserved without copying quantities.
BEGIN;

-- v0.36 restricted one group per event. Existing rows become the first named group.
ALTER TABLE public.event_main_plates_v036
 DROP CONSTRAINT IF EXISTS event_main_plates_v036_event_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS event_groups_v037_name_uq
 ON public.event_main_plates_v036(event_id,lower(btrim(name)));

-- Named group is a presentation / organization aid: canonical recipe rules remain
-- in event_menu_rules; their required quantity, costing and inventory remain unchanged.
CREATE OR REPLACE FUNCTION public.save_event_group_v037(
 p_event_id uuid,p_group_id uuid,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid; v_name text := btrim(coalesce(p_name,''));
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(v_name) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'EVENT_GROUP_NAME_INVALID'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 IF p_group_id IS NULL THEN
  INSERT INTO public.event_main_plates_v036(event_id,name) VALUES(p_event_id,v_name)
  RETURNING id INTO v_id;
 ELSE
  UPDATE public.event_main_plates_v036 SET name=v_name,updated_at=now()
   WHERE id=p_group_id AND event_id=p_event_id RETURNING id INTO v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_GROUP_NOT_FOUND'; END IF;
 END IF;
 RETURN v_id;
END;$$;

CREATE OR REPLACE FUNCTION public.delete_event_group_v037(p_event_id uuid,p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND status IN('planning','open','confirmed') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_NOT_EDITABLE'; END IF;
 PERFORM 1 FROM public.event_main_plates_v036 WHERE event_id=p_event_id AND id=p_group_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_GROUP_NOT_FOUND'; END IF;
 -- Explicit group deletion deletes ONLY the group's own canonical recipe rules.
 DELETE FROM public.event_menu_rules WHERE id IN (
  SELECT rule_id FROM public.event_serving_rules_v036
  WHERE event_id=p_event_id AND main_plate_id=p_group_id
 );
 DELETE FROM public.event_main_plates_v036 WHERE event_id=p_event_id AND id=p_group_id;
END;$$;

CREATE OR REPLACE FUNCTION public.save_event_group_serving_v037(
 p_event_id uuid,p_rule_id uuid,p_menu_item_id uuid,p_rule_type text,
 p_servings numeric,p_people numeric,p_serving_label text,p_unit_id uuid,
 p_servings_per_menu_item numeric,p_group_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rule uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_group_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.event_main_plates_v036 WHERE id=p_group_id AND event_id=p_event_id
 ) THEN RAISE EXCEPTION 'EVENT_GROUP_NOT_FOUND'; END IF;
 -- v0.36 validates conversion precision and v0.34 enforces the canonical menu
 -- rule. Pass NULL so group rows may use per-person/per-table/shared/fixed.
 v_rule:=public.save_event_serving_v036(p_event_id,p_rule_id,p_menu_item_id,
  p_rule_type,p_servings,p_people,p_serving_label,p_unit_id,p_servings_per_menu_item,NULL);
 UPDATE public.event_serving_rules_v036 SET main_plate_id=p_group_id,updated_at=now()
  WHERE rule_id=v_rule AND event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EVENT_GROUP_RULE_NOT_FOUND'; END IF;
 RETURN v_rule;
END;$$;

-- Fast serving-unit creation from the ingredient/portion dialog. A menu yield
-- (10 skewers from one KG menu product) differs from a RAW stock relation
-- (one skewer uses X grams of a recipe material): neither is inferred.
-- Both writes, when requested, are atomic. No financial or inventory entry created.
CREATE OR REPLACE FUNCTION public.create_event_serving_unit_v037(
 p_menu_item_id uuid,p_label text,p_yield numeric,
 p_material_id uuid DEFAULT NULL,p_quantity_in_base numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_label text:=btrim(regexp_replace(coalesce(p_label,''),'[[:space:]]+',' ','g'));
 v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_item_id AND is_active)
 THEN RAISE EXCEPTION 'EVENT_MENU_ITEM_INVALID'; END IF;
 IF length(v_label) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'EVENT_SERVING_LABEL_INVALID'; END IF;
 IF p_yield IS NULL OR p_yield<0.0001 OR p_yield>100000 OR round(p_yield,4)<>p_yield
 THEN RAISE EXCEPTION 'EVENT_SERVING_AMOUNT_INVALID'; END IF;
 IF (p_material_id IS NULL) <> (p_quantity_in_base IS NULL)
 THEN RAISE EXCEPTION 'EVENT_MATERIAL_RELATION_INCOMPLETE'; END IF;
 -- Lock the menu item to serialize duplicate checks across simultaneous requests.
 PERFORM 1 FROM public.menu_items WHERE id=p_menu_item_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.menu_serving_conversions_v036
  WHERE menu_item_id=p_menu_item_id AND
  public.normalize_unit_name_v018(serving_label)=public.normalize_unit_name_v018(v_label))
 THEN RAISE EXCEPTION 'EVENT_SERVING_CONVERSION_DUPLICATE'; END IF;
 IF p_material_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.menu_item_recipe_items
     WHERE menu_item_id=p_menu_item_id AND material_id=p_material_id)
  THEN RAISE EXCEPTION 'EVENT_MATERIAL_NOT_IN_RECIPE'; END IF;
  IF p_quantity_in_base<0.00000001 OR p_quantity_in_base>99999999999
  THEN RAISE EXCEPTION 'INVALID_MATERIAL_UNIT_CONVERSION'; END IF;
  v_id:=public.save_named_unit_v018(NULL,v_label,NULL,p_material_id,p_quantity_in_base);
 END IF;
 INSERT INTO public.menu_serving_conversions_v036(
  menu_item_id,unit_id,serving_label,servings_per_menu_item,verified_by_owner)
 VALUES(p_menu_item_id,v_id,v_label,p_yield,true);
 RETURN jsonb_build_object('serving_label',v_label,'unit_id',v_id,
  'servings_per_menu_item',p_yield);
END;$$;

REVOKE ALL ON FUNCTION public.save_event_group_v037(uuid,uuid,text),
 public.delete_event_group_v037(uuid,uuid),
 public.save_event_group_serving_v037(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid),
 public.create_event_serving_unit_v037(uuid,text,numeric,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_event_group_v037(uuid,uuid,text),
 public.delete_event_group_v037(uuid,uuid),
 public.save_event_group_serving_v037(uuid,uuid,uuid,text,numeric,numeric,text,uuid,numeric,uuid),
 public.create_event_serving_unit_v037(uuid,text,numeric,uuid,numeric) TO authenticated;
COMMIT;
