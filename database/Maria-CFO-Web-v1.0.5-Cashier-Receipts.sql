-- Maria CFO Web v1.0.5: cashier order receipts -> selected cashbox.
-- REQUIRES: all migrations up to v1.0.4, including menu aliases.
-- Apply BEFORE uploading web v1.0.5. Back up the database first.
-- Does NOT rewrite previously imported orders, or auto-post their cash:
-- manual/reconciled historical receipts could already exist.
-- Every NEW imported order gets exactly one atomic and traceable cash receipt.
BEGIN;

DO $preflight$
BEGIN
 IF to_regprocedure('public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid)') IS NULL
   OR to_regprocedure('public.record_cashbox_transaction(uuid,text,text,numeric,text,timestamp with time zone,text,text,uuid)') IS NULL
   OR to_regprocedure('public.menu_match_v104(text)') IS NULL
 THEN RAISE EXCEPTION 'MARIA_V105_REQUIRES_V104_AND_CASHBOX_MIGRATIONS'; END IF;
END;$preflight$;

CREATE TABLE IF NOT EXISTS public.ameen_daily_cash_postings_v105 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 daily_order_id uuid NOT NULL UNIQUE REFERENCES public.ameen_daily_orders_v041(id) ON DELETE RESTRICT,
 cashbox_id uuid NOT NULL REFERENCES public.cashboxes(id) ON DELETE RESTRICT,
 cashbox_transaction_id uuid NOT NULL UNIQUE REFERENCES public.cashbox_transactions(id) ON DELETE RESTRICT,
 amount_syp numeric(20,4) NOT NULL CHECK (amount_syp > 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ameen_daily_cash_postings_box_v105
 ON public.ameen_daily_cash_postings_v105(cashbox_id,created_at DESC);
-- A cashier order must never get a second active or voided transaction with this reference.
CREATE UNIQUE INDEX IF NOT EXISTS ameen_daily_cashbox_source_unique_v105
 ON public.cashbox_transactions(reference_id)
 WHERE reference_type='ameen_daily_order_v041' AND reference_id IS NOT NULL;
ALTER TABLE public.ameen_daily_cash_postings_v105 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maria_owner_read_v105 ON public.ameen_daily_cash_postings_v105;
CREATE POLICY maria_owner_read_v105 ON public.ameen_daily_cash_postings_v105
 FOR SELECT TO authenticated USING (public.is_app_owner());
REVOKE ALL ON public.ameen_daily_cash_postings_v105 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ameen_daily_cash_postings_v105 TO authenticated;

-- Wrapper invokes the v1.0.4 importer in ONE PostgreSQL transaction, then posts
-- the net amount for every newly created order. Any posting failure rolls back
-- ALL imported orders, aliases, menu items, and cashbox transactions together.
CREATE OR REPLACE FUNCTION public.ameen_import_daily_v105(
 p_filename text,p_sha256 text,p_records jsonb,p_actions jsonb DEFAULT '[]'::jsonb,
 p_cashbox_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $v105$
DECLARE
 v_result jsonb; v_import_id uuid; v_timezone text;
 v_order record; v_at timestamptz; v_tx uuid;
 v_posted integer:=0; v_posted_sum numeric(20,4):=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_cashbox_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cashboxes WHERE id=p_cashbox_id AND is_active)
 THEN RAISE EXCEPTION 'DAILY_V105_CASHIER_CASHBOX_REQUIRED'; END IF;
 -- Price mismatch is ONLY informative. The cashier line price and net are
 -- preserved. No import action may change an existing menu selling price.
 IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'DAILY_V105_ACTIONS_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_actions) a(value)
   WHERE coalesce(a.value->>'mode','')='update'
     OR coalesce(a.value->>'priceMode','')='update')
 THEN RAISE EXCEPTION 'DAILY_V105_MENU_PRICE_UPDATE_DISALLOWED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('maria-daily-v041',0));
 v_result:=public.ameen_import_daily_v041(
    p_filename,p_sha256,p_records,p_actions,p_cashbox_id);
 IF coalesce((v_result->>'duplicateFile')::boolean,false) THEN
  RETURN v_result || jsonb_build_object('cashPostedOrders',0,'cashPostedSyp',0,
    'cashStatus','duplicate_no_new_postings');
 END IF;
 v_import_id:=(v_result->>'runId')::uuid;
 IF v_import_id IS NULL THEN RAISE EXCEPTION 'DAILY_V105_MISSING_RUN_ID'; END IF;
 SELECT coalesce(nullif(timezone,''),'UTC') INTO v_timezone
 FROM public.app_settings WHERE id=1;
 IF v_timezone IS NULL THEN RAISE EXCEPTION 'DAILY_V105_MISSING_APP_TIMEZONE'; END IF;

 FOR v_order IN
   SELECT id,business_date,external_number,occurred_at,source_net
   FROM public.ameen_daily_orders_v041
   WHERE import_id=v_import_id ORDER BY business_date,external_number
 LOOP
   IF v_order.source_net=0 THEN CONTINUE; END IF;
   -- Reference collision or a previously posted receipt means STOP, not a second deposit.
   IF EXISTS (SELECT 1 FROM public.cashbox_transactions t
     WHERE t.reference_type='ameen_daily_order_v041' AND t.reference_id=v_order.id)
      OR EXISTS (SELECT 1 FROM public.ameen_daily_cash_postings_v105 p
     WHERE p.daily_order_id=v_order.id)
   THEN RAISE EXCEPTION 'DAILY_V105_RECEIPT_ALREADY_EXISTS: %',v_order.external_number; END IF;
   -- Preserve the original timestamp if it agrees with the chosen business day.
   -- Otherwise place the transaction at noon in the configured business timezone;
   -- the original source timestamp remains unchanged in the imported order.
   IF v_order.occurred_at IS NOT NULL
      AND (v_order.occurred_at AT TIME ZONE v_timezone)::date=v_order.business_date
   THEN v_at:=v_order.occurred_at;
   ELSE v_at:=(v_order.business_date::timestamp + interval '12 hours') AT TIME ZONE v_timezone;
   END IF;
   v_tx:=public.record_cashbox_transaction(
     p_cashbox_id,'in','sale',v_order.source_net,'SYP',v_at,
     format('قبض تقرير الكاشير: أوردر %s (%s)',v_order.external_number,v_order.business_date),
     'ameen_daily_order_v041',v_order.id);
   INSERT INTO public.ameen_daily_cash_postings_v105
       (daily_order_id,cashbox_id,cashbox_transaction_id,amount_syp)
   VALUES(v_order.id,p_cashbox_id,v_tx,v_order.source_net);
   v_posted:=v_posted+1;
   v_posted_sum:=v_posted_sum+v_order.source_net;
 END LOOP;
 v_result:=v_result||jsonb_build_object(
     'cashPostedOrders',v_posted,'cashPostedSyp',v_posted_sum,
     'cashboxId',p_cashbox_id,'cashStatus','posted_new_orders_only');
 UPDATE public.ameen_daily_imports_v041 SET summary=v_result WHERE id=v_import_id;
 RETURN v_result;
