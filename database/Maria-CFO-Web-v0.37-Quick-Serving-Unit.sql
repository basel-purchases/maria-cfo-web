-- Maria CFO Web v0.37 | Add a serving unit and its conversions without leaving the event.
-- Requires the existing v0.18 unit RPC and v0.36 menu-serving tables.
-- No existing menu, recipe, event, stock or financial records are rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_event_serving_unit_v037(
 p_menu_item_id uuid,
 p_serving_label text,
 p_servings_per_menu_item numeric,
 p_material_id uuid DEFAULT NULL,
 p_quantity_in_base numeric DEFAULT NULL)
RETURNS TABLE(conversion_id uuid, unit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 v_label text := btrim(coalesce(p_serving_label,''));
 v_unit uuid := NULL;
 v_conversion uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_item_id AND is_active) THEN
  RAISE EXCEPTION 'EVENT_MENU_ITEM_INVALID';
 END IF;
 IF length(v_label) NOT BETWEEN 1 AND 80 OR
    p_servings_per_menu_item IS NULL OR p_servings_per_menu_item<0.0001 OR
    p_servings_per_menu_item>100000 OR
    p_servings_per_menu_item<>round(p_servings_per_menu_item,4) THEN
  RAISE EXCEPTION 'EVENT_SERVING_AMOUNT_INVALID';
 END IF;
 IF v_label='وجبة من المنيو' THEN RAISE EXCEPTION 'EVENT_SERVING_NAME_RESERVED'; END IF;
 IF p_material_id IS NULL AND p_quantity_in_base IS NOT NULL THEN
  RAISE EXCEPTION 'EVENT_SERVING_MATERIAL_REQUIRED';
 END IF;
 IF p_material_id IS NOT NULL THEN
  IF p_quantity_in_base IS NULL OR p_quantity_in_base<0.00000001 OR
     p_quantity_in_base>99999999999 THEN RAISE EXCEPTION 'INVALID_MATERIAL_UNIT_CONVERSION'; END IF;
  -- Only associate a unit with an actual ingredient of this menu recipe.
  IF NOT EXISTS(SELECT 1 FROM public.menu_item_recipe_items r
      WHERE r.menu_item_id=p_menu_item_id AND r.material_id=p_material_id) THEN
   RAISE EXCEPTION 'EVENT_PORTION_MATERIAL_NOT_IN_RECIPE';
  END IF;
 END IF;

 -- Prevent two users from creating a visually identical portion concurrently.
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-serving-v037:' ||
     p_menu_item_id::text || ':' || public.normalize_unit_name_v018(v_label),0));
 IF EXISTS(SELECT 1 FROM public.menu_serving_conversions_v036 c
   WHERE c.menu_item_id=p_menu_item_id AND
    public.normalize_unit_name_v018(c.serving_label)=public.normalize_unit_name_v018(v_label)) THEN
  RAISE EXCEPTION 'EVENT_SERVING_CONVERSION_ALREADY_EXISTS';
 END IF;

 -- Save the raw-material unit through the existing protected unit-catalog RPC.
 -- Both relations are part of this single transaction; either both save or neither.
 IF p_material_id IS NOT NULL THEN
  v_unit:=public.save_named_unit_v018(NULL::uuid,v_label,NULL::text,p_material_id,p_quantity_in_base);
 END IF;
 INSERT INTO public.menu_serving_conversions_v036(menu_item_id,unit_id,serving_label,servings_per_menu_item)
 VALUES(p_menu_item_id,v_unit,v_label,p_servings_per_menu_item)
 RETURNING id INTO v_conversion;
 RETURN QUERY SELECT v_conversion,v_unit;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_serving_unit_v037(uuid,text,numeric,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_serving_unit_v037(uuid,text,numeric,uuid,numeric) TO authenticated;
COMMIT;
