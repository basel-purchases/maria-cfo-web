-- Maria CFO Web v1.0.33 | stock issuance independent of price availability;
-- non-destructive menu merge and guarded delete of truly unused menu entries.
-- Requires tested v1.0.32 migrations. Test against a database clone before production.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='180s';
DO $preflight$
BEGIN
 IF to_regclass('public.v131_sale_cost_queue') IS NULL
 OR to_regclass('public.menu_item_aliases_v104') IS NULL
 OR to_regprocedure('public.v131_complete_sale_cost(uuid)') IS NULL
 OR to_regprocedure('public.v132_auto_link_sale_queue()') IS NULL
 THEN RAISE EXCEPTION 'V133_REQUIRES_V132_AND_V131'; END IF;
END;
$preflight$;

-- The old row remains for foreign-key integrity and historical attribution.
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS is_archived_v133 boolean NOT NULL DEFAULT false;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS merged_into_menu_id_v133 uuid REFERENCES public.menu_items(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS menu_items_active_v133_idx ON public.menu_items(is_archived_v133,name);
CREATE TABLE IF NOT EXISTS public.v133_menu_merge_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_menu_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 target_menu_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 source_name text NOT NULL,
 target_name text NOT NULL,
 moved_pending_sales integer NOT NULL DEFAULT 0,
 historical_ameen_links_preserved integer NOT NULL DEFAULT 0,
 recipe_transferred boolean NOT NULL DEFAULT false,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v133_distinct_merge CHECK(source_menu_id<>target_menu_id),
 UNIQUE(source_menu_id)
);
CREATE TABLE IF NOT EXISTS public.v133_menu_delete_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deleted_menu_id uuid NOT NULL UNIQUE,
 deleted_name text NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.v133_menu_merge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v133_menu_delete_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v133_menu_merge_read_owner ON public.v133_menu_merge_history;
CREATE POLICY v133_menu_merge_read_owner ON public.v133_menu_merge_history FOR SELECT TO authenticated USING(public.is_app_owner());
DROP POLICY IF EXISTS v133_menu_delete_read_owner ON public.v133_menu_delete_history;
CREATE POLICY v133_menu_delete_read_owner ON public.v133_menu_delete_history FOR SELECT TO authenticated USING(public.is_app_owner());
REVOKE ALL ON public.v133_menu_merge_history,public.v133_menu_delete_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v133_menu_merge_history,public.v133_menu_delete_history TO authenticated;

-- Alias validation understands the original primary name of an archived merged entry.
CREATE OR REPLACE FUNCTION public.menu_alias_validate_v104(p_menu_id uuid,p_name text)
RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $validate$
DECLARE v_key text;
BEGIN
 v_key:=public.menu_alias_normalize_v104(p_name);
 IF p_menu_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_id AND NOT is_archived_v133)
 THEN RAISE EXCEPTION 'MENU_ALIAS_TARGET_NOT_ACTIVE'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 180 OR v_key=''
 THEN RAISE EXCEPTION 'MENU_ALIAS_INVALID_NAME'; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_items m WHERE m.id<>p_menu_id
  AND public.menu_alias_normalize_v104(m.name)=v_key
  AND (NOT m.is_archived_v133 OR m.merged_into_menu_id_v133 IS DISTINCT FROM p_menu_id))
 THEN RAISE EXCEPTION 'MENU_ALIAS_COLLIDES_WITH_MENU_NAME: %',p_name; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a WHERE a.alias_key=v_key AND a.menu_item_id<>p_menu_id)
 THEN RAISE EXCEPTION 'MENU_ALIAS_USED_BY_ANOTHER_ITEM: %',p_name; END IF;
 RETURN v_key;
END;
$validate$;
REVOKE ALL ON FUNCTION public.menu_alias_validate_v104(uuid,text) FROM PUBLIC,anon,authenticated;

