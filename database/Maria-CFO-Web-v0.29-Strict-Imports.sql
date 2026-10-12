-- Maria CFO Web v0.29 - strict inventory eligibility and recipes with full real cost.
-- Apply AFTER v0.28. No tables are deleted; transactions/history stay intact.
-- Supabase SQL Editor: execute once after a verified database backup.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ameen_material_cost_sources_v029 (
  material_id uuid PRIMARY KEY REFERENCES public.materials(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES public.ameen_import_runs_v024(id) ON DELETE RESTRICT,
  source_price numeric(20,8) NOT NULL CHECK(source_price>0),
  price_per_base_unit numeric(20,8) NOT NULL CHECK(price_per_base_unit>0),
  source_warehouse text NOT NULL,
  source_unit text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ameen_material_cost_sources_v029 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ameen_material_cost_sources_v029 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ameen_material_cost_sources_v029 TO authenticated;
DROP POLICY IF EXISTS ameen_cost_source_owner_v029 ON public.ameen_material_cost_sources_v029;
CREATE POLICY ameen_cost_source_owner_v029 ON public.ameen_material_cost_sources_v029
FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE OR REPLACE FUNCTION public.import_ameen_v029(
 p_kind text,p_filename text,p_sha256 text,p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_rec jsonb; v_allowed jsonb:='[]'::jsonb;
 v_qty numeric; v_price numeric; v_accept boolean;
 v_name text; v_wh text; v_kind text; v_run uuid; v_result jsonb;
 v_total integer; v_kept integer:=0; v_record record; v_price_base numeric;
 v_applied integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF jsonb_typeof(p_records)<>'array' THEN RAISE EXCEPTION 'V029_EXPECT_RECORD_ARRAY'; END IF;
 v_total:=jsonb_array_length(p_records);
 IF v_total<1 OR v_total>5000 THEN RAISE EXCEPTION 'V029_RECORD_COUNT_INVALID'; END IF;
 IF p_kind<>'inventory' THEN
   RETURN public.import_ameen_v024(p_kind,p_filename,p_sha256,p_records);
 END IF;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_kind:=v_rec->>'kind';v_name:=btrim(coalesce(v_rec->>'name',''));
   v_wh:=btrim(coalesce(v_rec->>'warehouse',''));
   IF coalesce(v_rec->>'quantity','') !~ '^-?[0-9]+([.][0-9]+)?$'
      OR (v_rec->>'price' IS NOT NULL AND (v_rec->>'price') !~ '^-?[0-9]+([.][0-9]+)?$')
   THEN RAISE EXCEPTION 'V029_BAD_QUANTITY_OR_PRICE: %',v_name; END IF;
   v_qty:=(v_rec->>'quantity')::numeric;
   v_price:=coalesce((v_rec->>'price')::numeric,0);
   v_accept:=false;
   IF v_kind='material' THEN
     IF (SELECT count(*) FROM public.materials m WHERE lower(btrim(m.name))=lower(v_name))>1 THEN
       RAISE EXCEPTION 'V029_DUPLICATE_MATERIAL_NAME_REVIEW_REQUIRED: %',v_name;
     END IF;
     v_accept:=v_wh<>'' AND v_qty>0 AND
       (v_price>0 OR EXISTS(
          SELECT 1 FROM public.materials m WHERE lower(btrim(m.name))=lower(v_name)
            AND m.last_purchase_unit_cost_base>0));
   ELSIF v_kind='menu' THEN
     v_accept:=v_price>0;
   ELSIF v_kind='asset' THEN
     v_accept:=v_wh<>'' AND v_qty>0;
   END IF;
   IF v_accept THEN
     v_allowed:=v_allowed||jsonb_build_array(v_rec);v_kept:=v_kept+1;
   END IF;
 END LOOP;
 IF v_kept=0 THEN RAISE EXCEPTION 'V029_NO_ELIGIBLE_RECORDS'; END IF;
 -- Existing v0.24 implementation atomically creates catalog rows and stock movements.
 v_result:=public.import_ameen_v024(p_kind,p_filename,p_sha256,v_allowed);
 IF coalesce((v_result->>'duplicateFile')::boolean,false) THEN
   RETURN v_result||jsonb_build_object('v029Accepted',v_kept,'v029Rejected',v_total-v_kept);
 END IF;
 v_run:=(v_result->>'runId')::uuid;
 -- The Excel source_price is per EXCEL inventory unit. Convert to BASE unit
 -- using the quantity conversion already validated by the original importer.
 -- Only fill unknown reference costs; never overwrite a genuine previous price.
 FOR v_record IN
   SELECT DISTINCT ON (i.core_entity_id) i.core_entity_id AS material_id,
     i.source_price,i.quantity_original,i.quantity_base,i.warehouse,i.unit_name
   FROM public.ameen_inventory_rows_v024 i
   WHERE i.last_run_id=v_run AND i.kind='material'
    AND i.source_price>0 AND i.quantity_original>0 AND i.quantity_base>0
    AND i.review_reason IS NULL AND nullif(btrim(i.warehouse),'') IS NOT NULL
   ORDER BY i.core_entity_id,i.source_key
 LOOP
   v_price_base:=round(v_record.source_price * v_record.quantity_original / v_record.quantity_base,8);
   IF v_price_base<=0 THEN CONTINUE; END IF;
   UPDATE public.materials SET last_purchase_unit_cost_base=v_price_base
   WHERE id=v_record.material_id
      AND (last_purchase_unit_cost_base IS NULL OR last_purchase_unit_cost_base<=0);
   IF FOUND THEN
     v_applied:=v_applied+1;
     INSERT INTO public.ameen_material_cost_sources_v029
       (material_id,run_id,source_price,price_per_base_unit,source_warehouse,source_unit)
     VALUES(v_record.material_id,v_run,v_record.source_price,v_price_base,
       v_record.warehouse,coalesce(v_record.unit_name,''))
     ON CONFLICT(material_id) DO NOTHING;
   END IF;
 END LOOP;
 RETURN v_result||jsonb_build_object('v029Accepted',v_kept,'v029Rejected',v_total-v_kept,
   'v029MaterialPricesSetFromExcel',v_applied);
END;
$$;
REVOKE ALL ON FUNCTION public.import_ameen_v029(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_ameen_v029(text,text,text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.import_ameen_v029(text,text,text,jsonb) IS
 'v0.29: only positive-stock, warehoused and priced materials; positive menu sale prices; priced reference cost provenance; owner-only.';

CREATE OR REPLACE FUNCTION public.import_menu_recipes_v029(
  p_sha256 text,
  p_recipes jsonb,
  p_lines jsonb,
  p_replace_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_recipe jsonb; v_line jsonb; v_key text; v_name text; v_material_name text;
  v_unit_name text; v_menu uuid; v_mat uuid; v_unit uuid; v_qty numeric;
  v_count integer; v_existing_count integer; v_created integer:=0;
  v_inserted integer:=0; v_updated integer:=0; v_unchanged integer:=0;
  v_removed integer:=0; v_run uuid; v_summary jsonb; v_row record;
  v_distinct_materials integer; v_priced_materials integer;
  v_missing_materials integer; v_covered_recipes integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'RECIPES_ACCESS_DENIED'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'RECIPES_INVALID_SHA256'; END IF;
 IF jsonb_typeof(p_recipes)<>'array' OR jsonb_typeof(p_lines)<>'array' THEN
   RAISE EXCEPTION 'RECIPES_EXPECT_ARRAYS'; END IF;
 IF jsonb_array_length(p_recipes) NOT BETWEEN 1 AND 75 THEN RAISE EXCEPTION 'RECIPES_V029_EXPECT_1_TO_75_ELIGIBLE_MENU_ITEMS'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'RECIPES_INVALID_LINES'; END IF;

 -- Same lock key used by v0.27: never interleave two full-file imports.
 PERFORM pg_advisory_xact_lock(hashtext('maria_recipes_v027_atomic'));
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_targets_v029 (
   recipe_key text PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
   menu_name text NOT NULL
 ) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_lines_v029 (
   recipe_key text NOT NULL, menu_item_id uuid NOT NULL, material_id uuid NOT NULL,
   quantity_base numeric NOT NULL CHECK(quantity_base>0)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_targets_v029,pg_temp.recipe_lines_v029;

 FOR v_recipe IN SELECT value FROM jsonb_array_elements(p_recipes) LOOP
   v_key:=btrim(coalesce(v_recipe->>'key',''));
   v_name:=btrim(coalesce(v_recipe->>'menuName',''));
   IF length(v_key) NOT BETWEEN 2 AND 80 OR length(v_name) NOT BETWEEN 2 AND 250 THEN
      RAISE EXCEPTION 'RECIPE_KEY_OR_NAME_MISSING'; END IF;
   SELECT count(*),(array_agg(mi.id))[1] INTO v_count,v_menu
     FROM public.menu_items mi
     WHERE public.recipe_key_normalize_v027(mi.name)=public.recipe_key_normalize_v027(v_name);
   IF v_count<>1 THEN RAISE EXCEPTION 'MENU_ITEM_NOT_UNIQUE_OR_MISSING: %',v_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.menu_items mi WHERE mi.id=v_menu AND mi.manual_price_original>0) THEN
      RAISE EXCEPTION 'RECIPE_V029_MENU_WITHOUT_POSITIVE_SELLING_PRICE: %',v_name; END IF;
   INSERT INTO pg_temp.recipe_targets_v029(recipe_key,menu_item_id,menu_name)
     VALUES(v_key,v_menu,v_name);
 END LOOP;

 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   v_key:=btrim(coalesce(v_line->>'recipeKey',''));
   SELECT t.menu_item_id INTO v_menu FROM pg_temp.recipe_targets_v029 t WHERE t.recipe_key=v_key;
   IF v_menu IS NULL THEN RAISE EXCEPTION 'RECIPE_LINE_UNKNOWN_KEY: %',v_key; END IF;
   v_material_name:=btrim(coalesce(v_line->>'materialName',''));
   v_unit_name:=btrim(coalesce(v_line->>'baseUnit',''));
   IF length(v_material_name) NOT BETWEEN 2 AND 250 OR length(v_unit_name) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'RECIPE_MATERIAL_OR_UNIT_MISSING: %',v_key; END IF;
   IF coalesce(v_line->>'quantityBase','') !~ '^([0-9]+)([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'RECIPE_INVALID_QUANTITY: %/%',v_key,v_material_name; END IF;
   v_qty:=(v_line->>'quantityBase')::numeric;
   IF v_qty<=0 OR v_qty>10000000 THEN RAISE EXCEPTION 'RECIPE_QUANTITY_OUT_OF_RANGE: %',v_material_name; END IF;
   SELECT count(*),(array_agg(m.id))[1] INTO v_count,v_mat
      FROM public.materials m
      WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_material_name);
   IF v_count>1 THEN RAISE EXCEPTION 'RECIPE_MATERIAL_DUPLICATE_CATALOG: %',v_material_name; END IF;
   -- NEVER create a material from a recipe. v0.29 only accepts catalog materials
   -- with a positive physical stock, positive cost and a valid imported warehouse.
   IF v_count=0 THEN RAISE EXCEPTION 'RECIPE_V029_MATERIAL_MISSING: %',v_material_name; END IF;
   SELECT m.base_unit_id INTO v_unit FROM public.materials m WHERE m.id=v_mat;
   IF NOT public.recipe_unit_matches_v028(v_unit,v_unit_name) THEN
      RAISE EXCEPTION 'RECIPE_V029_UNIT_MISMATCH: % / %',v_material_name,v_unit_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.materials m WHERE m.id=v_mat
      AND m.current_stock_base>0 AND m.last_purchase_unit_cost_base>0) THEN
      RAISE EXCEPTION 'RECIPE_V029_MATERIAL_WITHOUT_STOCK_OR_PRICE: %',v_material_name; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.ameen_inventory_rows_v024 inv
      WHERE inv.core_entity_id=v_mat AND inv.kind='material'
        AND nullif(btrim(inv.warehouse),'') IS NOT NULL
        AND inv.quantity_base>0 AND inv.review_reason IS NULL) THEN
      RAISE EXCEPTION 'RECIPE_V029_MATERIAL_WITHOUT_VALID_WAREHOUSE: %',v_material_name; END IF;
   INSERT INTO pg_temp.recipe_lines_v029(recipe_key,menu_item_id,material_id,quantity_base)
      VALUES(v_key,v_menu,v_mat,v_qty);
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_temp.recipe_targets_v029 t WHERE NOT EXISTS(
     SELECT 1 FROM pg_temp.recipe_lines_v029 x WHERE x.recipe_key=t.recipe_key))
 THEN RAISE EXCEPTION 'RECIPE_MISSING_ALL_MATERIALS'; END IF;
 SELECT count(*) INTO v_existing_count FROM public.menu_item_recipe_items ri
    WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v029 t);
 IF v_existing_count>0 AND NOT p_replace_existing THEN
    RAISE EXCEPTION 'RECIPE_EXISTING_COMPONENTS_REQUIRE_CONFIRMATION: %',v_existing_count; END IF;

 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_desired_v029 (
   menu_item_id uuid NOT NULL,
   material_id uuid NOT NULL,
   base_unit_id uuid NOT NULL,
   qty numeric NOT NULL,
   PRIMARY KEY(menu_item_id,material_id)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_desired_v029;
 INSERT INTO pg_temp.recipe_desired_v029(menu_item_id,material_id,base_unit_id,qty)
 SELECT x.menu_item_id,x.material_id,m.base_unit_id,round(sum(x.quantity_base),8)
   FROM pg_temp.recipe_lines_v029 x JOIN public.materials m ON m.id=x.material_id
  GROUP BY x.menu_item_id,x.material_id,m.base_unit_id;
 IF EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v029 WHERE qty<=0)
 THEN RAISE EXCEPTION 'RECIPE_ROUNDED_TO_ZERO'; END IF;

 -- Save run + state BEFORE modifying rows, in the same atomic transaction.
 INSERT INTO public.recipe_import_runs_v028(file_sha256,recipe_count,material_line_count)
 VALUES(p_sha256,(SELECT count(*) FROM pg_temp.recipe_targets_v029),
        (SELECT count(*) FROM pg_temp.recipe_lines_v029))
 RETURNING id INTO v_run;
 INSERT INTO public.recipe_import_backups_v028(run_id,menu_item_id,original_recipe)
 SELECT v_run,t.menu_item_id,
   coalesce((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id)
     FROM public.menu_item_recipe_items ri WHERE ri.menu_item_id=t.menu_item_id),'[]'::jsonb)
 FROM pg_temp.recipe_targets_v029 t;

 -- Preserve row IDs when ingredient and quantity are unchanged. New/changed rows
 -- pass through the existing owner-only v0.7 validated recipe writer.
 FOR v_row IN
   SELECT d.menu_item_id,d.material_id,d.base_unit_id,d.qty,
       ri.id AS existing_id,ri.quantity_base AS existing_qty,
       ri.input_quantity AS existing_input_qty,ri.input_unit_id AS existing_input_unit_id
   FROM pg_temp.recipe_desired_v029 d
   LEFT JOIN public.menu_item_recipe_items ri
      ON ri.menu_item_id=d.menu_item_id AND ri.material_id=d.material_id
 LOOP
   IF v_row.existing_id IS NULL THEN
      PERFORM public.save_menu_recipe_item_v07(v_row.menu_item_id,v_row.material_id,
                 v_row.base_unit_id,v_row.qty,NULL);
      v_inserted:=v_inserted+1;
   ELSIF v_row.existing_qty IS DISTINCT FROM v_row.qty
      OR v_row.existing_input_qty IS DISTINCT FROM v_row.qty
      OR v_row.existing_input_unit_id IS DISTINCT FROM v_row.base_unit_id THEN
      PERFORM public.save_menu_recipe_item_v07(v_row.menu_item_id,v_row.material_id,
                 v_row.base_unit_id,v_row.qty,v_row.existing_id);
      v_updated:=v_updated+1;
   ELSE
      v_unchanged:=v_unchanged+1;
   END IF;
 END LOOP;

 -- Delete ONLY ingredients absent from the new approved file, after backup and confirmation.
 DELETE FROM public.menu_item_recipe_items ri
  WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v029 t)
    AND NOT EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v029 d
      WHERE d.menu_item_id=ri.menu_item_id AND d.material_id=ri.material_id);
 GET DIAGNOSTICS v_removed = ROW_COUNT;

 -- Price is ALWAYS read live from matched materials.last_purchase_unit_cost_base.
 -- Never update materials.last_purchase_unit_cost_base from the Excel's zero prices.
 SELECT count(*),count(*) FILTER(WHERE m.last_purchase_unit_cost_base>0),
   count(*) FILTER(WHERE (m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0))
 INTO v_distinct_materials,v_priced_materials,v_missing_materials
 FROM public.materials m WHERE m.id IN (SELECT DISTINCT d.material_id FROM pg_temp.recipe_desired_v029 d);
 SELECT count(*) INTO v_covered_recipes
 FROM pg_temp.recipe_targets_v029 t WHERE NOT EXISTS(
   SELECT 1 FROM pg_temp.recipe_desired_v029 d JOIN public.materials m ON m.id=d.material_id
   WHERE d.menu_item_id=t.menu_item_id AND (m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0)
 );

 v_summary:=jsonb_build_object(
   'recipesImported',(SELECT count(*) FROM pg_temp.recipe_targets_v029),'sourceLines',(SELECT count(*) FROM pg_temp.recipe_lines_v029),
   'matchedMaterials',v_distinct_materials,'pricedMaterials',v_priced_materials,
   'missingPriceMaterials',v_missing_materials,'recipesFullyPriced',v_covered_recipes,
   'materialsCreated',v_created,'linesInserted',v_inserted,'linesUpdated',v_updated,
   'linesRemoved',v_removed,'linesUnchanged',v_unchanged,'duplicateFile',false,
   'note','v0.29: only entirely priced and stocked recipes in a physical warehouse, sale price >0, no unpriced material creation.'
 );
 UPDATE public.recipe_import_runs_v028 SET summary=v_summary WHERE id=v_run;
 RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION public.import_menu_recipes_v029(text,jsonb,jsonb,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_menu_recipes_v029(text,jsonb,jsonb,boolean) TO authenticated;
COMMENT ON FUNCTION public.import_menu_recipes_v029(text,jsonb,jsonb,boolean) IS
 'v0.29: atomic selective import, refuses missing/zero material costs, missing stock/warehouse, and zero menu selling prices.';
COMMIT;
