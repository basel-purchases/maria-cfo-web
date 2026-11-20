-- Maria CFO v1.0.34 | Purchase-first menu recipes and historical sales archive.
-- Requires v1.0.33 FIX2 and earlier migrations. Run in STAGING first.
-- This migration NEVER reads old menu material prices, creates materials from menus,
-- adjusts material stock, or generates cashbox transactions for sales archive.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='120s';

DO $precheck$
BEGIN
 IF to_regclass('public.v126_menu_recipe_reviews') IS NULL
    OR to_regclass('public.purchase_invoice_items') IS NULL
    OR to_regclass('public.material_aliases_v106') IS NULL
    OR to_regclass('public.v126_historical_invoices') IS NULL
    OR to_regclass('public.v133_menu_merge_history') IS NULL THEN
  RAISE EXCEPTION 'V134_MISSING_PRIOR_MIGRATIONS';
 END IF;
END;
$precheck$;

CREATE TABLE IF NOT EXISTS public.v134_menu_import_batches(
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 batch_index integer NOT NULL CHECK(batch_index>=0),
 filename text NOT NULL,
 stats jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(sha256,batch_index)
);
ALTER TABLE public.v134_menu_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v134_menu_import_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v134_menu_import_batches TO authenticated;
DROP POLICY IF EXISTS v134_menu_batch_owner ON public.v134_menu_import_batches;
CREATE POLICY v134_menu_batch_owner ON public.v134_menu_import_batches
 FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE TABLE IF NOT EXISTS public.v134_sales_archive_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_key text NOT NULL UNIQUE,
 payload_md5 text NOT NULL,
 workbook_sha256 text NOT NULL,
 source_invoice_no text NOT NULL,
 occurred_at timestamptz NOT NULL,
 source_customer text,
 total_sales_syp numeric(20,4) NOT NULL,
 line_count integer NOT NULL CHECK(line_count>0),
 financial_posted boolean NOT NULL DEFAULT false,
 inventory_posted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(financial_posted=false AND inventory_posted=false)
);
CREATE INDEX IF NOT EXISTS v134_sales_archive_date_idx ON public.v134_sales_archive_documents(occurred_at);
CREATE TABLE IF NOT EXISTS public.v134_sales_archive_lines(
 document_id uuid NOT NULL REFERENCES public.v134_sales_archive_documents(id) ON DELETE CASCADE,
 line_index integer NOT NULL CHECK(line_index>0),
 source_row integer,
 source_name text NOT NULL,
 source_unit text,
 source_quantity numeric(20,6) NOT NULL,
 source_unit_price_syp numeric(20,6),
 menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 match_method text NOT NULL DEFAULT 'unmatched',
 source_net_syp numeric(20,4) NOT NULL,
 source_discount_syp numeric(20,4),
 source_additions_syp numeric(20,4),
 PRIMARY KEY(document_id,line_index)
);
CREATE INDEX IF NOT EXISTS v134_sales_archive_menu_idx ON public.v134_sales_archive_lines(menu_item_id);
CREATE INDEX IF NOT EXISTS v134_sales_archive_name_idx ON public.v134_sales_archive_lines(lower(source_name));
ALTER TABLE public.v134_sales_archive_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v134_sales_archive_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v134_sales_archive_documents,public.v134_sales_archive_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v134_sales_archive_documents,public.v134_sales_archive_lines TO authenticated;
DROP POLICY IF EXISTS v134_sales_archive_owner ON public.v134_sales_archive_documents;
CREATE POLICY v134_sales_archive_owner ON public.v134_sales_archive_documents
 FOR SELECT TO authenticated USING(public.is_app_owner());
DROP POLICY IF EXISTS v134_sales_archive_lines_owner ON public.v134_sales_archive_lines;
CREATE POLICY v134_sales_archive_lines_owner ON public.v134_sales_archive_lines
 FOR SELECT TO authenticated USING(public.is_app_owner());

