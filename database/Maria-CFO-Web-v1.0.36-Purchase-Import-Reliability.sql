-- Maria CFO v1.0.36 | Fix opening purchase import failures and expose the actual source row.
-- Apply AFTER v1.0.35, on a restorable BACKUP/STAGING first. NO data wipe.
-- 1) Avoid recalculating 209-line invoice totals after every inserted line.
-- 2) Historical cash posting must NEVER roll back a valid source document just
--    because a cashbox does not exist, payment validation fails, or ledger is locked.
--    Such errors are recorded for explicit, idempotent reconciliation.
-- 3) Reveal precise DB/source row diagnostics to the owner.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='180s';
DO $preflight$
BEGIN
 IF to_regprocedure('public.v126_import_historic_invoices(text,jsonb,boolean)') IS NULL
 OR to_regprocedure('public.refresh_purchase_invoice_totals_v010(uuid)') IS NULL
 OR to_regprocedure('public.v135_post_historical_cash(text,uuid)') IS NULL
 OR to_regclass('public.v135_historical_cash_postings') IS NULL
 OR to_regclass('public.v126_historical_invoices') IS NULL
 OR to_regclass('public.purchase_invoice_items') IS NULL
 THEN RAISE EXCEPTION 'V136_REQUIRES_V135_AND_V126_MIGRATIONS'; END IF;
END;
$preflight$;

-- Source operation is stored; the cash issue is NOT silently considered paid.
CREATE TABLE IF NOT EXISTS public.v136_historical_cash_deferred (
 source_kind text NOT NULL CHECK (source_kind IN('purchase','sale')),
 source_id uuid NOT NULL,
 error_code text NOT NULL,
 error_message text NOT NULL,
 attempts integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_kind,source_id)
);
ALTER TABLE public.v136_historical_cash_deferred ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v136_historical_cash_deferred FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v136_historical_cash_deferred TO authenticated;
DROP POLICY IF EXISTS v136_cash_deferred_owner ON public.v136_historical_cash_deferred;
CREATE POLICY v136_cash_deferred_owner ON public.v136_historical_cash_deferred
 FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE OR REPLACE FUNCTION public.v136_capture_historical_cash()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $trig$
DECLARE v_kind text;
BEGIN
 v_kind:=CASE WHEN TG_TABLE_NAME='v126_historical_invoices' THEN 'purchase' ELSE 'sale' END;
 BEGIN
  IF public.v135_post_historical_cash(v_kind,NEW.id) THEN
   DELETE FROM public.v136_historical_cash_deferred WHERE source_kind=v_kind AND source_id=NEW.id;
  ELSE
   INSERT INTO public.v136_historical_cash_deferred(source_kind,source_id,error_code,error_message)
    VALUES(v_kind,NEW.id,'CASHBOX_UNAVAILABLE_OR_ZERO','لم يُرحّل القيد النقدي؛ راجع وجود صندوق نشط ثم أكمل الترحيل')
    ON CONFLICT(source_kind,source_id) DO UPDATE SET
    error_code=excluded.error_code,error_message=excluded.error_message,
    attempts=public.v136_historical_cash_deferred.attempts+1,updated_at=now();
  END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.v136_historical_cash_deferred(source_kind,source_id,error_code,error_message)
    VALUES(v_kind,NEW.id,SQLSTATE,left(SQLERRM,800))
    ON CONFLICT(source_kind,source_id) DO UPDATE SET
    error_code=excluded.error_code,error_message=excluded.error_message,
    attempts=public.v136_historical_cash_deferred.attempts+1,updated_at=now();
 END;
 RETURN NEW;
END;
$trig$;
DROP TRIGGER IF EXISTS v135_purchase_archive_cash_trigger ON public.v126_historical_invoices;
DROP TRIGGER IF EXISTS v136_purchase_archive_cash_trigger ON public.v126_historical_invoices;
CREATE TRIGGER v136_purchase_archive_cash_trigger AFTER INSERT ON public.v126_historical_invoices
 FOR EACH ROW EXECUTE FUNCTION public.v136_capture_historical_cash();
DROP TRIGGER IF EXISTS v135_sales_archive_cash_trigger ON public.v134_sales_archive_documents;
DROP TRIGGER IF EXISTS v136_sales_archive_cash_trigger ON public.v134_sales_archive_documents;
CREATE TRIGGER v136_sales_archive_cash_trigger AFTER INSERT ON public.v134_sales_archive_documents
 FOR EACH ROW EXECUTE FUNCTION public.v136_capture_historical_cash();

