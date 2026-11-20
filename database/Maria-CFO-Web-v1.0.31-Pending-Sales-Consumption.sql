-- Maria CFO Web v1.0.31 (B) | Sale-cost queue for Al-Ameen imports and posted local orders.
-- The sale/receipt is NOT reposted when costing or issuing inventory later.
-- Requires the FIXED v1.0.30 material group migration and v1.0.26 dated counts.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '180s';
DO $preflight$
BEGIN
 IF to_regclass('public.ameen_daily_lines_v041') IS NULL
  OR to_regclass('public.order_item_materials') IS NULL
  OR to_regprocedure('public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone)') IS NULL
  OR to_regprocedure('public.v126_import_physical_counts(text,jsonb,boolean)') IS NULL
 THEN RAISE EXCEPTION 'V131_SALES_MISSING_BASE_MIGRATIONS'; END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.v131_sale_cost_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_kind text NOT NULL CHECK(source_kind IN ('ameen','restaurant')),
 ameen_line_id bigint UNIQUE REFERENCES public.ameen_daily_lines_v041(id) ON DELETE RESTRICT,
 restaurant_line_id uuid UNIQUE REFERENCES public.order_items(id) ON DELETE RESTRICT,
 menu_item_id uuid REFERENCES public.menu_items(id),
 source_name text NOT NULL,
 sold_quantity numeric(20,6) NOT NULL CHECK(sold_quantity>0),
 sale_date date NOT NULL,
 occurred_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','issued','included_in_count','review')),
 cost_total_base numeric(20,4),
 is_cost_complete boolean NOT NULL DEFAULT false,
 error_note text,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT v131_one_sales_source CHECK(
  (source_kind='ameen' AND ameen_line_id IS NOT NULL AND restaurant_line_id IS NULL)
  OR (source_kind='restaurant' AND restaurant_line_id IS NOT NULL AND ameen_line_id IS NULL))
);
CREATE INDEX IF NOT EXISTS v131_cost_queue_state_idx ON public.v131_sale_cost_queue(state,sale_date,id);
CREATE INDEX IF NOT EXISTS v131_cost_queue_menu_idx ON public.v131_sale_cost_queue(menu_item_id,state);
CREATE TABLE IF NOT EXISTS public.v131_sale_cost_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 queue_id uuid NOT NULL REFERENCES public.v131_sale_cost_queue(id) ON DELETE RESTRICT,
 requested_material_id uuid NOT NULL REFERENCES public.materials(id),
 actual_material_id uuid NOT NULL REFERENCES public.materials(id),
 used_base numeric(20,6) NOT NULL CHECK(used_base>0),
 unit_cost_base numeric(20,6) NOT NULL CHECK(unit_cost_base>=0),
 line_cost_base numeric(20,4) NOT NULL CHECK(line_cost_base>=0),
 inventory_movement_id uuid UNIQUE REFERENCES public.inventory_movements(id),
 included_in_count boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v131_cost_components_queue ON public.v131_sale_cost_components(queue_id);
ALTER TABLE public.v131_sale_cost_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v131_sale_cost_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS v131_sale_queue_owner ON public.v131_sale_cost_queue;
CREATE POLICY v131_sale_queue_owner ON public.v131_sale_cost_queue FOR SELECT TO authenticated USING(public.is_app_owner());
DROP POLICY IF EXISTS v131_sale_components_owner ON public.v131_sale_cost_components;
CREATE POLICY v131_sale_components_owner ON public.v131_sale_cost_components FOR SELECT TO authenticated USING(public.is_app_owner());
REVOKE ALL ON public.v131_sale_cost_queue,public.v131_sale_cost_components FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v131_sale_cost_queue,public.v131_sale_cost_components TO authenticated;

