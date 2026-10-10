-- Maria CFO Web v0.24 - Al-Ameen XLSX import (owner-only / idempotent / atomic per file)
-- REQUIRED: Maria CFO v0.23 migration installed. Test on a disposable Supabase copy first.
-- Does not post any order, supplier payment, or cashbox entry.
BEGIN;

-- Fractional essential-equipment counts exist in Al-Ameen exports.
ALTER TABLE public.restaurant_assets_v023
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ALTER COLUMN minimum_quantity TYPE numeric USING minimum_quantity::numeric;
ALTER TABLE public.restaurant_assets_v023
  ADD COLUMN IF NOT EXISTS ameen_unit_v024 text;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS ameen_sale_unit_v024 text;

CREATE TABLE IF NOT EXISTS public.ameen_import_runs_v024 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('inventory','orders','suppliers')),
 filename text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 record_count integer NOT NULL CHECK(record_count BETWEEN 1 AND 5000),
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,sha256)
);
CREATE TABLE IF NOT EXISTS public.ameen_warehouses_v024 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ameen_warehouse_name_v024_uq ON public.ameen_warehouses_v024(lower(btrim(name)));
CREATE TABLE IF NOT EXISTS public.ameen_inventory_rows_v024 (
 source_key text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('menu','material','asset')),
 name text NOT NULL,
 category text,
 warehouse text NOT NULL DEFAULT '',
 unit_name text,
 quantity_original numeric,
 secondary_unit text,
 secondary_quantity numeric,
 source_price numeric,
 core_entity_id uuid,
 quantity_base numeric,
 review_reason text,
 balance_changed_in_run boolean NOT NULL DEFAULT false,
 last_run_id uuid REFERENCES public.ameen_import_runs_v024(id) ON DELETE SET NULL,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ameen_inventory_warehouse_v024_idx ON public.ameen_inventory_rows_v024(warehouse,kind);
