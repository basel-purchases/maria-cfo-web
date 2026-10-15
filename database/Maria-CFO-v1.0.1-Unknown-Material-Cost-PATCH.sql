-- Maria CFO v1.0.1 - materials with zero stock and unknown purchase price
-- Apply ONCE in Supabase SQL Editor BEFORE importing the corrected Excel file.
-- This only replaces the central import RPC; no business records are deleted.
-- A zero opening price is an UNKNOWN COST (stored as NULL), never a real zero-cost recipe.
BEGIN;

CREATE OR REPLACE FUNCTION public.quick_import_v030(
 p_kind text,p_filename text,p_sha256 text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_run uuid;v_old_run uuid;v_old_summary jsonb;
 v_created int:=0;v_updated int:=0;v_review int:=0;v_skipped int:=0;
 v_rec jsonb;v_line jsonb;v_dish jsonb;v_group record;
 v_mat uuid;v_base uuid;v_unit uuid;v_menu uuid;v_id uuid;v_cat uuid;
 v_old jsonb;v_new jsonb;v_pre_recipe jsonb;v_status text;
 v_name text;v_key text;v_unit_name text;v_matname text;v_reason text;
 v_qty numeric;v_price numeric;v_delta numeric;v_stock numeric;
 v_count int;v_line_count int;v_complete boolean;v_recipe_ok boolean;
 v_published int:=0;v_pending int:=0;v_order_drafts int:=0;
 v_account text;v_supplier uuid;v_balance jsonb;v_record jsonb;
 v_ts timestamptz;v_day date;v_orderno text;v_order uuid;
 v_warning text;v_all int;v_matching int;v_supplier_name text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_kind NOT IN ('master','assets','suppliers','orders') THEN RAISE EXCEPTION 'INVALID_QUICK_IMPORT_TYPE'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'INVALID_IMPORT_SHA256'; END IF;
 IF length(coalesce(p_filename,'')) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'INVALID_IMPORT_FILENAME'; END IF;
 IF p_payload IS NULL OR pg_column_size(p_payload)>10000000 THEN RAISE EXCEPTION 'INVALID_OR_OVERSIZED_PAYLOAD'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v030-central-import',0));
 SELECT id,summary INTO v_old_run,v_old_summary FROM public.quick_import_runs_v030
  WHERE kind=p_kind AND sha256=p_sha256 AND undone_at IS NULL LIMIT 1;
 IF v_old_run IS NOT NULL THEN RETURN v_old_summary||jsonb_build_object('duplicateFile',true,'runId',v_old_run);END IF;
 IF (p_kind='master' AND (jsonb_typeof(p_payload)<>'object' OR jsonb_typeof(p_payload->'materials')<>'array' OR jsonb_typeof(p_payload->'dishes')<>'array'))
    OR (p_kind<>'master' AND jsonb_typeof(p_payload)<>'array') THEN
   RAISE EXCEPTION 'INVALID_EXCEL_PAYLOAD_STRUCTURE'; END IF;
 v_all:=CASE WHEN p_kind='master' THEN jsonb_array_length(p_payload->'materials')+jsonb_array_length(p_payload->'dishes')
     ELSE jsonb_array_length(p_payload) END;
 IF v_all<1 OR v_all>5000 THEN RAISE EXCEPTION 'IMPORT_COUNT_OUT_OF_RANGE: %',v_all; END IF;
 INSERT INTO public.quick_import_runs_v030(kind,filename,sha256)
 VALUES(p_kind,p_filename,p_sha256) RETURNING id INTO v_run;

 IF p_kind='master' THEN
  -- Master material stock = checked snapshot, NOT cumulative historical purchases.
  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload->'materials') LOOP
   v_name:=btrim(coalesce(v_rec->>'name',''));
   v_unit_name:=btrim(coalesce(v_rec->>'unit',''));
   IF length(v_name) NOT BETWEEN 1 AND 250 OR length(v_unit_name) NOT BETWEEN 1 AND 90
      OR coalesce(v_rec->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
      OR coalesce(v_rec->>'lastPrice','') !~ '^[0-9]+(\.[0-9]+)?$'
   THEN RAISE EXCEPTION 'MASTER_MATERIAL_ROW_INVALID: %',v_name; END IF;
   v_qty:=(v_rec->>'quantity')::numeric;v_price:=(v_rec->>'lastPrice')::numeric;
   IF v_qty>1000000000000 OR v_price<0 OR (v_price=0 AND v_qty>0) OR v_price>1000000000000 THEN
     RAISE EXCEPTION 'MASTER_MATERIAL_QUANTITY_OR_COST_INVALID: %',v_name; END IF;
   SELECT id,base_unit_id INTO v_mat,v_base FROM public.materials
    WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name)
    ORDER BY id LIMIT 1 FOR UPDATE;
   v_old:=NULL;
   IF v_mat IS NOT NULL THEN
     SELECT to_jsonb(m) INTO v_old FROM public.materials m WHERE id=v_mat;
     v_unit:=public.ameen_unit_v024(v_unit_name);
     IF v_base<>v_unit THEN RAISE EXCEPTION 'MASTER_UNIT_CHANGED_REVIEW: %',v_name; END IF;
   ELSE
     v_unit:=public.ameen_unit_v024(v_unit_name);
     IF EXISTS(SELECT 1 FROM public.units u WHERE u.id=v_unit AND u.created_at=now())
       AND NOT EXISTS(SELECT 1 FROM public.quick_import_changes_v030 c
         WHERE c.run_id=v_run AND c.entity_type='unit' AND c.entity_key=v_unit::text) THEN
       SELECT to_jsonb(u) INTO v_new FROM public.units u WHERE u.id=v_unit;
       PERFORM public.quick_import_log_v030(v_run,'unit',v_unit::text,NULL,v_new);
     END IF;
     INSERT INTO public.materials(name,code,base_unit_id)
      VALUES(v_name, 'MC030-'||upper(substr(md5(v_name),1,14)),v_unit)
      RETURNING id INTO v_mat;
     v_created:=v_created+1;
   END IF;
   UPDATE public.materials SET last_purchase_unit_cost_base=CASE WHEN v_price>0 THEN v_price ELSE last_purchase_unit_cost_base END,
    last_purchase_at=CASE WHEN v_price>0 AND coalesce(v_rec->>'priceDate','') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (v_rec->>'priceDate')::date::timestamptz ELSE last_purchase_at END,
    updated_at=now() WHERE id=v_mat;
   SELECT current_stock_base INTO v_stock FROM public.materials WHERE id=v_mat FOR UPDATE;
   v_delta:=round(v_qty-v_stock,8);
   IF v_delta<>0 THEN
    PERFORM public.record_inventory_movement(v_mat,
     CASE WHEN v_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
     v_delta,NULL,now(),'manual_adjustment',v_run,NULL,'رصيد افتتاحي من ملف Maria CFO v0.30');
   END IF;
   SELECT to_jsonb(m) INTO v_new FROM public.materials m WHERE id=v_mat;
   PERFORM public.quick_import_log_v030(v_run,'material',v_mat::text,v_old,v_new);
   IF v_old IS NOT NULL THEN v_updated:=v_updated+1;END IF;
  END LOOP;

  FOR v_dish IN SELECT value FROM jsonb_array_elements(p_payload->'dishes') LOOP
   v_name:=btrim(coalesce(v_dish->>'name',''));
   IF length(v_name) NOT BETWEEN 1 AND 250 OR jsonb_typeof(v_dish->'lines')<>'array'
      OR (v_dish->>'salePrice' IS NOT NULL AND (coalesce(v_dish->>'salePrice','') !~ '^[0-9]+(\.[0-9]+)?$' OR (v_dish->>'salePrice')::numeric<0))
   THEN RAISE EXCEPTION 'MASTER_MENU_ROW_INVALID: %',v_name; END IF;
   v_price:=nullif((v_dish->>'salePrice')::numeric,0);
   SELECT id INTO v_menu FROM public.menu_items
     WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name)
     ORDER BY id LIMIT 1 FOR UPDATE;
   v_old:=NULL;
   IF v_menu IS NULL THEN
      INSERT INTO public.menu_items(name,manual_price_original) VALUES(v_name,v_price) RETURNING id INTO v_menu;
      v_created:=v_created+1;
   ELSE
      SELECT to_jsonb(mi) INTO v_old FROM public.menu_items mi WHERE id=v_menu;
      UPDATE public.menu_items SET manual_price_original=coalesce(v_price,manual_price_original),updated_at=now() WHERE id=v_menu;
      v_updated:=v_updated+1;
   END IF;
   SELECT to_jsonb(mi) INTO v_new FROM public.menu_items mi WHERE id=v_menu;
   PERFORM public.quick_import_log_v030(v_run,'menu',v_menu::text,v_old,v_new);
   v_pre_recipe:=public.quick_import_recipe_state_v030(v_menu);
   v_complete:=coalesce(v_dish->>'status','')='منتهي'
       AND EXISTS(SELECT 1 FROM public.menu_items WHERE id=v_menu AND manual_price_original>0)
       AND jsonb_array_length(v_dish->'lines')>0;
   v_reason:=NULL;
   CREATE TEMP TABLE IF NOT EXISTS pg_temp.v030_recipe_lines (
     material_id uuid PRIMARY KEY,qty numeric NOT NULL) ON COMMIT DROP;
   TRUNCATE pg_temp.v030_recipe_lines;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_dish->'lines') LOOP
     v_matname:=btrim(coalesce(v_line->>'materialName',''));
     v_qty:=NULL;
     IF coalesce(v_line->>'quantity','') ~ '^[0-9]+(\.[0-9]+)?$'
       THEN v_qty:=(v_line->>'quantity')::numeric; END IF;
     IF v_matname='' OR coalesce(v_line->>'needsReview','false')='true'
        OR v_qty IS NULL OR v_qty<=0 OR v_qty>10000000 THEN
         v_complete:=false;v_reason:='مكونات أو كميات غير مكتملة';CONTINUE;
     END IF;
     SELECT id,base_unit_id INTO v_mat,v_base FROM public.materials
        WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_matname)
        ORDER BY id LIMIT 1;
     IF v_mat IS NULL THEN v_complete:=false;v_reason:='مادة غير موجودة في كتالوج المواد';CONTINUE;END IF;
     IF NOT EXISTS (SELECT 1 FROM public.materials m WHERE m.id=v_mat AND m.last_purchase_unit_cost_base>0) THEN
       v_complete:=false;v_reason:='سعر شراء مادة غير معروف';CONTINUE;
     END IF;
     IF btrim(coalesce(v_line->>'unit',''))<>'' AND NOT public.recipe_unit_matches_v028(v_base,v_line->>'unit') THEN
        v_complete:=false;v_reason:='وحدة مكون لا تطابق وحدة المادة';CONTINUE;
     END IF;
     INSERT INTO pg_temp.v030_recipe_lines(material_id,qty) VALUES(v_mat,v_qty)
     ON CONFLICT(material_id) DO UPDATE SET qty=v030_recipe_lines.qty+excluded.qty;
   END LOOP;
   IF (SELECT count(*) FROM pg_temp.v030_recipe_lines)=0 THEN v_complete:=false;END IF;
   IF v_complete THEN
     -- Back up and replace ONLY approved, complete recipes.
     DELETE FROM public.menu_item_recipe_items WHERE menu_item_id=v_menu;
     FOR v_group IN SELECT material_id,qty FROM pg_temp.v030_recipe_lines LOOP
       SELECT base_unit_id INTO v_unit FROM public.materials WHERE id=v_group.material_id;
       PERFORM public.save_menu_recipe_item_v07(v_menu,v_group.material_id,v_unit,v_group.qty,NULL);
     END LOOP;
     v_published:=v_published+1;
   ELSE
     -- Even a priced meal stays without cost if recipe is incomplete.
     DELETE FROM public.menu_item_recipe_items WHERE menu_item_id=v_menu;
     v_pending:=v_pending+1;v_review:=v_review+1;
   END IF;
   PERFORM public.quick_import_log_v030(v_run,'recipe',v_menu::text,v_pre_recipe,
       public.quick_import_recipe_state_v030(v_menu));
   INSERT INTO public.quick_import_recipe_drafts_v030(run_id,menu_item_id,source_status,lines,review_reason)
     VALUES(v_run,v_menu,coalesce(v_dish->>'status',''),v_dish->'lines',
        CASE WHEN v_complete THEN NULL ELSE coalesce(v_reason,'بحاجة إلى إكمال أو اعتماد الوصفة') END);
  END LOOP;

 ELSIF p_kind='assets' THEN
  -- Only asset rows reach this branch; server re-check prevents forged material/menu records.
  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
    IF coalesce(v_rec->>'kind','')<>'asset' THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
    v_name:=btrim(coalesce(v_rec->>'name',''));
    IF length(v_name) NOT BETWEEN 1 AND 250 OR coalesce(v_rec->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
       OR coalesce(v_rec->>'warehouse','')='' THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
    IF (v_rec->>'quantity')::numeric<=0 THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
  END LOOP;
  FOR v_group IN
    SELECT lower(btrim(x.r->>'name')) AS key, (array_agg(x.r->>'name'))[1] AS name,
      (array_agg(x.r->>'unit'))[1] AS unit,
      (array_agg(x.r->>'category'))[1] AS category,
      sum((x.r->>'quantity')::numeric) AS qty
    FROM jsonb_array_elements(p_payload) x(r)
    WHERE x.r->>'kind'='asset' AND nullif(btrim(x.r->>'warehouse'),'') IS NOT NULL
      AND coalesce(x.r->>'quantity','') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (x.r->>'quantity')::numeric>0 AND nullif(btrim(x.r->>'name'),'') IS NOT NULL
    GROUP BY lower(btrim(x.r->>'name'))
  LOOP
    SELECT id INTO v_id FROM public.restaurant_assets_v023
       WHERE lower(btrim(name))=v_group.key LIMIT 1 FOR UPDATE;
    v_old:=NULL;
    v_cat:=public.ameen_catalog_category_v024('asset',v_group.category);
    IF v_cat IS NOT NULL AND EXISTS(SELECT 1 FROM public.asset_categories_v023 ac
      WHERE ac.id=v_cat AND ac.created_at=now()) AND NOT EXISTS(
      SELECT 1 FROM public.quick_import_changes_v030 c
      WHERE c.run_id=v_run AND c.entity_type='asset_category' AND c.entity_key=v_cat::text) THEN
      SELECT to_jsonb(ac) INTO v_new FROM public.asset_categories_v023 ac WHERE ac.id=v_cat;
      PERFORM public.quick_import_log_v030(v_run,'asset_category',v_cat::text,NULL,v_new);
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.restaurant_assets_v023(name,category_id,quantity,minimum_quantity,ameen_unit_v024)
      VALUES(v_group.name,v_cat,v_group.qty,0,v_group.unit) RETURNING id INTO v_id;
      v_created:=v_created+1;
    ELSE
      SELECT to_jsonb(a) INTO v_old FROM public.restaurant_assets_v023 a WHERE id=v_id;
      UPDATE public.restaurant_assets_v023 SET quantity=v_group.qty,
        category_id=coalesce(v_cat,category_id),
        ameen_unit_v024=coalesce(nullif(v_group.unit,''),ameen_unit_v024),updated_at=now() WHERE id=v_id;
      v_updated:=v_updated+1;
    END IF;
    SELECT to_jsonb(a) INTO v_new FROM public.restaurant_assets_v023 a WHERE id=v_id;
    PERFORM public.quick_import_log_v030(v_run,'asset',v_id::text,v_old,v_new);
  END LOOP;

 ELSIF p_kind='suppliers' THEN
   FOR v_group IN SELECT DISTINCT btrim(x.r->>'accountCode') AS account
     FROM jsonb_array_elements(p_payload) x(r) LOOP
     v_account:=v_group.account;
     IF coalesce(v_account,'')='' OR length(v_account)>70 THEN RAISE EXCEPTION 'SUPPLIER_CODE_INVALID';END IF;
     SELECT x.r INTO v_record FROM jsonb_array_elements(p_payload) WITH ORDINALITY x(r,ord)
      WHERE btrim(x.r->>'accountCode')=v_account ORDER BY x.ord DESC LIMIT 1;
     v_supplier_name:=btrim(coalesce(v_record->>'name',''));
     IF length(v_supplier_name) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'SUPPLIER_NAME_INVALID';END IF;
     SELECT id INTO v_supplier FROM public.suppliers WHERE ameen_account_code_v024=v_account LIMIT 1 FOR UPDATE;
     IF v_supplier IS NULL THEN
       SELECT id INTO v_supplier FROM public.suppliers
         WHERE lower(btrim(name))=lower(v_supplier_name) AND ameen_account_code_v024 IS NULL
         ORDER BY id LIMIT 1 FOR UPDATE;
     END IF;
     v_old:=NULL;
     IF v_supplier IS NULL THEN
       INSERT INTO public.suppliers(name,ameen_account_code_v024)
        VALUES(v_supplier_name,v_account) RETURNING id INTO v_supplier;v_created:=v_created+1;
     ELSE
       SELECT to_jsonb(s) INTO v_old FROM public.suppliers s WHERE id=v_supplier;
       UPDATE public.suppliers SET name=v_supplier_name,ameen_account_code_v024=v_account,updated_at=now()
         WHERE id=v_supplier;
       v_updated:=v_updated+1;
     END IF;
     SELECT to_jsonb(s) INTO v_new FROM public.suppliers s WHERE id=v_supplier;
     PERFORM public.quick_import_log_v030(v_run,'supplier',v_supplier::text,v_old,v_new);
     SELECT to_jsonb(b) INTO v_old FROM public.ameen_supplier_balances_v024 b
       WHERE external_account=v_account FOR UPDATE;
     INSERT INTO public.ameen_supplier_balances_v024
       (external_account,supplier_id,supplier_name,previous_balance,total_debit,total_credit,
        current_balance,uncollected_papers_v025)
     VALUES(v_account,v_supplier,v_supplier_name,
       coalesce((v_record->>'previousBalance')::numeric,0),
       coalesce((v_record->>'summaryDebit')::numeric,0),
       coalesce((v_record->>'summaryCredit')::numeric,0),
       coalesce((v_record->>'currentBalance')::numeric,0),
       coalesce((v_record->>'uncollectedPapers')::numeric,0))
     ON CONFLICT(external_account) DO UPDATE SET
       supplier_name=excluded.supplier_name,supplier_id=excluded.supplier_id,
       previous_balance=excluded.previous_balance,total_debit=excluded.total_debit,
       total_credit=excluded.total_credit,current_balance=excluded.current_balance,
       uncollected_papers_v025=excluded.uncollected_papers_v025,updated_at=now();
     SELECT to_jsonb(b) INTO v_new FROM public.ameen_supplier_balances_v024 b WHERE external_account=v_account;
     PERFORM public.quick_import_log_v030(v_run,'supplier_balance',v_account,v_old,v_new);
   END LOOP;
   FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
     v_account:=btrim(coalesce(v_rec->>'accountCode',''));
     v_key:=btrim(coalesce(v_rec->>'key',''));
     IF v_key='' OR length(v_key)>950 OR coalesce(v_rec->>'occurredAt','')='' THEN
       RAISE EXCEPTION 'SUPPLIER_LEDGER_ROW_INVALID';END IF;
     IF EXISTS(SELECT 1 FROM public.ameen_supplier_entries_v024 WHERE source_key=v_key) THEN
       v_skipped:=v_skipped+1;CONTINUE;
     END IF;
     INSERT INTO public.ameen_supplier_entries_v024
       (source_key,external_account,occurred_at,source_document,debit,credit,description)
     VALUES(v_key,v_account,(v_rec->>'occurredAt')::timestamptz,v_rec->>'document',
       coalesce((v_rec->>'debit')::numeric,0),coalesce((v_rec->>'credit')::numeric,0),v_rec->>'note');
     SELECT to_jsonb(e) INTO v_new FROM public.ameen_supplier_entries_v024 e WHERE source_key=v_key;
     PERFORM public.quick_import_log_v030(v_run,'supplier_entry',v_key,NULL,v_new);
     v_created:=v_created+1;
   END LOOP;

 ELSE -- orders
   FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
     v_orderno:=btrim(coalesce(v_rec->>'number',''));
     IF length(v_orderno) NOT BETWEEN 1 AND 100 OR coalesce(v_rec->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR jsonb_typeof(v_rec->'items')<>'array' OR jsonb_array_length(v_rec->'items')=0
     THEN RAISE EXCEPTION 'ORDER_REPORT_INVALID'; END IF;
     v_day:=(v_rec->>'date')::date;
     v_ts:=(v_rec->>'occurredAt')::timestamptz;
     v_reason:=NULL;
     IF EXISTS(SELECT 1 FROM public.orders WHERE business_date=v_day AND external_order_number=v_orderno AND status<>'voided') THEN
       v_reason:='هذا الرقم والتاريخ موجودان مسبقًا؛ لم تُعدّل بياناته.';v_skipped:=v_skipped+1;
     END IF;
     v_order:=NULL;
     IF v_reason IS NULL THEN
       v_order:=public.create_order(p_cashbox_id=>NULL,p_external_order_number=>v_orderno,
         p_currency_code=>'SYP',p_occurred_at=>v_ts,
         p_entry_method=>'manual',p_source_fingerprint=>'quick-v030:'||md5(v_day::text||'|'||v_orderno),
         p_notes=>'مسودة مستوردة من حركة الطلبات؛ يُراجع الصافي ولا تُنشر تلقائيًا.');
       PERFORM public.set_order_rates_v023(v_order,0,0,0);
       FOR v_line IN SELECT value FROM jsonb_array_elements(v_rec->'items') LOOP
         v_name:=btrim(coalesce(v_line->>'name',''));
         IF length(v_name) NOT BETWEEN 1 AND 250 OR (v_line->>'quantity')::numeric<=0 OR (v_line->>'unitPrice')::numeric<0
           THEN RAISE EXCEPTION 'ORDER_LINE_INVALID: %',v_orderno;END IF;
         SELECT id INTO v_menu FROM public.menu_items
           WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name)
           ORDER BY id LIMIT 1;
         IF v_menu IS NULL THEN
           INSERT INTO public.menu_items(name,manual_price_original,ameen_sale_unit_v024,notes)
            VALUES(v_name,(v_line->>'unitPrice')::numeric,v_line->>'unit',
              'صنف مبيعات من حركة الطلبات؛ يحتاج مطابقة مع المنيو') RETURNING id INTO v_menu;
           SELECT to_jsonb(mi) INTO v_new FROM public.menu_items mi WHERE id=v_menu;
           PERFORM public.quick_import_log_v030(v_run,'order_menu',v_menu::text,NULL,v_new);
           v_created:=v_created+1;v_review:=v_review+1;
         END IF;
         PERFORM public.add_order_item_v013(v_order,v_menu,
          (v_line->>'quantity')::numeric,(v_line->>'unitPrice')::numeric,0,v_name);
       END LOOP;
       PERFORM public.quick_import_log_v030(v_run,'order',v_order::text,NULL,
         public.quick_import_order_state_v030(v_order));
       v_created:=v_created+1;v_order_drafts:=v_order_drafts+1;
       IF jsonb_array_length(coalesce(v_rec->'reviewReasons','[]'::jsonb))>0 THEN
         v_review:=v_review+1;v_reason:=array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_rec->'reviewReasons')),'؛ ');
       END IF;
     END IF;
     INSERT INTO public.quick_import_order_rows_v030
       (run_id,business_date,external_number,source_payload,linked_order_id,review_note)
     VALUES(v_run,v_day,v_orderno,v_rec,v_order,v_reason);
   END LOOP;
 END IF;

 v_balance:=jsonb_build_object('created',v_created,'updated',v_updated,'review',v_review,
    'skipped',v_skipped,'duplicateFile',false,'runId',v_run,
    'recipesPublished',CASE WHEN p_kind='master' THEN v_published ELSE NULL END,
    'recipesPending',CASE WHEN p_kind='master' THEN v_pending ELSE NULL END,
    'ordersDraft',CASE WHEN p_kind='orders' THEN v_order_drafts ELSE NULL END,
    'undoUntil',(SELECT expires_at FROM public.quick_import_runs_v030 WHERE id=v_run),
    'note','Operation is atomic; 24-hour undo requires unchanged, unused records.');
 UPDATE public.quick_import_runs_v030 SET summary=v_balance WHERE id=v_run;
 RETURN v_balance;
END;$$;

REVOKE ALL ON FUNCTION public.quick_import_v030(text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quick_import_v030(text,text,text,jsonb) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