-- Enqueue every imported cashier sale even if recipe/cost not yet known. Does not touch cashbox or stock.
CREATE OR REPLACE FUNCTION public.v131_enqueue_ameen_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $enqueue$
DECLARE v_order public.ameen_daily_orders_v041%ROWTYPE;v_tz text;v_at timestamptz;
BEGIN
 SELECT * INTO v_order FROM public.ameen_daily_orders_v041 WHERE id=NEW.order_id;
 SELECT coalesce(nullif(timezone,''),'Asia/Damascus') INTO v_tz FROM public.app_settings WHERE id=1;
 v_at:=CASE WHEN v_order.occurred_at IS NOT NULL AND
  (v_order.occurred_at AT TIME ZONE v_tz)::date=v_order.business_date
  THEN v_order.occurred_at
  ELSE (v_order.business_date::timestamp+interval '12 hours') AT TIME ZONE v_tz END;
 INSERT INTO public.v131_sale_cost_queue(source_kind,ameen_line_id,menu_item_id,source_name,sold_quantity,sale_date,occurred_at)
 VALUES('ameen',NEW.id,NEW.menu_item_id,NEW.item_name,NEW.quantity,v_order.business_date,v_at)
 ON CONFLICT(ameen_line_id) DO NOTHING;
 RETURN NEW;
END;
$enqueue$;
DROP TRIGGER IF EXISTS v131_ameen_cost_queue_trigger ON public.ameen_daily_lines_v041;
CREATE TRIGGER v131_ameen_cost_queue_trigger AFTER INSERT ON public.ameen_daily_lines_v041
 FOR EACH ROW EXECUTE FUNCTION public.v131_enqueue_ameen_line();

