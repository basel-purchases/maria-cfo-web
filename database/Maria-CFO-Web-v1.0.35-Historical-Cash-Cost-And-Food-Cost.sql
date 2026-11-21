-- Maria CFO v1.0.35: reconciled historical sale costs, idempotent historical cash,
-- and configurable Food Cost. Run AFTER v1.0.34.1 on a backed-up STAGING DB first.
-- No reset, no automatic backfill of OLD cash movements. New imports post once;
-- previously imported documents need a separate preview + explicit confirmation.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='180s';
DO $preflight$
BEGIN
 IF to_regclass('public.v134_sales_archive_documents') IS NULL
 OR to_regclass('public.v134_sales_archive_lines') IS NULL
 OR to_regclass('public.v126_historical_invoices') IS NULL
 OR to_regclass('public.v131_sale_cost_queue') IS NULL
 OR to_regprocedure('public.record_supplier_invoice_payment(uuid,uuid,numeric,text,timestamp with time zone,numeric,text)') IS NULL
 OR to_regprocedure('public.record_cashbox_transaction(uuid,text,text,numeric,text,timestamp with time zone,text,text,uuid)') IS NULL
 OR to_regprocedure('public.menu_match_v104(text)') IS NULL
 THEN RAISE EXCEPTION 'V135_REQUIRES_EXISTING_V134_AND_CASHBOX_MIGRATIONS'; END IF;
END;
$preflight$;