-- Read-only, owner-only readiness and deferred breakdown. A missing SQL migration
-- is now diagnosed BEFORE trying an expensive invoice batch.
CREATE OR REPLACE FUNCTION public.v136_import_readiness()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $pre$
DECLARE v_cc text;v_purchases integer;v_sales integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 SELECT base_currency_code INTO v_cc FROM public.app_settings WHERE id=1;
 SELECT count(*) INTO v_purchases FROM public.cashboxes WHERE is_active AND is_general;
 SELECT count(*) INTO v_sales FROM public.cashboxes WHERE is_active AND NOT is_general;
 RETURN jsonb_build_object('ready',v_cc='SYP','baseCurrency',v_cc,
  'activeGeneralBoxes',v_purchases,'activeSaleBoxes',v_sales,
  'importer','v1.0.36','historicalImportFunctionExists',
   to_regprocedure('public.v126_import_historic_invoices(text,jsonb,boolean)') IS NOT NULL);
END;
$pre$;
REVOKE ALL ON FUNCTION public.v136_import_readiness() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v136_import_readiness() TO authenticated;

CREATE OR REPLACE FUNCTION public.v136_deferred_cash_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $status$
 SELECT jsonb_build_object(
  'purchasesDeferred',count(*) FILTER (WHERE source_kind='purchase'),
  'salesDeferred',count(*) FILTER (WHERE source_kind='sale'),
  'issues',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'sourceKind',sub.source_kind,'errorCode',sub.error_code,
    'errorMessage',sub.error_message,'attempts',sub.attempts)
    ORDER BY sub.updated_at DESC),'[]'::jsonb)
    FROM (SELECT * FROM public.v136_historical_cash_deferred
      ORDER BY updated_at DESC LIMIT 20) sub))
 FROM public.v136_historical_cash_deferred WHERE public.is_app_owner();
$status$;
REVOKE ALL ON FUNCTION public.v136_deferred_cash_overview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v136_deferred_cash_overview() TO authenticated;