CREATE OR REPLACE FUNCTION public.v131_enqueue_restaurant_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $enqueue$
DECLARE v_tz text;
BEGIN
 IF NEW.status='posted' AND OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT coalesce(nullif(timezone,''),'Asia/Damascus') INTO v_tz FROM public.app_settings WHERE id=1;
  INSERT INTO public.v131_sale_cost_queue(source_kind,restaurant_line_id,menu_item_id,
    source_name,sold_quantity,sale_date,occurred_at,state)
  SELECT 'restaurant',li.id,li.menu_item_id,coalesce(mi.name,'وجبة بدون اسم'),li.quantity,
     (NEW.occurred_at AT TIME ZONE v_tz)::date,NEW.occurred_at,
     CASE WHEN EXISTS(SELECT 1 FROM public.order_item_materials s WHERE s.order_item_id=li.id)
       THEN 'review' ELSE 'pending' END
  FROM public.order_items li LEFT JOIN public.menu_items mi ON mi.id=li.menu_item_id
  WHERE li.order_id=NEW.id AND coalesce(li.has_incomplete_cost,false)=true
  ON CONFLICT(restaurant_line_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$enqueue$;
DROP TRIGGER IF EXISTS v131_restaurant_cost_queue_trigger ON public.orders;
CREATE TRIGGER v131_restaurant_cost_queue_trigger AFTER UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public.v131_enqueue_restaurant_order();

-- Seed older imports without changing orders, payments, costs or inventory.
CREATE OR REPLACE FUNCTION public.v131_seed_sales_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $seed$
DECLARE v_a int:=0;v_r int:=0;v_tz text;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 SELECT coalesce(nullif(timezone,''),'Asia/Damascus') INTO v_tz FROM public.app_settings WHERE id=1;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v131-seed-sale-queue',0));
 INSERT INTO public.v131_sale_cost_queue(source_kind,ameen_line_id,menu_item_id,source_name,
  sold_quantity,sale_date,occurred_at)
 SELECT 'ameen',li.id,li.menu_item_id,li.item_name,li.quantity,o.business_date,
  CASE WHEN o.occurred_at IS NOT NULL AND (o.occurred_at AT TIME ZONE v_tz)::date=o.business_date
   THEN o.occurred_at ELSE (o.business_date::timestamp+interval '12 hours') AT TIME ZONE v_tz END
 FROM public.ameen_daily_lines_v041 li JOIN public.ameen_daily_orders_v041 o ON o.id=li.order_id
 ON CONFLICT(ameen_line_id) DO NOTHING;
 GET DIAGNOSTICS v_a=ROW_COUNT;
 INSERT INTO public.v131_sale_cost_queue(source_kind,restaurant_line_id,menu_item_id,source_name,
   sold_quantity,sale_date,occurred_at,state)
 SELECT 'restaurant',li.id,li.menu_item_id,coalesce(mi.name,'وجبة بدون اسم'),li.quantity,
   (o.occurred_at AT TIME ZONE v_tz)::date,o.occurred_at,
   CASE WHEN EXISTS(SELECT 1 FROM public.order_item_materials s WHERE s.order_item_id=li.id) THEN 'review' ELSE 'pending' END
 FROM public.order_items li JOIN public.orders o ON o.id=li.order_id
 LEFT JOIN public.menu_items mi ON mi.id=li.menu_item_id
 WHERE o.status='posted' AND coalesce(li.has_incomplete_cost,false)=true
 ON CONFLICT(restaurant_line_id) DO NOTHING;
 GET DIAGNOSTICS v_r=ROW_COUNT;
 RETURN jsonb_build_object('importedLinesAdded',v_a,'manualLinesAdded',v_r);
END;
$seed$;
REVOKE ALL ON FUNCTION public.v131_seed_sales_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_seed_sales_queue() TO authenticated;

-- A queued line is posted AT MOST ONCE, with source material snapshots for refund/audit.
-- If sale is on/before the latest approved physical count, cost is recorded but stock is NOT debited.
CREATE OR REPLACE FUNCTION public.v131_complete_sale_cost(p_queue_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $complete$
DECLARE v_sale public.v131_sale_cost_queue%ROWTYPE;v_last_count date;v_recipe record;v_alloc record;
 v_cost numeric;v_qty numeric;v_total numeric:=0;v_recipe_count int:=0;v_component uuid;
 v_movement uuid;v_covered boolean;v_available numeric;v_order uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 SELECT * INTO v_sale FROM public.v131_sale_cost_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'V131_SALE_NOT_FOUND';END IF;
 IF v_sale.state IN ('issued','included_in_count') THEN
  RETURN jsonb_build_object('state',v_sale.state,'alreadyCompleted',true);
 END IF;
 IF v_sale.state='review' THEN RAISE EXCEPTION 'V131_MANUAL_ORDER_PARTIALLY_ISSUED_REVIEW_REQUIRED'; END IF;
 IF v_sale.menu_item_id IS NULL THEN RAISE EXCEPTION 'V131_SALE_MENU_NOT_ASSIGNED'; END IF;
 IF v_sale.source_kind='restaurant' AND NOT EXISTS(
   SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
   WHERE oi.id=v_sale.restaurant_line_id AND o.status='posted'
 ) THEN RAISE EXCEPTION 'V131_SALE_ORDER_NO_LONGER_POSTED';END IF;
 IF v_sale.source_kind='restaurant' AND EXISTS(
  SELECT 1 FROM public.order_item_materials WHERE order_item_id=v_sale.restaurant_line_id)
 THEN RAISE EXCEPTION 'V131_SALE_HAS_EARLIER_STOCK_SNAPSHOTS'; END IF;
 SELECT count(*) INTO v_recipe_count FROM public.menu_item_recipe_items WHERE menu_item_id=v_sale.menu_item_id;
 IF v_recipe_count=0 THEN RAISE EXCEPTION 'V131_SALE_RECIPE_NOT_DEFINED';END IF;
 SELECT max(count_date) INTO v_last_count FROM public.v126_physical_counts;
 v_covered:=(v_last_count IS NOT NULL AND v_sale.sale_date<=v_last_count);
 -- No movements may be saved if ANY ingredient is missing a valuation.
 FOR v_recipe IN SELECT material_id,quantity_base FROM public.menu_item_recipe_items
   WHERE menu_item_id=v_sale.menu_item_id ORDER BY material_id LOOP
  v_qty:=round(v_recipe.quantity_base*v_sale.sold_quantity,6);
  IF v_qty<=0 THEN RAISE EXCEPTION 'V131_RECIPE_QUANTITY_NOT_POSITIVE'; END IF;
  IF v_covered THEN
   v_cost:=public.get_material_cost_at(v_recipe.material_id,v_sale.occurred_at);
   IF v_cost IS NULL OR v_cost<=0 THEN RAISE EXCEPTION 'V131_COST_MISSING_AT_SALE_DATE';END IF;
   INSERT INTO public.v131_sale_cost_components(queue_id,requested_material_id,actual_material_id,
      used_base,unit_cost_base,line_cost_base,included_in_count)
   VALUES(v_sale.id,v_recipe.material_id,v_recipe.material_id,v_qty,v_cost,
      round(v_qty*v_cost,4),true);
   v_total:=v_total+round(v_qty*v_cost,4);
  ELSE
   FOR v_alloc IN SELECT * FROM public.material_consumption_plan_v130(
     v_recipe.material_id,v_qty,v_sale.occurred_at) LOOP
    v_cost:=v_alloc.unit_cost_base;
    IF v_cost IS NULL OR v_cost<=0 THEN RAISE EXCEPTION 'V131_COST_MISSING_AT_SALE_DATE';END IF;
    SELECT current_stock_base INTO v_available FROM public.materials
     WHERE id=v_alloc.actual_material_id FOR UPDATE;
    IF v_available<v_alloc.issued_base THEN RAISE EXCEPTION 'V131_SALE_STOCK_INSUFFICIENT';END IF;
    v_component:=gen_random_uuid();
    INSERT INTO public.v131_sale_cost_components(id,queue_id,requested_material_id,
      actual_material_id,used_base,unit_cost_base,line_cost_base)
    VALUES(v_component,v_sale.id,v_recipe.material_id,v_alloc.actual_material_id,
       v_alloc.issued_base,v_cost,round(v_alloc.issued_base*v_cost,4));
    v_order:=CASE WHEN v_sale.source_kind='ameen' THEN
      (SELECT order_id FROM public.ameen_daily_lines_v041 WHERE id=v_sale.ameen_line_id)
      ELSE (SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id) END;
    v_movement:=public.record_inventory_movement(v_alloc.actual_material_id,'sale',
     -v_alloc.issued_base,v_cost,v_sale.occurred_at,'v131_sale_cost',v_order,v_component,
     'تسوية صرف مواد مبيعات سابقة، دون قبض جديد');
    UPDATE public.v131_sale_cost_components SET inventory_movement_id=v_movement WHERE id=v_component;
    IF v_sale.source_kind='restaurant' THEN
     INSERT INTO public.order_item_materials(order_item_id,material_id,quantity_per_item_base,
       total_quantity_base,unit_cost_base_snapshot,requested_material_id_v130,inventory_movement_id)
     VALUES(v_sale.restaurant_line_id,v_alloc.actual_material_id,
       round(v_alloc.issued_base/v_sale.sold_quantity,8),v_alloc.issued_base,v_cost,
       v_recipe.material_id,v_movement);
    END IF;
    v_total:=v_total+round(v_alloc.issued_base*v_cost,4);
   END LOOP;
  END IF;
 END LOOP;
 UPDATE public.v131_sale_cost_queue SET state=CASE WHEN v_covered THEN 'included_in_count' ELSE 'issued' END,
   cost_total_base=round(v_total,4),is_cost_complete=true,error_note=NULL,
   resolved_at=now(),updated_at=now() WHERE id=v_sale.id;
 IF v_sale.source_kind='restaurant' THEN
   UPDATE public.order_items SET known_cost_total_base=round(v_total,4),has_incomplete_cost=false
     WHERE id=v_sale.restaurant_line_id;
   UPDATE public.orders SET known_cost_total_base=(SELECT coalesce(sum(known_cost_total_base),0)
       FROM public.order_items WHERE order_id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id)),
     has_incomplete_cost=(SELECT coalesce(bool_or(has_incomplete_cost),false)
       FROM public.order_items WHERE order_id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id))
   WHERE id=(SELECT order_id FROM public.order_items WHERE id=v_sale.restaurant_line_id);
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN v_covered THEN 'included_in_count' ELSE 'issued' END,
  'cost',round(v_total,4),'materialCount',v_recipe_count,'inventoryDeducted',NOT v_covered);