-- Historical sales NEVER cause a second stock debit. Sale quantity is negative in
-- the attached Al-Ameen sales report; positive return lines are not consumptions.
CREATE TABLE IF NOT EXISTS public.v135_archive_cost_queue(
 document_id uuid NOT NULL REFERENCES public.v134_sales_archive_documents(id) ON DELETE RESTRICT,
 line_index integer NOT NULL,
 menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','estimated','settled')),
 cost_total_base numeric(20,4),
 basis text NOT NULL DEFAULT 'no_recipe',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(document_id,line_index),
 FOREIGN KEY(document_id,line_index) REFERENCES public.v134_sales_archive_lines(document_id,line_index) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS v135_archive_pending_idx ON public.v135_archive_cost_queue(state,updated_at);
CREATE INDEX IF NOT EXISTS v135_archive_menu_idx ON public.v135_archive_cost_queue(menu_item_id,state);
ALTER TABLE public.v135_archive_cost_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v135_archive_cost_queue FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v135_archive_cost_queue TO authenticated;
DROP POLICY IF EXISTS v135_archive_read_owner ON public.v135_archive_cost_queue;
CREATE POLICY v135_archive_read_owner ON public.v135_archive_cost_queue
 FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE OR REPLACE FUNCTION public.v135_archive_line_enqueue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $queue$
BEGIN
 IF NEW.source_quantity<0 THEN
  INSERT INTO public.v135_archive_cost_queue(document_id,line_index,menu_item_id)
  VALUES(NEW.document_id,NEW.line_index,NEW.menu_item_id)
  ON CONFLICT(document_id,line_index) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$queue$;
DROP TRIGGER IF EXISTS v135_archive_line_enqueue_trigger ON public.v134_sales_archive_lines;
CREATE TRIGGER v135_archive_line_enqueue_trigger AFTER INSERT ON public.v134_sales_archive_lines
 FOR EACH ROW EXECUTE FUNCTION public.v135_archive_line_enqueue();
-- Existing archive: catch up without affecting any stock or money.
INSERT INTO public.v135_archive_cost_queue(document_id,line_index,menu_item_id)
SELECT l.document_id,l.line_index,l.menu_item_id FROM public.v134_sales_archive_lines l
WHERE l.source_quantity<0
ON CONFLICT(document_id,line_index) DO NOTHING;

CREATE OR REPLACE FUNCTION public.v135_reconcile_archive_costs(p_limit integer DEFAULT 500,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reconcile$
DECLARE v_line record;v_match uuid;v_recipe_count integer;v_hist_missing integer;
 v_current_missing integer;v_hist numeric;v_current numeric;v_state text;v_basis text;
 v_processed integer:=0;v_completed integer:=0;v_estimated integer:=0;v_pending integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_limit NOT BETWEEN 1 AND 750 OR p_offset<0 OR p_offset>10000000
 THEN RAISE EXCEPTION 'V135_INVALID_RECONCILE_PAGE'; END IF;
 FOR v_line IN
  SELECT q.document_id,q.line_index,q.menu_item_id,l.source_name,l.source_quantity,
    l.menu_item_id AS archive_menu,d.occurred_at
  FROM public.v135_archive_cost_queue q
  JOIN public.v134_sales_archive_lines l USING(document_id,line_index)
  JOIN public.v134_sales_archive_documents d ON d.id=q.document_id
  ORDER BY d.occurred_at,q.document_id,q.line_index LIMIT p_limit OFFSET p_offset
 LOOP
  v_processed:=v_processed+1;
  v_match:=coalesce(v_line.menu_item_id,v_line.archive_menu);
  IF v_match IS NOT NULL THEN
   SELECT coalesce(merged_into_menu_id_v133,id) INTO v_match FROM public.menu_items WHERE id=v_match;
  END IF;
  IF v_match IS NULL THEN
   SELECT menu_id INTO v_match FROM public.menu_match_v104(v_line.source_name);
  END IF;
  IF v_match IS NULL THEN
   UPDATE public.v135_archive_cost_queue SET menu_item_id=NULL,state='pending',cost_total_base=NULL,
     basis='menu_unmatched',updated_at=now()
   WHERE document_id=v_line.document_id AND line_index=v_line.line_index;
   v_pending:=v_pending+1;CONTINUE;
  END IF;
  SELECT count(*),
   count(*) FILTER(WHERE hc.cost IS NULL OR hc.cost<=0),
   count(*) FILTER(WHERE coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0)) IS NULL
                OR coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0))<=0),
   sum(r.quantity_base*abs(v_line.source_quantity)*hc.cost),
   sum(r.quantity_base*abs(v_line.source_quantity)*coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0)))
  INTO v_recipe_count,v_hist_missing,v_current_missing,v_hist,v_current
  FROM public.menu_item_recipe_items r
  JOIN public.materials m ON m.id=r.material_id
  LEFT JOIN LATERAL (SELECT public.get_material_cost_at(r.material_id,v_line.occurred_at) AS cost) hc ON TRUE
  WHERE r.menu_item_id=v_match;
  IF v_recipe_count=0 THEN
   v_state:='pending';v_basis:='recipe_missing';v_hist:=NULL;
  ELSIF v_hist_missing=0 THEN
   v_state:='settled';v_basis:='sale_date_cost';v_hist:=round(v_hist,4);
  ELSIF v_current_missing=0 THEN
   v_state:='estimated';v_basis:='current_material_cost_not_historical';v_hist:=round(v_current,4);
  ELSE
   v_state:='pending';v_basis:='material_cost_unknown';v_hist:=NULL;
  END IF;
  UPDATE public.v135_archive_cost_queue SET menu_item_id=v_match,
   state=v_state,basis=v_basis,cost_total_base=v_hist,updated_at=now()
  WHERE document_id=v_line.document_id AND line_index=v_line.line_index;
  IF v_state='settled' THEN v_completed:=v_completed+1;
  ELSIF v_state='estimated' THEN v_estimated:=v_estimated+1;
  ELSE v_pending:=v_pending+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('processed',v_processed,'settled',v_completed,
    'estimated',v_estimated,'pending',v_pending,'stockMovements',0,'cashMovements',0);