-- Controlled retry (after backup/reconciliation), never rewrites the historical invoice.
CREATE OR REPLACE FUNCTION public.v136_retry_deferred_cash(p_confirm boolean DEFAULT false,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $retry$
DECLARE item record;v_done integer:=0;v_failed integer:=0;v_no_box integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF NOT p_confirm THEN RAISE EXCEPTION 'V136_EXPLICIT_CASH_CONFIRMATION_REQUIRED'; END IF;
 IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'V136_INVALID_RETRY_LIMIT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('v136-retry-cash',0));
 FOR item IN SELECT d.source_kind,d.source_id FROM public.v136_historical_cash_deferred d
  ORDER BY d.updated_at,d.source_id LIMIT p_limit LOOP
  BEGIN
   IF public.v135_post_historical_cash(item.source_kind,item.source_id) THEN
    DELETE FROM public.v136_historical_cash_deferred
      WHERE source_kind=item.source_kind AND source_id=item.source_id;
    v_done:=v_done+1;
   ELSIF EXISTS(SELECT 1 FROM public.v135_historical_cash_postings
     WHERE source_kind=item.source_kind AND source_id=item.source_id) THEN
    DELETE FROM public.v136_historical_cash_deferred
      WHERE source_kind=item.source_kind AND source_id=item.source_id;
    v_done:=v_done+1;
   ELSE v_no_box:=v_no_box+1;END IF;
  EXCEPTION WHEN OTHERS THEN
   UPDATE public.v136_historical_cash_deferred
    SET error_code=SQLSTATE,error_message=left(SQLERRM,800),attempts=attempts+1,updated_at=now()
    WHERE source_kind=item.source_kind AND source_id=item.source_id;
   v_failed:=v_failed+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('posted',v_done,'failed',v_failed,'noBox',v_no_box);
END;
$retry$;
REVOKE ALL ON FUNCTION public.v136_retry_deferred_cash(boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v136_retry_deferred_cash(boolean,integer) TO authenticated;

-- Replace the original historic importer WITHOUT changing its signature,
-- document identity, unit checks, provenance, or idempotency.
CREATE OR REPLACE FUNCTION public.v126_import_historic_invoices(
 p_sha256 text,p_documents jsonb,p_accept_missing_units boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb;l jsonb;v_day date;v_no text;v_supplier_name text;v_key text;v_payload_md5 text;
 v_supplier uuid;v_invoice uuid;v_unit uuid;v_material uuid;v_qty numeric;v_price numeric;v_net numeric;
 v_discount numeric;v_added numeric;v_original numeric;v_lineprice numeric;v_linediscount numeric;
 v_ts timestamptz;v_tz text;v_old text;v_total numeric;v_result jsonb;v_created int:=0;v_skipped int:=0;
 v_item_count int:=0;v_line_count int:=0;v_existing uuid;v_setting_currency text;
 v_base_unit uuid;v_conversion numeric;v_current_line text;v_current_item text;
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
   v_day:=(d->>'date')::date;v_no:=btrim(d->>'number');v_supplier_name:=btrim(d->>'supplier');v_current_line:=NULL;v_current_item:=NULL;
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
     'استيراد تاريخي من الأمين؛ حركة الصندوق تُرحّل مرة واحدة أو تحفظ معلّقة للمطابقة',NULL,NULL);
   UPDATE public.purchase_invoices SET is_ameen_legacy_v029=true WHERE id=v_invoice;
   v_total:=0;
   FOR l IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
     v_current_line:=coalesce(l->>'sourceRow','غير محدد');v_current_item:=left(coalesce(l->>'name',''),180);
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
     -- v1.0.36: Bulk insert with the EXACT same columns/conversion as
     -- add_purchase_invoice_item, but refresh totals once per invoice.
     -- Original helper refreshes the entire invoice after every line: for
     -- the 209-line opening invoice this is O(n^2) and may time out in API.
     SELECT m.base_unit_id INTO v_base_unit FROM public.materials m WHERE m.id=v_material AND m.is_active;
     IF v_base_unit IS NULL THEN RAISE EXCEPTION 'V136_MATERIAL_NOT_ACTIVE: %',v_current_item; END IF;
     v_conversion:=NULL;
     IF v_unit=v_base_unit THEN v_conversion:=1;
     ELSE SELECT mu.quantity_in_base INTO v_conversion FROM public.material_units mu
       WHERE mu.material_id=v_material AND mu.unit_id=v_unit AND mu.quantity_in_base>0
       ORDER BY mu.id LIMIT 1;
     END IF;
     IF v_conversion IS NULL OR v_conversion<=0 THEN
       RAISE EXCEPTION 'V136_PURCHASE_UNIT_CONVERSION_REQUIRED: %',v_current_item;
     END IF;
     INSERT INTO public.purchase_invoice_items(
       invoice_id,material_id,purchase_unit_id,quantity_purchase_unit,
       conversion_to_base,unit_price_original,line_discount_original,ai_confidence,notes
     ) VALUES(v_invoice,v_material,v_unit,v_qty,v_conversion,v_lineprice,v_linediscount,NULL,
        'أمين سطر '||coalesce(l->>'sourceRow','؟')||'؛ السعر الأصلي '||v_price::text||
        '؛ الحسم '||coalesce(l->>'discount','0')||'؛ الإضافات '||coalesce(l->>'additions','0')||
        '؛ الصافي '||v_net::text||' ل.س');
     v_total:=v_total+v_net;v_line_count:=v_line_count+1;
   END LOOP;
   PERFORM public.refresh_purchase_invoice_totals_v010(v_invoice);
   PERFORM public.post_purchase_invoice(v_invoice);
   IF abs((SELECT total_original FROM public.purchase_invoices WHERE id=v_invoice)-v_total)>0.1 THEN
     RAISE EXCEPTION 'HISTORIC_INVOICE_TOTAL_MISMATCH: %',v_no;
   END IF;
   INSERT INTO public.v126_historical_invoices(document_key,payload_md5,workbook_sha256,invoice_id,source_number,source_date,source_supplier,original_total_syp)
   VALUES(v_key,v_payload_md5,p_sha256,v_invoice,v_no,v_day,v_supplier_name,round(v_total,4));
   v_created:=v_created+1;
 END LOOP;
 RETURN jsonb_build_object('invoicesCreated',v_created,'invoicesAlreadyPresent',v_skipped,'linesCreated',v_line_count,
   'currency','SYP','settlement','historical_cash_posted_or_deferred');
EXCEPTION WHEN OTHERS THEN
 RAISE EXCEPTION 'V136_PURCHASE_IMPORT_FAILED invoice=% source_row=% material=% pgcode=% detail=%',
    coalesce(v_no,'قبل إنشاء الفاتورة'),coalesce(v_current_line,'غير محدد'),
    coalesce(v_current_item,'غير محدد'),SQLSTATE,SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.v126_import_historic_invoices(text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v126_import_historic_invoices(text,jsonb,boolean) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