CREATE TABLE IF NOT EXISTS public.ameen_order_snapshots_v024 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_date date NOT NULL,
 external_number text NOT NULL,
 occurred_at timestamptz NOT NULL,
 source_net numeric NOT NULL DEFAULT 0,
 source_gross numeric NOT NULL DEFAULT 0,
 source_syp numeric,
 line_payload jsonb NOT NULL,
 row_hash text NOT NULL,
 linked_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
 review_status text NOT NULL DEFAULT 'needs_review',
 review_notes text,
 approved_at timestamptz,
 approval_items_hash text,
 last_synced_at timestamptz,
 last_run_id uuid REFERENCES public.ameen_import_runs_v024(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_date,external_number)
);
CREATE TABLE IF NOT EXISTS public.ameen_supplier_balances_v024 (
 external_account text PRIMARY KEY,
 supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
 supplier_name text NOT NULL,
 previous_balance numeric NOT NULL DEFAULT 0,
 total_debit numeric NOT NULL DEFAULT 0,
 total_credit numeric NOT NULL DEFAULT 0,
 current_balance numeric NOT NULL DEFAULT 0,
 last_run_id uuid REFERENCES public.ameen_import_runs_v024(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ameen_supplier_entries_v024 (
 source_key text PRIMARY KEY,
 external_account text NOT NULL REFERENCES public.ameen_supplier_balances_v024(external_account),
 occurred_at timestamptz NOT NULL,
 source_document text,
 debit numeric NOT NULL DEFAULT 0,
 credit numeric NOT NULL DEFAULT 0,
 description text,
 last_run_id uuid REFERENCES public.ameen_import_runs_v024(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(debit>=0 AND credit>=0)
);
CREATE INDEX IF NOT EXISTS ameen_supplier_entries_lookup_v024_idx ON public.ameen_supplier_entries_v024(external_account,occurred_at DESC);

-- Match suppliers by their native Al-Ameen account key, never by uncertain names alone when a code exists.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS ameen_account_code_v024 text;
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_ameen_account_code_v024_uq
 ON public.suppliers(ameen_account_code_v024) WHERE ameen_account_code_v024 IS NOT NULL;

-- Imported staging is read-only from the browser; all writes go through a single owner-checked RPC.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['ameen_import_runs_v024','ameen_warehouses_v024',
   'ameen_inventory_rows_v024','ameen_order_snapshots_v024','ameen_supplier_balances_v024',
   'ameen_supplier_entries_v024'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',tbl);
  EXECUTE format('DROP POLICY IF EXISTS ameen_owner_read_v024 ON public.%I',tbl);
  EXECUTE format('CREATE POLICY ameen_owner_read_v024 ON public.%I FOR SELECT TO authenticated USING(public.is_app_owner())',tbl);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ameen_unit_v024(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_code text;v_id uuid;v_name text:=btrim(coalesce(p_name,''));BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF v_name='' THEN RETURN NULL; END IF;
 v_code:=CASE public.normalize_unit_name_v018(v_name)
  WHEN 'غرام' THEN 'G' WHEN 'غ' THEN 'G' WHEN 'جرام' THEN 'G'
  WHEN 'كغ' THEN 'KG' WHEN 'كيلو' THEN 'KG' WHEN 'كيلوغرام' THEN 'KG'
  WHEN 'لتر' THEN 'L' WHEN 'مل' THEN 'ML' WHEN 'مليلتر' THEN 'ML'
  WHEN 'قطعه' THEN 'PCS' WHEN 'قطعة' THEN 'PCS' WHEN 'حبه' THEN 'PCS' WHEN 'حبة' THEN 'PCS'
  WHEN 'صندوق' THEN 'BOX' WHEN 'كرتون' THEN 'CARTON' WHEN 'كرتونه' THEN 'CARTON'
  WHEN 'كرتونة' THEN 'CARTON' WHEN 'كيس' THEN 'BAG' WHEN 'دزينه' THEN 'DOZ' WHEN 'دزينة' THEN 'DOZ'
  WHEN 'كاسه' THEN 'GLASS' WHEN 'كاسة' THEN 'GLASS' WHEN 'كوب' THEN 'CUP'
  WHEN 'صحن' THEN 'TRAY' WHEN 'طرد' THEN 'PACK' WHEN 'عبوة' THEN 'PACK' WHEN 'كاس' THEN 'GLASS'
  ELSE NULL END;
 SELECT id INTO v_id FROM public.units
  WHERE is_active IS TRUE AND is_material_specific IS NOT TRUE
   AND ((v_code IS NOT NULL AND upper(code)=v_code)
        OR public.normalize_unit_name_v018(name)=public.normalize_unit_name_v018(v_name))
  ORDER BY CASE WHEN public.normalize_unit_name_v018(name)=public.normalize_unit_name_v018(v_name) THEN 0 ELSE 1 END,id LIMIT 1;
 IF v_id IS NOT NULL THEN RETURN v_id; END IF;
 -- Older catalogs may contain the same visible label as a material-specific unit.
 -- Do not steal that unit or abort the whole report due to a name collision.
 IF EXISTS(SELECT 1 FROM public.units u WHERE
       public.normalize_unit_name_v018(u.name)=public.normalize_unit_name_v018(v_name)) THEN
   v_name:=left(v_name,90)||' (استيراد الأمين)';
   SELECT id INTO v_id FROM public.units
    WHERE is_active IS TRUE AND is_material_specific IS NOT TRUE
      AND public.normalize_unit_name_v018(name)=public.normalize_unit_name_v018(v_name)
    LIMIT 1;
   IF v_id IS NOT NULL THEN RETURN v_id; END IF;
 END IF;
 -- Custom Al-Ameen labels are shared units; code deterministic across subsequent imports.
 INSERT INTO public.units(name,code,unit_type,is_system,is_active,is_material_specific)
 VALUES(v_name,'AM_'||upper(substr(md5(public.normalize_unit_name_v018(v_name)),1,14)),
       'custom',false,true,false) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ameen_unit_v024(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ameen_unit_v024(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ameen_catalog_category_v024(p_kind text,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_name text:=btrim(coalesce(p_name,''));v_id uuid;BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF v_name='' THEN RETURN NULL; END IF;
 IF p_kind='menu' THEN
  SELECT id INTO v_id FROM public.menu_categories WHERE lower(btrim(name))=lower(v_name) ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN INSERT INTO public.menu_categories(name) VALUES(v_name) RETURNING id INTO v_id; END IF;
 ELSIF p_kind='material' THEN
  SELECT id INTO v_id FROM public.material_categories_v023 WHERE lower(btrim(name))=lower(v_name) ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN INSERT INTO public.material_categories_v023(name) VALUES(v_name) RETURNING id INTO v_id; END IF;
 ELSIF p_kind='asset' THEN
  SELECT id INTO v_id FROM public.asset_categories_v023 WHERE lower(btrim(name))=lower(v_name) ORDER BY id LIMIT 1;
  IF v_id IS NULL THEN INSERT INTO public.asset_categories_v023(name) VALUES(v_name) RETURNING id INTO v_id; END IF;
 ELSE RAISE EXCEPTION 'AMEEN_CATEGORY_KIND_INVALID'; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.ameen_catalog_category_v024(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ameen_catalog_category_v024(text,text) TO authenticated;

-- Single RPC / single PostgreSQL transaction. A failed import leaves no partial writes.
CREATE OR REPLACE FUNCTION public.import_ameen_v024(
 p_kind text,p_filename text,p_sha256 text,p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_run uuid;v_count integer;v_total integer;v_created integer:=0;v_updated integer:=0;
 v_same integer:=0;v_review integer:=0;v_ledger integer:=0;v_record jsonb;v_item jsonb;
 v_key text;v_kind text;v_name text;v_wh text;v_cat uuid;v_entity uuid;v_unit uuid;
 v_price numeric;v_qty numeric;v_base_qty numeric;v_base_id uuid;v_base_code text;v_input_code text;
 v_factor numeric;v_old public.ameen_inventory_rows_v024%rowtype;v_status text;v_reason text;
 v_current numeric;v_target numeric;v_delta numeric;v_stock record;v_was_changed boolean;
 v_supplier uuid;v_acc text;v_account_name text;v_order uuid;v_other_order uuid;
 v_date date;v_no text;v_hash text;v_previous public.ameen_order_snapshots_v024%rowtype;
 v_order_status text;v_order_fingerprint text;v_order_row_age timestamptz;v_menu uuid;
 v_net numeric;v_gross numeric;v_summary jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_kind NOT IN ('inventory','orders','suppliers') THEN RAISE EXCEPTION 'AMEEN_KIND_REQUIRED'; END IF;
 IF p_records IS NULL OR jsonb_typeof(p_records)<>'array' THEN RAISE EXCEPTION 'AMEEN_ROWS_REQUIRED'; END IF;
 v_count:=jsonb_array_length(p_records);
 IF v_count<1 OR v_count>5000 THEN RAISE EXCEPTION 'AMEEN_RECORD_COUNT_INVALID'; END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'AMEEN_FILE_HASH_INVALID'; END IF;
 IF length(coalesce(p_filename,''))>255 THEN RAISE EXCEPTION 'AMEEN_FILENAME_TOO_LONG'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-ameen-v024:global',0));
 SELECT id,result INTO v_run,v_summary FROM public.ameen_import_runs_v024
  WHERE kind=p_kind AND sha256=p_sha256 LIMIT 1;
 IF v_run IS NOT NULL THEN RETURN v_summary||jsonb_build_object('duplicateFile',true,'runId',v_run); END IF;
 INSERT INTO public.ameen_import_runs_v024(kind,filename,sha256,record_count)
 VALUES(p_kind,coalesce(nullif(btrim(p_filename),''),'report.xlsx'),p_sha256,v_count) RETURNING id INTO v_run;

 IF p_kind='inventory' THEN
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_kind:=v_record->>'kind'; v_name:=btrim(coalesce(v_record->>'name',''));
   v_key:=coalesce(v_record->>'key','');v_wh:=btrim(coalesce(v_record->>'warehouse',''));
   IF v_kind NOT IN('menu','material','asset') OR length(v_name)<1 OR length(v_name)>250
     OR length(v_key)<3 OR length(v_key)>950 THEN RAISE EXCEPTION 'AMEEN_INVENTORY_ROW_INVALID'; END IF;
   v_qty:=coalesce((v_record->>'quantity')::numeric,0);
   v_price:=(v_record->>'price')::numeric;
   IF abs(v_qty)>100000000000 OR (v_price IS NOT NULL AND abs(v_price)>100000000000) THEN
    RAISE EXCEPTION 'AMEEN_INVENTORY_AMOUNT_OUT_OF_RANGE'; END IF;
   v_reason:=NULL;v_entity:=NULL;v_base_qty:=NULL;
   v_cat:=public.ameen_catalog_category_v024(v_kind,v_record->>'category');
   IF v_wh<>'' THEN
    INSERT INTO public.ameen_warehouses_v024(name) VALUES(v_wh)
    ON CONFLICT DO NOTHING;
   END IF;
   IF v_kind='menu' THEN
    SELECT id INTO v_entity FROM public.menu_items WHERE lower(btrim(name))=lower(v_name)
      ORDER BY is_active DESC,id LIMIT 1;
    IF v_entity IS NULL THEN
     INSERT INTO public.menu_items(name,category_id,manual_price_original,ameen_sale_unit_v024)
     VALUES(v_name,v_cat,CASE WHEN v_price>0 THEN v_price ELSE NULL END,v_record->>'unit')
     RETURNING id INTO v_entity;
     v_created:=v_created+1;
    ELSE
     UPDATE public.menu_items SET
      category_id=coalesce(v_cat,category_id),
      ameen_sale_unit_v024=coalesce(nullif(v_record->>'unit',''),ameen_sale_unit_v024),
      manual_price_original=CASE WHEN v_price>0 THEN v_price ELSE manual_price_original END
     WHERE id=v_entity;
     v_updated:=v_updated+1;
    END IF;
    v_reason:='كمية المنيو من تقرير الأمين غير معتمدة كرصيد مخزني.';
   ELSIF v_kind='material' THEN
    v_unit:=public.ameen_unit_v024(coalesce(nullif(v_record->>'unit',''),'قطعة'));
    SELECT id,base_unit_id INTO v_entity,v_base_id FROM public.materials
     WHERE lower(btrim(name))=lower(v_name) ORDER BY is_active DESC,id LIMIT 1;
    IF v_entity IS NULL THEN
     INSERT INTO public.materials(name,code,base_unit_id,category_id_v023)
     VALUES(v_name,'AM-'||upper(substr(md5(v_name),1,14)),v_unit,v_cat)
     RETURNING id,base_unit_id INTO v_entity,v_base_id;
     v_created:=v_created+1;
    ELSE
     UPDATE public.materials SET category_id_v023=coalesce(v_cat,category_id_v023) WHERE id=v_entity;
     v_updated:=v_updated+1;
    END IF;
    v_factor:=NULL;
    IF v_unit=v_base_id THEN v_factor:=1; ELSE
     SELECT upper(code) INTO v_input_code FROM public.units WHERE id=v_unit;
     SELECT upper(code) INTO v_base_code FROM public.units WHERE id=v_base_id;
     v_factor:=CASE
       WHEN v_input_code='G' AND v_base_code='KG' THEN 0.001
       WHEN v_input_code='KG' AND v_base_code='G' THEN 1000
       WHEN v_input_code='ML' AND v_base_code='L' THEN 0.001
       WHEN v_input_code='L' AND v_base_code='ML' THEN 1000
       ELSE NULL END;
     IF v_factor IS NULL THEN
      SELECT quantity_in_base INTO v_factor FROM public.material_units
       WHERE material_id=v_entity AND unit_id=v_unit LIMIT 1;
     END IF;
    END IF;
    IF v_factor IS NULL THEN v_reason:='وحدة الجرد لا تملك تحويلًا إلى وحدة المخزون الأساسية.';
    ELSIF v_qty<0 THEN v_reason:='كمية سالبة: يتطلب تعديل المخزون تأكيدًا منفصلًا.';
    ELSIF v_wh='' AND v_qty<>0 THEN v_reason:='كمية بلا مستودع: مراجعة موقع الصنف مطلوبة.';
    ELSE v_base_qty:=v_qty*v_factor; END IF;
   ELSE -- asset
    SELECT id INTO v_entity FROM public.restaurant_assets_v023 WHERE lower(btrim(name))=lower(v_name)
      ORDER BY id LIMIT 1;
    IF v_entity IS NULL THEN
     INSERT INTO public.restaurant_assets_v023(name,category_id,quantity,minimum_quantity,ameen_unit_v024)
     VALUES(v_name,v_cat,0,0,v_record->>'unit') RETURNING id INTO v_entity;
     v_created:=v_created+1;
    ELSE
     UPDATE public.restaurant_assets_v023 SET category_id=coalesce(v_cat,category_id),
      ameen_unit_v024=coalesce(ameen_unit_v024,v_record->>'unit') WHERE id=v_entity;
     v_updated:=v_updated+1;
    END IF;
    IF v_qty<0 THEN v_reason:='كمية سالبة في الأساسيات: تحتاج مراجعة.';
    ELSIF v_wh='' AND v_qty<>0 THEN v_reason:='أساسيات بلا موقع حفظ محدد.'; END IF;
   END IF;
   SELECT * INTO v_old FROM public.ameen_inventory_rows_v024 WHERE source_key=v_key FOR UPDATE;
   v_was_changed:=NOT FOUND OR v_old.quantity_base IS DISTINCT FROM v_base_qty;
   IF FOUND AND v_old.core_entity_id IS DISTINCT FROM v_entity THEN
    RAISE EXCEPTION 'AMEEN_ITEM_MAPPING_CHANGED_REVIEW_REQUIRED: %',v_name;
   END IF;
   IF FOUND AND v_old.quantity_original=v_qty AND v_old.source_price IS NOT DISTINCT FROM v_price
     AND v_old.kind=v_kind AND v_old.category IS NOT DISTINCT FROM v_record->>'category' THEN
    v_same:=v_same+1;
   END IF;
   INSERT INTO public.ameen_inventory_rows_v024
      (source_key,kind,name,category,warehouse,unit_name,quantity_original,secondary_unit,
       secondary_quantity,source_price,core_entity_id,quantity_base,review_reason,balance_changed_in_run,last_run_id,last_seen_at)
   VALUES(v_key,v_kind,v_name,v_record->>'category',v_wh,v_record->>'unit',v_qty,
       v_record->>'unit2',(v_record->>'quantity2')::numeric,v_price,v_entity,v_base_qty,v_reason,v_was_changed,v_run,now())
   ON CONFLICT(source_key) DO UPDATE SET
     name=excluded.name,category=excluded.category,quantity_original=excluded.quantity_original,
     secondary_unit=excluded.secondary_unit,secondary_quantity=excluded.secondary_quantity,
     source_price=excluded.source_price,core_entity_id=excluded.core_entity_id,
     quantity_base=excluded.quantity_base,review_reason=excluded.review_reason,
     balance_changed_in_run=excluded.balance_changed_in_run,
     last_run_id=excluded.last_run_id,last_seen_at=now();
   IF v_reason IS NOT NULL AND v_kind<>'menu' THEN v_review:=v_review+1; END IF;
  END LOOP;
  -- Reconcile total physical material stock to the current snapshot, never add total quantity twice.
  FOR v_stock IN
   SELECT core_entity_id AS material_id, count(*) AS row_count,
    count(*) FILTER(WHERE quantity_base IS NULL) AS invalid_count,
    count(*) FILTER(WHERE balance_changed_in_run) AS changed_count,
    sum(coalesce(quantity_base,0)) AS total_base
   FROM public.ameen_inventory_rows_v024 WHERE last_run_id=v_run AND kind='material'
   GROUP BY core_entity_id
  LOOP
   IF v_stock.invalid_count>0 THEN v_review:=v_review+1;CONTINUE;END IF;
   IF v_stock.changed_count=0 THEN CONTINUE; END IF;
   SELECT current_stock_base INTO v_current FROM public.materials
      WHERE id=v_stock.material_id FOR UPDATE;
   v_target:=v_stock.total_base;
   v_delta:=round(v_target-coalesce(v_current,0),6);
   IF abs(v_delta)>0.000001 THEN
    PERFORM public.record_inventory_movement(
      p_material_id=>v_stock.material_id,
      p_movement_type=>CASE WHEN v_delta>0 THEN 'adjustment_in' ELSE 'adjustment_out' END,
      p_quantity_delta_base=>v_delta,p_unit_cost_base_per_base_unit=>NULL,
      p_occurred_at=>now(),p_source_type=>'manual_adjustment',p_source_id=>v_run,
      p_source_line_id=>NULL,p_note=>'تسوية رصيد الجرد المستورد من الأمين؛ لا تُعدّ عملية شراء');
    v_ledger:=v_ledger+1;
   END IF;
  END LOOP;
  -- Asset totals by exact snapshot for assets contained in this import.
  UPDATE public.restaurant_assets_v023 a SET quantity=q.amount,updated_at=now()
  FROM (SELECT core_entity_id AS asset_id,sum(quantity_original) amount,
        count(*) FILTER(WHERE review_reason IS NOT NULL) issues
        FROM public.ameen_inventory_rows_v024
        WHERE last_run_id=v_run AND kind='asset'
        GROUP BY core_entity_id) q
  WHERE a.id=q.asset_id AND q.issues=0 AND q.amount>=0;

 ELSIF p_kind='orders' THEN
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_no:=btrim(coalesce(v_record->>'number',''));
   v_date:=(v_record->>'date')::date;
   v_net:=(v_record->>'netTotal')::numeric;
   v_gross:=(v_record->>'grossTotal')::numeric;
   IF v_no='' OR length(v_no)>100 OR v_date IS NULL OR v_net<0 OR v_gross<0
      OR jsonb_typeof(v_record->'items')<>'array' OR jsonb_array_length(v_record->'items')<1
    THEN RAISE EXCEPTION 'AMEEN_ORDER_INVALID'; END IF;
   v_hash:=md5(v_record::text);
   SELECT * INTO v_previous FROM public.ameen_order_snapshots_v024
     WHERE business_date=v_date AND external_number=v_no FOR UPDATE;
   IF FOUND AND v_previous.row_hash=v_hash THEN v_same:=v_same+1;CONTINUE;END IF;
   v_order:=v_previous.linked_order_id;
   v_reason:=NULL;
   IF v_order IS NULL THEN
    SELECT id,status,source_fingerprint INTO v_other_order,v_order_status,v_order_fingerprint
      FROM public.orders WHERE business_date=v_date AND external_order_number=v_no
       AND status IS DISTINCT FROM 'voided' ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
    IF v_other_order IS NOT NULL AND coalesce(v_order_fingerprint,'') NOT LIKE 'ameen:%' THEN
      v_reason:='أوردر برقم وتاريخ مماثلين موجود مسبقًا؛ لم نستبدله.';
    ELSE v_order:=v_other_order; END IF;
   END IF;
   IF v_order IS NOT NULL THEN
    SELECT status,source_fingerprint INTO v_order_status,v_order_fingerprint
       FROM public.orders WHERE id=v_order FOR UPDATE;
    IF v_order_status<>'draft' THEN
      v_reason:='الأوردر منشور أو ملغى؛ تحديث المصدر محفوظ دون تعديل الحركات المالية.';
    ELSIF v_previous.id IS NOT NULL AND v_previous.linked_order_id=v_order THEN
      SELECT max(updated_at) INTO v_order_row_age FROM public.order_items WHERE order_id=v_order;
      IF v_order_row_age>coalesce(v_previous.last_synced_at,v_previous.updated_at)+interval '2 seconds'
       THEN v_reason:='المسودة عُدلت يدويًا بعد الاستيراد؛ تحتاج مطابقة قبل الاستبدال.'; END IF;
    END IF;
   END IF;
   IF v_reason IS NULL AND v_order IS NULL THEN
    v_order:=public.create_order(p_cashbox_id=>NULL,p_external_order_number=>v_no,
       p_currency_code=>'SYP',p_occurred_at=>(v_record->>'occurredAt')::timestamptz,
       p_entry_method=>'manual',p_source_fingerprint=>'ameen:'||md5(v_date::text||'|'||v_no),
       p_notes=>'مسودة مستوردة من برنامج الأمين v0.24؛ صافي الملف يحتاج مراجعة قبل النشر.');
    PERFORM public.set_order_rates_v023(v_order,0,0,0);
    v_created:=v_created+1;
   ELSIF v_reason IS NULL THEN
    DELETE FROM public.order_items WHERE order_id=v_order;
    v_updated:=v_updated+1;
   END IF;
   IF v_reason IS NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_record->'items') LOOP
     v_name:=btrim(coalesce(v_item->>'name',''));
     IF v_name='' OR (v_item->>'quantity')::numeric<=0 OR (v_item->>'unitPrice')::numeric<0
      THEN RAISE EXCEPTION 'AMEEN_ORDER_ITEM_INVALID'; END IF;
     SELECT id INTO v_menu FROM public.menu_items WHERE lower(btrim(name))=lower(v_name)
      ORDER BY is_active DESC,id LIMIT 1;
     IF v_menu IS NULL THEN
      INSERT INTO public.menu_items(name,manual_price_original)
       VALUES(v_name,(v_item->>'unitPrice')::numeric) RETURNING id INTO v_menu;
     END IF;
     PERFORM public.add_order_item_v013(v_order,v_menu,(v_item->>'quantity')::numeric,
       (v_item->>'unitPrice')::numeric,0,v_name);
    END LOOP;
   ELSE v_review:=v_review+1; END IF;
   INSERT INTO public.ameen_order_snapshots_v024
    (business_date,external_number,occurred_at,source_net,source_gross,source_syp,
      line_payload,row_hash,linked_order_id,review_status,review_notes,last_synced_at,last_run_id,updated_at)
   VALUES(v_date,v_no,(v_record->>'occurredAt')::timestamptz,v_net,v_gross,
    (v_record->>'reportedSyp')::numeric,v_record->'items',v_hash,v_order,
    CASE WHEN v_reason IS NULL THEN 'needs_review' ELSE 'conflict' END,
    coalesce(v_reason,'فرق الصافي والرسوم والصندوق يحتاج مراجعة قبل النشر.'),
    CASE WHEN v_reason IS NULL THEN now() ELSE NULL END,v_run,now())
   ON CONFLICT(business_date,external_number) DO UPDATE SET
    occurred_at=excluded.occurred_at,source_net=excluded.source_net,source_gross=excluded.source_gross,
    source_syp=excluded.source_syp,line_payload=excluded.line_payload,row_hash=excluded.row_hash,
    linked_order_id=excluded.linked_order_id,review_status=excluded.review_status,
    review_notes=excluded.review_notes,approved_at=NULL,approval_items_hash=NULL,last_synced_at=coalesce(excluded.last_synced_at,public.ameen_order_snapshots_v024.last_synced_at),
    last_run_id=excluded.last_run_id,updated_at=now();
  END LOOP;

 ELSE -- suppliers
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_acc:=btrim(coalesce(v_record->>'accountCode',''));
   v_account_name:=btrim(coalesce(v_record->>'name',''));
   v_key:=coalesce(v_record->>'key','');
   IF v_acc='' OR length(v_acc)>70 OR length(v_account_name)>250
     OR v_key='' OR length(v_key)>950 THEN RAISE EXCEPTION 'AMEEN_SUPPLIER_INVALID'; END IF;
   SELECT id INTO v_supplier FROM public.suppliers WHERE ameen_account_code_v024=v_acc LIMIT 1;
   IF v_supplier IS NULL THEN
     SELECT id INTO v_supplier FROM public.suppliers WHERE lower(btrim(name))=lower(v_account_name)
        AND ameen_account_code_v024 IS NULL ORDER BY id LIMIT 1;
     IF v_supplier IS NULL THEN
       INSERT INTO public.suppliers(name,ameen_account_code_v024) VALUES(v_account_name,v_acc)
         RETURNING id INTO v_supplier;v_created:=v_created+1;
     ELSE
       UPDATE public.suppliers SET ameen_account_code_v024=v_acc WHERE id=v_supplier;
       v_updated:=v_updated+1;
     END IF;
   ELSE
     UPDATE public.suppliers SET name=v_account_name WHERE id=v_supplier AND name IS DISTINCT FROM v_account_name;
   END IF;
   INSERT INTO public.ameen_supplier_balances_v024
     (external_account,supplier_id,supplier_name,previous_balance,total_debit,total_credit,current_balance,last_run_id)
   VALUES(v_acc,v_supplier,v_account_name,coalesce((v_record->>'previousBalance')::numeric,0),
    coalesce((v_record->>'summaryDebit')::numeric,0),coalesce((v_record->>'summaryCredit')::numeric,0),
    coalesce((v_record->>'currentBalance')::numeric,0),v_run)
   ON CONFLICT(external_account) DO UPDATE SET
     supplier_id=excluded.supplier_id,supplier_name=excluded.supplier_name,
     previous_balance=excluded.previous_balance,total_debit=excluded.total_debit,
     total_credit=excluded.total_credit,current_balance=excluded.current_balance,
     last_run_id=excluded.last_run_id,updated_at=now();
   IF EXISTS(SELECT 1 FROM public.ameen_supplier_entries_v024 WHERE source_key=v_key) THEN v_updated:=v_updated+1;
   ELSE v_created:=v_created+1; END IF;
   INSERT INTO public.ameen_supplier_entries_v024
    (source_key,external_account,occurred_at,source_document,debit,credit,description,last_run_id)
   VALUES(v_key,v_acc,(v_record->>'occurredAt')::timestamptz,v_record->>'document',
    coalesce((v_record->>'debit')::numeric,0),coalesce((v_record->>'credit')::numeric,0),
    v_record->>'note',v_run)
   ON CONFLICT(source_key) DO UPDATE SET
    occurred_at=excluded.occurred_at,source_document=excluded.source_document,
    debit=excluded.debit,credit=excluded.credit,description=excluded.description,
    last_run_id=excluded.last_run_id,updated_at=now();
  END LOOP;
 END IF;

 v_summary:=jsonb_build_object('kind',p_kind,'created',v_created,'updated',v_updated,
   'unchanged',v_same,'review',v_review,'stockAdjustments',v_ledger,'records',v_count,
   'duplicateFile',false,'runId',v_run,'publishedOrders',0,'postedSupplierPayments',0);
 UPDATE public.ameen_import_runs_v024 SET result=v_summary WHERE id=v_run;
 RETURN v_summary;
END $$;
REVOKE ALL ON FUNCTION public.import_ameen_v024(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_ameen_v024(text,text,text,jsonb) TO authenticated;

COMMENT ON FUNCTION public.import_ameen_v024(text,text,text,jsonb) IS
'Owner-only transactional Al-Ameen import. Draft orders only; supplier statement is observational; physical stock reconciled by per-warehouse snapshot.';


-- Imported orders never become financial sales without explicit approval.
-- An existing posted order is never silently adjusted by a new Excel report.
CREATE OR REPLACE FUNCTION public.approve_ameen_order_v024(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order public.orders%rowtype; v_source public.ameen_order_snapshots_v024%rowtype; v_items_hash text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.status<>'draft' THEN RAISE EXCEPTION 'AMEEN_APPROVAL_REQUIRES_DRAFT'; END IF;
 SELECT * INTO v_source FROM public.ameen_order_snapshots_v024
  WHERE linked_order_id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_source.review_status='conflict' THEN RAISE EXCEPTION 'AMEEN_SOURCE_CONFLICT'; END IF;
 IF v_order.cashbox_id IS NULL THEN RAISE EXCEPTION 'AMEEN_ORDER_CASHBOX_REQUIRED'; END IF;
 IF abs(coalesce(v_order.net_total_original,0)-v_source.source_net)>0.01 THEN
   RAISE EXCEPTION 'AMEEN_ORDER_TOTAL_MISMATCH: computed % vs source %',v_order.net_total_original,v_source.source_net;
 END IF;
 SELECT md5(coalesce(jsonb_agg(jsonb_build_array(oi.id,oi.menu_item_id,oi.raw_item_name,oi.quantity,
      oi.unit_price_original,oi.adjustment_type,oi.adjustment_value,oi.adjustment_reason_id,oi.notes) ORDER BY oi.id)::text,'[]')) INTO v_items_hash
   FROM public.order_items oi WHERE oi.order_id=p_order_id;
 UPDATE public.ameen_order_snapshots_v024 SET review_status='approved',
  review_notes='Approved by owner after total, cashbox and item review',
  approval_items_hash=v_items_hash,approved_at=now(),updated_at=now()
 WHERE id=v_source.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.approve_ameen_order_v024(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ameen_order_v024(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_ameen_order_post_v024()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_source public.ameen_order_snapshots_v024%rowtype; v_current_items_hash text;
BEGIN
 IF NEW.status='posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
   SELECT * INTO v_source FROM public.ameen_order_snapshots_v024 WHERE linked_order_id=NEW.id LIMIT 1;
   IF FOUND THEN
    IF v_source.review_status<>'approved' OR v_source.approved_at IS NULL THEN
      RAISE EXCEPTION 'AMEEN_ORDER_REVIEW_REQUIRED';
    END IF;
    IF abs(coalesce(NEW.net_total_original,0)-v_source.source_net)>0.01 THEN
      RAISE EXCEPTION 'AMEEN_ORDER_TOTAL_MISMATCH';
    END IF;
    SELECT md5(coalesce(jsonb_agg(jsonb_build_array(oi.id,oi.menu_item_id,oi.raw_item_name,oi.quantity,
      oi.unit_price_original,oi.adjustment_type,oi.adjustment_value,oi.adjustment_reason_id,oi.notes) ORDER BY oi.id)::text,'[]')) INTO v_current_items_hash
      FROM public.order_items oi WHERE oi.order_id=NEW.id;
    IF v_source.approval_items_hash IS DISTINCT FROM v_current_items_hash THEN
      RAISE EXCEPTION 'AMEEN_ORDER_ITEMS_CHANGED_REAPPROVAL_REQUIRED';
    END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_ameen_order_post_v024_trg ON public.orders;
CREATE TRIGGER guard_ameen_order_post_v024_trg BEFORE UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.guard_ameen_order_post_v024();

COMMIT;