END;
$reconcile$;
REVOKE ALL ON FUNCTION public.v135_reconcile_archive_costs(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_reconcile_archive_costs(integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.v135_archive_cost_report(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0,
 p_pending_only boolean DEFAULT false,p_search text DEFAULT '')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $report$
WITH totals AS (
 SELECT count(*) total,count(*) FILTER(WHERE state='pending') pending,
  count(*) FILTER(WHERE state='estimated') estimated,
  count(*) FILTER(WHERE state='settled') settled
 FROM public.v135_archive_cost_queue WHERE public.is_app_owner()
), chosen AS (
 SELECT q.*,l.source_name,l.source_quantity,l.source_net_syp,d.source_invoice_no,d.occurred_at,
  coalesce(m.name,l.source_name) AS display_name,
  (SELECT count(*) FROM public.menu_item_recipe_items r WHERE r.menu_item_id=q.menu_item_id) recipe_count
 FROM public.v135_archive_cost_queue q
 JOIN public.v134_sales_archive_lines l USING(document_id,line_index)
 JOIN public.v134_sales_archive_documents d ON d.id=q.document_id
 LEFT JOIN public.menu_items m ON m.id=q.menu_item_id
 WHERE public.is_app_owner() AND (NOT p_pending_only OR q.state<>'settled')
   AND (p_search='' OR coalesce(m.name,l.source_name) ILIKE '%' || p_search || '%')
 ORDER BY CASE WHEN q.state='pending' THEN 0 WHEN q.state='estimated' THEN 1 ELSE 2 END,
  lower(coalesce(m.name,l.source_name)),d.occurred_at DESC
 LIMIT least(greatest(p_limit,1),300) OFFSET greatest(p_offset,0)
)
SELECT jsonb_build_object('total',t.total,'pending',t.pending,'estimated',t.estimated,'settled',t.settled,
 'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('menuId',c.menu_item_id,
  'name',c.display_name,'sourceName',c.source_name,'qty',abs(c.source_quantity),'date',c.occurred_at,
  'invoice',c.source_invoice_no,'cost',c.cost_total_base,'state',c.state,'basis',c.basis,
  'recipeCount',c.recipe_count) ORDER BY
  CASE WHEN c.state='pending' THEN 0 WHEN c.state='estimated' THEN 1 ELSE 2 END,lower(c.display_name))
  FROM chosen c),'[]'::jsonb))