-- MENU: sale prices belong to dishes; material purchase prices come ONLY from invoices.
-- Catalog materials without a purchase history are inserted separately with zero stock,
-- NULL purchase cost, and an exact name/unit (never guessed historical stock).
-- Unapproved/estimated recipe quantities persist intact in v126_menu_recipe_reviews.
-- Add only recipe/legacy-catalog items after purchases. Re-import is idempotent.
-- The two-sheet workbook is a reference catalog, NOT a stock or price adjustment.
CREATE OR REPLACE FUNCTION public.v134_create_recipe_catalog_materials(p_materials jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $catalog$
DECLARE
 e jsonb;v_name text;v_unit text;v_source text;v_stock numeric;
 v_id uuid;v_count integer;v_created integer:=0;v_existing integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF jsonb_typeof(p_materials)<>'array' OR jsonb_array_length(p_materials)>100 THEN
  RAISE EXCEPTION 'V134_INVALID_MATERIAL_CATALOG';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.purchase_invoice_items LIMIT 1) THEN
  RAISE EXCEPTION 'V134_PURCHASES_MUST_BE_IMPORTED_FIRST';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v134-recipe-catalog',0));
 FOR e IN SELECT value FROM jsonb_array_elements(p_materials) LOOP
  v_name:=btrim(coalesce(e->>'name',''));
  v_unit:=btrim(coalesce(e->>'unit',''));
  v_source:=btrim(coalesce(e->>'source',''));
  IF length(v_name) NOT BETWEEN 1 AND 250 OR length(v_unit) NOT BETWEEN 1 AND 90
    OR v_source NOT IN ('مادة من المنيو والوصفات','كتالوج المنيو القديم')
    OR coalesce(e->>'stock','') NOT IN ('0','0.0','0.00')
    OR (e ? 'price' AND nullif(btrim(e->>'price'),'') IS NOT NULL) THEN
   RAISE EXCEPTION 'V134_INVALID_ZERO_STOCK_CATALOG_MATERIAL: %',v_name;
  END IF;
  SELECT count(*),min(id::text)::uuid INTO v_count,v_id
   FROM public.materials WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name);
  IF v_count>1 THEN RAISE EXCEPTION 'V134_AMBIGUOUS_CATALOG_MATERIAL: %',v_name;END IF;
  IF v_id IS NULL THEN
   v_id:=public.v126_material_for_name(v_name,public.ameen_unit_v024(v_unit),true);
   -- Only the newly inserted item is reset. Existing purchase material rows are untouched.
   UPDATE public.materials SET current_stock_base=0,last_purchase_unit_cost_base=NULL
    WHERE id=v_id;
   v_created:=v_created+1;
  ELSE
   v_existing:=v_existing+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('materialsCreated',v_created,'materialsAlreadyPresent',v_existing,
   'materialPricesImported',0,'stockQuantitiesUpdated',0);
