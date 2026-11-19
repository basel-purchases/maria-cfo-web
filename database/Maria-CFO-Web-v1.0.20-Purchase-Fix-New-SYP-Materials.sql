-- Maria CFO Web v1.0.20 | PATCH AFTER v1.0.19
-- READ FIRST: Apply to the existing Supabase database using SQL Editor.
-- NO DATA RESET. Installation changes functions only; no row is modified
-- until a user explicitly edits a purchase or confirms an FX rate, or the
-- authenticated app performs the idempotent startup material-price sync.
-- Requires all prior migrations including v1.0.19 to be present.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
 IF to_regclass('public.purchase_invoice_revisions_v119') IS NULL
    OR to_regprocedure('public.revise_purchase_invoice_v119(uuid,uuid,text,date,text,jsonb,text)') IS NULL
 THEN RAISE EXCEPTION 'V119_PURCHASE_MIGRATION_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='inventory_movements'
     AND column_name='source_type')
   OR NOT EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='inventory_movements'
     AND column_name='source_id')
 THEN RAISE EXCEPTION 'V120_INVENTORY_SOURCE_COLUMNS_MISSING'; END IF;
END;
$preflight$;

-- The old snapshot routine includes voided invoices and uses inconsistent
-- exchange-rate column names. This replacement recomputes the *active* most
-- recent purchase after posting or reversing; it never touches USD anchors,
-- independent SYP reference prices, or prior invoice snapshots.
CREATE OR REPLACE FUNCTION public.repair_material_latest_purchase_snapshot(p_material_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $repair$
DECLARE
  v_last record;
  v_supplier uuid;
  v_supplier_last record;
  v_supplier_count bigint;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_material_id IS NULL THEN RETURN; END IF;

  SELECT pii.unit_price_original,pii.purchase_unit_id,
         pii.unit_cost_base_per_base_unit,pi.currency_code,
         pi.exchange_rate_to_base,pi.occurred_at
    INTO v_last
    FROM public.purchase_invoice_items pii
    JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
   WHERE pii.material_id=p_material_id
     AND pi.status='posted' AND NOT coalesce(pi.is_voided,false)
     AND NOT coalesce(pi.is_ameen_legacy_v029,false)
   ORDER BY pi.occurred_at DESC, pi.posted_at DESC NULLS LAST,
            pii.created_at DESC, pii.id DESC
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.materials SET
       last_purchase_price_original=v_last.unit_price_original,
       last_purchase_currency_code=v_last.currency_code,
       last_purchase_unit_id=v_last.purchase_unit_id,
       last_purchase_exchange_rate=v_last.exchange_rate_to_base,
       last_purchase_unit_cost_base=v_last.unit_cost_base_per_base_unit,
       last_purchase_at=v_last.occurred_at
     WHERE id=p_material_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.purchase_invoice_items pii
    JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
    WHERE pii.material_id=p_material_id AND pi.status='posted'
      AND NOT coalesce(pi.is_ameen_legacy_v029,false)
  ) THEN
    -- Do not present a voided invoice as the material's last *actual* purchase.
    -- This resets purchase-snapshot fields only when this material has a real
    -- posted invoice history; independent manual reference prices are untouched.
    UPDATE public.materials SET
       last_purchase_price_original=NULL,
       last_purchase_currency_code=NULL,
       last_purchase_unit_id=NULL,
       last_purchase_exchange_rate=NULL,
       last_purchase_unit_cost_base=NULL,
       last_purchase_at=NULL
     WHERE id=p_material_id;
  END IF;

  FOR v_supplier IN
    SELECT DISTINCT pi.supplier_id
      FROM public.purchase_invoice_items pii
      JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
     WHERE pii.material_id=p_material_id AND pi.supplier_id IS NOT NULL
       AND pi.status='posted' AND NOT coalesce(pi.is_ameen_legacy_v029,false)
     ORDER BY pi.supplier_id
  LOOP
    SELECT count(*) INTO v_supplier_count
      FROM public.purchase_invoice_items pii
      JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
     WHERE pii.material_id=p_material_id AND pi.supplier_id=v_supplier
       AND pi.status='posted' AND NOT coalesce(pi.is_voided,false)
       AND NOT coalesce(pi.is_ameen_legacy_v029,false);
    IF v_supplier_count>0 THEN
      SELECT pii.purchase_unit_id, pii.unit_price_original,
             pii.unit_cost_base_per_base_unit, pi.currency_code,
             pi.exchange_rate_to_base, pi.occurred_at
        INTO v_supplier_last
        FROM public.purchase_invoice_items pii
        JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
       WHERE pii.material_id=p_material_id AND pi.supplier_id=v_supplier
         AND pi.status='posted' AND NOT coalesce(pi.is_voided,false)
         AND NOT coalesce(pi.is_ameen_legacy_v029,false)
       ORDER BY pi.occurred_at DESC, pi.posted_at DESC NULLS LAST,
                pii.created_at DESC, pii.id DESC
       LIMIT 1;
      INSERT INTO public.supplier_materials(
         supplier_id,material_id,default_purchase_unit_id,last_price_original,
         last_currency_code,last_exchange_rate,last_unit_cost_base,
         last_purchase_at,purchase_count)
      VALUES(v_supplier,p_material_id,v_supplier_last.purchase_unit_id,
         v_supplier_last.unit_price_original,v_supplier_last.currency_code,
         v_supplier_last.exchange_rate_to_base,
         v_supplier_last.unit_cost_base_per_base_unit,
         v_supplier_last.occurred_at,v_supplier_count)
      ON CONFLICT (supplier_id,material_id) DO UPDATE SET
         default_purchase_unit_id=excluded.default_purchase_unit_id,
         last_price_original=excluded.last_price_original,
         last_currency_code=excluded.last_currency_code,
         last_exchange_rate=excluded.last_exchange_rate,
         last_unit_cost_base=excluded.last_unit_cost_base,
         last_purchase_at=excluded.last_purchase_at,
         purchase_count=excluded.purchase_count;
    ELSE
      UPDATE public.supplier_materials SET
         default_purchase_unit_id=NULL,last_price_original=NULL,
         last_currency_code=NULL,last_exchange_rate=NULL,
         last_unit_cost_base=NULL,last_purchase_at=NULL,purchase_count=0
       WHERE supplier_id=v_supplier AND material_id=p_material_id;
    END IF;
  END LOOP;
