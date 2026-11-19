-- Maria CFO Web v1.0.19 | SAFE PURCHASE REVISION AND SUPPLIER ACTIVITY
-- Apply once to the *existing* Supabase database. NO DATA RESET, NO TRUNCATE.
-- This migration only creates audit objects, read-only supplier profile and
-- an explicit, transactional owner-only invoice-revision function.
BEGIN;

CREATE TABLE IF NOT EXISTS public.purchase_invoice_revisions_v119 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
  replacement_invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
  previous_snapshot jsonb NOT NULL,
  replacement_snapshot jsonb NOT NULL,
  moved_payment_count integer NOT NULL DEFAULT 0,
  moved_payment_amount_original numeric NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_revision_distinct_v119 CHECK (previous_invoice_id <> replacement_invoice_id),
  CONSTRAINT purchase_revision_once_v119 UNIQUE (previous_invoice_id),
  CONSTRAINT purchase_revision_replacement_v119 UNIQUE (replacement_invoice_id)
);
CREATE INDEX IF NOT EXISTS purchase_revisions_replacement_idx_v119
 ON public.purchase_invoice_revisions_v119(replacement_invoice_id);
ALTER TABLE public.purchase_invoice_revisions_v119 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_invoice_revisions_v119 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.purchase_invoice_revisions_v119 TO authenticated;
DROP POLICY IF EXISTS purchase_revisions_owner_read_v119 ON public.purchase_invoice_revisions_v119;
CREATE POLICY purchase_revisions_owner_read_v119 ON public.purchase_invoice_revisions_v119
 FOR SELECT TO authenticated USING (public.is_app_owner());

-- Return a purchase's current successor ID after edits; never edit a voided
-- historical version. Supabase can use the audit table for traceability.
CREATE OR REPLACE FUNCTION public.revise_purchase_invoice_v119(
  p_invoice_id uuid,
  p_supplier_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_currency_code text,
  p_items jsonb,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;
REVOKE ALL ON FUNCTION public.revise_purchase_invoice_v119(uuid,uuid,text,date,text,jsonb,text)
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revise_purchase_invoice_v119(uuid,uuid,text,date,text,jsonb,text)
 TO authenticated;

-- One owner-only snapshot for a supplier's invoices, itemized purchases,
-- payment allocations and full stock movements for the materials they supplied.
-- The latter includes unrelated usage/adjustment and is never mislabeled as a
-- purchase from this supplier.
CREATE OR REPLACE FUNCTION public.supplier_activity_v119(p_supplier_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = '' AS $$
BEGIN
  IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_supplier_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_supplier_id)
    THEN RAISE EXCEPTION 'SUPPLIER_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'invoices',coalesce((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.invoice_date DESC,pi.id)
      FROM public.purchase_invoices pi WHERE pi.supplier_id=p_supplier_id),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(pii)||jsonb_build_object(
      'material_name',m.name,'unit_name',u.name,'unit_code',u.code) ORDER BY pi.invoice_date DESC,pi.id,pii.id)
      FROM public.purchase_invoice_items pii
      JOIN public.purchase_invoices pi ON pi.id=pii.invoice_id
      LEFT JOIN public.materials m ON m.id=pii.material_id
      LEFT JOIN public.units u ON u.id=pii.purchase_unit_id
      WHERE pi.supplier_id=p_supplier_id),'[]'::jsonb),
    'payments',coalesce((SELECT jsonb_agg(to_jsonb(sp) ORDER BY sp.id)
      FROM public.supplier_payments sp WHERE sp.supplier_id=p_supplier_id),'[]'::jsonb),
    'allocations',coalesce((SELECT jsonb_agg(to_jsonb(spa))
      FROM public.supplier_payment_allocations spa
      JOIN public.supplier_payments sp ON sp.id=spa.payment_id
      WHERE sp.supplier_id=p_supplier_id),'[]'::jsonb),
    'movements',coalesce((SELECT jsonb_agg(to_jsonb(im)||jsonb_build_object(
         'material_name',m.name) ORDER BY im.occurred_at DESC,im.id)
      FROM public.inventory_movements im
      LEFT JOIN public.materials m ON m.id=im.material_id
      WHERE im.material_id IN (SELECT DISTINCT pii.material_id
         FROM public.purchase_invoice_items pii JOIN public.purchase_invoices pi
         ON pi.id=pii.invoice_id WHERE pi.supplier_id=p_supplier_id)),'[]'::jsonb),
    'revisions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC)
      FROM public.purchase_invoice_revisions_v119 r
      JOIN public.purchase_invoices pi ON pi.id=r.previous_invoice_id
      WHERE pi.supplier_id=p_supplier_id),'[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.supplier_activity_v119(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_activity_v119(uuid) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