END;$v105$;

-- Reconciliation reports precisely which old/new orders have a receipt in the cashbox.
CREATE OR REPLACE FUNCTION public.ameen_cashbox_reconciliation_v105(p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $rpt$
 SELECT jsonb_build_object(
   'postedOrders',count(*) FILTER (WHERE p.id IS NOT NULL AND t.is_void IS NOT TRUE),
   'postedSyp',coalesce(sum(o.source_net) FILTER (WHERE p.id IS NOT NULL AND t.is_void IS NOT TRUE),0),
   'unpostedOrders',count(*) FILTER (WHERE (p.id IS NULL OR t.is_void IS TRUE) AND o.source_net>0),
   'unpostedSyp',coalesce(sum(o.source_net) FILTER (WHERE (p.id IS NULL OR t.is_void IS TRUE) AND o.source_net>0),0),
   'details',coalesce(jsonb_agg(jsonb_build_object(
     'orderId',o.id,'externalNumber',o.external_number,'net',o.source_net,
     'posted',p.id IS NOT NULL AND t.is_void IS NOT TRUE,
     'cashboxId',p.cashbox_id,'cashboxName',b.name,
     'cashboxTransactionId',p.cashbox_transaction_id,
     'voided',coalesce(t.is_void,false)
   ) ORDER BY o.external_number),'[]'::jsonb)
 )
 FROM public.ameen_daily_orders_v041 o
 LEFT JOIN public.ameen_daily_cash_postings_v105 p ON p.daily_order_id=o.id
 LEFT JOIN public.cashbox_transactions t ON t.id=p.cashbox_transaction_id
 LEFT JOIN public.cashboxes b ON b.id=p.cashbox_id
 WHERE public.is_app_owner() AND o.business_date=p_day;
$rpt$;


-- Adds a READ-ONLY price to the existing searchable menu view so an alias
-- dropdown can mark exact price matches without choosing an item automatically.
CREATE OR REPLACE VIEW public.menu_item_search_v104 WITH (security_invoker=true) AS
 SELECT mi.id,mi.name,mi.category_id,coalesce(s.cost_is_missing,false) AS cost_is_missing,
   concat_ws(' ',mi.name,coalesce(string_agg(a.alias_name,' ' ORDER BY a.alias_name),'')) AS search_text,
   coalesce(string_agg(a.alias_name,' · ' ORDER BY a.alias_name),'') AS aliases_text,
   mi.manual_price_original AS menu_price
 FROM public.menu_items mi
 LEFT JOIN public.menu_item_aliases_v104 a ON a.menu_item_id=mi.id
 LEFT JOIN public.menu_cost_status_v041 s ON s.id=mi.id
 WHERE public.is_app_owner()
 GROUP BY mi.id,mi.name,mi.category_id,s.cost_is_missing;
REVOKE ALL ON public.menu_item_search_v104 FROM PUBLIC,anon;
GRANT SELECT ON public.menu_item_search_v104 TO authenticated;

-- Cashier imports are now only allowed via v1.0.5 wrapper. Legacy SQL stays
-- in the database for internal reuse, but cannot be invoked by a browser role.
REVOKE ALL ON FUNCTION public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ameen_import_daily_v105(text,text,jsonb,jsonb,uuid),
 public.ameen_cashbox_reconciliation_v105(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ameen_import_daily_v105(text,text,jsonb,jsonb,uuid),
 public.ameen_cashbox_reconciliation_v105(date) TO authenticated;
COMMIT;