FROM totals t;
$report$;
REVOKE ALL ON FUNCTION public.v135_archive_cost_report(integer,integer,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_archive_cost_report(integer,integer,boolean,text) TO authenticated;

-- Financial posting links to the original source, never to the workbook filename.
-- A copy or re-upload CANNOT create another transaction.
CREATE TABLE IF NOT EXISTS public.v135_historical_cash_postings(
 source_kind text NOT NULL CHECK(source_kind IN('sale','purchase')),
 source_id uuid NOT NULL,
 cashbox_id uuid NOT NULL REFERENCES public.cashboxes(id) ON DELETE RESTRICT,
 posting_id uuid NOT NULL UNIQUE,
 amount_syp numeric(20,4) NOT NULL CHECK(amount_syp>0),
 direction text NOT NULL CHECK(direction IN ('in','out')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_kind,source_id)
);
ALTER TABLE public.v135_historical_cash_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v135_historical_cash_postings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v135_historical_cash_postings TO authenticated;
DROP POLICY IF EXISTS v135_historical_cash_owner ON public.v135_historical_cash_postings;
CREATE POLICY v135_historical_cash_owner ON public.v135_historical_cash_postings
 FOR SELECT TO authenticated USING(public.is_app_owner());
CREATE UNIQUE INDEX IF NOT EXISTS v135_cash_source_unique_sale ON public.cashbox_transactions(reference_id)
 WHERE reference_type='v135_historical_sale' AND reference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.v135_post_historical_cash(p_kind text,p_source uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $posting$
DECLARE v_amount numeric;v_box uuid;v_at timestamptz;v_entry uuid;v_invoice uuid;
 v_no text;v_timezone text;v_direction text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF p_kind NOT IN('sale','purchase') OR p_source IS NULL THEN
  RAISE EXCEPTION 'V135_INVALID_CASH_SOURCE';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('v135cash:'||p_kind||p_source::text,0));
 IF EXISTS(SELECT 1 FROM public.v135_historical_cash_postings
           WHERE source_kind=p_kind AND source_id=p_source) THEN RETURN false;END IF;
 SELECT coalesce(nullif(timezone,''),'Asia/Damascus') INTO v_timezone FROM public.app_settings WHERE id=1;
 IF p_kind='sale' THEN
  SELECT total_sales_syp,occurred_at,source_invoice_no INTO v_amount,v_at,v_no
  FROM public.v134_sales_archive_documents WHERE id=p_source FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V135_ARCHIVE_SALE_MISSING'; END IF;
  SELECT id INTO v_box FROM public.cashboxes WHERE is_active AND NOT is_general
  ORDER BY display_order NULLS LAST,id LIMIT 1;
  IF v_box IS NULL THEN RETURN false; END IF; -- no cashier box configured yet
  IF v_amount=0 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM public.cashbox_transactions
    WHERE reference_type='v135_historical_sale' AND reference_id=p_source)
  THEN RAISE EXCEPTION 'V135_EXISTING_UNTRACKED_SALE_RECEIPT';END IF;
  v_direction:=CASE WHEN v_amount>0 THEN 'in' ELSE 'out' END;
  PERFORM public.get_or_create_cashbox_session(v_box,(v_at AT TIME ZONE v_timezone)::date);
  v_entry:=public.record_cashbox_transaction(v_box,v_direction,
    CASE WHEN v_direction='in' THEN 'sale' ELSE 'refund' END,
    abs(v_amount),'SYP',v_at,
    'فاتورة مبيع تاريخية '||v_no||' — ترحيل نقدي مرة واحدة',
    'v135_historical_sale',p_source);
 ELSE
  SELECT h.original_total_syp,h.source_number,h.invoice_id,
    (h.source_date::timestamp+interval '12 hours') AT TIME ZONE v_timezone
  INTO v_amount,v_no,v_invoice,v_at
  FROM public.v126_historical_invoices h WHERE h.id=p_source FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V135_ARCHIVE_PURCHASE_MISSING';END IF;
  SELECT id INTO v_box FROM public.cashboxes WHERE is_general AND is_active ORDER BY id LIMIT 1;
  IF v_box IS NULL THEN RETURN false;END IF;
  IF v_amount<=0 THEN RETURN false;END IF;
  IF EXISTS(SELECT 1 FROM public.supplier_payment_allocations WHERE invoice_id=v_invoice)
  THEN RAISE EXCEPTION 'V135_PURCHASE_ALREADY_PAID_RECONCILIATION_REQUIRED: %',v_no;END IF;
  PERFORM public.get_or_create_cashbox_session(v_box,(v_at AT TIME ZONE v_timezone)::date);
  v_entry:=public.record_supplier_invoice_payment(v_invoice,v_box,v_amount,'SYP',v_at,v_amount,
    'استيراد شراء تاريخي: خصم من الصندوق العام — '||v_no);
  v_direction:='out';
 END IF;
 IF v_entry IS NULL THEN RAISE EXCEPTION 'V135_CASH_POST_NOT_CONFIRMED';END IF;
 INSERT INTO public.v135_historical_cash_postings(source_kind,source_id,cashbox_id,posting_id,amount_syp,direction)
 VALUES(p_kind,p_source,v_box,v_entry,abs(v_amount),v_direction);
 RETURN true;