END;
$complete$;
REVOKE ALL ON FUNCTION public.v131_complete_sale_cost(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_complete_sale_cost(uuid) TO authenticated;

-- Per-line exception blocks guarantee no partial ingredient deduction on a failed recipe or stock shortage.
CREATE OR REPLACE FUNCTION public.v131_complete_ready_sales(p_limit integer DEFAULT 50,p_queue_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $batch$
DECLARE v_row record;v_ok int:=0;v_covered int:=0;v_failed int:=0;v_result jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 IF p_limit NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'V131_BATCH_LIMIT_1_TO_150';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-v131-cost-completion',0));
 FOR v_row IN SELECT id FROM public.v131_sale_cost_queue
  WHERE state='pending' AND (p_queue_id IS NULL OR id=p_queue_id)
    AND EXISTS (SELECT 1 FROM public.menu_item_recipe_items r WHERE r.menu_item_id=public.v131_sale_cost_queue.menu_item_id)
  ORDER BY sale_date,id LIMIT p_limit LOOP
  BEGIN
   SELECT public.v131_complete_sale_cost(v_row.id) INTO v_result;
   IF v_result->>'state'='included_in_count' THEN v_covered:=v_covered+1;
   ELSE v_ok:=v_ok+1;END IF;
  EXCEPTION WHEN OTHERS THEN
   v_failed:=v_failed+1;
   UPDATE public.v131_sale_cost_queue SET error_note=left(SQLERRM,260),updated_at=now()
     WHERE id=v_row.id;
  END;
 END LOOP;
 RETURN jsonb_build_object('issued',v_ok,'countCovered',v_covered,'stillWaiting',v_failed);
END;
$batch$;
REVOKE ALL ON FUNCTION public.v131_complete_ready_sales(integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_complete_ready_sales(integer,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.v131_sale_queue_list(
 p_limit int DEFAULT 200,p_offset int DEFAULT 0,p_only_pending boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $list$
SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'source',q.source_kind,
 'orderNo',CASE WHEN q.source_kind='ameen' THEN ao.external_number ELSE o.external_order_number END,
 'saleDate',q.sale_date,'menuName',coalesce(m.name,q.source_name),'sourceName',q.source_name,
 'quantity',q.sold_quantity,'state',q.state,'error',q.error_note,'cost',q.cost_total_base,
 'recipeCount',(SELECT count(*) FROM public.menu_item_recipe_items r WHERE r.menu_item_id=q.menu_item_id),
 'components',(SELECT count(*) FROM public.v131_sale_cost_components c WHERE c.queue_id=q.id),
 'doneAt',q.resolved_at)
 ORDER BY CASE WHEN q.state='pending' THEN 0 WHEN q.state='review' THEN 1 ELSE 2 END,
  q.sale_date DESC,q.created_at DESC),'[]'::jsonb)
FROM (SELECT * FROM public.v131_sale_cost_queue
 WHERE NOT p_only_pending OR state IN ('pending','review')
 ORDER BY CASE WHEN state='pending' THEN 0 WHEN state='review' THEN 1 ELSE 2 END,
          sale_date DESC,created_at DESC
 LIMIT least(greatest(p_limit,1),500) OFFSET greatest(p_offset,0)) q
LEFT JOIN public.ameen_daily_lines_v041 al ON al.id=q.ameen_line_id
LEFT JOIN public.ameen_daily_orders_v041 ao ON ao.id=al.order_id
LEFT JOIN public.order_items oi ON oi.id=q.restaurant_line_id
LEFT JOIN public.orders o ON o.id=oi.order_id
LEFT JOIN public.menu_items m ON m.id=q.menu_item_id
WHERE public.is_app_owner();
$list$;
REVOKE ALL ON FUNCTION public.v131_sale_queue_list(int,int,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_sale_queue_list(int,int,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.v131_sale_queue_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $summary$
 SELECT jsonb_build_object(
  'total',count(*),
  'pending',count(*) FILTER(WHERE state='pending'),
  'review',count(*) FILTER(WHERE state='review'),
  'completed',count(*) FILTER(WHERE state IN ('issued','included_in_count')),
  'ready',count(*) FILTER(WHERE state='pending' AND menu_item_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.menu_item_recipe_items r WHERE r.menu_item_id=v131_sale_cost_queue.menu_item_id)))
 FROM public.v131_sale_cost_queue WHERE public.is_app_owner();
$summary$;
REVOKE ALL ON FUNCTION public.v131_sale_queue_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_sale_queue_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.v131_sale_queue_ready_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $count$
SELECT count(*)::integer FROM public.v131_sale_cost_queue q
 WHERE public.is_app_owner() AND q.state='pending' AND q.menu_item_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.menu_item_recipe_items r WHERE r.menu_item_id=q.menu_item_id);
$count$;
REVOKE ALL ON FUNCTION public.v131_sale_queue_ready_count() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.v131_sale_queue_ready_count() TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
