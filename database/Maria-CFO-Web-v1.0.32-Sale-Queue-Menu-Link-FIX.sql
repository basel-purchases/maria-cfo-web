-- Maria CFO Web v1.0.32: safe menu linking and name-first cost queue.
-- Execute only AFTER v1.0.31 on a test database first. No cash, stock or historical invoice writes.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '180s';

DO $guard$
BEGIN
 IF to_regclass('public.v131_sale_cost_queue') IS NULL
    OR to_regclass('public.menu_item_aliases_v104') IS NULL
    OR to_regprocedure('public.menu_save_v104(uuid,text,uuid,numeric,numeric,numeric,numeric,text[])') IS NULL
 THEN RAISE EXCEPTION 'V132_REQUIRES_V131_AND_MENU_ALIASES'; END IF;
END;
$guard$;

-- Exact unique primary/secondary-name match for historic pending cashier lines.
-- Ambiguous matches are intentionally left unlinked, for an accountant to decide.
CREATE OR REPLACE FUNCTION public.v132_auto_link_sale_queue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $link$
DECLARE v_changed integer := 0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 WITH candidates AS (
   SELECT q.id AS queue_id, m.id AS menu_id
   FROM public.v131_sale_cost_queue q
   JOIN public.menu_items m ON public.menu_alias_normalize_v104(m.name) = public.menu_alias_normalize_v104(q.source_name)
   WHERE q.state='pending' AND q.menu_item_id IS NULL
   UNION
   SELECT q.id, a.menu_item_id
   FROM public.v131_sale_cost_queue q
   JOIN public.menu_item_aliases_v104 a ON a.alias_key = public.menu_alias_normalize_v104(q.source_name)
   WHERE q.state='pending' AND q.menu_item_id IS NULL
 ), unique_match AS (
   SELECT queue_id, (array_agg(DISTINCT menu_id))[1] AS menu_id
   FROM candidates GROUP BY queue_id HAVING count(DISTINCT menu_id)=1
 )
 UPDATE public.v131_sale_cost_queue q
 SET menu_item_id=u.menu_id,
     error_note=CASE WHEN q.error_note='V131_SALE_MENU_NOT_ASSIGNED' THEN NULL ELSE q.error_note END,
     updated_at=now()
 FROM unique_match u WHERE q.id=u.queue_id AND q.state='pending' AND q.menu_item_id IS NULL;
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 RETURN v_changed;
END;
$link$;
REVOKE ALL ON FUNCTION public.v132_auto_link_sale_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v132_auto_link_sale_queue() TO authenticated;

-- Explicit accountant decision: links every unlinked pending line with the same
-- normalized cashier name to ONE known menu item. Does not edit original orders.
CREATE OR REPLACE FUNCTION public.v132_link_sale_queue_menu(p_cashier_name text,p_menu_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $link$
DECLARE v_count integer;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_menu_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_id)
    OR length(btrim(coalesce(p_cashier_name,''))) NOT BETWEEN 1 AND 250
 THEN RAISE EXCEPTION 'V132_MENU_MAPPING_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v132-sale-name:'||public.menu_alias_normalize_v104(p_cashier_name),0));
 UPDATE public.v131_sale_cost_queue q
 SET menu_item_id=p_menu_id,
     error_note=CASE WHEN q.error_note='V131_SALE_MENU_NOT_ASSIGNED' THEN NULL ELSE q.error_note END,
     updated_at=now()
 WHERE q.state='pending' AND q.menu_item_id IS NULL
   AND public.menu_alias_normalize_v104(q.source_name)=public.menu_alias_normalize_v104(p_cashier_name);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN jsonb_build_object('linked',v_count,'menuItemId',p_menu_id);
END;
$link$;
REVOKE ALL ON FUNCTION public.v132_link_sale_queue_menu(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.v132_link_sale_queue_menu(text,uuid) TO authenticated;

-- Keep the original RPC signature. Sort globally by the item name BEFORE pagination;
-- include menuItemId so the UI can distinguish truly unlinked sales from recipes.
CREATE OR REPLACE FUNCTION public.v131_sale_queue_list(
 p_limit int DEFAULT 200,p_offset int DEFAULT 0,p_only_pending boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $list$
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'source',q.source_kind,'menuItemId',q.menu_item_id,
 'orderNo',CASE WHEN q.source_kind='ameen' THEN ao.external_number ELSE o.external_order_number END,
 'saleDate',q.sale_date,'menuName',q.display_name,'sourceName',q.source_name,
 'quantity',q.sold_quantity,'state',q.state,'error',q.error_note,'cost',q.cost_total_base,
 'recipeCount',(SELECT count(*) FROM public.menu_item_recipe_items r WHERE r.menu_item_id=q.menu_item_id),
 'components',(SELECT count(*) FROM public.v131_sale_cost_components c WHERE c.queue_id=q.id),
 'doneAt',q.resolved_at)
 ORDER BY lower(q.display_name),q.sale_date DESC,q.id),'[]'::jsonb)
FROM (
 SELECT scq.*,coalesce(m.name,scq.source_name) AS display_name
 FROM public.v131_sale_cost_queue scq
 LEFT JOIN public.menu_items m ON m.id=scq.menu_item_id
 WHERE (NOT p_only_pending OR scq.state IN ('pending','review'))
   AND public.is_app_owner()
 ORDER BY lower(coalesce(m.name,scq.source_name)),scq.sale_date DESC,scq.id
 LIMIT least(greatest(p_limit,1),500) OFFSET greatest(p_offset,0)
) q
LEFT JOIN public.ameen_daily_lines_v041 al ON al.id=q.ameen_line_id
LEFT JOIN public.ameen_daily_orders_v041 ao ON ao.id=al.order_id
LEFT JOIN public.order_items oi ON oi.id=q.restaurant_line_id
LEFT JOIN public.orders o ON o.id=oi.order_id;
$list$;
REVOKE ALL ON FUNCTION public.v131_sale_queue_list(integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_sale_queue_list(integer,integer,boolean) TO authenticated;

COMMIT;
