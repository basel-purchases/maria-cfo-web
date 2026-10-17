-- Maria CFO Web v1.0.4: menu alternate names and safe daily cashier reconciliation.
-- Run ONCE in Supabase SQL Editor as postgres, BEFORE deploying v1.0.4 site.
-- Requires v0.41. Additive: does not erase/rename any existing business records.
-- A failed statement rolls the entire migration back.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';

-- Normalization is deliberately conservative: accents, alef and digit variants only.
-- Units and quantities are NOT stripped when storing alias keys or canonical names.
CREATE OR REPLACE FUNCTION public.menu_alias_normalize_v104(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT btrim(regexp_replace(
   translate(translate(lower(btrim(coalesce(p_name,''))), 'ًٌٍَُِّْـ', ''),
     'أإآٱى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااي01234567890123456789'),
   '[[:space:]]+', ' ', 'g'));
$$;

-- Only a LEADING sale quantity/unit is ignored for secondary matching.
-- Never silently strip numbers elsewhere (e.g. menu product names with a number).
CREATE OR REPLACE FUNCTION public.menu_strip_leading_unit_v104(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT btrim(regexp_replace(public.menu_alias_normalize_v104(p_name),
   '^(?:[0-9]+(?:[.,][0-9]+)?[[:space:]]*)?(?:كيلو[[:space:]]*غرام|كيلوغرام|كيلوجرام|كجم|كغ|كيلو|kgs|kg|غرام|جرام|غم|غ|gram|g|ليتر|لتر|ل|litre|liter|l|مللي[[:space:]]*لتر|مل|ml|قطعة|حبات|حبة|حبه|حصص|حصة|pcs|pc)[[:space:]]+', '', 'i'));
$$;

CREATE TABLE IF NOT EXISTS public.menu_item_aliases_v104 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 alias_name text NOT NULL CHECK (length(btrim(alias_name)) BETWEEN 1 AND 180),
 alias_key text GENERATED ALWAYS AS (public.menu_alias_normalize_v104(alias_name)) STORED,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT menu_item_aliases_key_v104 UNIQUE (alias_key),
 CONSTRAINT menu_item_aliases_key_nonempty_v104 CHECK (alias_key <> '')
);
CREATE INDEX IF NOT EXISTS menu_item_aliases_menu_v104 ON public.menu_item_aliases_v104(menu_item_id);
ALTER TABLE public.menu_item_aliases_v104 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_item_aliases_v104 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.menu_item_aliases_v104 TO authenticated;
DROP POLICY IF EXISTS maria_alias_owner_read_v104 ON public.menu_item_aliases_v104;
CREATE POLICY maria_alias_owner_read_v104 ON public.menu_item_aliases_v104
 FOR SELECT TO authenticated USING (public.is_app_owner());

-- Prevent the same alternative name pointing to another meal OR colliding with
-- the normalized primary name of a different meal. One target per alias only.
CREATE OR REPLACE FUNCTION public.menu_alias_validate_v104(p_menu_id uuid,p_name text)
RETURNS text LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_key text;
BEGIN
 v_key:=public.menu_alias_normalize_v104(p_name);
 IF p_menu_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_id)
 THEN RAISE EXCEPTION 'MENU_ALIAS_TARGET_NOT_FOUND'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 180 OR v_key=''
 THEN RAISE EXCEPTION 'MENU_ALIAS_INVALID_NAME'; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_items m WHERE m.id<>p_menu_id
   AND public.menu_alias_normalize_v104(m.name)=v_key)
 THEN RAISE EXCEPTION 'MENU_ALIAS_COLLIDES_WITH_MENU_NAME: %',p_name; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
   WHERE a.alias_key=v_key AND a.menu_item_id<>p_menu_id)
 THEN RAISE EXCEPTION 'MENU_ALIAS_USED_BY_ANOTHER_ITEM: %',p_name; END IF;
 RETURN v_key;
END;$$;
REVOKE ALL ON FUNCTION public.menu_alias_validate_v104(uuid,text) FROM PUBLIC,anon,authenticated;

