-- Maria CFO Web v0.28 — repeatable recipe import and current material-price matching.
-- Apply AFTER the existing v0.27 recipe-import migration. Does not replace its function/history.
-- Run with SQL Editor (postgres role), AFTER taking a Supabase database backup.
-- This migration NEVER posts stock movements, changes material prices, or alters historical sales.
BEGIN;

CREATE TABLE IF NOT EXISTS public.recipe_import_runs_v028 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  recipe_count integer NOT NULL CHECK(recipe_count BETWEEN 1 AND 500),
  material_line_count integer NOT NULL CHECK(material_line_count BETWEEN 1 AND 10000),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS recipe_import_runs_v028_imported_at_idx
  ON public.recipe_import_runs_v028(imported_at DESC);

-- A separate backup PER re-import, including an unchanged re-import. Never overwrite v0.27 backups.
CREATE TABLE IF NOT EXISTS public.recipe_import_backups_v028 (
  run_id uuid NOT NULL REFERENCES public.recipe_import_runs_v028(id) ON DELETE RESTRICT,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  original_recipe jsonb NOT NULL,
  PRIMARY KEY (run_id,menu_item_id)
);

ALTER TABLE public.recipe_import_runs_v028 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_import_backups_v028 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recipe_import_runs_v028 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.recipe_import_backups_v028 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.recipe_import_runs_v028, public.recipe_import_backups_v028 TO authenticated;
DROP POLICY IF EXISTS recipe_import_runs_owner_read_v028 ON public.recipe_import_runs_v028;
CREATE POLICY recipe_import_runs_owner_read_v028 ON public.recipe_import_runs_v028
  FOR SELECT TO authenticated USING (public.is_app_owner());
DROP POLICY IF EXISTS recipe_import_backups_owner_read_v028 ON public.recipe_import_backups_v028;
CREATE POLICY recipe_import_backups_owner_read_v028 ON public.recipe_import_backups_v028
  FOR SELECT TO authenticated USING (public.is_app_owner());

-- Alias matching compares equivalent base-unit LABELS only. No KG/G or L/ML quantity conversion.
CREATE OR REPLACE FUNCTION public.recipe_unit_code_v028(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE public.normalize_unit_name_v018(p_name)
  WHEN 'غرام' THEN 'G' WHEN 'غ' THEN 'G' WHEN 'جرام' THEN 'G' WHEN 'g' THEN 'G'
  WHEN 'كغ' THEN 'KG' WHEN 'كيلو' THEN 'KG' WHEN 'كيلوغرام' THEN 'KG' WHEN 'kg' THEN 'KG'
  WHEN 'لتر' THEN 'L' WHEN 'l' THEN 'L'
  WHEN 'مل' THEN 'ML' WHEN 'مليلتر' THEN 'ML' WHEN 'ml' THEN 'ML'
  WHEN 'قطعه' THEN 'PCS' WHEN 'قطعة' THEN 'PCS' WHEN 'حبه' THEN 'PCS' WHEN 'حبة' THEN 'PCS' WHEN 'pcs' THEN 'PCS'
  WHEN 'صندوق' THEN 'BOX' WHEN 'box' THEN 'BOX'
  WHEN 'كرتون' THEN 'CARTON' WHEN 'كرتونه' THEN 'CARTON' WHEN 'كرتونة' THEN 'CARTON' WHEN 'carton' THEN 'CARTON'
  WHEN 'كيس' THEN 'BAG' WHEN 'bag' THEN 'BAG'
  WHEN 'دزينه' THEN 'DOZ' WHEN 'دزينة' THEN 'DOZ' WHEN 'doz' THEN 'DOZ'
  WHEN 'كاسه' THEN 'GLASS' WHEN 'كاسة' THEN 'GLASS' WHEN 'كاس' THEN 'GLASS' WHEN 'glass' THEN 'GLASS'
  WHEN 'كوب' THEN 'CUP' WHEN 'cup' THEN 'CUP'
  WHEN 'صحن' THEN 'TRAY' WHEN 'tray' THEN 'TRAY'
  WHEN 'طرد' THEN 'PACK' WHEN 'عبوة' THEN 'PACK' WHEN 'pack' THEN 'PACK'
  ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION public.recipe_unit_matches_v028(p_existing_unit_id uuid, p_input_name text)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT
   public.normalize_unit_name_v018(u.name)=public.normalize_unit_name_v018(p_input_name)
   OR (u.is_material_specific IS NOT TRUE
       AND public.recipe_unit_code_v028(p_input_name) IS NOT NULL
       AND upper(u.code)=public.recipe_unit_code_v028(p_input_name))
   FROM public.units u WHERE u.id=p_existing_unit_id),false);
