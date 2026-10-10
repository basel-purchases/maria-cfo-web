-- Maria CFO Web v0.25 -- display complete imported supplier statements.
-- Requires v0.24. The stored report remains reference-only; no supplier payments or cashbox movements are posted.
BEGIN;
ALTER TABLE public.ameen_supplier_balances_v024
 ADD COLUMN IF NOT EXISTS uncollected_papers_v025 numeric;

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
 IF v_run IS NOT NULL THEN
   -- A v0.24 file may have been imported before the negotiable-paper field was tracked.
   -- Repair only this supplementary report field without replaying transactions.
   IF p_kind='suppliers' THEN
    FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
     IF v_record ? 'uncollectedPapers' THEN
      UPDATE public.ameen_supplier_balances_v024
         SET uncollected_papers_v025=(v_record->>'uncollectedPapers')::numeric
         WHERE external_account=v_record->>'accountCode'
           AND uncollected_papers_v025 IS DISTINCT FROM (v_record->>'uncollectedPapers')::numeric;
     END IF;
    END LOOP;
   END IF;
   RETURN v_summary||jsonb_build_object('duplicateFile',true,'runId',v_run);
 END IF;
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
     (external_account,supplier_id,supplier_name,previous_balance,total_debit,total_credit,
      uncollected_papers_v025,current_balance,last_run_id)
   VALUES(v_acc,v_supplier,v_account_name,coalesce((v_record->>'previousBalance')::numeric,0),
    coalesce((v_record->>'summaryDebit')::numeric,0),coalesce((v_record->>'summaryCredit')::numeric,0),
    (v_record->>'uncollectedPapers')::numeric,
    coalesce((v_record->>'currentBalance')::numeric,0),v_run)
   ON CONFLICT(external_account) DO UPDATE SET
     supplier_id=excluded.supplier_id,supplier_name=excluded.supplier_name,
     previous_balance=excluded.previous_balance,total_debit=excluded.total_debit,
     total_credit=excluded.total_credit,
     uncollected_papers_v025=excluded.uncollected_papers_v025,
     current_balance=excluded.current_balance,
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
COMMIT;