END;
$repair$;

-- v1.0.19's published-invoice edit calls void_purchase_invoice_v010.
-- Its older implementation queried inventory_movements.reference_type/reference_id
-- which DO NOT EXIST in the live v1.0.19 database. Correct names are
-- source_type/source_id/source_line_id. Any failure rolls back the full revision.
CREATE OR REPLACE FUNCTION public.void_purchase_invoice_v010(
    p_invoice_id uuid,p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $void$
DECLARE
  v_invoice public.purchase_invoices%ROWTYPE;
  v_move record;
  v_actual bigint;
  v_expected bigint;
  v_material uuid;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT * INTO v_invoice FROM public.purchase_invoices
    WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_INVOICE_NOT_FOUND'; END IF;
  IF coalesce(v_invoice.is_voided,false) THEN RAISE EXCEPTION 'PURCHASE_INVOICE_ALREADY_VOIDED'; END IF;
  IF coalesce(v_invoice.is_ameen_legacy_v029,false) THEN RAISE EXCEPTION 'PURCHASE_REVISION_HISTORIC_LOCKED'; END IF;
  IF v_invoice.status<>'posted' THEN RAISE EXCEPTION 'ONLY_POSTED_INVOICE_CAN_BE_VOIDED'; END IF;
  IF EXISTS(SELECT 1 FROM public.supplier_payment_allocations WHERE invoice_id=p_invoice_id)
    THEN RAISE EXCEPTION 'PURCHASE_INVOICE_HAS_PAYMENTS'; END IF;
  SELECT count(*) INTO v_expected FROM public.purchase_invoice_items
   WHERE invoice_id=p_invoice_id;
  SELECT count(*) INTO v_actual FROM public.inventory_movements
   WHERE source_type='purchase_invoice' AND source_id=p_invoice_id
      AND movement_type='purchase' AND quantity_delta_base>0;
  IF v_expected=0 OR v_expected<>v_actual THEN
    RAISE EXCEPTION 'PURCHASE_VOID_MOVEMENTS_MISMATCH (% expected, % found)',v_expected,v_actual;
  END IF;

  FOR v_move IN
     SELECT id,material_id,quantity_delta_base,unit_cost_base_per_base_unit
       FROM public.inventory_movements
      WHERE source_type='purchase_invoice' AND source_id=p_invoice_id
        AND movement_type='purchase' AND quantity_delta_base>0
      ORDER BY id FOR UPDATE
  LOOP
     -- Directly record an explicitly linked reversal even if a purchased
     -- material has since been disabled. Never edit an old movement in place.
     INSERT INTO public.inventory_movements(
         material_id,movement_type,quantity_delta_base,
         unit_cost_base_per_base_unit,occurred_at,
         source_type,source_id,source_line_id,note)
       VALUES(v_move.material_id,'adjustment_out',-abs(v_move.quantity_delta_base),
         v_move.unit_cost_base_per_base_unit,now(),
         'purchase_void',p_invoice_id,v_move.id,
         coalesce(nullif(btrim(p_reason),''),'إلغاء أو تصحيح فاتورة شراء'));
     UPDATE public.materials SET current_stock_base=current_stock_base-abs(v_move.quantity_delta_base)
       WHERE id=v_move.material_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_VOID_MATERIAL_NOT_FOUND'; END IF;
  END LOOP;

  UPDATE public.purchase_invoices SET
      is_voided=true,voided_at=now(),
      void_reason=nullif(btrim(coalesce(p_reason,'')),''),
      voided_original_total=total_original,total_original=0
   WHERE id=p_invoice_id;

  FOR v_material IN
    SELECT DISTINCT material_id FROM public.purchase_invoice_items
    WHERE invoice_id=p_invoice_id ORDER BY material_id
  LOOP
    PERFORM public.repair_material_latest_purchase_snapshot(v_material);
  END LOOP;
  RETURN true;
END;
$void$;

-- v1.0.20: Preserve original invoice-level discount, tax, due date and notes
-- during a posted correction. The V119 audit and allocation guards remain.
CREATE OR REPLACE FUNCTION public.revise_purchase_invoice_v119(p_invoice_id uuid, p_supplier_id uuid, p_invoice_number text, p_invoice_date date, p_currency_code text, p_items jsonb, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old public.purchase_invoices%ROWTYPE;
  v_new public.purchase_invoices%ROWTYPE;
  v_new_id uuid;
  v_item jsonb;
  v_qty numeric;
  v_price numeric;
  v_discount numeric;
  v_material uuid;
  v_unit uuid;
  v_alloc_count integer := 0;
  v_alloc_total numeric := 0;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_occurs timestamptz;
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_invoice_id IS NULL THEN RAISE EXCEPTION 'PURCHASE_REVISION_INVOICE_REQUIRED'; END IF;
  SELECT * INTO v_old FROM public.purchase_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_REVISION_INVOICE_NOT_FOUND'; END IF;
  IF coalesce(v_old.is_voided,false) THEN RAISE EXCEPTION 'PURCHASE_REVISION_OLD_VERSION'; END IF;
  IF coalesce(v_old.is_ameen_legacy_v029,false) THEN RAISE EXCEPTION 'PURCHASE_REVISION_HISTORIC_LOCKED'; END IF;
  IF v_old.status NOT IN ('draft','posted') THEN RAISE EXCEPTION 'PURCHASE_REVISION_INVALID_STATUS'; END IF;
  IF p_supplier_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_supplier_id)
    THEN RAISE EXCEPTION 'PURCHASE_REVISION_SUPPLIER_REQUIRED'; END IF;
  IF p_invoice_date IS NULL OR p_currency_code NOT IN ('SYP','USD')
    THEN RAISE EXCEPTION 'PURCHASE_REVISION_BAD_HEADER'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items)>500
    THEN RAISE EXCEPTION 'PURCHASE_REVISION_BAD_ITEMS'; END IF;
  IF v_old.status='posted' AND jsonb_array_length(p_items)=0
    THEN RAISE EXCEPTION 'PURCHASE_REVISION_EMPTY_POSTED'; END IF;

  -- Validate ALL items before making changes; the existing item RPC performs
  -- additional material/activity/unit-conversion validation inside this txn.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS x(value) LOOP
    IF jsonb_typeof(v_item)<>'object' THEN RAISE EXCEPTION 'PURCHASE_REVISION_BAD_ITEMS'; END IF;
    v_material := (v_item->>'material_id')::uuid;
    v_unit := (v_item->>'purchase_unit_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric,0);
    IF v_material IS NULL OR v_unit IS NULL OR v_qty IS NULL OR v_qty<=0
       OR v_price IS NULL OR v_price<0 OR v_discount<0
       OR v_discount>v_qty*v_price
      THEN RAISE EXCEPTION 'PURCHASE_REVISION_INVALID_LINE'; END IF;
  END LOOP;

  -- Keep payment allocations with their original receipt. A corrected invoice
  -- can inherit the allocations only if its vendor/currency and payable still
  -- match. Any unknown/failing accounting constraint rolls back everything.
  IF v_old.status='posted' THEN
    PERFORM 1 FROM public.supplier_payment_allocations
       WHERE invoice_id=p_invoice_id FOR UPDATE;
    SELECT count(*), coalesce(sum(amount_invoice_currency),0)
      INTO v_alloc_count, v_alloc_total
      FROM public.supplier_payment_allocations WHERE invoice_id=p_invoice_id;
    IF v_alloc_count>0 AND (v_old.supplier_id IS DISTINCT FROM p_supplier_id
                             OR v_old.currency_code IS DISTINCT FROM p_currency_code)
       THEN RAISE EXCEPTION 'PURCHASE_REVISION_PAID_PARTY_OR_CURRENCY'; END IF;
  END IF;

  v_occurs := (p_invoice_date::timestamp + interval '12 hours') AT TIME ZONE 'UTC';
  IF v_old.status='draft' THEN
    UPDATE public.purchase_invoices SET supplier_id=p_supplier_id,
        invoice_number=nullif(btrim(coalesce(p_invoice_number,'')),''),
        invoice_date=p_invoice_date, occurred_at=v_occurs,
        currency_code=p_currency_code WHERE id=p_invoice_id;
    DELETE FROM public.purchase_invoice_items WHERE invoice_id=p_invoice_id;
    v_new_id := p_invoice_id;
  ELSE
    SELECT to_jsonb(v_old) || jsonb_build_object(
      'items', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
           FROM public.purchase_invoice_items i WHERE i.invoice_id=p_invoice_id),'[]'::jsonb))
      INTO v_old_snapshot;
    v_new_id := public.create_purchase_invoice(
       p_supplier_id=>p_supplier_id,
       p_currency_code=>p_currency_code,
       p_invoice_number=>nullif(btrim(coalesce(p_invoice_number,'')),''),
       p_invoice_date=>p_invoice_date,
       p_occurred_at=>v_occurs,
       p_entry_method=>'manual');
    -- Preserve accounting header adjustments. Creating a replacement invoice
    -- otherwise defaults discount/tax to zero and silently changes payable.
    UPDATE public.purchase_invoices SET
       discount_original=v_old.discount_original,
       tax_original=v_old.tax_original,
       notes=v_old.notes,
       due_date=v_old.due_date
     WHERE id=v_new_id;
    -- Correcting values in the same currency must not silently revalue an
    -- earlier USD purchase at today's unrelated exchange rate.
    IF v_old.currency_code=p_currency_code AND v_old.exchange_rate_to_base IS NOT NULL THEN
      UPDATE public.purchase_invoices SET exchange_rate_to_base=v_old.exchange_rate_to_base,
          due_date=v_old.due_date WHERE id=v_new_id;
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS x(value) LOOP
    PERFORM public.add_purchase_invoice_item(
       p_invoice_id=>v_new_id,
       p_material_id=>(v_item->>'material_id')::uuid,
       p_purchase_unit_id=>(v_item->>'purchase_unit_id')::uuid,
       p_quantity=>(v_item->>'quantity')::numeric,
       p_unit_price_original=>(v_item->>'unit_price')::numeric,
       p_line_discount_original=>coalesce((v_item->>'discount')::numeric,0),
       p_ai_confidence=>NULL,
       p_notes=>nullif(btrim(coalesce(v_item->>'notes','')),''));
  END LOOP;
  IF v_old.status='draft' THEN
    PERFORM public.refresh_purchase_invoice_totals_v010(p_invoice_id);
    RETURN p_invoice_id;
  END IF;

  PERFORM public.post_purchase_invoice(v_new_id);
  SELECT * INTO v_new FROM public.purchase_invoices WHERE id=v_new_id FOR UPDATE;
  IF v_new.status<>'posted' THEN RAISE EXCEPTION 'PURCHASE_REVISION_POST_FAILED'; END IF;
  IF v_new.total_original < v_alloc_total
     THEN RAISE EXCEPTION 'PURCHASE_REVISION_BELOW_PAID_AMOUNT'; END IF;
  IF v_alloc_count>0 AND v_new.exchange_rate_to_base IS DISTINCT FROM v_old.exchange_rate_to_base
     THEN RAISE EXCEPTION 'PURCHASE_REVISION_PAID_EXCHANGE_RATE'; END IF;

  -- Transfer allocations ONLY inside the same transaction, preserving the
  -- existing cash payments. Then v0.10 void reverses old stock movements.
  IF v_alloc_count>0 THEN
     UPDATE public.supplier_payment_allocations SET invoice_id=v_new_id
       WHERE invoice_id=p_invoice_id;
  END IF;
  PERFORM public.void_purchase_invoice_v010(p_invoice_id,
      'تصحيح فاتورة v1.0.19؛ استبدلت بالفاتورة '||v_new_id::text||
       coalesce(' | '||nullif(btrim(p_reason),''),''));

  SELECT to_jsonb(v_new) || jsonb_build_object('items',
      coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM public.purchase_invoice_items i WHERE i.invoice_id=v_new_id),'[]'::jsonb))
      INTO v_new_snapshot;
  INSERT INTO public.purchase_invoice_revisions_v119(
     previous_invoice_id,replacement_invoice_id,previous_snapshot,
     replacement_snapshot,moved_payment_count,moved_payment_amount_original,reason)
  VALUES(p_invoice_id,v_new_id,v_old_snapshot,v_new_snapshot,
      v_alloc_count,v_alloc_total,nullif(btrim(coalesce(p_reason,'')),''));
  RETURN v_new_id;