END;
$posting$;
REVOKE ALL ON FUNCTION public.v135_post_historical_cash(text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v135_cash_on_archive_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $trig$
BEGIN
 PERFORM public.v135_post_historical_cash('sale',NEW.id);RETURN NEW;
END;
$trig$;
CREATE OR REPLACE FUNCTION public.v135_cash_on_purchase_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $trig$
BEGIN
 PERFORM public.v135_post_historical_cash('purchase',NEW.id);RETURN NEW;
END;
$trig$;
DROP TRIGGER IF EXISTS v135_sales_archive_cash_trigger ON public.v134_sales_archive_documents;
CREATE TRIGGER v135_sales_archive_cash_trigger AFTER INSERT ON public.v134_sales_archive_documents
 FOR EACH ROW EXECUTE FUNCTION public.v135_cash_on_archive_insert();
DROP TRIGGER IF EXISTS v135_purchase_archive_cash_trigger ON public.v126_historical_invoices;
CREATE TRIGGER v135_purchase_archive_cash_trigger AFTER INSERT ON public.v126_historical_invoices
 FOR EACH ROW EXECUTE FUNCTION public.v135_cash_on_purchase_insert();

CREATE OR REPLACE FUNCTION public.v135_historical_cash_preview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $preview$
SELECT jsonb_build_object(
 'salesMissing',(SELECT count(*) FROM public.v134_sales_archive_documents d
     WHERE public.is_app_owner() AND d.total_sales_syp<>0 AND NOT EXISTS
      (SELECT 1 FROM public.v135_historical_cash_postings p WHERE p.source_kind='sale' AND p.source_id=d.id)),
 'salesAmount',(SELECT coalesce(sum(d.total_sales_syp),0) FROM public.v134_sales_archive_documents d
     WHERE public.is_app_owner() AND NOT EXISTS
      (SELECT 1 FROM public.v135_historical_cash_postings p WHERE p.source_kind='sale' AND p.source_id=d.id)),
 'purchasesMissing',(SELECT count(*) FROM public.v126_historical_invoices d
     WHERE public.is_app_owner() AND d.original_total_syp>0 AND NOT EXISTS
      (SELECT 1 FROM public.v135_historical_cash_postings p WHERE p.source_kind='purchase' AND p.source_id=d.id)),
 'purchasesAmount',(SELECT coalesce(sum(d.original_total_syp),0) FROM public.v126_historical_invoices d
     WHERE public.is_app_owner() AND NOT EXISTS
      (SELECT 1 FROM public.v135_historical_cash_postings p WHERE p.source_kind='purchase' AND p.source_id=d.id)),
 'salesPosted',(SELECT count(*) FROM public.v135_historical_cash_postings WHERE source_kind='sale' AND public.is_app_owner()),
 'purchasesPosted',(SELECT count(*) FROM public.v135_historical_cash_postings WHERE source_kind='purchase' AND public.is_app_owner())
);
$preview$;
REVOKE ALL ON FUNCTION public.v135_historical_cash_preview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_historical_cash_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.v135_backfill_historical_cash(p_confirm boolean DEFAULT false,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $backfill$
DECLARE v_rec record;v_done integer:=0;v_skipped integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF NOT p_confirm THEN RAISE EXCEPTION 'V135_EXPLICIT_CASH_BACKFILL_CONFIRMATION_REQUIRED';END IF;
 IF p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'V135_INVALID_CASH_BACKFILL_LIMIT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v135-cash-backfill',0));
 FOR v_rec IN
   SELECT 'purchase'::text AS kind,d.id,d.source_date::timestamptz AS occurred_at
   FROM public.v126_historical_invoices d
   WHERE d.original_total_syp>0 AND NOT EXISTS(SELECT 1 FROM public.v135_historical_cash_postings p
      WHERE p.source_kind='purchase' AND p.source_id=d.id)
   UNION ALL
   SELECT 'sale'::text,d.id,d.occurred_at FROM public.v134_sales_archive_documents d
   WHERE d.total_sales_syp<>0 AND NOT EXISTS(SELECT 1 FROM public.v135_historical_cash_postings p
      WHERE p.source_kind='sale' AND p.source_id=d.id)
   ORDER BY occurred_at,kind,id LIMIT p_limit
 LOOP
  IF public.v135_post_historical_cash(v_rec.kind,v_rec.id) THEN v_done:=v_done+1;
  ELSE v_skipped:=v_skipped+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('posted',v_done,'deferredWithoutCashbox',v_skipped);
