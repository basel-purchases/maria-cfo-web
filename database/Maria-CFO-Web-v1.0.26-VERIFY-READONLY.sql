-- Maria CFO v1.0.26: run in Supabase SQL Editor, READ-ONLY.
-- This does not modify, reset or approve inventory or invoices.
SELECT 'invoices_historical' AS section,
       count(*)::numeric AS item_count,
       coalesce(sum(original_total_syp),0) AS amount_syp
FROM public.v126_historical_invoices
UNION ALL
SELECT 'counts_approved',count(*)::numeric,coalesce(sum(adjustment_delta_base),0)
FROM public.v126_physical_counts
UNION ALL
SELECT 'menu_only_import_runs',count(*)::numeric,0
FROM public.v126_menu_only_imports;

-- Historical invoices should be posted and tagged legacy, not treated as supplier debt.
SELECT hi.source_supplier, count(*) AS invoice_count,
       round(sum(hi.original_total_syp),4) AS historical_purchases_syp,
       count(*) FILTER (WHERE pi.status<>'posted' OR NOT coalesce(pi.is_ameen_legacy_v029,false)) AS wrongly_tagged
FROM public.v126_historical_invoices hi
JOIN public.purchase_invoices pi ON pi.id=hi.invoice_id
GROUP BY hi.source_supplier ORDER BY invoice_count DESC;

-- Current stock must agree with sum of movements (on a freshly rebuilt database).
SELECT m.name,m.current_stock_base,
       coalesce(sum(im.quantity_delta_base),0) AS ledger_base,
       round(m.current_stock_base-coalesce(sum(im.quantity_delta_base),0),6) AS difference_base
FROM public.materials m LEFT JOIN public.inventory_movements im ON im.material_id=m.id
GROUP BY m.id,m.name,m.current_stock_base
HAVING abs(m.current_stock_base-coalesce(sum(im.quantity_delta_base),0))>0.00001
ORDER BY abs(m.current_stock_base-coalesce(sum(im.quantity_delta_base),0)) DESC
LIMIT 50;

-- The latest physical count per material should still reconcile against all later movements.
WITH latest_count AS (
 SELECT DISTINCT ON(material_id) pc.* FROM public.v126_physical_counts pc
 ORDER BY material_id,count_date DESC,created_at DESC
)
SELECT m.name,c.count_date,c.counted_quantity,c.counted_base,
       c.expected_before_base,c.adjustment_delta_base,m.current_stock_base AS current_now,
       c.counted_base+coalesce((SELECT sum(im.quantity_delta_base)
          FROM public.inventory_movements im
          WHERE im.material_id=c.material_id
           AND im.occurred_at>=((c.count_date::timestamp+interval '1 day') AT TIME ZONE c.count_timezone)),0) AS predicted_current
FROM latest_count c JOIN public.materials m ON m.id=c.material_id
ORDER BY c.count_date DESC,m.name;

-- Trigger must be enabled to reject late backdated stock postings after approval.
SELECT tgname,tgenabled FROM pg_trigger
WHERE tgrelid='public.inventory_movements'::regclass AND tgname='v126_guard_backdated_stock_trigger';