-- Replaces all aliases on the edited menu item atomically.
CREATE OR REPLACE FUNCTION public.menu_aliases_set_v104(p_menu_id uuid,p_names text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record; v_own_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF cardinality(coalesce(p_names,ARRAY[]::text[]))>40 THEN RAISE EXCEPTION 'MENU_TOO_MANY_ALIASES'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 SELECT public.menu_alias_normalize_v104(m.name) INTO v_own_key FROM public.menu_items m WHERE m.id=p_menu_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND'; END IF;
 FOR r IN SELECT DISTINCT ON (public.menu_alias_normalize_v104(btrim(a.name)))
     btrim(a.name) AS name,public.menu_alias_normalize_v104(btrim(a.name)) AS norm
   FROM unnest(coalesce(p_names,ARRAY[]::text[])) AS a(name)
   WHERE btrim(coalesce(a.name,''))<>''
   ORDER BY public.menu_alias_normalize_v104(btrim(a.name)),btrim(a.name)
 LOOP
   IF r.norm<>v_own_key THEN PERFORM public.menu_alias_validate_v104(p_menu_id,r.name); END IF;
 END LOOP;
 DELETE FROM public.menu_item_aliases_v104 WHERE menu_item_id=p_menu_id;
 FOR r IN SELECT DISTINCT ON (public.menu_alias_normalize_v104(btrim(a.name)))
     btrim(a.name) AS name,public.menu_alias_normalize_v104(btrim(a.name)) AS norm
   FROM unnest(coalesce(p_names,ARRAY[]::text[])) AS a(name)
   WHERE btrim(coalesce(a.name,''))<>''
   ORDER BY public.menu_alias_normalize_v104(btrim(a.name)),btrim(a.name)
 LOOP
   IF r.norm<>v_own_key THEN
     INSERT INTO public.menu_item_aliases_v104(menu_item_id,alias_name) VALUES(p_menu_id,r.name);
   END IF;
 END LOOP;
END;$$;

CREATE OR REPLACE FUNCTION public.menu_alias_add_v104(p_menu_id uuid,p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_key text;v_own_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 v_key:=public.menu_alias_validate_v104(p_menu_id,p_name);
 SELECT public.menu_alias_normalize_v104(name) INTO v_own_key FROM public.menu_items WHERE id=p_menu_id;
 IF v_key=v_own_key THEN RETURN; END IF;
 INSERT INTO public.menu_item_aliases_v104(menu_item_id,alias_name)
 VALUES(p_menu_id,btrim(p_name)) ON CONFLICT(alias_key) DO NOTHING;
END;$$;

-- Resolve exact primary name, exact alias, then uniquely matched name after
-- removing a leading quantity/unit. Ambiguous names are NEVER auto-linked.
CREATE OR REPLACE FUNCTION public.menu_match_v104(p_name text)
RETURNS TABLE(menu_id uuid,match_kind text,candidate_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH names AS (SELECT public.menu_alias_normalize_v104(p_name) AS original,
     public.menu_strip_leading_unit_v104(p_name) AS stripped),
 candidates AS (
  SELECT mi.id,1 AS priority,'canonical'::text AS kind FROM public.menu_items mi,names n
    WHERE public.menu_alias_normalize_v104(mi.name)=n.original AND n.original<>''
  UNION ALL
  SELECT a.menu_item_id,2,'alias' FROM public.menu_item_aliases_v104 a,names n
    WHERE a.alias_key=n.original AND n.original<>''
  UNION ALL
  SELECT mi.id,3,'unit_prefix' FROM public.menu_items mi,names n
    WHERE n.original<>n.stripped AND n.stripped<>''
      AND public.menu_alias_normalize_v104(mi.name)=n.stripped
  UNION ALL
  SELECT a.menu_item_id,4,'alias_unit_prefix' FROM public.menu_item_aliases_v104 a,names n
    WHERE n.original<>n.stripped AND n.stripped<>'' AND a.alias_key=n.stripped
 ), best AS (SELECT min(priority) AS priority FROM candidates),
 selected AS (SELECT DISTINCT c.id,c.kind FROM candidates c,best b WHERE c.priority=b.priority)
 SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL::uuid END,
    CASE WHEN count(*)=0 THEN 'none' WHEN count(*)=1 THEN (array_agg(kind))[1] ELSE 'ambiguous' END,
    count(*)::integer
 FROM selected WHERE public.is_app_owner();
$$;

-- One searchable record per meal, including its alternatives, for server paging.
CREATE OR REPLACE VIEW public.menu_item_search_v104 WITH (security_invoker=true) AS
 SELECT mi.id,mi.name,mi.category_id,coalesce(s.cost_is_missing,false) AS cost_is_missing,
   concat_ws(' ',mi.name,coalesce(string_agg(a.alias_name,' ' ORDER BY a.alias_name),'')) AS search_text,
   coalesce(string_agg(a.alias_name,' · ' ORDER BY a.alias_name),'') AS aliases_text
 FROM public.menu_items mi
 LEFT JOIN public.menu_item_aliases_v104 a ON a.menu_item_id=mi.id
 LEFT JOIN public.menu_cost_status_v041 s ON s.id=mi.id
 WHERE public.is_app_owner()
 GROUP BY mi.id,mi.name,mi.category_id,s.cost_is_missing;
REVOKE ALL ON public.menu_item_search_v104 FROM PUBLIC,anon;
GRANT SELECT ON public.menu_item_search_v104 TO authenticated;

-- Single-transaction menu update: item, aliases, estimated cost and price audit.
CREATE OR REPLACE FUNCTION public.menu_save_v104(p_menu_id uuid,p_name text,
 p_category_id uuid,p_price numeric,p_food_cost numeric,p_discount numeric,
 p_estimate numeric,p_aliases text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;v_new_key text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 1 AND 250
 THEN RAISE EXCEPTION 'MENU_NAME_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 v_new_key:=public.menu_alias_normalize_v104(p_name);
 IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
    WHERE a.alias_key=v_new_key AND a.menu_item_id IS DISTINCT FROM p_menu_id)
 THEN RAISE EXCEPTION 'MENU_NAME_COLLIDES_WITH_ALIAS'; END IF;
 IF EXISTS(SELECT 1 FROM public.menu_items m
    WHERE m.id IS DISTINCT FROM p_menu_id AND public.menu_alias_normalize_v104(m.name)=v_new_key)
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

REVOKE ALL ON FUNCTION public.menu_alias_normalize_v104(text),
 public.menu_strip_leading_unit_v104(text),public.menu_aliases_set_v104(uuid,text[]),
 public.menu_alias_add_v104(uuid,text),public.menu_match_v104(text),
 public.menu_save_v104(uuid,text,uuid,numeric,numeric,numeric,numeric,text[])
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.menu_aliases_set_v104(uuid,text[]),
 public.menu_alias_add_v104(uuid,text),public.menu_match_v104(text),
 public.menu_save_v104(uuid,text,uuid,numeric,numeric,numeric,numeric,text[])
 TO authenticated;

-- Preserve the matching provenance to avoid attributing a one-portion recipe
-- cost to a sale explicitly described as e.g. "1 kg" without a serving conversion.
ALTER TABLE public.ameen_daily_lines_v041
 ADD COLUMN IF NOT EXISTS match_kind_v104 text;

-- The preview/import v0.41 overrides follow below, and preserve existing RPC signatures.

-- Preview uses exactly the same database-side name resolver as the actual import.
CREATE OR REPLACE FUNCTION public.ameen_price_preview_v041(p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records)>5000
 THEN RAISE EXCEPTION 'INVALID_ORDERS_PREVIEW'; END IF;
 WITH source_lines AS (
  SELECT li.value->>'name' AS item_name,(li.value->>'unitPrice')::numeric AS proposed_price,
    coalesce(o.value->>'occurredAt',o.value->>'date','') AS stamp,
    o.ordinality AS order_pos,li.ordinality AS line_pos
  FROM jsonb_array_elements(p_records) WITH ORDINALITY o(value,ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(o.value->'items') WITH ORDINALITY li(value,ordinality)
 ), grouped AS (
  SELECT public.recipe_key_normalize_v027(item_name) AS item_key,
     (array_agg(item_name ORDER BY stamp DESC,order_pos DESC,line_pos DESC))[1] AS name,
     (array_agg(proposed_price ORDER BY stamp DESC,order_pos DESC,line_pos DESC))[1] AS file_price,
     min(proposed_price) AS min_file_price,max(proposed_price) AS max_file_price,count(*) AS occurrences
  FROM source_lines GROUP BY public.recipe_key_normalize_v027(item_name)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',g.name,'filePrice',g.file_price,'minFilePrice',g.min_file_price,
   'maxFilePrice',g.max_file_price,'occurrences',g.occurrences,
   'menuId',m.id,'menuName',m.name,'menuPrice',m.manual_price_original,
   'matchKind',resolved.match_kind,'matchCandidates',resolved.candidate_count,
   'different',m.id IS NULL OR m.manual_price_original IS DISTINCT FROM g.file_price
 ) ORDER BY g.name),'[]'::jsonb) INTO v_result FROM grouped g
 CROSS JOIN LATERAL public.menu_match_v104(g.name) resolved
 LEFT JOIN public.menu_items m ON m.id=resolved.menu_id;
 RETURN v_result;
END;$$;

CREATE OR REPLACE FUNCTION public.ameen_import_daily_v041(
 p_filename text,p_sha256 text,p_records jsonb,p_actions jsonb DEFAULT '[]'::jsonb,
 p_reported_cashbox_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_run uuid;v_old record;v_rec jsonb;v_line jsonb;v_item record;
 v_day date;v_number text;v_ts timestamptz;v_order uuid;v_menu uuid;
 v_name text;v_mode text;v_price_mode text;v_action jsonb;v_menu_price numeric;v_file_price numeric;v_target uuid;v_match_kind text;v_line_match text;
 v_gross numeric;v_net numeric;v_qty numeric;v_unit_price numeric;v_line_net numeric;
 v_new integer:=0;v_existing integer:=0;v_conflicts integer:=0;v_lines integer:=0;
 v_price_updates integer:=0;v_new_items integer:=0;v_aliases_added integer:=0;v_notes jsonb:='[]'::jsonb;v_effective jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_sha256 !~ '^[0-9a-f]{64}$' OR length(coalesce(p_filename,'')) NOT BETWEEN 1 AND 250
    OR jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 5000
    OR pg_column_size(p_records)>12000000 OR jsonb_typeof(p_actions)<>'array'
    OR jsonb_array_length(p_actions)>3000
 THEN RAISE EXCEPTION 'DAILY_IMPORT_INVALID_PAYLOAD'; END IF;
 IF p_reported_cashbox_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_reported_cashbox_id AND is_active)
 THEN RAISE EXCEPTION 'DAILY_CASHBOX_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-daily-v041',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-menu-alias-v104',0));
 SELECT id,summary INTO v_old FROM public.ameen_daily_imports_v041 WHERE sha256=p_sha256 LIMIT 1;
 IF FOUND THEN RETURN v_old.summary||jsonb_build_object('duplicateFile',true,'runId',v_old.id); END IF;
 INSERT INTO public.ameen_daily_imports_v041(filename,sha256) VALUES(p_filename,p_sha256) RETURNING id INTO v_run;
 SELECT coalesce(jsonb_agg(r.value ORDER BY r.ordinality),'[]'::jsonb) INTO v_effective
 FROM jsonb_array_elements(p_records) WITH ORDINALITY r(value,ordinality) WHERE NOT EXISTS (
  SELECT 1 FROM public.ameen_daily_orders_v041 o
   WHERE o.business_date=(r.value->>'date')::date AND o.external_number=r.value->>'number');
 PERFORM set_config('maria.price_origin_v041','ameen_import',true);
 PERFORM set_config('maria.price_import_v041',v_run::text,true);

 -- Determine the menu price PER DISTINCT ITEM once per file, using the latest file row.
 FOR v_item IN
  WITH ls AS (
   SELECT li.value->>'name' AS name,(li.value->>'unitPrice')::numeric AS unit_price,
    coalesce(o.value->>'occurredAt',o.value->>'date','') AS stamp,
    o.ordinality AS op,li.ordinality AS lp
   FROM jsonb_array_elements(v_effective) WITH ORDINALITY o(value,ordinality)
   CROSS JOIN LATERAL jsonb_array_elements(o.value->'items') WITH ORDINALITY li(value,ordinality)
  ) SELECT public.recipe_key_normalize_v027(name) AS item_key,
   (array_agg(name ORDER BY stamp DESC,op DESC,lp DESC))[1] AS item_name,
   (array_agg(unit_price ORDER BY stamp DESC,op DESC,lp DESC))[1] AS last_price,
   min(unit_price) AS min_price,max(unit_price) AS max_price
  FROM ls GROUP BY public.recipe_key_normalize_v027(name)
 LOOP
  v_name:=btrim(coalesce(v_item.item_name,''));v_file_price:=v_item.last_price;
  IF length(v_name) NOT BETWEEN 1 AND 250 OR v_file_price IS NULL OR v_file_price<0 OR v_file_price>999999999999
  THEN RAISE EXCEPTION 'DAILY_ITEM_INVALID: %',v_name; END IF;
  SELECT a.value INTO v_action FROM jsonb_array_elements(p_actions) a(value)
   WHERE public.recipe_key_normalize_v027(a.value->>'name')=v_item.item_key LIMIT 1;
  v_mode:=coalesce(nullif(v_action->>'mode',''),'keep');
  v_price_mode:=coalesce(nullif(v_action->>'priceMode',''),'keep');
  SELECT resolved.menu_id,resolved.match_kind INTO v_menu,v_match_kind
    FROM public.menu_match_v104(v_name) resolved;
  IF v_mode='alias' THEN
    -- Linking to a DIFFERENT existing menu item is allowed only when source
    -- was not already unambiguously matched. Never overwrite a known match.
    IF coalesce(v_action->>'menuId','') !~ '^[0-9a-fA-F-]{36}$'
    THEN RAISE EXCEPTION 'DAILY_ALIAS_TARGET_REQUIRED: %',v_name; END IF;
    v_target:=(v_action->>'menuId')::uuid;
    IF v_menu IS NOT NULL AND v_menu<>v_target
    THEN RAISE EXCEPTION 'DAILY_ALIAS_CONFLICT: %',v_name; END IF;
    PERFORM public.menu_alias_add_v104(v_target,v_name);
    v_menu:=v_target;
    v_aliases_added:=v_aliases_added+1;
    v_mode:=v_price_mode;
  ELSIF v_menu IS NULL AND v_mode='create' THEN
    IF v_match_kind='ambiguous' AND EXISTS (
      SELECT 1 FROM public.menu_items m WHERE public.menu_alias_normalize_v104(m.name)=public.menu_alias_normalize_v104(v_name))
    THEN RAISE EXCEPTION 'DAILY_AMBIGUOUS_MENU: %',v_name; END IF;
    INSERT INTO public.menu_items(name,manual_price_original,notes)
      VALUES(v_name,v_file_price,'أُضيف من تقرير كاشير يومي؛ تحتاج تكلفة الوصفة إلى التحقق.')
      RETURNING id INTO v_menu;
    INSERT INTO public.menu_price_audit_v041(menu_item_id,old_price,new_price,origin,import_id,note)
      VALUES(v_menu,NULL,v_file_price,'ameen_new_item',v_run,'إضافة صنف جديد من تقرير الكاشير');
    v_new_items:=v_new_items+1;
    v_mode:='keep';
  ELSIF v_menu IS NULL THEN
    RAISE EXCEPTION 'DAILY_ITEM_NEEDS_EXPLICIT_CREATE_OR_ALIAS: %',v_name;
  ELSIF v_mode='create' THEN
    RAISE EXCEPTION 'DAILY_ITEM_ALREADY_MATCHED: %',v_name;
  END IF;
  IF v_mode NOT IN('keep','update') THEN RAISE EXCEPTION 'DAILY_PRICE_ACTION_INVALID'; END IF;
  SELECT manual_price_original INTO v_menu_price FROM public.menu_items WHERE id=v_menu FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DAILY_MENU_TARGET_MISSING'; END IF;
  IF v_mode='update' AND v_file_price IS DISTINCT FROM v_menu_price THEN
    UPDATE public.menu_items SET manual_price_original=v_file_price WHERE id=v_menu;
    v_price_updates:=v_price_updates+1;
  END IF;
 END LOOP;

 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_number=btrim(coalesce(v_rec->>'number',''));
   IF length(v_number) NOT BETWEEN 1 AND 100 OR coalesce(v_rec->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(v_rec->'items')<>'array' OR jsonb_array_length(v_rec->'items') NOT BETWEEN 1 AND 3000
    THEN RAISE EXCEPTION 'DAILY_ORDER_INVALID'; END IF;
   v_day=(v_rec->>'date')::date;
   v_ts=(v_rec->>'occurredAt')::timestamptz;
   v_net=(v_rec->>'netTotal')::numeric;
   v_gross=(v_rec->>'grossTotal')::numeric;
   IF v_net IS NULL OR v_net<0 OR v_net>999999999999 OR v_gross IS NULL OR v_gross<0 OR v_gross>999999999999
   THEN RAISE EXCEPTION 'DAILY_ORDER_TOTAL_INVALID'; END IF;
   SELECT id,source_fingerprint INTO v_order,v_name FROM public.ameen_daily_orders_v041
    WHERE business_date=v_day AND external_number=v_number FOR UPDATE;
   IF FOUND THEN
      IF v_name=md5(v_rec::text) THEN v_existing:=v_existing+1;
      ELSE v_conflicts:=v_conflicts+1;
       v_notes:=v_notes||jsonb_build_array(jsonb_build_object('date',v_day,'number',v_number,'reason','رقم وتاريخ موجودان ببيانات مختلفة؛ لم نستبدل السجل القديم'));
      END IF;
      CONTINUE;
   END IF;
   INSERT INTO public.ameen_daily_orders_v041(import_id,business_date,external_number,occurred_at,source_net,source_gross,
    source_fingerprint,source_cashbox,reported_cashbox_id,source_payload)
   VALUES(v_run,v_day,v_number,v_ts,v_net,v_gross,md5(v_rec::text),nullif(btrim(v_rec->>'cashbox'),''),p_reported_cashbox_id,v_rec)
   RETURNING id INTO v_order;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_rec->'items') LOOP
      v_name=btrim(coalesce(v_line->>'name',''));
      v_qty=(v_line->>'quantity')::numeric;v_unit_price=(v_line->>'unitPrice')::numeric;v_line_net=(v_line->>'lineNet')::numeric;
      IF length(v_name) NOT BETWEEN 1 AND 250 OR v_qty IS NULL OR v_qty<=0 OR v_unit_price IS NULL OR v_unit_price<0 OR v_line_net IS NULL OR v_line_net<0
      THEN RAISE EXCEPTION 'DAILY_LINE_INVALID'; END IF;
      SELECT m.id,m.manual_price_original,resolved.match_kind INTO v_menu,v_menu_price,v_line_match
      FROM public.menu_match_v104(v_name) resolved
      JOIN public.menu_items m ON m.id=resolved.menu_id;
      IF v_menu IS NULL THEN RAISE EXCEPTION 'DAILY_LINE_MENU_NOT_RESOLVED: %',v_name; END IF;
      INSERT INTO public.ameen_daily_lines_v041(order_id,source_row,menu_item_id,item_name,unit_name,quantity,unit_price,line_net,reference_price,note,match_kind_v104)
       VALUES(v_order,nullif(v_line->>'sourceRow','')::integer,v_menu,v_name,v_line->>'unit',v_qty,v_unit_price,v_line_net,v_menu_price,v_line->>'note',v_line_match);
      v_lines:=v_lines+1;
   END LOOP;
   v_new:=v_new+1;
 END LOOP;
 UPDATE public.ameen_daily_imports_v041 SET summary=jsonb_build_object('created',v_new,'existing',v_existing,
   'conflicts',v_conflicts,'lines',v_lines,'menuItemsAdded',v_new_items,'menuPricesUpdated',v_price_updates,'aliasesAdded',v_aliases_added,
   'duplicateFile',false,'runId',v_run,'reviewNotes',v_notes)
 WHERE id=v_run;
 RETURN (SELECT summary FROM public.ameen_daily_imports_v041 WHERE id=v_run);
END;$$;


-- Cost safety: leading weight/volume names do not inherit per-portion recipe cost.
CREATE OR REPLACE FUNCTION public.ameen_daily_report_v041(p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'number',o.external_number,'date',o.business_date,'net',o.source_net,
   'gross',o.source_gross,'cashbox',coalesce(o.source_cashbox,cb.name,'غير محدد في التقرير'),
   'cashboxFromFile',o.source_cashbox,'source',imp.origin,'occurredAt',o.occurred_at,
   'difference',o.source_net-o.source_gross
  ) ORDER BY o.occurred_at,o.external_number)
   FROM public.ameen_daily_orders_v041 o JOIN public.ameen_daily_imports_v041 imp ON imp.id=o.import_id
   LEFT JOIN public.cashboxes cb ON cb.id=o.reported_cashbox_id
   WHERE o.business_date=p_day),'[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',li.id,'orderId',li.order_id,'name',li.item_name,'menuId',li.menu_item_id,
   'qty',li.quantity,'unitPrice',li.unit_price,'lineNet',li.line_net,
   'referencePrice',li.reference_price,'sourceRow',li.source_row,
   'unit',li.unit_name,'matchKind',li.match_kind_v104,
   'cost',CASE WHEN li.match_kind_v104 IN ('unit_prefix','alias_unit_prefix') THEN NULL
     WHEN c.id IS NOT NULL AND c.recipe_cost_base IS NOT NULL
     AND NOT coalesce(c.has_missing_cost,true) THEN c.recipe_cost_base ELSE e.estimated_unit_cost_base END,
   'costKind',CASE WHEN li.match_kind_v104 IN ('unit_prefix','alias_unit_prefix') THEN 'missing'
     WHEN c.id IS NOT NULL AND c.recipe_cost_base IS NOT NULL
     AND NOT coalesce(c.has_missing_cost,true) THEN 'recipe'
     WHEN e.estimated_unit_cost_base IS NOT NULL THEN 'estimate' ELSE 'missing' END
  ) ORDER BY li.id)
   FROM public.ameen_daily_lines_v041 li
   JOIN public.ameen_daily_orders_v041 o ON o.id=li.order_id
   LEFT JOIN public.menu_item_costs c ON c.id=li.menu_item_id
   LEFT JOIN public.event_menu_cost_estimates_v039 e ON e.menu_item_id=li.menu_item_id
   WHERE o.business_date=p_day),'[]'::jsonb),
  'priceHistory',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'item',mi.name,'oldPrice',a.old_price,'newPrice',a.new_price,
   'origin',a.origin,'undone',a.undone_at IS NOT NULL,'at',a.occurred_at
  ) ORDER BY a.id DESC) FROM (SELECT * FROM public.menu_price_audit_v041 ORDER BY id DESC LIMIT 250) a
   JOIN public.menu_items mi ON mi.id=a.menu_item_id),'[]'::jsonb)
 ) WHERE public.is_app_owner() AND p_day IS NOT NULL;
$$;


REVOKE ALL ON FUNCTION public.ameen_price_preview_v041(jsonb),
 public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid),
 public.ameen_daily_report_v041(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ameen_price_preview_v041(jsonb),
 public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid),
 public.ameen_daily_report_v041(date) TO authenticated;
COMMIT;