-- After a merge, a surviving menu item may be renamed to a former merged alias.
CREATE OR REPLACE FUNCTION public.menu_save_v104(p_menu_id uuid,p_name text,
 p_category_id uuid,p_price numeric,p_food_cost numeric,p_discount numeric,
 p_estimate numeric,p_aliases text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_new_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 250
 THEN RAISE EXCEPTION 'MENU_NAME_INVALID'; END IF;
 IF p_menu_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.menu_items
     WHERE id=p_menu_id AND is_archived_v133)
 THEN RAISE EXCEPTION 'V133_CANNOT_EDIT_ARCHIVED_MENU'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 v_new_key:=public.menu_alias_normalize_v104(p_name);
 IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
    WHERE a.alias_key=v_new_key AND a.menu_item_id IS DISTINCT FROM p_menu_id)
 THEN RAISE EXCEPTION 'MENU_NAME_COLLIDES_WITH_ALIAS'; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_items m
    WHERE m.id IS DISTINCT FROM p_menu_id AND public.menu_alias_normalize_v104(m.name)=v_new_key
      AND (NOT m.is_archived_v133 OR m.merged_into_menu_id_v133 IS DISTINCT FROM p_menu_id))
 THEN RAISE EXCEPTION 'MENU_NAME_ALREADY_EXISTS'; END IF;
 IF p_menu_id IS NULL THEN
   INSERT INTO public.menu_items(name,category_id,manual_price_original,target_food_cost_percent,default_discount_percent)
    VALUES(btrim(p_name),p_category_id,p_price,p_food_cost,coalesce(p_discount,0)) RETURNING id INTO v_id;
 ELSE
   UPDATE public.menu_items SET name=btrim(p_name),category_id=p_category_id,
     manual_price_original=p_price,target_food_cost_percent=p_food_cost,
     default_discount_percent=coalesce(p_discount,0)
   WHERE id=p_menu_id RETURNING id INTO v_id;
   IF v_id IS NULL THEN RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND'; END IF;
 END IF;
 PERFORM public.menu_aliases_set_v104(v_id,p_aliases);
 PERFORM public.menu_set_estimate_v041(v_id,p_estimate);
 RETURN v_id;
END;$$;

-- The searchable catalog MUST exclude archived duplicates (keep its v1.0.5 column order).
CREATE OR REPLACE VIEW public.menu_item_search_v104 WITH (security_invoker=true) AS
 SELECT mi.id,mi.name,mi.category_id,coalesce(s.cost_is_missing,false) AS cost_is_missing,
   concat_ws(' ',mi.name,coalesce(string_agg(a.alias_name,' ' ORDER BY a.alias_name),'')) AS search_text,
   coalesce(string_agg(a.alias_name,' · ' ORDER BY a.alias_name),'') AS aliases_text,
   mi.manual_price_original AS menu_price
 FROM public.menu_items mi
 LEFT JOIN public.menu_item_aliases_v104 a ON a.menu_item_id=mi.id
 LEFT JOIN public.menu_cost_status_v041 s ON s.id=mi.id
 WHERE public.is_app_owner() AND NOT mi.is_archived_v133
 GROUP BY mi.id,mi.name,mi.category_id,s.cost_is_missing;
REVOKE ALL ON public.menu_item_search_v104 FROM PUBLIC,anon;
GRANT SELECT ON public.menu_item_search_v104 TO authenticated;