END;
$backfill$;
REVOKE ALL ON FUNCTION public.v135_backfill_historical_cash(boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_backfill_historical_cash(boolean,integer) TO authenticated;

-- Food Cost controls and event-driven warnings, only for recipes with known
-- positive costs/prices. Unknown recipe values are never interpreted as 0%.
CREATE TABLE IF NOT EXISTS public.v135_food_cost_settings(
 id integer PRIMARY KEY CHECK(id=1),min_percent numeric(8,3) NOT NULL DEFAULT 25,
 max_percent numeric(8,3) NOT NULL DEFAULT 40,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v135_food_cost_range CHECK(min_percent>=0 AND max_percent<=100 AND min_percent<max_percent)
);
INSERT INTO public.v135_food_cost_settings(id,min_percent,max_percent)
 VALUES(1,25,40) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.v135_food_cost_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v135_food_cost_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v135_food_cost_settings TO authenticated;
DROP POLICY IF EXISTS v135_food_cost_settings_owner ON public.v135_food_cost_settings;
CREATE POLICY v135_food_cost_settings_owner ON public.v135_food_cost_settings
 FOR SELECT TO authenticated USING(public.is_app_owner());
CREATE TABLE IF NOT EXISTS public.v135_cost_alerts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE,
 food_cost_percent numeric(12,4) NOT NULL,reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS v135_cost_alerts_recent_idx ON public.v135_cost_alerts(created_at DESC);
ALTER TABLE public.v135_cost_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v135_cost_alerts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v135_cost_alerts TO authenticated;
DROP POLICY IF EXISTS v135_cost_alerts_owner ON public.v135_cost_alerts;
CREATE POLICY v135_cost_alerts_owner ON public.v135_cost_alerts FOR SELECT TO authenticated USING(public.is_app_owner());

CREATE OR REPLACE FUNCTION public.v135_warn_food_cost(p_menu_id uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $warn$
DECLARE v_price numeric;v_recipe numeric;v_est numeric;v_missing boolean;v_pct numeric;
 v_min numeric;v_max numeric;
BEGIN
 SELECT m.manual_price_original*(1-coalesce(m.default_discount_percent,0)/100),
   c.recipe_cost_base,c.has_missing_cost,e.estimated_unit_cost_base
 INTO v_price,v_recipe,v_missing,v_est
 FROM public.menu_items m
 LEFT JOIN public.menu_item_costs c ON c.id=m.id
 LEFT JOIN public.event_menu_cost_estimates_v039 e ON e.menu_item_id=m.id
 WHERE m.id=p_menu_id AND NOT m.is_archived_v133;
 IF NOT FOUND OR coalesce(v_price,0)<=0 THEN RETURN false;END IF;
 IF v_recipe IS NULL OR coalesce(v_missing,true) OR
    NOT EXISTS(SELECT 1 FROM public.menu_item_recipe_items WHERE menu_item_id=p_menu_id) THEN v_recipe:=v_est;END IF;
 IF v_recipe IS NULL THEN RETURN false;END IF;
 v_pct:=round(v_recipe*100/v_price,4);
 SELECT min_percent,max_percent INTO v_min,v_max FROM public.v135_food_cost_settings WHERE id=1;
 IF v_pct BETWEEN v_min AND v_max THEN RETURN false;END IF;
 IF EXISTS (SELECT 1 FROM public.v135_cost_alerts WHERE menu_item_id=p_menu_id AND reason=p_reason
   AND created_at>now()-interval '2 minutes' AND abs(food_cost_percent-v_pct)<0.001) THEN RETURN false;END IF;
 INSERT INTO public.v135_cost_alerts(menu_item_id,food_cost_percent,reason)
 VALUES(p_menu_id,v_pct,left(coalesce(p_reason,'تغيرت التكلفة أو السعر'),160));
 RETURN true;
END;
$warn$;
REVOKE ALL ON FUNCTION public.v135_warn_food_cost(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v135_menu_price_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $notice$
BEGIN
 IF TG_OP='INSERT' OR (NEW.manual_price_original IS DISTINCT FROM OLD.manual_price_original
 OR NEW.default_discount_percent IS DISTINCT FROM OLD.default_discount_percent) THEN
  PERFORM public.v135_warn_food_cost(NEW.id,'تغيير سعر الوجبة');
 END IF;
 RETURN NEW;
END;
$notice$;
DROP TRIGGER IF EXISTS v135_menu_price_alert_trigger ON public.menu_items;
CREATE TRIGGER v135_menu_price_alert_trigger AFTER INSERT OR UPDATE ON public.menu_items
 FOR EACH ROW EXECUTE FUNCTION public.v135_menu_price_notice();
CREATE OR REPLACE FUNCTION public.v135_recipe_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $notice$
BEGIN
 IF TG_OP='UPDATE' AND NEW.menu_item_id IS DISTINCT FROM OLD.menu_item_id THEN
  PERFORM public.v135_warn_food_cost(OLD.menu_item_id,'تعديل مكونات الوصفة');
 END IF;
 -- Any previously costed historic sales for this recipe become pending again
 -- until their actual sale-date/material cost is recomputed.
 UPDATE public.v135_archive_cost_queue
 SET state='pending',basis='recipe_changed',cost_total_base=NULL,updated_at=now()
 WHERE menu_item_id=(CASE WHEN TG_OP='DELETE' THEN OLD.menu_item_id ELSE NEW.menu_item_id END)
 AND state<>'pending';
 PERFORM public.v135_warn_food_cost(CASE WHEN TG_OP='DELETE' THEN OLD.menu_item_id ELSE NEW.menu_item_id END,'تعديل مكونات الوصفة');
 RETURN NULL;
END;
$notice$;
DROP TRIGGER IF EXISTS v135_recipe_alert_trigger ON public.menu_item_recipe_items;
CREATE TRIGGER v135_recipe_alert_trigger AFTER INSERT OR UPDATE OR DELETE ON public.menu_item_recipe_items
 FOR EACH ROW EXECUTE FUNCTION public.v135_recipe_notice();
CREATE OR REPLACE FUNCTION public.v135_material_price_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $notice$
DECLARE v_recipe record;
BEGIN
 IF (to_jsonb(NEW)->>'price_syp_v110') IS DISTINCT FROM (to_jsonb(OLD)->>'price_syp_v110')
 OR (to_jsonb(NEW)->>'price_usd_v110') IS DISTINCT FROM (to_jsonb(OLD)->>'price_usd_v110')

 OR (to_jsonb(NEW)->>'last_purchase_unit_cost_base') IS DISTINCT FROM (to_jsonb(OLD)->>'last_purchase_unit_cost_base') THEN
  FOR v_recipe IN SELECT DISTINCT menu_item_id FROM public.menu_item_recipe_items WHERE material_id=NEW.id LOOP
   PERFORM public.v135_warn_food_cost(v_recipe.menu_item_id,'تغير سعر المادة أو الدولار');
  END LOOP;
 END IF;
 RETURN NEW;
END;
$notice$;
DROP TRIGGER IF EXISTS v135_material_price_alert_trigger ON public.materials;
CREATE TRIGGER v135_material_price_alert_trigger AFTER UPDATE ON public.materials
 FOR EACH ROW EXECUTE FUNCTION public.v135_material_price_notice();

CREATE OR REPLACE FUNCTION public.v135_set_food_cost_limits(p_min numeric,p_max numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $set$
DECLARE v_menu record;v_alerts int:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 IF p_min IS NULL OR p_max IS NULL OR p_min<0 OR p_max>100 OR p_min>=p_max
 THEN RAISE EXCEPTION 'V135_INVALID_FOOD_COST_LIMITS';END IF;
 UPDATE public.v135_food_cost_settings SET min_percent=p_min,max_percent=p_max,updated_at=now() WHERE id=1;
 FOR v_menu IN SELECT id FROM public.menu_items WHERE NOT is_archived_v133 LOOP
  IF public.v135_warn_food_cost(v_menu.id,'تغيير حدود الكوست') THEN v_alerts:=v_alerts+1;END IF;
 END LOOP;
 RETURN jsonb_build_object('min',p_min,'max',p_max,'newAlerts',v_alerts);
END;
$set$;
REVOKE ALL ON FUNCTION public.v135_set_food_cost_limits(numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_set_food_cost_limits(numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.v135_food_cost_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $overview$
WITH settings AS (SELECT min_percent AS low,max_percent AS high FROM public.v135_food_cost_settings WHERE id=1),
menu_cost_rows AS (
 SELECT m.id,m.name,m.manual_price_original AS price,
  m.manual_price_original*(1-coalesce(m.default_discount_percent,0)/100) AS effective_price,
  CASE WHEN mc.recipe_cost_base IS NOT NULL AND coalesce(mc.has_missing_cost,false)=false
       AND EXISTS(SELECT 1 FROM public.menu_item_recipe_items r WHERE r.menu_item_id=m.id) THEN mc.recipe_cost_base
       ELSE e.estimated_unit_cost_base END AS cost,
  CASE WHEN mc.recipe_cost_base IS NOT NULL AND coalesce(mc.has_missing_cost,false)=false
       AND EXISTS(SELECT 1 FROM public.menu_item_recipe_items r WHERE r.menu_item_id=m.id) THEN 'recipe'
       WHEN e.estimated_unit_cost_base IS NOT NULL THEN 'estimate' ELSE 'unknown' END AS basis
 FROM public.menu_items m LEFT JOIN public.menu_item_costs mc ON mc.id=m.id
 LEFT JOIN public.event_menu_cost_estimates_v039 e ON e.menu_item_id=m.id
 WHERE public.is_app_owner() AND NOT m.is_archived_v133
),rated AS (
 SELECT r.*,CASE WHEN effective_price>0 AND cost IS NOT NULL
  THEN round(cost*100/effective_price,3) ELSE NULL END AS pct,s.low,s.high FROM menu_cost_rows r CROSS JOIN settings s
)
SELECT jsonb_build_object(
 'min',min(low),'max',max(high),'average',round(avg(pct),2),
 'total',count(*),'priced',count(pct),'unknown',count(*) FILTER(WHERE pct IS NULL),
 'outside',count(*) FILTER(WHERE pct<low OR pct>high),
 'unreadAlerts',(SELECT count(*) FROM public.v135_cost_alerts WHERE seen_at IS NULL AND public.is_app_owner()),
 'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'price',price,
   'effectivePrice',effective_price,'cost',cost,'percent',pct,'basis',basis,
   'outside',coalesce(pct<low OR pct>high,false)) ORDER BY pct DESC NULLS LAST,name),'[]'::jsonb))
FROM rated;
$overview$;
REVOKE ALL ON FUNCTION public.v135_food_cost_overview() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_food_cost_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.v135_food_cost_alerts(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $list$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'menuId',a.menu_item_id,
 'menuName',m.name,'percent',a.food_cost_percent,'reason',a.reason,
 'at',a.created_at,'seen',a.seen_at IS NOT NULL) ORDER BY a.created_at DESC),'[]'::jsonb)
 FROM (SELECT * FROM public.v135_cost_alerts WHERE public.is_app_owner()
  ORDER BY created_at DESC LIMIT least(greatest(p_limit,1),50)) a
 LEFT JOIN public.menu_items m ON m.id=a.menu_item_id;
$list$;
REVOKE ALL ON FUNCTION public.v135_food_cost_alerts(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_food_cost_alerts(integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.v135_mark_food_cost_alerts_read()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $mark$
DECLARE v_rows int;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
 UPDATE public.v135_cost_alerts SET seen_at=now() WHERE seen_at IS NULL;
 GET DIAGNOSTICS v_rows=ROW_COUNT;RETURN v_rows;
END;
$mark$;
REVOKE ALL ON FUNCTION public.v135_mark_food_cost_alerts_read() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_mark_food_cost_alerts_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.v135_archive_financial_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $summary$
SELECT jsonb_build_object(
 'purchaseInvoices',(SELECT count(*) FROM public.v126_historical_invoices WHERE public.is_app_owner()),
 'purchaseAmount',(SELECT coalesce(sum(original_total_syp),0) FROM public.v126_historical_invoices WHERE public.is_app_owner()),
 'salesInvoices',(SELECT count(*) FROM public.v134_sales_archive_documents WHERE public.is_app_owner()),
 'salesAmount',(SELECT coalesce(sum(total_sales_syp),0) FROM public.v134_sales_archive_documents WHERE public.is_app_owner()),
 'costPending',(SELECT count(*) FROM public.v135_archive_cost_queue WHERE state='pending' AND public.is_app_owner()),
 'costEstimated',(SELECT count(*) FROM public.v135_archive_cost_queue WHERE state='estimated' AND public.is_app_owner()),
 'costKnown',(SELECT coalesce(sum(cost_total_base),0) FROM public.v135_archive_cost_queue WHERE state='settled' AND public.is_app_owner()),
 'costEstimatedAmount',(SELECT coalesce(sum(cost_total_base),0) FROM public.v135_archive_cost_queue WHERE state='estimated' AND public.is_app_owner())
);
$summary$;
REVOKE ALL ON FUNCTION public.v135_archive_financial_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v135_archive_financial_summary() TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