END;
$catalog$;
REVOKE ALL ON FUNCTION public.v134_create_recipe_catalog_materials(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_create_recipe_catalog_materials(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.v134_import_menu_purchase_first(
 p_sha256 text,p_batch_index integer,p_filename text,p_dishes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $menu$
DECLARE
 d jsonb; l jsonb; v_name text;v_matname text;v_menu uuid;v_mat uuid;v_unit uuid;
 v_base uuid;v_count integer;v_qty numeric;v_factor numeric;v_price numeric;
 v_ready boolean;v_reason text;v_total integer:=0;v_published integer:=0;
 v_pending integer:=0;v_created integer:=0;v_unmatched integer:=0;v_cost text;
 v_result jsonb;v_group record;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_sha256 !~ '^[a-f0-9]{64}$' OR coalesce(p_batch_index,-1)<0
    OR length(btrim(coalesce(p_filename,''))) NOT BETWEEN 1 AND 250
    OR jsonb_typeof(p_dishes)<>'array' OR jsonb_array_length(p_dishes) NOT BETWEEN 1 AND 30 THEN
  RAISE EXCEPTION 'V134_INVALID_MENU_IMPORT';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v134-menu-purchase-first',0));
 SELECT stats INTO v_result FROM public.v134_menu_import_batches
 WHERE sha256=p_sha256 AND batch_index=p_batch_index;
 IF FOUND THEN RETURN v_result||jsonb_build_object('duplicateBatch',true); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.purchase_invoice_items LIMIT 1) THEN
  RAISE EXCEPTION 'V134_PURCHASES_MUST_BE_IMPORTED_FIRST';
 END IF;
 CREATE TEMP TABLE IF NOT EXISTS pg_temp.v134_recipe_lines(
  mat uuid PRIMARY KEY,qty numeric(20,6) NOT NULL CHECK(qty>0)
 ) ON COMMIT DROP;
 FOR d IN SELECT value FROM jsonb_array_elements(p_dishes) LOOP
  v_name:=btrim(coalesce(d->>'name',''));
  IF length(v_name) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'V134_INVALID_MENU_NAME';END IF;
  v_price:=NULL;
  IF coalesce(d->>'salePrice','') ~ '^[0-9]+(\.[0-9]+)?$'
    AND (d->>'salePrice')::numeric>0 THEN v_price:=(d->>'salePrice')::numeric; END IF;
  SELECT count(*),min(id::text)::uuid INTO v_count,v_menu FROM public.menu_items
   WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name);
  IF v_count>1 THEN RAISE EXCEPTION 'V134_MENU_NAME_AMBIGUOUS: %',v_name;END IF;
  IF v_menu IS NULL THEN
   INSERT INTO public.menu_items(name,manual_price_original)
   VALUES(v_name,v_price) RETURNING id INTO v_menu;
   v_created:=v_created+1;
  ELSE
   UPDATE public.menu_items SET manual_price_original=coalesce(v_price,manual_price_original),updated_at=now()
    WHERE id=v_menu;
  END IF;
  TRUNCATE pg_temp.v134_recipe_lines;
  v_ready:=coalesce(d->>'status','')='منتهي' AND jsonb_typeof(d->'lines')='array'
     AND jsonb_array_length(d->'lines')>0;
  v_reason:='الوصفة غير معتمدة أو لا تحتوي مكونات';
  FOR l IN SELECT value FROM jsonb_array_elements(coalesce(d->'lines','[]'::jsonb)) LOOP
   v_matname:=btrim(coalesce(l->>'materialName',''));
   IF v_matname='' OR coalesce(l->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
      OR btrim(coalesce(l->>'unit',''))='' THEN
    v_ready:=false;v_reason:='اسم أو كمية أو وحدة مكون ناقصة';CONTINUE;
   END IF;
   v_qty:=(l->>'quantity')::numeric;
   IF v_qty<=0 OR v_qty>100000000 THEN
    v_ready:=false;v_reason:='كمية مكون غير صالحة';CONTINUE;
   END IF;
   IF coalesce(l->>'note','') ILIKE '%تقديري%'
       OR coalesce(l->>'note','') ILIKE '%افتراض%'
       OR coalesce((l->>'needsReview')::boolean,false) THEN
    v_ready:=false;v_reason:='مكونات تقديرية تحتاج اعتماد المحاسب أو الشيف';
   END IF;
   SELECT count(*),min(m.id::text)::uuid INTO v_count,v_mat
    FROM public.materials m
    WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(v_matname);
   IF v_count=0 THEN
    SELECT count(*),min(a.material_id::text)::uuid INTO v_count,v_mat
     FROM public.material_aliases_v106 a
     WHERE a.alias_key=public.material_alias_normalize_v106(v_matname);
   END IF;
   IF v_count<>1 OR v_mat IS NULL THEN
    v_ready:=false;v_reason:='المكون غير موجود في كتالوج المواد أو له أسماء متعارضة';
    v_unmatched:=v_unmatched+1;CONTINUE;
   END IF;
   SELECT base_unit_id INTO v_base FROM public.materials WHERE id=v_mat;
   v_unit:=public.ameen_unit_v024(btrim(l->>'unit'));
   v_factor:=1;
   IF v_unit<>v_base THEN
    SELECT quantity_in_base INTO v_factor FROM public.material_units
       WHERE material_id=v_mat AND unit_id=v_unit LIMIT 1;
    IF v_factor IS NULL THEN v_factor:=public.v126_unit_factor(v_unit,v_base);END IF;
    IF v_factor IS NULL OR v_factor<=0 THEN
     v_ready:=false;v_reason:='وحدة الوصفة تحتاج تحويل معتمد';CONTINUE;
    END IF;
   END IF;
   v_qty:=round(v_qty*v_factor,6);
   IF v_qty<=0 THEN v_ready:=false;v_reason:='كمية محولة صغيرة جدًا';CONTINUE;END IF;
   INSERT INTO pg_temp.v134_recipe_lines(mat,qty) VALUES(v_mat,v_qty)
    ON CONFLICT(mat) DO UPDATE SET qty=v134_recipe_lines.qty+EXCLUDED.qty;
  END LOOP;
  IF v_ready AND (SELECT count(*) FROM pg_temp.v134_recipe_lines)>0 THEN
   DELETE FROM public.menu_item_recipe_items WHERE menu_item_id=v_menu;
   FOR v_group IN SELECT mat,qty FROM pg_temp.v134_recipe_lines LOOP
    SELECT base_unit_id INTO v_unit FROM public.materials WHERE id=v_group.mat;
    PERFORM public.save_menu_recipe_item_v07(v_menu,v_group.mat,v_unit,v_group.qty,NULL);
   END LOOP;
   DELETE FROM public.v126_menu_recipe_reviews WHERE menu_item_id=v_menu;
   v_published:=v_published+1;
  ELSE
   INSERT INTO public.v126_menu_recipe_reviews(menu_item_id,source_sha256,original_status,lines,reason)
    VALUES(v_menu,p_sha256,coalesce(d->>'status',''),coalesce(d->'lines','[]'::jsonb),v_reason)
    ON CONFLICT(menu_item_id) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,
     original_status=EXCLUDED.original_status,lines=EXCLUDED.lines,reason=EXCLUDED.reason,updated_at=now();
   v_pending:=v_pending+1;
  END IF;
  v_total:=v_total+1;
 END LOOP;
 v_result:=jsonb_build_object('menuItems',v_total,'newMenuItems',v_created,
    'recipesPublished',v_published,'recipesPendingReview',v_pending,
    'unresolvedIngredientOccurrences',v_unmatched,'materialsCreated',0,
    'purchasePricesCopied',0,'stockQuantitiesUpdated',0);
 INSERT INTO public.v134_menu_import_batches(sha256,batch_index,filename,stats)
  VALUES(p_sha256,p_batch_index,p_filename,v_result);
 RETURN v_result;
END;
$menu$;
REVOKE ALL ON FUNCTION public.v134_import_menu_purchase_first(text,integer,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_import_menu_purchase_first(text,integer,text,jsonb) TO authenticated;

-- SALE INVOICE ARCHIVE: original Al-Ameen 'مبيع' detailed invoice report.
-- Keeps original signs, invoice numbers, prices and line quantities. No cash,
-- inventory or order posting because this report has no trustworthy payment mode.
CREATE OR REPLACE FUNCTION public.v134_import_sales_archive(
 p_sha256 text,p_documents jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $sales$
DECLARE
 d jsonb;l jsonb;v_checksum_lines jsonb;v_ts timestamptz;v_no text;v_key text;v_old text;v_id uuid;
 v_md5 text;v_total numeric;v_qty numeric;v_price numeric;v_net numeric;
 v_new integer:=0;v_skipped integer:=0;v_lines integer:=0;v_idx integer;
 v_menu_id uuid;v_menu_name text;v_method text;v_matches integer;v_matched integer:=0;v_unmatched integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_sha256 !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_documents)<>'array'
    OR jsonb_array_length(p_documents) NOT BETWEEN 1 AND 15 THEN
  RAISE EXCEPTION 'V134_INVALID_SALES_ARCHIVE_BATCH';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v134-sales-archive',0));
 FOR d IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
  v_no:=btrim(coalesce(d->>'number',''));
  IF v_no NOT LIKE 'مبيع%' OR length(v_no)>150
     OR coalesce(d->>'occurredAt','') !~ '^20[0-9]{2}-[01][0-9]-[0-3][0-9]T'
     OR jsonb_typeof(d->'lines')<>'array'
     OR jsonb_array_length(d->'lines') NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'V134_SALES_ARCHIVE_DOCUMENT_INVALID';END IF;
  v_ts:=(d->>'occurredAt')::timestamptz;
  v_key:=md5(v_no||'|'||v_ts::text);
  -- Stable checksum of the original Al-Ameen invoice: ignore our optional
  -- menu links, so re-uploading a file with improved secondary-name matches
  -- does not masquerade as a changed invoice or duplicate any sale.
  -- Keep the original archive checksum stable while excluding the optional
  -- menu link. Use separate statements to avoid nested SELECT/INTO ambiguity.
  SELECT coalesce(jsonb_agg(sale_row.line - 'menuName' ORDER BY sale_row.ordinal),'[]'::jsonb)
    INTO v_checksum_lines
    FROM jsonb_array_elements(d->'lines') WITH ORDINALITY AS sale_row(line,ordinal);
  v_md5:=md5(jsonb_build_object(
    'number',d->>'number',
    'occurredAt',d->>'occurredAt',
    'customer',d->>'customer',
    'lines',v_checksum_lines
  )::text);
  SELECT payload_md5 INTO v_old FROM public.v134_sales_archive_documents WHERE document_key=v_key;
  IF FOUND THEN
   IF v_old<>v_md5 THEN RAISE EXCEPTION 'V134_SALES_INVOICE_REIMPORT_CONFLICT: %',v_no;END IF;
   v_skipped:=v_skipped+1;CONTINUE;
  END IF;
  v_total:=0;v_idx:=0;
  FOR l IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
   IF length(btrim(coalesce(l->>'name',''))) NOT BETWEEN 1 AND 250
     OR coalesce(l->>'quantity','') !~ '^-?[0-9]+(\.[0-9]+)?$'
     OR coalesce(l->>'net','') !~ '^-?[0-9]+(\.[0-9]+)?$'
     OR coalesce(l->>'unitPrice','') !~ '^[0-9]+(\.[0-9]+)?$' THEN
     RAISE EXCEPTION 'V134_SALES_ARCHIVE_LINE_INVALID: %',v_no;
   END IF;
   v_idx:=v_idx+1;
   v_net:=round((l->>'net')::numeric,4);
   v_total:=v_total-v_net;
  END LOOP;
  INSERT INTO public.v134_sales_archive_documents(
   document_key,payload_md5,workbook_sha256,source_invoice_no,
   occurred_at,source_customer,total_sales_syp,line_count)
   VALUES(v_key,v_md5,p_sha256,v_no,v_ts,left(btrim(coalesce(d->>'customer','')),250),round(v_total,4),v_idx)
   RETURNING id INTO v_id;
  v_idx:=0;
  FOR l IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
   v_idx:=v_idx+1;
   v_menu_id:=NULL;v_method:='unmatched';
   v_menu_name:=btrim(coalesce(l->>'menuName',''));
   IF v_menu_name<>'' THEN
    SELECT count(*),min(id::text)::uuid INTO v_matches,v_menu_id
    FROM public.menu_items
    WHERE public.menu_alias_normalize_v104(name)=public.menu_alias_normalize_v104(v_menu_name)
     AND NOT is_archived_v133;
    IF v_matches=1 THEN v_method:='approved_from_file'; ELSE v_menu_id:=NULL; END IF;
   END IF;
   IF v_menu_id IS NULL THEN
    SELECT menu_id,match_kind INTO v_menu_id,v_method FROM public.menu_match_v104(l->>'name');
    IF v_menu_id IS NOT NULL THEN
      SELECT coalesce(merged_into_menu_id_v133,id) INTO v_menu_id FROM public.menu_items WHERE id=v_menu_id;
    ELSE v_method:='unmatched'; END IF;
   END IF;
   IF v_menu_id IS NULL THEN v_unmatched:=v_unmatched+1; ELSE v_matched:=v_matched+1; END IF;
   INSERT INTO public.v134_sales_archive_lines(document_id,line_index,source_row,
      source_name,source_unit,source_quantity,source_unit_price_syp,menu_item_id,match_method,source_net_syp,
      source_discount_syp,source_additions_syp)
   VALUES(v_id,v_idx,NULLIF(l->>'sourceRow','')::integer,
      left(btrim(l->>'name'),250),left(coalesce(l->>'unit',''),80),
      round((l->>'quantity')::numeric,6),round((l->>'unitPrice')::numeric,6),
      v_menu_id,v_method,round((l->>'net')::numeric,4),
      round(coalesce(nullif(l->>'discount',''),'0')::numeric,4),
      round(coalesce(nullif(l->>'additions',''),'0')::numeric,4));
   v_lines:=v_lines+1;
  END LOOP;
  v_new:=v_new+1;
 END LOOP;
 RETURN jsonb_build_object('documentsCreated',v_new,'documentsAlreadyPresent',v_skipped,
  'linesCreated',v_lines,'matchedLines',v_matched,'unmatchedLines',v_unmatched,
  'currency','SYP','affectsStock',false,'affectsCash',false,
  'mode','historical_archive_only_no_double_counting');
END;
$sales$;
REVOKE ALL ON FUNCTION public.v134_import_sales_archive(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_import_sales_archive(text,jsonb) TO authenticated;


-- Promote ONLY accountant-marked, unambiguous sale spellings as secondary menu names.
-- Existing aliases/manual choices are never replaced. Failures are skipped and counted,
-- never rebind historical items to a different menu item.
CREATE OR REPLACE FUNCTION public.v134_register_sales_aliases(p_pairs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $aliases$
DECLARE
 p jsonb;v_id uuid;v_name text;v_menu text;v_count int;
 v_new integer:=0;v_existing integer:=0;v_review integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF jsonb_typeof(p_pairs)<>'array' OR jsonb_array_length(p_pairs)>70 THEN
  RAISE EXCEPTION 'V134_SALES_ALIAS_BATCH_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v134-sale-aliases',0));
 FOR p IN SELECT value FROM jsonb_array_elements(p_pairs) LOOP
  v_name:=btrim(coalesce(p->>'sourceName',''));
  v_menu:=btrim(coalesce(p->>'menuName',''));
  IF length(v_name) NOT BETWEEN 1 AND 180 OR length(v_menu) NOT BETWEEN 1 AND 250 THEN
   v_review:=v_review+1;CONTINUE;END IF;
  SELECT count(*),min(id::text)::uuid INTO v_count,v_id FROM public.menu_items
   WHERE NOT is_archived_v133 AND public.menu_alias_normalize_v104(name)=public.menu_alias_normalize_v104(v_menu);
  IF v_count<>1 THEN v_review:=v_review+1;CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
     WHERE a.alias_key=public.menu_alias_normalize_v104(v_name) AND a.menu_item_id=v_id)
     OR public.menu_alias_normalize_v104(v_menu)=public.menu_alias_normalize_v104(v_name) THEN
    v_existing:=v_existing+1;CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM public.menu_item_aliases_v104 a
     WHERE a.alias_key=public.menu_alias_normalize_v104(v_name) AND a.menu_item_id<>v_id)
    OR EXISTS(SELECT 1 FROM public.menu_items m
     WHERE NOT m.is_archived_v133 AND m.id<>v_id
      AND public.menu_alias_normalize_v104(m.name)=public.menu_alias_normalize_v104(v_name))
    OR (SELECT count(*) FROM public.menu_item_aliases_v104 WHERE menu_item_id=v_id)>=40 THEN
   v_review:=v_review+1;CONTINUE;END IF;
  PERFORM public.menu_alias_add_v104(v_id,v_name);
  v_new:=v_new+1;
 END LOOP;
 RETURN jsonb_build_object('aliasesAdded',v_new,'alreadyRegistered',v_existing,'heldForReview',v_review);
END;
$aliases$;
REVOKE ALL ON FUNCTION public.v134_register_sales_aliases(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_register_sales_aliases(jsonb) TO authenticated;

-- Small read-only dashboard for the five setup stages. Presence is not completeness.
CREATE OR REPLACE FUNCTION public.v134_initial_setup_progress()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $status$
SELECT CASE WHEN public.is_app_owner() THEN jsonb_build_object(
 'purchaseInvoices',(SELECT count(*) FROM public.v126_historical_invoices),
 'purchasedMaterials',(SELECT count(DISTINCT material_id) FROM public.purchase_invoice_items),
 'menuItems',(SELECT count(*) FROM public.menu_items WHERE NOT is_archived_v133),
 'countedMaterials',(SELECT count(*) FROM public.v126_physical_counts),
 'salesInvoices',(SELECT count(*) FROM public.v134_sales_archive_documents),
 'salesLines',(SELECT count(*) FROM public.v134_sales_archive_lines),
 'linkedSalesLines',(SELECT count(*) FROM public.v134_sales_archive_lines WHERE menu_item_id IS NOT NULL),
 'employees',(SELECT count(*) FROM public.employees)) ELSE '{}'::jsonb END;
$status$;
REVOKE ALL ON FUNCTION public.v134_initial_setup_progress() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_initial_setup_progress() TO authenticated;

-- Independent, read-only historical sales invoice register; never posted to cashboxes or stock.
CREATE OR REPLACE FUNCTION public.v134_sales_archive_list(p_limit integer DEFAULT 50,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $list$
SELECT CASE WHEN public.is_app_owner() THEN jsonb_build_object(
 'totalInvoices',(SELECT count(*) FROM public.v134_sales_archive_documents),
 'totalLines',(SELECT count(*) FROM public.v134_sales_archive_lines),
 'linkedLines',(SELECT count(*) FROM public.v134_sales_archive_lines WHERE menu_item_id IS NOT NULL),
 'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'number',d.source_invoice_no,'date',d.occurred_at,
  'amount',d.total_sales_syp,'lines',d.line_count,'linked',
   (SELECT count(*) FROM public.v134_sales_archive_lines l WHERE l.document_id=d.id AND l.menu_item_id IS NOT NULL),
  'id',d.id) ORDER BY d.occurred_at DESC,d.source_invoice_no)
 FROM (SELECT * FROM public.v134_sales_archive_documents ORDER BY occurred_at DESC,source_invoice_no
       LIMIT least(greatest(p_limit,1),100) OFFSET greatest(p_offset,0)) d),'[]'::jsonb)
) ELSE '{}'::jsonb END;
$list$;
REVOKE ALL ON FUNCTION public.v134_sales_archive_list(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_sales_archive_list(integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.v134_sales_archive_invoice(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $invoice$
SELECT CASE WHEN public.is_app_owner() THEN coalesce((SELECT jsonb_build_object(
 'number',d.source_invoice_no,'date',d.occurred_at,'amount',d.total_sales_syp,
 'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'name',l.source_name,'quantity',l.source_quantity,'price',l.source_unit_price_syp,
  'net',l.source_net_syp,'menu',m.name,'matched',l.menu_item_id IS NOT NULL,'method',l.match_method)
  ORDER BY l.line_index) FROM public.v134_sales_archive_lines l LEFT JOIN public.menu_items m ON m.id=l.menu_item_id
  WHERE l.document_id=d.id),'[]'::jsonb)) FROM public.v134_sales_archive_documents d WHERE d.id=p_id),'{}'::jsonb)
 ELSE '{}'::jsonb END;
$invoice$;
REVOKE ALL ON FUNCTION public.v134_sales_archive_invoice(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v134_sales_archive_invoice(uuid) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