END;
$function$;


-- Optimistic concurrency: reject an out-of-date browser tab instead of
-- silently replacing a newer correction. Then reuse the v1.0.19 atomic
-- revision transaction with the fixed and audited stock reversal above.
CREATE OR REPLACE FUNCTION public.revise_purchase_invoice_v120(
 p_invoice_id uuid,p_supplier_id uuid,p_invoice_number text,p_invoice_date date,
 p_currency_code text,p_items jsonb,p_reason text DEFAULT NULL,
 p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $revision$
DECLARE
 v_current public.purchase_invoices%ROWTYPE;
 v_replacement uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_current FROM public.purchase_invoices
   WHERE id=p_invoice_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PURCHASE_REVISION_INVOICE_NOT_FOUND'; END IF;
 IF p_expected_updated_at IS NOT NULL
     AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at
 THEN RAISE EXCEPTION 'PURCHASE_REVISION_STALE_INVOICE'; END IF;
 v_replacement:=public.revise_purchase_invoice_v119(
    p_invoice_id,p_supplier_id,p_invoice_number,p_invoice_date,
    p_currency_code,p_items,p_reason);
 IF v_current.status='draft' THEN
   UPDATE public.purchase_invoices SET updated_at=clock_timestamp()
     WHERE id=v_replacement;
 END IF;
 RETURN v_replacement;
END;
$revision$;

-- One idempotent reconciliation after login. No external FX fetch, no
-- automatic adoption of market quotes, no history changes to invoices.
CREATE OR REPLACE FUNCTION public.material_price_sync_current_fx_v120()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $sync$
DECLARE
 v_rate numeric;
 v_material record;
 v_new numeric;
 v_count integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT usd_to_base_rate INTO v_rate FROM public.app_settings
  WHERE id=1 FOR UPDATE;
 IF v_rate IS NULL OR v_rate<=0 OR v_rate>1000 THEN
    RAISE EXCEPTION 'FX_NEW_SYP_RATE_REVIEW_REQUIRED';
 END IF;
 FOR v_material IN
   SELECT id,price_usd_v110,price_syp_v110,price_fx_rate_v110
   FROM public.materials
   WHERE price_usd_v110 IS NOT NULL AND price_usd_v110>0
   ORDER BY id FOR UPDATE
 LOOP
   v_new:=round(v_material.price_usd_v110*v_rate,8);
   IF v_material.price_syp_v110 IS DISTINCT FROM v_new OR
      v_material.price_fx_rate_v110 IS DISTINCT FROM v_rate THEN
     UPDATE public.materials SET
       price_syp_v110=v_new,price_fx_rate_v110=v_rate,
       price_updated_at_v110=now()
      WHERE id=v_material.id;
     INSERT INTO public.material_price_history_v110(
       material_id,action,previous_usd,new_usd,previous_syp,new_syp,fx_rate)
     VALUES(v_material.id,'fx_revalue',v_material.price_usd_v110,
       v_material.price_usd_v110,v_material.price_syp_v110,v_new,v_rate);
     v_count:=v_count+1;
   END IF;
 END LOOP;
 RETURN jsonb_build_object('rate',v_rate,'updated_materials',v_count,
     'applied',true,'unit','new_SYP','status','synchronized');
END;
$sync$;

CREATE OR REPLACE FUNCTION public.material_price_set_new_exchange_v120(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $setfx$
DECLARE
 v_previous numeric;
 v_result jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>1000 THEN
   RAISE EXCEPTION 'INVALID_NEW_SYP_EXCHANGE_RATE';
 END IF;
 SELECT usd_to_base_rate INTO v_previous FROM public.app_settings
   WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APP_SETTINGS_MISSING'; END IF;
 IF v_previous IS DISTINCT FROM p_rate THEN
   PERFORM public.set_exchange_rate('USD',p_rate,now(),
     'سعر الدولار بالليرة السورية الجديدة v1.0.20');
 END IF;
 v_result:=public.material_price_sync_current_fx_v120();
 RETURN v_result || jsonb_build_object('rate_changed',v_previous IS DISTINCT FROM p_rate);
END;
$setfx$;

-- Do not silently cascade-delete a supplier's historical material catalog.
-- Suppliers with invoices, allocations, imported balances or linked materials
-- must be retained for audit; only truly unused suppliers can be removed.
CREATE OR REPLACE FUNCTION public.supplier_delete_if_unused_v120(p_supplier_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $supplier_delete$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM 1 FROM public.suppliers WHERE id=p_supplier_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_invoices WHERE supplier_id=p_supplier_id)
    OR EXISTS(SELECT 1 FROM public.supplier_payments WHERE supplier_id=p_supplier_id)
    OR EXISTS(SELECT 1 FROM public.supplier_materials WHERE supplier_id=p_supplier_id)
    OR EXISTS(SELECT 1 FROM public.ameen_supplier_balances_v024 WHERE supplier_id=p_supplier_id)
 THEN RAISE EXCEPTION 'SUPPLIER_HAS_HISTORY_CANNOT_DELETE'; END IF;
 DELETE FROM public.suppliers WHERE id=p_supplier_id;
 RETURN true;
END;
$supplier_delete$;

REVOKE ALL ON FUNCTION public.repair_material_latest_purchase_snapshot(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.void_purchase_invoice_v010(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.revise_purchase_invoice_v120(uuid,uuid,text,date,text,jsonb,text,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_price_sync_current_fx_v120() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_price_set_new_exchange_v120(numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.supplier_delete_if_unused_v120(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revise_purchase_invoice_v120(uuid,uuid,text,date,text,jsonb,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_price_sync_current_fx_v120() TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_price_set_new_exchange_v120(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_delete_if_unused_v120(uuid) TO authenticated;
-- Existing v0.10 application route for safe void remains available.
GRANT EXECUTE ON FUNCTION public.void_purchase_invoice_v010(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_material_latest_purchase_snapshot(uuid) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
