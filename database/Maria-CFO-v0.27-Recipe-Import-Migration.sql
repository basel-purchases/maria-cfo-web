-- Maria CFO v0.27: atomic one-time import of 75 approved existing-menu recipes.
-- Branches directly from v0.25. Does NOT require/modify v0.26 schema.
-- Execute in a test Supabase DB first; never runs order posting or stock adjustments.
BEGIN;

CREATE TABLE IF NOT EXISTS public.recipe_import_batches_v027 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_sha256 text NOT NULL UNIQUE CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  recipe_count integer NOT NULL CHECK(recipe_count BETWEEN 1 AND 500),
  material_line_count integer NOT NULL CHECK(material_line_count BETWEEN 1 AND 10000),
  created_materials integer NOT NULL DEFAULT 0,
  replaced_recipes integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.recipe_import_details_v027 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.recipe_import_batches_v027(id) ON DELETE CASCADE,
  recipe_key text NOT NULL,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  quantity_base numeric NOT NULL CHECK(quantity_base>0),
  material_name text NOT NULL,
  assumption text,
  source_rows text,
  created_material boolean NOT NULL DEFAULT false,
  UNIQUE(batch_id,recipe_key,material_id)
);

CREATE TABLE IF NOT EXISTS public.recipe_import_backups_v027 (
  menu_item_id uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  original_recipe jsonb NOT NULL DEFAULT '[]'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipe_import_batches_v027','recipe_import_details_v027','recipe_import_backups_v027'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('DROP POLICY IF EXISTS recipe_owner_read_v027 ON public.%I',t);
    EXECUTE format('CREATE POLICY recipe_owner_read_v027 ON public.%I FOR SELECT TO authenticated USING(public.is_app_owner())',t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.recipe_key_normalize_v027(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT lower(regexp_replace(btrim(coalesce(p_value,'')),'[[:space:]]+',' ','g'));
$$;
REVOKE ALL ON FUNCTION public.recipe_key_normalize_v027(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recipe_key_normalize_v027(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_menu_recipes_v027(
  p_sha256 text,
  p_recipes jsonb,
  p_lines jsonb,
  p_replace_existing boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_recipe jsonb;v_line jsonb;v_menu uuid;v_mat uuid;v_unit uuid;v_name text;v_key text;
  v_mname text;v_munit text;v_existing_unit text;v_qty numeric;
  v_created integer:=0;v_replaced integer:=0;v_batch uuid;v_result jsonb;
  v_prev integer;v_count integer;v_mat_count integer;v_isnew boolean;v_old jsonb;
  v_group record;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'RECIPES_ACCESS_DENIED'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'RECIPES_INVALID_SHA256'; END IF;
 IF jsonb_typeof(p_recipes)<>'array' OR jsonb_typeof(p_lines)<>'array' THEN
  RAISE EXCEPTION 'RECIPES_EXPECT_ARRAYS'; END IF;
 IF jsonb_array_length(p_recipes)<>75 THEN RAISE EXCEPTION 'RECIPES_EXPECT_75_MENU_ITEMS'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 75 AND 10000 THEN RAISE EXCEPTION 'RECIPES_INVALID_LINES'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('maria_recipes_v027_atomic'));
 SELECT b.summary INTO v_result FROM public.recipe_import_batches_v027 b WHERE b.file_sha256=p_sha256;
 IF FOUND THEN RETURN v_result || jsonb_build_object('duplicateFile',true); END IF;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_target_v027 (
  recipe_key text PRIMARY KEY,menu_item_id uuid NOT NULL UNIQUE,menu_name text NOT NULL
 ) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.recipe_lines_v027 (
  recipe_key text NOT NULL,menu_item_id uuid NOT NULL,material_id uuid NOT NULL,
  material_name text NOT NULL,quantity_base numeric NOT NULL,source_rows text,
  assumption text,created_material boolean NOT NULL DEFAULT false
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp.recipe_target_v027, pg_temp.recipe_lines_v027;

 FOR v_recipe IN SELECT value FROM jsonb_array_elements(p_recipes) LOOP
   v_key:=btrim(coalesce(v_recipe->>'key',''));
   v_name:=btrim(coalesce(v_recipe->>'menuName',''));
   IF length(v_key) NOT BETWEEN 2 AND 80 OR length(v_name) NOT BETWEEN 2 AND 250 THEN
     RAISE EXCEPTION 'RECIPE_KEY_OR_NAME_MISSING'; END IF;
   SELECT count(*),(array_agg(id))[1] INTO v_count,v_menu FROM public.menu_items
     WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name);
   IF v_count<>1 THEN RAISE EXCEPTION 'MENU_ITEM_NOT_UNIQUE_OR_MISSING: %',v_name; END IF;
   INSERT INTO pg_temp.recipe_target_v027(recipe_key,menu_item_id,menu_name)
   VALUES(v_key,v_menu,v_name);
 END LOOP;

 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   v_key:=btrim(coalesce(v_line->>'recipeKey',''));
   SELECT menu_item_id INTO v_menu FROM pg_temp.recipe_target_v027 WHERE recipe_key=v_key;
   IF v_menu IS NULL THEN RAISE EXCEPTION 'RECIPE_LINE_UNKNOWN_KEY: %',v_key; END IF;
   v_mname:=btrim(coalesce(v_line->>'materialName',''));
   v_munit:=btrim(coalesce(v_line->>'baseUnit',''));
   IF length(v_mname) NOT BETWEEN 2 AND 250 OR length(v_munit) NOT BETWEEN 1 AND 100 THEN
     RAISE EXCEPTION 'RECIPE_MATERIAL_OR_UNIT_MISSING: %',v_key; END IF;
   IF coalesce(v_line->>'quantityBase','') !~ '^([0-9]+)([.][0-9]+)?$' THEN
     RAISE EXCEPTION 'RECIPE_INVALID_QUANTITY: %/%',v_key,v_mname;
   END IF;
   v_qty:=(v_line->>'quantityBase')::numeric;
   IF v_qty<=0 OR v_qty>10000000 THEN RAISE EXCEPTION 'RECIPE_QUANTITY_OUT_OF_RANGE: %',v_mname; END IF;
   SELECT count(*),(array_agg(m.id))[1] INTO v_count,v_mat FROM public.materials m
     WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_mname);
   IF v_count>1 THEN RAISE EXCEPTION 'RECIPE_MATERIAL_DUPLICATE_CATALOG: %',v_mname; END IF;
   v_isnew:=false;
   IF v_count=0 THEN
      IF NOT coalesce((v_line->>'newMaterial')::boolean,false) THEN
        RAISE EXCEPTION 'RECIPE_MATERIAL_NOT_IN_CATALOG: %',v_mname; END IF;
      -- Use the v0.24 shared-unit helper to ensure a valid base unit without changing existing materials.
      v_unit:=public.ameen_unit_v024(v_munit);
      IF v_unit IS NULL THEN RAISE EXCEPTION 'RECIPE_BASE_UNIT_NOT_FOUND: %',v_munit; END IF;
      INSERT INTO public.materials(name,code,base_unit_id)
      VALUES(v_mname,'RC27-'||upper(substr(md5(v_mname),1,14)),v_unit)
      RETURNING id INTO v_mat;
      v_created:=v_created+1;
      v_isnew:=true;
   ELSE
      SELECT u.name INTO v_existing_unit FROM public.materials m
        JOIN public.units u ON u.id=m.base_unit_id WHERE m.id=v_mat;
      IF public.recipe_key_normalize_v027(v_existing_unit) <> public.recipe_key_normalize_v027(v_munit) THEN
        RAISE EXCEPTION 'RECIPE_STOCK_UNIT_CHANGED: % expected %, got %',v_mname,v_munit,v_existing_unit;
      END IF;
   END IF;
   INSERT INTO pg_temp.recipe_lines_v027(recipe_key,menu_item_id,material_id,material_name,
      quantity_base,source_rows,assumption,created_material)
    VALUES(v_key,v_menu,v_mat,v_mname,v_qty,left(coalesce(v_line->>'sourceRows',''),500),
      left(coalesce(v_line->>'assumption',''),600),v_isnew);
 END LOOP;

 IF EXISTS(SELECT 1 FROM pg_temp.recipe_target_v027 t WHERE NOT EXISTS(
      SELECT 1 FROM pg_temp.recipe_lines_v027 x WHERE x.recipe_key=t.recipe_key))
 THEN RAISE EXCEPTION 'RECIPE_MISSING_ALL_MATERIALS'; END IF;
 SELECT count(*) INTO v_prev FROM public.menu_item_recipe_items old
   WHERE old.menu_item_id IN (SELECT menu_item_id FROM pg_temp.recipe_target_v027);
 IF v_prev>0 AND NOT p_replace_existing THEN
   RAISE EXCEPTION 'RECIPE_EXISTING_COMPONENTS_REQUIRE_CONFIRMATION: %',v_prev;
 END IF;

 -- Keep one permanent copy of the original recipe rows for every menu item.
 INSERT INTO public.recipe_import_backups_v027(menu_item_id,original_recipe)
 SELECT t.menu_item_id,
    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
         FROM public.menu_item_recipe_items i WHERE i.menu_item_id=t.menu_item_id),'[]'::jsonb)
 FROM pg_temp.recipe_target_v027 t
 ON CONFLICT(menu_item_id) DO NOTHING;

 SELECT count(DISTINCT menu_item_id) INTO v_replaced FROM public.menu_item_recipe_items
 WHERE menu_item_id IN (SELECT menu_item_id FROM pg_temp.recipe_target_v027);

 DELETE FROM public.menu_item_recipe_items WHERE menu_item_id IN (
    SELECT menu_item_id FROM pg_temp.recipe_target_v027);

 -- Reuse the existing v0.7 posting-compatible RPC: it detects which recipe quantity
 -- columns the deployed Maria CFO schema has (quantity_base vs quantity_in_base etc).
 -- This avoids hardcoding one legacy schema and uses the exact same conversion rules
 -- as the ordinary v0.25 recipe editor, inside this single transaction.
 FOR v_group IN
    SELECT x.menu_item_id,x.material_id,m.base_unit_id AS base_unit_id,
           round(sum(x.quantity_base),8) AS qty
    FROM pg_temp.recipe_lines_v027 x
    JOIN public.materials m ON m.id=x.material_id
    GROUP BY x.menu_item_id,x.material_id,m.base_unit_id
 LOOP
    IF v_group.qty<=0 THEN RAISE EXCEPTION 'RECIPE_ROUNDED_TO_ZERO'; END IF;
    PERFORM public.save_menu_recipe_item_v07(v_group.menu_item_id,
            v_group.material_id,v_group.base_unit_id,v_group.qty,NULL);
 END LOOP;

 INSERT INTO public.recipe_import_batches_v027(file_sha256,recipe_count,material_line_count,
   created_materials,replaced_recipes,summary)
 VALUES(p_sha256,(SELECT count(*) FROM pg_temp.recipe_target_v027),
   (SELECT count(*) FROM pg_temp.recipe_lines_v027),v_created,v_replaced,
   jsonb_build_object('recipesImported',75,'sourceLines',(SELECT count(*) FROM pg_temp.recipe_lines_v027),
     'materialsCreated',v_created,'existingRecipesReplaced',v_replaced,'duplicateFile',false,
     'note','No stock changes or historical order edits; unknown costs remain unknown.'))
 RETURNING id,summary INTO v_batch,v_result;

 INSERT INTO public.recipe_import_details_v027(batch_id,recipe_key,menu_item_id,
      material_id,quantity_base,material_name,assumption,source_rows,created_material)
 SELECT v_batch,x.recipe_key,x.menu_item_id,x.material_id,
   round(sum(x.quantity_base),8),x.material_name,string_agg(DISTINCT x.assumption,' ; '),
   string_agg(DISTINCT x.source_rows,','),bool_or(x.created_material)
 FROM pg_temp.recipe_lines_v027 x
 GROUP BY x.recipe_key,x.menu_item_id,x.material_id,x.material_name;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.import_menu_recipes_v027(text,jsonb,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_menu_recipes_v027(text,jsonb,jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.recipe_import_history_v027()
RETURNS SETOF public.recipe_import_batches_v027
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT b.* FROM public.recipe_import_batches_v027 b
   WHERE public.is_app_owner() ORDER BY b.imported_at DESC LIMIT 30;
$$;
REVOKE ALL ON FUNCTION public.recipe_import_history_v027() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recipe_import_history_v027() TO authenticated;

COMMENT ON FUNCTION public.import_menu_recipes_v027(text,jsonb,jsonb,boolean) IS
  'Owner-only transactional import of 75 existing-menu material-only recipes; catalog-only new materials get zero opening balance and unknown cost. The v0.25 stock and order posting functions are unchanged.';
COMMIT;
