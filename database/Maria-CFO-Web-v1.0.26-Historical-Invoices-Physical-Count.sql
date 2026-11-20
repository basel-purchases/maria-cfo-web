-- Maria CFO Web v1.0.26 | Historical Al-Ameen purchase invoices, menu-only,
-- and date-aware physical inventory. Run after all migrations up to v1.0.25.
-- Does NOT reset any data, post supplier cash payments, or assume USD FX.
BEGIN;

CREATE TABLE IF NOT EXISTS public.v126_historical_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_key text NOT NULL UNIQUE,
 payload_md5 text NOT NULL,
 workbook_sha256 text NOT NULL,
 invoice_id uuid NOT NULL UNIQUE REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
 source_number text NOT NULL,
 source_date date NOT NULL,
 source_supplier text NOT NULL,
 original_total_syp numeric(20,4) NOT NULL,
 settlement_assertion text NOT NULL DEFAULT 'paid_outside_system_by_operator',
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v126_historic_settled_check CHECK (settlement_assertion='paid_outside_system_by_operator')
);
CREATE INDEX IF NOT EXISTS v126_historical_date_idx ON public.v126_historical_invoices(source_date);
ALTER TABLE public.v126_historical_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v126_historical_owner ON public.v126_historical_invoices;
CREATE POLICY v126_historical_owner ON public.v126_historical_invoices
 FOR SELECT TO authenticated USING (public.is_app_owner());
GRANT SELECT ON public.v126_historical_invoices TO authenticated;

CREATE TABLE IF NOT EXISTS public.v126_physical_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
 count_date date NOT NULL,
 count_timezone text NOT NULL,
 counted_quantity numeric(20,6) NOT NULL CHECK(counted_quantity>=0),
 count_unit_id uuid NOT NULL REFERENCES public.units(id),
 counted_base numeric(20,6) NOT NULL,
 expected_before_base numeric(20,6) NOT NULL,
 adjustment_delta_base numeric(20,6) NOT NULL,
 resulting_current_base numeric(20,6) NOT NULL,
 adjustment_movement_id uuid UNIQUE REFERENCES public.inventory_movements(id),
 source_sha256 text NOT NULL,
 source_department text,
 operator_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(material_id,count_date)
);
CREATE INDEX IF NOT EXISTS v126_physical_by_day_idx ON public.v126_physical_counts(count_date);
ALTER TABLE public.v126_physical_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v126_counts_owner ON public.v126_physical_counts;
CREATE POLICY v126_counts_owner ON public.v126_physical_counts FOR SELECT TO authenticated USING (public.is_app_owner());
GRANT SELECT ON public.v126_physical_counts TO authenticated;