-- The menu identifier resolver ignores old archived primary names so their
-- canonical names now correctly resolve as aliases of the surviving dish.
CREATE OR REPLACE FUNCTION public.menu_match_v104(p_name text)
RETURNS TABLE(menu_id uuid,match_kind text,candidate_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $match$
 WITH names AS (SELECT public.menu_alias_normalize_v104(p_name) AS original,
      public.menu_strip_leading_unit_v104(p_name) AS stripped),
 candidates AS (
  SELECT mi.id,1 AS priority,'canonical'::text AS kind FROM public.menu_items mi,names n
  WHERE NOT mi.is_archived_v133 AND public.menu_alias_normalize_v104(mi.name)=n.original AND n.original<>''
  UNION ALL
  SELECT a.menu_item_id,2,'alias' FROM public.menu_item_aliases_v104 a
    JOIN public.menu_items mi ON mi.id=a.menu_item_id,names n
  WHERE NOT mi.is_archived_v133 AND a.alias_key=n.original AND n.original<>''
  UNION ALL
  SELECT mi.id,3,'unit_prefix' FROM public.menu_items mi,names n
  WHERE NOT mi.is_archived_v133 AND n.original<>n.stripped AND n.stripped<>''
    AND public.menu_alias_normalize_v104(mi.name)=n.stripped
  UNION ALL
  SELECT a.menu_item_id,4,'alias_unit_prefix' FROM public.menu_item_aliases_v104 a
    JOIN public.menu_items mi ON mi.id=a.menu_item_id,names n
  WHERE NOT mi.is_archived_v133 AND n.original<>n.stripped AND n.stripped<>'' AND a.alias_key=n.stripped
 ), best AS (SELECT min(priority) AS priority FROM candidates),
 selected AS (SELECT DISTINCT c.id,c.kind FROM candidates c,best b WHERE c.priority=b.priority)
 SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL::uuid END,
   CASE WHEN count(*)=0 THEN 'none' WHEN count(*)=1 THEN (array_agg(kind))[1] ELSE 'ambiguous' END,
   count(*)::integer
 FROM selected WHERE public.is_app_owner();
$match$;
REVOKE ALL ON FUNCTION public.menu_match_v104(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.menu_match_v104(text) TO authenticated;

-- Determine whether a dish is referenced elsewhere, without assuming a fixed
-- list of historical sale, event or import tables. Historical references block deletion.
CREATE OR REPLACE FUNCTION public.v133_menu_usage(p_menu_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $usage$
DECLARE v_fk record;v_exists boolean;v_used jsonb:='[]'::jsonb;v_recipes int:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_id AND NOT is_archived_v133)
 THEN RAISE EXCEPTION 'V133_MENU_NOT_ACTIVE'; END IF;
 FOR v_fk IN
  SELECT c.conrelid::regclass AS table_name, c.conkey,
         a.attname AS column_name
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  WHERE c.contype='f' AND c.confrelid='public.menu_items'::regclass
 LOOP
  IF v_fk.table_name::text IN ('menu_item_aliases_v104','public.menu_item_aliases_v104',
    'menu_item_recipe_items','public.menu_item_recipe_items',
    'event_menu_cost_estimates_v039','public.event_menu_cost_estimates_v039',
    'v126_menu_recipe_reviews','public.v126_menu_recipe_reviews') THEN CONTINUE; END IF;
  IF coalesce(array_length(v_fk.conkey,1),0)<>1 THEN
    RAISE EXCEPTION 'V133_MENU_COMPOSITE_REFERENCE_REVIEW';
  END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I = $1)',v_fk.table_name,v_fk.column_name)
    INTO v_exists USING p_menu_id;
  IF v_exists THEN v_used:=v_used||jsonb_build_array(v_fk.table_name::text); END IF;
 END LOOP;
 SELECT count(*) INTO v_recipes FROM public.menu_item_recipe_items WHERE menu_item_id=p_menu_id;
 RETURN jsonb_build_object('canDelete',jsonb_array_length(v_used)=0,'references',v_used,'recipeLines',v_recipes);
END;
$usage$;
REVOKE ALL ON FUNCTION public.v133_menu_usage(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v133_menu_usage(uuid) TO authenticated;

-- Delete ONLY an unused dish. Catalog recipe and aliases may be cleaned up; all
-- historical/payment/booking/import references are protected by the FK scan.
CREATE OR REPLACE FUNCTION public.v133_menu_delete_unused(p_menu_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $delete$
DECLARE v_item public.menu_items%ROWTYPE;v_check jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v133-menu-operations',0));
 SELECT * INTO v_item FROM public.menu_items WHERE id=p_menu_id FOR UPDATE;
 IF NOT FOUND OR v_item.is_archived_v133 THEN RAISE EXCEPTION 'V133_MENU_NOT_ACTIVE'; END IF;
 v_check:=public.v133_menu_usage(p_menu_id);
 IF NOT coalesce((v_check->>'canDelete')::boolean,false)
 THEN RAISE EXCEPTION 'V133_MENU_USED: %',v_check->>'references'; END IF;
 -- These optional records have no external historical transactions.
 DELETE FROM public.menu_item_aliases_v104 WHERE menu_item_id=p_menu_id;
 DELETE FROM public.menu_item_recipe_items WHERE menu_item_id=p_menu_id;
 DELETE FROM public.event_menu_cost_estimates_v039 WHERE menu_item_id=p_menu_id;
 DELETE FROM public.v126_menu_recipe_reviews WHERE menu_item_id=p_menu_id;
 DELETE FROM public.menu_items WHERE id=p_menu_id;
 INSERT INTO public.v133_menu_delete_history(deleted_menu_id,deleted_name) VALUES(p_menu_id,v_item.name);
 RETURN jsonb_build_object('deleted',true,'name',v_item.name);
END;
$delete$;
REVOKE ALL ON FUNCTION public.v133_menu_delete_unused(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v133_menu_delete_unused(uuid) TO authenticated;

-- Merge never deletes sales, payouts, receipt lines, or imported price snapshots.
-- It archives the duplicate, links future name matching, carries its alias list,
-- re-points pending sales, and copies a recipe only when the target had none.
CREATE OR REPLACE FUNCTION public.v133_menu_merge(p_source_id uuid,p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $merge$
DECLARE v_source public.menu_items%ROWTYPE;v_target public.menu_items%ROWTYPE;
 v_target_key text;v_source_key text;v_line_count int:=0;v_moved_recipe boolean:=false;
 v_queued int:=0;v_ameen int:=0;v_alias record;
 v_existing_alias_count integer:=0;v_source_alias_exists boolean:=false;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id=p_target_id
 THEN RAISE EXCEPTION 'V133_MENU_MERGE_INVALID_PAIR'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v133-menu-operations',0));
 -- Lock both menu rows in deterministic order.
 PERFORM 1 FROM public.menu_items WHERE id IN(p_source_id,p_target_id) ORDER BY id FOR UPDATE;
 SELECT * INTO v_source FROM public.menu_items WHERE id=p_source_id;
 SELECT * INTO v_target FROM public.menu_items WHERE id=p_target_id;
 IF v_source.id IS NULL OR v_target.id IS NULL OR v_source.is_archived_v133 OR v_target.is_archived_v133
 THEN RAISE EXCEPTION 'V133_MENU_MERGE_INACTIVE_ITEM'; END IF;
 v_source_key:=public.menu_alias_normalize_v104(v_source.name);
 v_target_key:=public.menu_alias_normalize_v104(v_target.name);
 IF length(v_source.name)>180 THEN RAISE EXCEPTION 'V133_SOURCE_NAME_TOO_LONG_FOR_ALIAS'; END IF;
 -- Even two legacy entries with the same normalized name may be merged.
 IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
    WHERE a.alias_key=v_source_key AND a.menu_item_id NOT IN(p_source_id,p_target_id))
 THEN RAISE EXCEPTION 'V133_SOURCE_NAME_USED_AS_OTHER_ALIAS'; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_items m WHERE m.id NOT IN(p_source_id,p_target_id)
   AND NOT m.is_archived_v133 AND public.menu_alias_normalize_v104(m.name)=v_source_key)
 THEN RAISE EXCEPTION 'V133_SOURCE_NAME_USED_AS_OTHER_MENU'; END IF;
 -- Preserve the target recipe. Transfer the source recipe only when target is empty.
 IF NOT EXISTS(SELECT 1 FROM public.menu_item_recipe_items WHERE menu_item_id=p_target_id)
 AND EXISTS(SELECT 1 FROM public.menu_item_recipe_items WHERE menu_item_id=p_source_id) THEN
  UPDATE public.menu_item_recipe_items SET menu_item_id=p_target_id WHERE menu_item_id=p_source_id;
  GET DIAGNOSTICS v_line_count=ROW_COUNT;
  v_moved_recipe:=v_line_count>0;
 END IF;
 -- Any source alias that equals the target's canonical name is redundant.
 DELETE FROM public.menu_item_aliases_v104 WHERE menu_item_id=p_source_id AND alias_key=v_target_key;
 -- Enforce the 40-alias limit without a nested SQL CASE in a PL/pgSQL IF.
 -- The previous combined IF expression caused a PostgreSQL parsing error near here.
 SELECT count(*) INTO v_existing_alias_count
 FROM public.menu_item_aliases_v104
 WHERE menu_item_id IN (p_source_id, p_target_id);
 SELECT EXISTS(
   SELECT 1 FROM public.menu_item_aliases_v104 a
   WHERE a.menu_item_id IN (p_source_id, p_target_id)
     AND a.alias_key = v_source_key
 ) INTO v_source_alias_exists;
 IF v_source_key <> v_target_key AND NOT v_source_alias_exists THEN
   v_existing_alias_count := v_existing_alias_count + 1;
 END IF;
 IF v_existing_alias_count > 40 THEN
   RAISE EXCEPTION 'V133_MERGE_TOO_MANY_ALIASES';
 END IF;
 -- Reject ambiguities against another active canonical name before changing the mapping.
 FOR v_alias IN SELECT alias_key FROM public.menu_item_aliases_v104 WHERE menu_item_id=p_source_id LOOP
   IF EXISTS(SELECT 1 FROM public.menu_items m WHERE m.id NOT IN(p_source_id,p_target_id)
      AND NOT m.is_archived_v133 AND public.menu_alias_normalize_v104(m.name)=v_alias.alias_key)
   THEN RAISE EXCEPTION 'V133_MERGED_ALIAS_CONFLICT'; END IF;
 END LOOP;
 UPDATE public.menu_item_aliases_v104 SET menu_item_id=p_target_id WHERE menu_item_id=p_source_id;
 UPDATE public.menu_items SET is_archived_v133=true,merged_into_menu_id_v133=p_target_id
 WHERE id=p_source_id;
 IF v_source_key<>v_target_key THEN
   INSERT INTO public.menu_item_aliases_v104(menu_item_id,alias_name)
   VALUES(p_target_id,v_source.name)
   ON CONFLICT(alias_key) DO NOTHING;
 END IF;
 -- Required: pending cost/stock entries for the duplicate now use the surviving recipe.
 UPDATE public.v131_sale_cost_queue SET menu_item_id=p_target_id,updated_at=now()
 WHERE menu_item_id=p_source_id AND state='pending';
 GET DIAGNOSTICS v_queued=ROW_COUNT;
 -- A pre-existing planning estimate may fill an empty target estimate, without
 -- overwriting the chosen target's own estimate or touching any sale snapshots.
 INSERT INTO public.event_menu_cost_estimates_v039(menu_item_id,estimated_unit_cost_base,note)
 SELECT p_target_id,estimated_unit_cost_base,note
 FROM public.event_menu_cost_estimates_v039 WHERE menu_item_id=p_source_id
 ON CONFLICT(menu_item_id) DO NOTHING;
 -- Historical posted cashier lines must retain their original catalog reference.
 -- Rewriting them could change past profitability reports and price audit trails.
 SELECT count(*) INTO v_ameen FROM public.ameen_daily_lines_v041 WHERE menu_item_id=p_source_id;
 INSERT INTO public.v133_menu_merge_history(source_menu_id,target_menu_id,source_name,target_name,
   moved_pending_sales,historical_ameen_links_preserved,recipe_transferred)
 VALUES(p_source_id,p_target_id,v_source.name,v_target.name,v_queued,v_ameen,v_moved_recipe);
 RETURN jsonb_build_object('merged',true,'sourceName',v_source.name,'targetName',v_target.name,
  'pendingSalesRelinked',v_queued,'historicalAmeenLinesPreserved',v_ameen,'recipeTransferred',v_moved_recipe,
  'sourceArchived',true);
END;
$merge$;
REVOKE ALL ON FUNCTION public.v133_menu_merge(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v133_menu_merge(uuid,uuid) TO authenticated;

-- Once a duplicate has been archived, pending sales must never be relinked back
-- to its obsolete canonical name by the v1.0.32 background matcher.
CREATE OR REPLACE FUNCTION public.v132_auto_link_sale_queue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $link$
DECLARE v_changed integer := 0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 WITH candidates AS (
   SELECT q.id AS queue_id,m.id AS menu_id
   FROM public.v131_sale_cost_queue q
   JOIN public.menu_items m ON public.menu_alias_normalize_v104(m.name)=public.menu_alias_normalize_v104(q.source_name)
   WHERE q.state='pending' AND q.menu_item_id IS NULL AND NOT m.is_archived_v133
   UNION
   SELECT q.id,a.menu_item_id
   FROM public.v131_sale_cost_queue q
   JOIN public.menu_item_aliases_v104 a ON a.alias_key=public.menu_alias_normalize_v104(q.source_name)
   JOIN public.menu_items m ON m.id=a.menu_item_id
   WHERE q.state='pending' AND q.menu_item_id IS NULL AND NOT m.is_archived_v133
 ), unique_match AS (
  SELECT queue_id,(array_agg(DISTINCT menu_id))[1] AS menu_id FROM candidates
  GROUP BY queue_id HAVING count(DISTINCT menu_id)=1
 )
 UPDATE public.v131_sale_cost_queue q SET menu_item_id=u.menu_id,
  error_note=CASE WHEN q.error_note='V131_SALE_MENU_NOT_ASSIGNED' THEN NULL ELSE q.error_note END,
  updated_at=now()
 FROM unique_match u WHERE q.id=u.queue_id AND q.state='pending' AND q.menu_item_id IS NULL;
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 RETURN v_changed;
END;
$link$;
REVOKE ALL ON FUNCTION public.v132_auto_link_sale_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v132_auto_link_sale_queue() TO authenticated;

-- The stock issuance replacement is appended by the release builder below.

-- Re-posting remains idempotent: issued/included_in_count return early.
CREATE OR REPLACE FUNCTION public.v131_complete_sale_cost(p_queue_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $complete$
DECLARE v_sale public.v131_sale_cost_queue%ROWTYPE;v_last_count date;v_recipe record;v_alloc record;
 v_cost numeric;v_qty numeric;v_total numeric:=0;v_recipe_count int:=0;v_component uuid;
 v_movement uuid;v_covered boolean;v_available numeric;v_order uuid;
 v_missing_cost boolean:=false;v_cost_fallback numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 SELECT * INTO v_sale FROM public.v131_sale_cost_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'V131_SALE_NOT_FOUND';END IF;
 IF v_sale.state IN ('issued','included_in_count') THEN
  RETURN jsonb_build_object('state',v_sale.state,'alreadyCompleted',true);
 END IF;
 IF v_sale.state='review' THEN RAISE EXCEPTION 'V131_MANUAL_ORDER_PARTIALLY_ISSUED_REVIEW_REQUIRED'; END IF;
 IF v_sale.menu_item_id IS NULL THEN RAISE EXCEPTION 'V131_SALE_MENU_NOT_ASSIGNED'; END IF;
 IF v_sale.source_kind='restaurant' AND NOT EXISTS(
   SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
   WHERE oi.id=v_sale.restaurant_line_id AND o.status='posted'
 ) THEN RAISE EXCEPTION 'V131_SALE_ORDER_NO_LONGER_POSTED';END IF;
 IF v_sale.source_kind='restaurant' AND EXISTS(
  SELECT 1 FROM public.order_item_materials WHERE order_item_id=v_sale.restaurant_line_id)
 THEN RAISE EXCEPTION 'V131_SALE_HAS_EARLIER_STOCK_SNAPSHOTS'; END IF;
 SELECT count(*) INTO v_recipe_count FROM public.menu_item_recipe_items WHERE menu_item_id=v_sale.menu_item_id;
 IF v_recipe_count=0 THEN RAISE EXCEPTION 'V131_SALE_RECIPE_NOT_DEFINED';END IF;
 SELECT max(count_date) INTO v_last_count FROM public.v126_physical_counts;
 v_covered:=(v_last_count IS NOT NULL AND v_sale.sale_date<=v_last_count);
 -- Missing historical cost does not block a physical stock issuance.
 FOR v_recipe IN SELECT material_id,quantity_base FROM public.menu_item_recipe_items
   WHERE menu_item_id=v_sale.menu_item_id ORDER BY material_id LOOP
  v_qty:=round(v_recipe.quantity_base*v_sale.sold_quantity,6);
  IF v_qty<=0 THEN RAISE EXCEPTION 'V131_RECIPE_QUANTITY_NOT_POSITIVE'; END IF;
  IF v_covered THEN
   v_cost:=public.get_material_cost_at(v_recipe.material_id,v_sale.occurred_at);
   IF v_cost IS NULL OR v_cost<=0 THEN v_cost:=0;v_missing_cost:=true;END IF;
   INSERT INTO public.v131_sale_cost_components(queue_id,requested_material_id,actual_material_id,
      used_base,unit_cost_base,line_cost_base,included_in_count)
   VALUES(v_sale.id,v_recipe.material_id,v_recipe.material_id,v_qty,v_cost,
      round(v_qty*v_cost,4),true);
   v_total:=v_total+round(v_qty*v_cost,4);
  ELSE
   FOR v_alloc IN SELECT * FROM public.material_consumption_plan_v130(
     v_recipe.material_id,v_qty,v_sale.occurred_at) LOOP
    v_cost:=v_alloc.unit_cost_base;
    -- Valuation is independent of the physical issue. Historical sale-price data
    -- are NOT a reliable material cost. If the original cost is unknown, use the
    -- last positive purchase cost for the movement only and flag the valuation.
    IF v_cost IS NULL OR v_cost<=0 THEN
      v_missing_cost:=true;
      SELECT last_purchase_unit_cost_base INTO v_cost_fallback
        FROM public.materials WHERE id=v_alloc.actual_material_id;
      v_cost:=greatest(coalesce(v_cost_fallback,0),0);
    END IF;
    SELECT current_stock_base INTO v_available FROM public.materials
     WHERE id=v_alloc.actual_material_id FOR UPDATE;
    IF v_available<v_alloc.issued_base THEN RAISE EXCEPTION 'V131_SALE_STOCK_INSUFFICIENT';END IF;
    v_component:=gen_random_uuid();
    INSERT INTO public.v131_sale_cost_components(id,queue_id,requested_material_id,
      actual_material_id,used_base,unit_cost_base,line_cost_base)
    VALUES(v_component,v_sale.id,v_recipe.material_id,v_alloc.actual_material_id,
       v_alloc.issued_base,v_cost,round(v_alloc.issued_base*v_cost,4));
    v_order:=CASE WHEN v_sale.source_kind='ameen' THEN
      (SELECT order_id FROM public.ameen_daily_lines_v041 WHERE id=v_sale.ameen_line_id)
      ELSE (SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id) END;
    v_movement:=public.record_inventory_movement(v_alloc.actual_material_id,'sale',
     -v_alloc.issued_base,v_cost,v_sale.occurred_at,'v131_sale_cost',v_order,v_component,
     'تسوية صرف مواد مبيعات سابقة، دون قبض جديد');
    UPDATE public.v131_sale_cost_components SET inventory_movement_id=v_movement WHERE id=v_component;
    IF v_sale.source_kind='restaurant' THEN
     INSERT INTO public.order_item_materials(order_item_id,material_id,quantity_per_item_base,
       total_quantity_base,unit_cost_base_snapshot,requested_material_id_v130,inventory_movement_id)
     VALUES(v_sale.restaurant_line_id,v_alloc.actual_material_id,
       round(v_alloc.issued_base/v_sale.sold_quantity,8),v_alloc.issued_base,v_cost,
       v_recipe.material_id,v_movement);
    END IF;
    v_total:=v_total+round(v_alloc.issued_base*v_cost,4);
   END LOOP;
  END IF;
 END LOOP;
 UPDATE public.v131_sale_cost_queue SET state=CASE WHEN v_covered THEN 'included_in_count' ELSE 'issued' END,
   cost_total_base=CASE WHEN v_missing_cost THEN NULL ELSE round(v_total,4) END,
   is_cost_complete=NOT v_missing_cost,
   error_note=CASE WHEN v_missing_cost THEN 'V133_COST_UNCONFIRMED_STOCK_ISSUED' ELSE NULL END,
   resolved_at=now(),updated_at=now() WHERE id=v_sale.id;
 IF v_sale.source_kind='restaurant' THEN
   UPDATE public.order_items
     SET known_cost_total_base=CASE WHEN v_missing_cost THEN known_cost_total_base ELSE round(v_total,4) END,
         has_incomplete_cost=CASE WHEN v_missing_cost THEN has_incomplete_cost ELSE false END
     WHERE id=v_sale.restaurant_line_id;
   UPDATE public.orders SET known_cost_total_base=(SELECT coalesce(sum(known_cost_total_base),0)
       FROM public.order_items WHERE order_id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id)),
     has_incomplete_cost=(SELECT coalesce(bool_or(has_incomplete_cost),false)
       FROM public.order_items WHERE order_id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id))
   WHERE id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id);
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN v_covered THEN 'included_in_count' ELSE 'issued' END,
  'cost',CASE WHEN v_missing_cost THEN NULL ELSE round(v_total,4) END,
  'costConfirmed',NOT v_missing_cost,'materialCount',v_recipe_count,'inventoryDeducted',NOT v_covered);
END;
$complete$;

-- Keep the v1.0.32 list signature but expose separate stock and cost status.
CREATE OR REPLACE FUNCTION public.v131_sale_queue_list(
 p_limit int DEFAULT 200,p_offset int DEFAULT 0,p_only_pending boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $list$
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'source',q.source_kind,'menuItemId',q.menu_item_id,
 'orderNo',CASE WHEN q.source_kind='ameen' THEN ao.external_number ELSE o.external_order_number END,
 'saleDate',q.sale_date,'menuName',q.display_name,'sourceName',q.source_name,
 'quantity',q.sold_quantity,'state',q.state,'error',q.error_note,'cost',q.cost_total_base,
 'costComplete',q.is_cost_complete,
 'recipeCount',(SELECT count(*) FROM public.menu_item_recipe_items r WHERE r.menu_item_id=q.menu_item_id),
 'components',(SELECT count(*) FROM public.v131_sale_cost_components c WHERE c.queue_id=q.id),
 'doneAt',q.resolved_at)
 ORDER BY lower(q.display_name),q.sale_date DESC,q.id),'[]'::jsonb)
FROM (
 SELECT scq.*,coalesce(m.name,scq.source_name) AS display_name
 FROM public.v131_sale_cost_queue scq
 LEFT JOIN public.menu_items m ON m.id=scq.menu_item_id
 WHERE (NOT p_only_pending OR scq.state IN ('pending','review')) AND public.is_app_owner()
 ORDER BY lower(coalesce(m.name,scq.source_name)),scq.sale_date DESC,scq.id
 LIMIT least(greatest(p_limit,1),500) OFFSET greatest(p_offset,0)
) q
LEFT JOIN public.ameen_daily_lines_v041 al ON al.id=q.ameen_line_id
LEFT JOIN public.ameen_daily_orders_v041 ao ON ao.id=al.order_id
LEFT JOIN public.order_items oi ON oi.id=q.restaurant_line_id
LEFT JOIN public.orders o ON o.id=oi.order_id;
$list$;
REVOKE ALL ON FUNCTION public.v131_sale_queue_list(integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_sale_queue_list(integer,integer,boolean) TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