$$;
REVOKE ALL ON FUNCTION public.recipe_unit_code_v028(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recipe_unit_matches_v028(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.import_menu_recipes_v028(
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
 IF jsonb_array_length(p_recipes)<>75 THEN RAISE EXCEPTION 'RECIPES_EXPECT_75_MENU_ITEMS'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 75 AND 10000 THEN RAISE EXCEPTION 'RECIPES_INVALID_LINES'; END IF;

 -- Same lock key used by v0.27: never interleave two full-file imports.
 PERFORM pg_advisory_xact_lock(hashtext('maria_recipes_v027_atomic'));
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_targets_v028 (
   recipe_key text PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
   menu_name text NOT NULL
 ) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_lines_v028 (
   recipe_key text NOT NULL, menu_item_id uuid NOT NULL, material_id uuid NOT NULL,
   quantity_base numeric NOT NULL CHECK(quantity_base>0)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_targets_v028,pg_temp.recipe_lines_v028;

 FOR v_recipe IN SELECT value FROM jsonb_array_elements(p_recipes) LOOP
   v_key:=btrim(coalesce(v_recipe->>'key',''));
   v_name:=btrim(coalesce(v_recipe->>'menuName',''));
   IF length(v_key) NOT BETWEEN 2 AND 80 OR length(v_name) NOT BETWEEN 2 AND 250 THEN
      RAISE EXCEPTION 'RECIPE_KEY_OR_NAME_MISSING'; END IF;
   SELECT count(*),(array_agg(mi.id))[1] INTO v_count,v_menu
     FROM public.menu_items mi
     WHERE public.recipe_key_normalize_v027(mi.name)=public.recipe_key_normalize_v027(v_name);
   IF v_count<>1 THEN RAISE EXCEPTION 'MENU_ITEM_NOT_UNIQUE_OR_MISSING: %',v_name; END IF;
   INSERT INTO pg_temp.recipe_targets_v028(recipe_key,menu_item_id,menu_name)
     VALUES(v_key,v_menu,v_name);
 END LOOP;

 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   v_key:=btrim(coalesce(v_line->>'recipeKey',''));
   SELECT t.menu_item_id INTO v_menu FROM pg_temp.recipe_targets_v028 t WHERE t.recipe_key=v_key;
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
   IF v_count=0 THEN
      IF NOT coalesce((v_line->>'newMaterial')::boolean,false) THEN
        RAISE EXCEPTION 'RECIPE_MATERIAL_NOT_IN_CATALOG: %',v_material_name; END IF;
      -- ONLY truly absent materials may be created. No price, no opening balance.
      v_unit:=public.ameen_unit_v024(v_unit_name);
      IF v_unit IS NULL THEN RAISE EXCEPTION 'RECIPE_BASE_UNIT_NOT_FOUND: %',v_unit_name; END IF;
      INSERT INTO public.materials(name,code,base_unit_id)
        VALUES(v_material_name,'RC28-'||upper(substr(md5(v_material_name),1,14)),v_unit)
        RETURNING id INTO v_mat;
      v_created:=v_created+1;
   ELSE
      SELECT m.base_unit_id INTO v_unit FROM public.materials m WHERE m.id=v_mat;
      IF NOT public.recipe_unit_matches_v028(v_unit,v_unit_name) THEN
        RAISE EXCEPTION 'RECIPE_STOCK_UNIT_CHANGED: % / %',v_material_name,v_unit_name; END IF;
   END IF;
   INSERT INTO pg_temp.recipe_lines_v028(recipe_key,menu_item_id,material_id,quantity_base)
      VALUES(v_key,v_menu,v_mat,v_qty);
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_temp.recipe_targets_v028 t WHERE NOT EXISTS(
     SELECT 1 FROM pg_temp.recipe_lines_v028 x WHERE x.recipe_key=t.recipe_key))
 THEN RAISE EXCEPTION 'RECIPE_MISSING_ALL_MATERIALS'; END IF;
 SELECT count(*) INTO v_existing_count FROM public.menu_item_recipe_items ri
    WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v028 t);
 IF v_existing_count>0 AND NOT p_replace_existing THEN
    RAISE EXCEPTION 'RECIPE_EXISTING_COMPONENTS_REQUIRE_CONFIRMATION: %',v_existing_count; END IF;

 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_desired_v028 (
   menu_item_id uuid NOT NULL,
   material_id uuid NOT NULL,
   base_unit_id uuid NOT NULL,
   qty numeric NOT NULL,
   PRIMARY KEY(menu_item_id,material_id)
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_desired_v028;
 INSERT INTO pg_temp.recipe_desired_v028(menu_item_id,material_id,base_unit_id,qty)
 SELECT x.menu_item_id,x.material_id,m.base_unit_id,round(sum(x.quantity_base),8)
   FROM pg_temp.recipe_lines_v028 x JOIN public.materials m ON m.id=x.material_id
  GROUP BY x.menu_item_id,x.material_id,m.base_unit_id;
 IF EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v028 WHERE qty<=0)
 THEN RAISE EXCEPTION 'RECIPE_ROUNDED_TO_ZERO'; END IF;

 -- Save run + state BEFORE modifying rows, in the same atomic transaction.
 INSERT INTO public.recipe_import_runs_v028(file_sha256,recipe_count,material_line_count)
 VALUES(p_sha256,(SELECT count(*) FROM pg_temp.recipe_targets_v028),
        (SELECT count(*) FROM pg_temp.recipe_lines_v028))
 RETURNING id INTO v_run;
 INSERT INTO public.recipe_import_backups_v028(run_id,menu_item_id,original_recipe)
 SELECT v_run,t.menu_item_id,
   coalesce((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id)
     FROM public.menu_item_recipe_items ri WHERE ri.menu_item_id=t.menu_item_id),'[]'::jsonb)
 FROM pg_temp.recipe_targets_v028 t;

 -- Preserve row IDs when ingredient and quantity are unchanged. New/changed rows
 -- pass through the existing owner-only v0.7 validated recipe writer.
 FOR v_row IN
   SELECT d.menu_item_id,d.material_id,d.base_unit_id,d.qty,
       ri.id AS existing_id,ri.quantity_base AS existing_qty,
       ri.input_quantity AS existing_input_qty,ri.input_unit_id AS existing_input_unit_id
   FROM pg_temp.recipe_desired_v028 d
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
  WHERE ri.menu_item_id IN (SELECT t.menu_item_id FROM pg_temp.recipe_targets_v028 t)
    AND NOT EXISTS(SELECT 1 FROM pg_temp.recipe_desired_v028 d
      WHERE d.menu_item_id=ri.menu_item_id AND d.material_id=ri.material_id);
 GET DIAGNOSTICS v_removed = ROW_COUNT;

 -- Price is ALWAYS read live from matched materials.last_purchase_unit_cost_base.
 -- Never update materials.last_purchase_unit_cost_base from the Excel's zero prices.
 SELECT count(*),count(*) FILTER(WHERE m.last_purchase_unit_cost_base IS NOT NULL),
   count(*) FILTER(WHERE m.last_purchase_unit_cost_base IS NULL)
 INTO v_distinct_materials,v_priced_materials,v_missing_materials
 FROM public.materials m WHERE m.id IN (SELECT DISTINCT d.material_id FROM pg_temp.recipe_desired_v028 d);
 SELECT count(*) INTO v_covered_recipes
 FROM pg_temp.recipe_targets_v028 t WHERE NOT EXISTS(
   SELECT 1 FROM pg_temp.recipe_desired_v028 d JOIN public.materials m ON m.id=d.material_id
   WHERE d.menu_item_id=t.menu_item_id AND m.last_purchase_unit_cost_base IS NULL
 );

 v_summary:=jsonb_build_object(
   'recipesImported',75,'sourceLines',(SELECT count(*) FROM pg_temp.recipe_lines_v028),
   'matchedMaterials',v_distinct_materials,'pricedMaterials',v_priced_materials,
   'missingPriceMaterials',v_missing_materials,'recipesFullyPriced',v_covered_recipes,
   'materialsCreated',v_created,'linesInserted',v_inserted,'linesUpdated',v_updated,
   'linesRemoved',v_removed,'linesUnchanged',v_unchanged,'duplicateFile',false,
   'note','Same SHA can be re-imported. Matched material prices are read live; no prices, stock or historic ledgers modified.'
 );
 UPDATE public.recipe_import_runs_v028 SET summary=v_summary WHERE id=v_run;
 RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION public.import_menu_recipes_v028(text,jsonb,jsonb,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_menu_recipes_v028(text,jsonb,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.recipe_import_history_v028()
RETURNS SETOF public.recipe_import_runs_v028
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.* FROM public.recipe_import_runs_v028 r
 WHERE public.is_app_owner() ORDER BY r.imported_at DESC,r.id DESC LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.recipe_import_history_v028() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_import_history_v028() TO authenticated;
COMMENT ON FUNCTION public.import_menu_recipes_v028(text,jsonb,jsonb,boolean) IS
 'v0.28: owner-only atomic differential reimport of 75 recipes, current costs from materials.last_purchase_unit_cost_base; never changes materials prices, stock, orders, or historical costs.';
COMMIT;