CREATE TABLE IF NOT EXISTS public.v126_menu_only_imports (
 sha256 text PRIMARY KEY,filename text NOT NULL,stats jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.v126_menu_only_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v126_menu_imports_owner ON public.v126_menu_only_imports;
CREATE POLICY v126_menu_imports_owner ON public.v126_menu_only_imports FOR SELECT TO authenticated USING (public.is_app_owner());
GRANT SELECT ON public.v126_menu_only_imports TO authenticated;
CREATE TABLE IF NOT EXISTS public.v126_menu_recipe_reviews (
 menu_item_id uuid PRIMARY KEY REFERENCES public.menu_items(id) ON DELETE CASCADE,
 source_sha256 text NOT NULL,
 original_status text NOT NULL,
 lines jsonb NOT NULL,
 reason text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.v126_menu_recipe_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v126_menu_review_owner ON public.v126_menu_recipe_reviews;
CREATE POLICY v126_menu_review_owner ON public.v126_menu_recipe_reviews FOR SELECT TO authenticated USING (public.is_app_owner());
GRANT SELECT ON public.v126_menu_recipe_reviews TO authenticated;

-- Only dimensional conversions are safe; never infer package/carton sizes.
CREATE OR REPLACE FUNCTION public.v126_unit_factor(p_from uuid,p_to uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a text;b text;
BEGIN
 IF p_from=p_to THEN RETURN 1; END IF;
 SELECT upper(code) INTO a FROM public.units WHERE id=p_from;
 SELECT upper(code) INTO b FROM public.units WHERE id=p_to;
 RETURN CASE WHEN a='KG' AND b='G' THEN 1000
             WHEN a='G' AND b='KG' THEN 0.001
             WHEN a='L' AND b='ML' THEN 1000
             WHEN a='ML' AND b='L' THEN 0.001
             ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION public.v126_unit_factor(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v126_unit_factor(uuid,uuid) TO authenticated;

-- Material lookup deliberately uses exact normalized names only, not fuzzy SKU matching.
CREATE OR REPLACE FUNCTION public.v126_material_for_name(p_name text,p_unit uuid,p_create boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;v_oldunit uuid;v_factor numeric;v_n int;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT count(*) INTO v_n FROM public.materials
 WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(p_name);
 SELECT id INTO v_id FROM public.materials
 WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(p_name) ORDER BY id LIMIT 1;
 IF v_n>1 THEN RAISE EXCEPTION 'AMBIGUOUS_MATERIAL_NAME: %',p_name; END IF;
 IF v_id IS NULL THEN
   IF NOT p_create THEN RAISE EXCEPTION 'UNKNOWN_MATERIAL_IN_COUNT: %',p_name; END IF;
   INSERT INTO public.materials(name,code,base_unit_id,notes)
    VALUES(left(btrim(p_name),250),'H126-'||upper(substr(md5(public.recipe_key_normalize_v027(p_name)),1,20)),p_unit,
     'أُنشئت من حركة فواتير الأمين التاريخية أو كتالوج المنيو؛ يلزم التحقق من وحدات العبوات')
    RETURNING id INTO v_id;
 END IF;
 SELECT base_unit_id INTO v_oldunit FROM public.materials WHERE id=v_id FOR UPDATE;
 IF p_unit<>v_oldunit THEN
   SELECT quantity_in_base INTO v_factor FROM public.material_units
   WHERE material_id=v_id AND unit_id=p_unit LIMIT 1;
   IF v_factor IS NULL THEN
     v_factor:=public.v126_unit_factor(p_unit,v_oldunit);
     IF v_factor IS NULL THEN RAISE EXCEPTION 'PACKAGE_UNIT_CONVERSION_REQUIRES_REVIEW: %',p_name; END IF;
     INSERT INTO public.material_units(material_id,unit_id,quantity_in_base,is_purchase_unit,is_recipe_unit)
       VALUES(v_id,p_unit,v_factor,true,true)
       ON CONFLICT(material_id,unit_id) DO NOTHING;
   END IF;
 END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.v126_material_for_name(text,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v126_material_for_name(text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.v126_import_historic_invoices(
 p_sha256 text,p_documents jsonb,p_accept_missing_units boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb;l jsonb;v_day date;v_no text;v_supplier_name text;v_key text;v_payload_md5 text;
 v_supplier uuid;v_invoice uuid;v_unit uuid;v_material uuid;v_qty numeric;v_price numeric;v_net numeric;
 v_discount numeric;v_added numeric;v_original numeric;v_lineprice numeric;v_linediscount numeric;
 v_ts timestamptz;v_tz text;v_old text;v_total numeric;v_result jsonb;v_created int:=0;v_skipped int:=0;
 v_item_count int:=0;v_line_count int:=0;v_existing uuid;v_setting_currency text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_documents)<>'array' THEN RAISE EXCEPTION 'INVALID_HISTORIC_IMPORT'; END IF;
 IF jsonb_array_length(p_documents)<1 OR jsonb_array_length(p_documents)>20 THEN RAISE EXCEPTION 'MAX_20_HISTORIC_INVOICES_PER_TRANSACTION'; END IF;
 SELECT timezone,base_currency_code INTO v_tz,v_setting_currency FROM public.app_settings WHERE id=1;
 IF v_setting_currency<>'SYP' THEN RAISE EXCEPTION 'HISTORIC_SYP_REQUIRES_SYP_BASE_CURRENCY'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v126-historic-import',0));
 FOR d IN SELECT value FROM jsonb_array_elements(p_documents) LOOP
   IF coalesce(d->>'date','') !~ '^20[0-9]{2}-[01][0-9]-[0-3][0-9]$'
     OR length(btrim(coalesce(d->>'supplier',''))) NOT BETWEEN 1 AND 250
     OR length(btrim(coalesce(d->>'number',''))) NOT BETWEEN 1 AND 150
     OR jsonb_typeof(d->'lines')<>'array' OR jsonb_array_length(d->'lines')<1 OR jsonb_array_length(d->'lines')>400
   THEN RAISE EXCEPTION 'HISTORIC_DOCUMENT_INVALID';END IF;
   v_day:=(d->>'date')::date;v_no:=btrim(d->>'number');v_supplier_name:=btrim(d->>'supplier');
   v_key:=md5(v_day::text||'|'||v_no||'|'||public.recipe_key_normalize_v027(v_supplier_name));
   v_payload_md5:=md5(d::text);
   SELECT payload_md5,invoice_id INTO v_old,v_existing FROM public.v126_historical_invoices WHERE document_key=v_key;
   IF v_existing IS NOT NULL THEN
     IF v_old<>v_payload_md5 THEN RAISE EXCEPTION 'HISTORIC_DOCUMENT_ALREADY_IMPORTED_DIFFERENT_VALUES: %',v_no;END IF;
     v_skipped:=v_skipped+1;CONTINUE;
   END IF;
   -- Guard against inserting backdated purchases after an approved count; import in the documented order.
   IF EXISTS(SELECT 1 FROM public.v126_physical_counts pc WHERE pc.count_date>=v_day) THEN
     RAISE EXCEPTION 'HISTORIC_IMPORT_AFTER_PHYSICAL_COUNT_FORBIDDEN';
   END IF;
   SELECT count(*) INTO v_item_count FROM public.suppliers
      WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_supplier_name);
   SELECT id INTO v_supplier FROM public.suppliers
      WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_supplier_name) ORDER BY id LIMIT 1;
   IF v_item_count>1 THEN RAISE EXCEPTION 'AMBIGUOUS_SUPPLIER_NAME: %',v_supplier_name;END IF;
   IF v_supplier IS NULL THEN
     INSERT INTO public.suppliers(name,code,default_currency_code,payment_terms_days,notes)
       VALUES(v_supplier_name,'A126-'||upper(substr(md5(public.recipe_key_normalize_v027(v_supplier_name)),1,18)),'SYP',0,
       'مورد من أرشيف الأمين؛ كل الفواتير التاريخية مُصفاة خارج هذا البرنامج بحسب إفادة الإدارة')
       RETURNING id INTO v_supplier;
   END IF;
   v_ts:=(v_day::timestamp+interval '12 hours') AT TIME ZONE coalesce(nullif(v_tz,''),'Asia/Damascus');
   v_invoice:=public.create_purchase_invoice(v_supplier,'SYP',v_no,v_day,v_ts,'import',
     'استيراد تاريخي من الأمين — مصفاة خارج النظام بحسب إفادة الإدارة؛ لا دين ولا صرف صندوق آلي',NULL,NULL);
   UPDATE public.purchase_invoices SET is_ameen_legacy_v029=true WHERE id=v_invoice;
   v_total:=0;
   FOR l IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
     IF length(btrim(coalesce(l->>'name',''))) NOT BETWEEN 1 AND 250 OR coalesce(l->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
       OR coalesce(l->>'net','') !~ '^[0-9]+(\.[0-9]+)?$'
       OR coalesce(l->>'originalPrice','') !~ '^[0-9]+(\.[0-9]+)?$'
     THEN RAISE EXCEPTION 'HISTORIC_PURCHASE_LINE_INVALID: %',v_no;END IF;
     IF coalesce((l->>'unitWasMissing')::boolean,false) AND NOT p_accept_missing_units THEN
       RAISE EXCEPTION 'HISTORIC_MISSING_UNIT_CONFIRMATION_REQUIRED: %',l->>'name';END IF;
     v_qty:=round((l->>'quantity')::numeric,6);v_price:=(l->>'originalPrice')::numeric;
     v_net:=round((l->>'net')::numeric,4);
     IF v_qty<=0 OR v_qty>1e10 OR v_net>1e15 OR v_price>1e12 THEN RAISE EXCEPTION 'HISTORIC_PURCHASE_OUT_OF_RANGE';END IF;
     v_unit:=public.ameen_unit_v024(coalesce(nullif(btrim(l->>'unit'),''),'قطعة'));
     v_material:=public.v126_material_for_name(btrim(l->>'name'),v_unit,true);
     -- Preserve the net of each Al-Ameen line to 4 decimals. Some source unit
     -- prices have >6 decimals (e.g. fuel in tiny price units); DB stores 6.
     -- Round UP the unit price only when needed; use the difference as a
     -- rounding discount, and record the authentic price/additions in notes.
     v_lineprice:=round(v_price,6);
     IF round(v_qty*v_lineprice,4)<v_net THEN
       v_lineprice:=ceil((v_net/v_qty)*1000000)/1000000;
     END IF;
     v_linediscount:=round(v_qty*v_lineprice-v_net,4);
     IF v_linediscount<0 THEN RAISE EXCEPTION 'HISTORIC_INVOICE_PRECISION_ERROR';END IF;
     PERFORM public.add_purchase_invoice_item(v_invoice,v_material,v_unit,v_qty,v_lineprice,v_linediscount,NULL,
        'أمين سطر '||coalesce(l->>'sourceRow','؟')||'؛ السعر الأصلي '||v_price::text||
        '؛ الحسم '||coalesce(l->>'discount','0')||'؛ الإضافات '||coalesce(l->>'additions','0')||
        '؛ الصافي '||v_net::text||' ل.س');
     v_total:=v_total+v_net;v_line_count:=v_line_count+1;
   END LOOP;
   PERFORM public.post_purchase_invoice(v_invoice);
   IF abs((SELECT total_original FROM public.purchase_invoices WHERE id=v_invoice)-v_total)>0.1 THEN
     RAISE EXCEPTION 'HISTORIC_INVOICE_TOTAL_MISMATCH: %',v_no;
   END IF;
   INSERT INTO public.v126_historical_invoices(document_key,payload_md5,workbook_sha256,invoice_id,source_number,source_date,source_supplier,original_total_syp)
   VALUES(v_key,v_payload_md5,p_sha256,v_invoice,v_no,v_day,v_supplier_name,round(v_total,4));
   v_created:=v_created+1;
 END LOOP;
 RETURN jsonb_build_object('invoicesCreated',v_created,'invoicesAlreadyPresent',v_skipped,'linesCreated',v_line_count,
   'currency','SYP','settlement','paid_outside_system_no_cashbox_movement');
END $$;
REVOKE ALL ON FUNCTION public.v126_import_historic_invoices(text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v126_import_historic_invoices(text,jsonb,boolean) TO authenticated;

-- Menu-only import NEVER changes stock quantities; missing recipes remain pending, not zero-cost.
CREATE OR REPLACE FUNCTION public.v126_import_menu_only(p_sha256 text,p_filename text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_rec jsonb;v_dish jsonb;v_line jsonb;v_name text;v_unit uuid;v_mat uuid;v_menu uuid;
 v_price numeric;v_qty numeric;v_matname text;v_base uuid;v_factor numeric;v_ready boolean;v_reason text;
 v_rows int:=0;v_meals int:=0;v_published int:=0;v_pending int:=0;v_created_materials int:=0;
 v_exists int;v_status jsonb;v_result jsonb;v_group record;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 IF p_sha256 !~ '^[0-9a-f]{64}$' OR length(coalesce(p_filename,'')) NOT BETWEEN 1 AND 255
 OR jsonb_typeof(p_payload)<>'object' OR jsonb_typeof(p_payload->'materials')<>'array'
 OR jsonb_typeof(p_payload->'dishes')<>'array' THEN RAISE EXCEPTION 'INVALID_MENU_ONLY_IMPORT';END IF;
 IF jsonb_array_length(p_payload->'materials')>2500 OR jsonb_array_length(p_payload->'dishes')>2000 THEN RAISE EXCEPTION 'MENU_IMPORT_TOO_LARGE';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v126-menu-only',0));
 SELECT stats INTO v_status FROM public.v126_menu_only_imports WHERE sha256=p_sha256;
 IF FOUND THEN RETURN v_status||jsonb_build_object('duplicateFile',true);END IF;
 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_payload->'materials') LOOP
  v_name:=btrim(coalesce(v_rec->>'name',''));
  IF length(v_name) NOT BETWEEN 1 AND 250 OR coalesce(v_rec->>'unit','')='' THEN RAISE EXCEPTION 'MENU_MATERIAL_INVALID';END IF;
  v_unit:=public.ameen_unit_v024(btrim(v_rec->>'unit'));
  SELECT id INTO v_mat FROM public.materials WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name) LIMIT 1;
  IF v_mat IS NULL THEN v_created_materials:=v_created_materials+1;END IF;
  -- Do not overwrite existing invoice materials' units or prices; never import old stock counts.
  IF v_mat IS NULL THEN
    v_mat:=public.v126_material_for_name(v_name,v_unit,true);
  END IF;
  -- Same material name but incompatible packaging in an old menu file must
  -- not destroy historic invoice units or block the whole import.
  IF coalesce(v_rec->>'lastPrice','') ~ '^[0-9]+(\.[0-9]+)?$' AND (v_rec->>'lastPrice')::numeric>0 THEN
    UPDATE public.materials SET last_purchase_unit_cost_base=(v_rec->>'lastPrice')::numeric,
      notes=concat_ws(' | ',notes,'تكلفة مرجعية من ملف المنيو، وليست فاتورة شراء مثبتة')
    WHERE id=v_mat AND last_purchase_unit_cost_base IS NULL;
  END IF;
  v_rows:=v_rows+1;
 END LOOP;
 FOR v_dish IN SELECT value FROM jsonb_array_elements(p_payload->'dishes') LOOP
   v_name:=btrim(coalesce(v_dish->>'name',''));
   IF length(v_name) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'MENU_NAME_INVALID';END IF;
   v_price:=NULL;
   IF coalesce(v_dish->>'salePrice','') ~ '^[0-9]+(\.[0-9]+)?$' AND (v_dish->>'salePrice')::numeric>0 THEN
     v_price:=(v_dish->>'salePrice')::numeric;END IF;
   SELECT id INTO v_menu FROM public.menu_items
    WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name) LIMIT 1;
   IF v_menu IS NULL THEN
     INSERT INTO public.menu_items(name,manual_price_original) VALUES(v_name,v_price) RETURNING id INTO v_menu;
   ELSE UPDATE public.menu_items SET manual_price_original=coalesce(v_price,manual_price_original),updated_at=now() WHERE id=v_menu;END IF;
   v_ready:=coalesce(v_dish->>'status','')='منتهي' AND v_price>0
     AND jsonb_typeof(v_dish->'lines')='array' AND jsonb_array_length(v_dish->'lines')>0;
   v_reason:='وصفة أو سعر ناقص أو غير معتمد';
   CREATE TEMP TABLE IF NOT EXISTS pg_temp.v126_recipe_lines(mat uuid PRIMARY KEY,qty numeric NOT NULL) ON COMMIT DROP;
   TRUNCATE pg_temp.v126_recipe_lines;
   FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(v_dish->'lines','[]'::jsonb)) LOOP
    v_matname:=btrim(coalesce(v_line->>'materialName',''));
    IF coalesce(v_line->>'note','') LIKE 'اختر مادة:%' OR coalesce(v_line->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_ready:=false;v_reason:='مكونات غير مكتملة';CONTINUE;END IF;
    v_qty:=(v_line->>'quantity')::numeric;
    IF v_qty<=0 OR v_qty>1e9 OR v_matname='' THEN v_ready:=false;CONTINUE;END IF;
    SELECT id,base_unit_id INTO v_mat,v_base FROM public.materials
      WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_matname) LIMIT 1;
    IF v_mat IS NULL THEN v_ready:=false;v_reason:='مادة غير موجودة';CONTINUE;END IF;
    IF NOT EXISTS(SELECT 1 FROM public.materials WHERE id=v_mat AND last_purchase_unit_cost_base>0) THEN
       v_ready:=false;v_reason:='سعر تكلفة المادة غير معروف';CONTINUE;END IF;
    v_factor:=1;
    IF coalesce(v_line->>'unit','')<>'' THEN
      v_unit:=public.ameen_unit_v024(v_line->>'unit');
      IF v_unit<>v_base THEN
       SELECT quantity_in_base INTO v_factor FROM public.material_units WHERE material_id=v_mat AND unit_id=v_unit;
       IF v_factor IS NULL THEN v_factor:=public.v126_unit_factor(v_unit,v_base);END IF;
       IF v_factor IS NULL THEN v_ready:=false;v_reason:='وحدة الوصفة تحتاج ضبط حجم العبوة';CONTINUE;END IF;
      END IF;
    END IF;
    INSERT INTO pg_temp.v126_recipe_lines(mat,qty) VALUES(v_mat,v_qty*v_factor)
     ON CONFLICT(mat) DO UPDATE SET qty=v126_recipe_lines.qty+excluded.qty;
   END LOOP;
   IF v_ready AND (SELECT count(*) FROM pg_temp.v126_recipe_lines)>0 THEN
     DELETE FROM public.menu_item_recipe_items WHERE menu_item_id=v_menu;
     FOR v_group IN SELECT mat,qty FROM pg_temp.v126_recipe_lines LOOP
       SELECT base_unit_id INTO v_unit FROM public.materials WHERE id=v_group.mat;
       PERFORM public.save_menu_recipe_item_v07(v_menu,v_group.mat,v_unit,v_group.qty,NULL);
     END LOOP;
     DELETE FROM public.v126_menu_recipe_reviews WHERE menu_item_id=v_menu;
     v_published:=v_published+1;
   ELSE
     INSERT INTO public.v126_menu_recipe_reviews(menu_item_id,source_sha256,original_status,lines,reason)
     VALUES(v_menu,p_sha256,coalesce(v_dish->>'status',''),coalesce(v_dish->'lines','[]'::jsonb),v_reason)
     ON CONFLICT(menu_item_id) DO UPDATE SET source_sha256=excluded.source_sha256,
       original_status=excluded.original_status,lines=excluded.lines,reason=excluded.reason,updated_at=now();
     v_pending:=v_pending+1;
   END IF;
   v_meals:=v_meals+1;
 END LOOP;
 v_result:=jsonb_build_object('materialsCatalog',v_rows,'newMaterials',v_created_materials,'menuItems',v_meals,
   'recipesPublished',v_published,'recipesPendingReview',v_pending,'stockQuantitiesUpdated',0);
 INSERT INTO public.v126_menu_only_imports(sha256,filename,stats) VALUES(p_sha256,p_filename,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.v126_import_menu_only(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v126_import_menu_only(text,text,jsonb) TO authenticated;

-- Prevent any later workflow from silently inserting stock movements dated before
-- an already approved physical count. Otherwise past orders/invoices would
-- incorrectly change the present balance despite the count adjustment.
CREATE OR REPLACE FUNCTION public.v126_guard_backdated_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.v126_physical_counts pc
   WHERE pc.material_id=NEW.material_id
    AND (NEW.occurred_at AT TIME ZONE pc.count_timezone)::date<=pc.count_date) THEN
   RAISE EXCEPTION 'BACKDATED_STOCK_MOVEMENT_BEFORE_APPROVED_COUNT: material %, time %',NEW.material_id,NEW.occurred_at;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS v126_guard_backdated_stock_trigger ON public.inventory_movements;
CREATE TRIGGER v126_guard_backdated_stock_trigger BEFORE INSERT ON public.inventory_movements
 FOR EACH ROW EXECUTE FUNCTION public.v126_guard_backdated_stock();

-- Do not reverse an archived pre-count invoice after a count has already
-- established the actual physical balance. That reversal would deduct stock
-- again on today's date, bypassing the historical anchor.
CREATE OR REPLACE FUNCTION public.v126_guard_historic_invoice_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(OLD.is_ameen_legacy_v029,false) AND OLD.status='posted'
  AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.is_voided IS DISTINCT FROM OLD.is_voided)
  AND EXISTS (SELECT 1 FROM public.purchase_invoice_items pii
   JOIN public.v126_physical_counts pc ON pc.material_id=pii.material_id
   WHERE pii.invoice_id=OLD.id AND pc.count_date>=OLD.invoice_date)
 THEN
   RAISE EXCEPTION 'HISTORIC_PURCHASE_REVERSAL_CROSSES_APPROVED_PHYSICAL_COUNT';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS v126_guard_historic_invoice_reversal_trigger ON public.purchase_invoices;
CREATE TRIGGER v126_guard_historic_invoice_reversal_trigger BEFORE UPDATE OF status,is_voided
 ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.v126_guard_historic_invoice_reversal();

-- Backdated physical count adjusts at end of its business day, not at upload time.
-- current stock = counted stock + all posted movements from next day onward.
CREATE OR REPLACE FUNCTION public.v126_import_physical_counts(p_sha256 text,p_records jsonb,p_create_missing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;v_mat uuid;v_base uuid;v_unit uuid;v_factor numeric;v_q numeric;v_qbase numeric;
 v_date date;v_cutoff timestamptz;v_tz text;v_before numeric;v_delta numeric;v_move uuid;v_after numeric;
 v_now numeric;v_existing uuid;v_matches int;v_done int:=0;v_noop int:=0;v_skipped int:=0;v_new_materials int:=0;v_details jsonb:='[]'::jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 IF p_sha256 !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_records)<>'array' THEN RAISE EXCEPTION 'INVALID_COUNT_IMPORT';END IF;
 IF jsonb_array_length(p_records)<1 OR jsonb_array_length(p_records)>150 THEN RAISE EXCEPTION 'MAX_150_COUNTS_PER_TRANSACTION';END IF;
 SELECT timezone INTO v_tz FROM public.app_settings WHERE id=1;
 IF v_tz IS NULL THEN RAISE EXCEPTION 'MISSING_BUSINESS_TIMEZONE';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v126-physical-count',0));
 FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   IF length(btrim(coalesce(r->>'name',''))) NOT BETWEEN 1 AND 250
    OR coalesce(r->>'quantity','') !~ '^[0-9]+(\.[0-9]+)?$'
    OR coalesce(r->>'date','') !~ '^20[0-9]{2}-[01][0-9]-[0-3][0-9]$'
    OR length(btrim(coalesce(r->>'unit',''))) NOT BETWEEN 1 AND 90
   THEN RAISE EXCEPTION 'INVALID_APPROVED_COUNT_ROW';END IF;
   v_q:=(r->>'quantity')::numeric;v_date:=(r->>'date')::date;
   IF v_q>1e12 THEN RAISE EXCEPTION 'COUNT_QUANTITY_OUT_OF_RANGE';END IF;
   v_cutoff:=(v_date::timestamp+interval '1 day') AT TIME ZONE v_tz;
   IF v_cutoff>now() THEN RAISE EXCEPTION 'COUNT_BUSINESS_DAY_NOT_FINISHED: %',v_date;END IF;
   v_unit:=public.ameen_unit_v024(btrim(r->>'unit'));
   SELECT count(*) INTO v_matches FROM public.materials
    WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(btrim(r->>'name'));
   IF v_matches>1 THEN RAISE EXCEPTION 'AMBIGUOUS_COUNT_MATERIAL_NAME: %',r->>'name'; END IF;
   SELECT id,base_unit_id INTO v_mat,v_base FROM public.materials
    WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(btrim(r->>'name')) LIMIT 1;
   IF v_mat IS NULL THEN
     IF NOT p_create_missing THEN RAISE EXCEPTION 'COUNT_ITEM_NOT_IN_CATALOG: %',r->>'name';END IF;
     -- Only on explicit operator opt-in, and an approved individual count row.
     v_mat:=public.v126_material_for_name(btrim(r->>'name'),v_unit,true);
     v_base:=v_unit;
     UPDATE public.materials SET notes=concat_ws(' | ',notes,
       'مادة أُنشئت من جرد فعلي معتمد؛ سعر الشراء غير معروف ولا يُعتبر صفرًا') WHERE id=v_mat;
     v_new_materials:=v_new_materials+1;
   END IF;
   -- row lock serializes inventory write for the material in this request;
   -- all count imports are advisory-serialized; external movements require operational downtime during approval.
   PERFORM 1 FROM public.materials WHERE id=v_mat AND is_active=true FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'INACTIVE_COUNT_MATERIAL: %',r->>'name';END IF;
   IF v_unit=v_base THEN v_factor:=1;
   ELSE SELECT quantity_in_base INTO v_factor FROM public.material_units WHERE material_id=v_mat AND unit_id=v_unit;
    IF v_factor IS NULL THEN v_factor:=public.v126_unit_factor(v_unit,v_base);END IF;
   END IF;
   IF v_factor IS NULL OR v_factor<=0 THEN RAISE EXCEPTION 'COUNT_UNIT_PACKAGE_SIZE_NOT_CONFIGURED: %',r->>'name';END IF;
   v_qbase:=round(v_q*v_factor,6);
   SELECT id INTO v_existing FROM public.v126_physical_counts WHERE material_id=v_mat AND count_date=v_date;
   IF v_existing IS NOT NULL THEN
     IF EXISTS(SELECT 1 FROM public.v126_physical_counts
       WHERE id=v_existing AND source_sha256=p_sha256 AND counted_base=v_qbase) THEN
       v_skipped:=v_skipped+1;CONTINUE;
     END IF;
     RAISE EXCEPTION 'COUNT_ALREADY_APPROVED_FOR_MATERIAL_AND_DATE: %',r->>'name';
   END IF;
   IF EXISTS(SELECT 1 FROM public.v126_physical_counts WHERE material_id=v_mat AND count_date>v_date) THEN
     RAISE EXCEPTION 'CANNOT_BACKDATE_BEFORE_EXISTING_LATER_COUNT: %',r->>'name';END IF;
   -- This catches accidental inventory resets not reflected in movement ledger on a fresh database.
   SELECT current_stock_base INTO v_now FROM public.materials WHERE id=v_mat;
   IF abs(v_now-coalesce((SELECT sum(quantity_delta_base) FROM public.inventory_movements WHERE material_id=v_mat),0))>0.00001 THEN
     RAISE EXCEPTION 'STOCK_LEDGER_MISMATCH_REQUIRES_AUDIT: %',r->>'name';END IF;
   SELECT coalesce(sum(quantity_delta_base),0) INTO v_before FROM public.inventory_movements
     WHERE material_id=v_mat AND occurred_at<v_cutoff;
   v_delta:=round(v_qbase-v_before,6);
   v_move:=NULL;
   IF v_delta<>0 THEN
     v_move:=public.record_inventory_movement(v_mat,
      CASE WHEN v_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
      v_delta,(SELECT last_purchase_unit_cost_base FROM public.materials WHERE id=v_mat),
      v_cutoff-interval '1 microsecond','v126_physical_count',NULL,NULL,
      'جرد معتمد نهاية يوم '||v_date::text||' • فرق مع سجل الحركات '||v_delta::text);
   END IF;
   SELECT current_stock_base INTO v_after FROM public.materials WHERE id=v_mat;
   IF abs(v_after - (v_qbase+coalesce((SELECT sum(quantity_delta_base) FROM public.inventory_movements
       WHERE material_id=v_mat AND occurred_at>=v_cutoff),0)))>0.00001 THEN
     RAISE EXCEPTION 'COUNT_RECONCILIATION_MISMATCH: %',r->>'name'; END IF;
   INSERT INTO public.v126_physical_counts(material_id,count_date,count_timezone,counted_quantity,count_unit_id,
     counted_base,expected_before_base,adjustment_delta_base,resulting_current_base,adjustment_movement_id,
     source_sha256,source_department,operator_note)
   VALUES(v_mat,v_date,v_tz,v_q,v_unit,v_qbase,v_before,v_delta,v_after,v_move,p_sha256,
     left(coalesce(r->>'department',''),140),left(coalesce(r->>'note',''),400));
   v_done:=v_done+1;
   IF v_delta=0 THEN v_noop:=v_noop+1;END IF;
   IF v_done<=35 THEN v_details:=v_details||jsonb_build_array(jsonb_build_object('name',r->>'name',
     'countedBase',v_qbase,'expectedBefore',v_before,'delta',v_delta,'current',v_after));END IF;
 END LOOP;
 RETURN jsonb_build_object('approved',v_done,'alreadyApproved',v_skipped,'newCatalogMaterials',v_new_materials,'noChange',v_noop,'adjustmentsPreview',v_details);
END $$;
REVOKE ALL ON FUNCTION public.v126_import_physical_counts(text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.v126_import_physical_counts(text,jsonb,boolean) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
