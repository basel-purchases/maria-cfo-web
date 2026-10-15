-- Maria CFO Web v0.41: independent, auditable daily Al-Ameen cashier imports.
-- Requires v0.30, v0.39, and v0.40 migrations. Back up before executing.
-- NEVER posts historical cashier payments to cashboxes or inventory automatically.
-- This prevents cash movement duplication when a cashier report is imported again.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ameen_daily_imports_v041 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 250),
 sha256 text NOT NULL UNIQUE CHECK(sha256 ~ '^[a-z0-9:]{32,80}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 origin text NOT NULL DEFAULT 'daily_v041',
 summary jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.ameen_daily_orders_v041 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_id uuid NOT NULL REFERENCES public.ameen_daily_imports_v041(id) ON DELETE RESTRICT,
 business_date date NOT NULL,
 external_number text NOT NULL CHECK(length(external_number) BETWEEN 1 AND 100),
 occurred_at timestamptz,
 source_net numeric(20,4) NOT NULL CHECK(source_net>=0),
 source_gross numeric(20,4) NOT NULL CHECK(source_gross>=0),
 source_fingerprint text NOT NULL,
 source_cashbox text,
 reported_cashbox_id uuid REFERENCES public.cashboxes(id),
 source_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_date,external_number)
);
CREATE INDEX IF NOT EXISTS ameen_daily_orders_day_v041 ON public.ameen_daily_orders_v041(business_date DESC,external_number);
CREATE TABLE IF NOT EXISTS public.ameen_daily_lines_v041 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.ameen_daily_orders_v041(id) ON DELETE RESTRICT,
 source_row integer,
 menu_item_id uuid REFERENCES public.menu_items(id),
 item_name text NOT NULL,
 unit_name text,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 unit_price numeric(20,4) NOT NULL CHECK(unit_price>=0),
 line_net numeric(20,4) NOT NULL CHECK(line_net>=0),
 reference_price numeric(20,4),
 note text
);
CREATE INDEX IF NOT EXISTS ameen_daily_lines_order_v041 ON public.ameen_daily_lines_v041(order_id);
CREATE INDEX IF NOT EXISTS ameen_daily_lines_menu_v041 ON public.ameen_daily_lines_v041(menu_item_id);

CREATE TABLE IF NOT EXISTS public.menu_price_audit_v041 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
 old_price numeric(20,4), new_price numeric(20,4),
 origin text NOT NULL DEFAULT 'manual',
 import_id uuid REFERENCES public.ameen_daily_imports_v041(id),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 undone_at timestamptz,
 note text
);
CREATE INDEX IF NOT EXISTS menu_price_audit_item_v041 ON public.menu_price_audit_v041(menu_item_id,id DESC);

DO $$ DECLARE v_tbl text; BEGIN
 FOREACH v_tbl IN ARRAY ARRAY['ameen_daily_imports_v041','ameen_daily_orders_v041','ameen_daily_lines_v041','menu_price_audit_v041'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_tbl);
  EXECUTE format('DROP POLICY IF EXISTS maria_owner_read_v041 ON public.%I',v_tbl);
  EXECUTE format('CREATE POLICY maria_owner_read_v041 ON public.%I FOR SELECT TO authenticated USING (public.is_app_owner())',v_tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_tbl);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_tbl);
 END LOOP;
END $$;

-- Captures EVERY real price modification, including edits from the existing menu form.
CREATE OR REPLACE FUNCTION public.menu_price_audit_trigger_v041()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_origin text;v_import uuid;v_raw text;
BEGIN
 IF OLD.manual_price_original IS DISTINCT FROM NEW.manual_price_original THEN
  v_origin:=nullif(current_setting('maria.price_origin_v041',true),'');
  v_raw:=nullif(current_setting('maria.price_import_v041',true),'');
  IF v_raw IS NOT NULL THEN v_import:=v_raw::uuid; END IF;
  INSERT INTO public.menu_price_audit_v041(menu_item_id,old_price,new_price,origin,import_id)
  VALUES(NEW.id,OLD.manual_price_original,NEW.manual_price_original,coalesce(v_origin,'manual'),v_import);
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS menu_price_audit_v041_trg ON public.menu_items;
CREATE TRIGGER menu_price_audit_v041_trg AFTER UPDATE OF manual_price_original ON public.menu_items
 FOR EACH ROW EXECUTE FUNCTION public.menu_price_audit_trigger_v041();

-- Preview current vs Al-Ameen price, WITHOUT changing the menu.
CREATE OR REPLACE FUNCTION public.ameen_price_preview_v041(p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records)>5000 THEN RAISE EXCEPTION 'INVALID_ORDERS_PREVIEW'; END IF;
 WITH source_lines AS (
  SELECT li.value->>'name' AS item_name,(li.value->>'unitPrice')::numeric AS proposed_price,
    coalesce(o.value->>'occurredAt',o.value->>'date','') AS stamp,
    o.ordinality AS order_pos,li.ordinality AS line_pos
  FROM jsonb_array_elements(p_records) WITH ORDINALITY o(value,ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(o.value->'items') WITH ORDINALITY li(value,ordinality)
 ), grouped AS (
  SELECT public.recipe_key_normalize_v027(item_name) AS item_key,
     (array_agg(item_name ORDER BY stamp DESC,order_pos DESC,line_pos DESC))[1] AS name,
     (array_agg(proposed_price ORDER BY stamp DESC,order_pos DESC,line_pos DESC))[1] AS file_price,
     min(proposed_price) AS min_file_price,max(proposed_price) AS max_file_price,count(*) AS occurrences
  FROM source_lines GROUP BY public.recipe_key_normalize_v027(item_name)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object(
   'name',g.name,'filePrice',g.file_price,'minFilePrice',g.min_file_price,
   'maxFilePrice',g.max_file_price,'occurrences',g.occurrences,
   'menuId',m.id,'menuPrice',m.manual_price_original,
   'different',m.id IS NULL OR m.manual_price_original IS DISTINCT FROM g.file_price
 ) ORDER BY g.name),'[]'::jsonb) INTO v_result FROM grouped g
 LEFT JOIN LATERAL (SELECT id,manual_price_original FROM public.menu_items
  WHERE public.recipe_key_normalize_v027(name)=g.item_key ORDER BY id LIMIT 1) m ON true;
 RETURN v_result;
END;$$;

-- One transaction per file: records trusted cashier numbers, never assumes recipe costs or cash receipts.
CREATE OR REPLACE FUNCTION public.ameen_import_daily_v041(
 p_filename text,p_sha256 text,p_records jsonb,p_actions jsonb DEFAULT '[]'::jsonb,
 p_reported_cashbox_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_run uuid;v_old record;v_rec jsonb;v_line jsonb;v_item record;
 v_day date;v_number text;v_ts timestamptz;v_order uuid;v_menu uuid;
 v_name text;v_action text;v_menu_price numeric;v_file_price numeric;
 v_gross numeric;v_net numeric;v_qty numeric;v_unit_price numeric;v_line_net numeric;
 v_new integer:=0;v_existing integer:=0;v_conflicts integer:=0;v_lines integer:=0;
 v_price_updates integer:=0;v_new_items integer:=0;v_notes jsonb:='[]'::jsonb;v_effective jsonb;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_sha256 !~ '^[0-9a-f]{64}$' OR length(coalesce(p_filename,'')) NOT BETWEEN 1 AND 250
    OR jsonb_typeof(p_records)<>'array' OR jsonb_array_length(p_records) NOT BETWEEN 1 AND 5000
    OR pg_column_size(p_records)>12000000 OR jsonb_typeof(p_actions)<>'array'
 THEN RAISE EXCEPTION 'DAILY_IMPORT_INVALID_PAYLOAD'; END IF;
 IF p_reported_cashbox_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cashboxes WHERE id=p_reported_cashbox_id AND is_active)
 THEN RAISE EXCEPTION 'DAILY_CASHBOX_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-daily-v041',0));
 SELECT id,summary INTO v_old FROM public.ameen_daily_imports_v041 WHERE sha256=p_sha256 LIMIT 1;
 IF FOUND THEN RETURN v_old.summary||jsonb_build_object('duplicateFile',true,'runId',v_old.id); END IF;
 INSERT INTO public.ameen_daily_imports_v041(filename,sha256) VALUES(p_filename,p_sha256) RETURNING id INTO v_run;
 SELECT coalesce(jsonb_agg(r.value ORDER BY r.ordinality),'[]'::jsonb) INTO v_effective
 FROM jsonb_array_elements(p_records) WITH ORDINALITY r(value,ordinality) WHERE NOT EXISTS (
  SELECT 1 FROM public.ameen_daily_orders_v041 o
   WHERE o.business_date=(r.value->>'date')::date AND o.external_number=r.value->>'number');
 PERFORM set_config('maria.price_origin_v041','ameen_import',true);
 PERFORM set_config('maria.price_import_v041',v_run::text,true);

 -- Determine the menu price PER DISTINCT ITEM once per file, using the latest file row.
 FOR v_item IN
  WITH ls AS (
   SELECT li.value->>'name' AS name,(li.value->>'unitPrice')::numeric AS unit_price,
    coalesce(o.value->>'occurredAt',o.value->>'date','') AS stamp,
    o.ordinality AS op,li.ordinality AS lp
   FROM jsonb_array_elements(v_effective) WITH ORDINALITY o(value,ordinality)
   CROSS JOIN LATERAL jsonb_array_elements(o.value->'items') WITH ORDINALITY li(value,ordinality)
  ) SELECT public.recipe_key_normalize_v027(name) AS item_key,
   (array_agg(name ORDER BY stamp DESC,op DESC,lp DESC))[1] AS item_name,
   (array_agg(unit_price ORDER BY stamp DESC,op DESC,lp DESC))[1] AS last_price,
   min(unit_price) AS min_price,max(unit_price) AS max_price
  FROM ls GROUP BY public.recipe_key_normalize_v027(name)
 LOOP
  v_name:=btrim(coalesce(v_item.item_name,''));v_file_price:=v_item.last_price;
  IF length(v_name) NOT BETWEEN 1 AND 250 OR v_file_price IS NULL OR v_file_price<0 OR v_file_price>999999999999
  THEN RAISE EXCEPTION 'DAILY_ITEM_INVALID: %',v_name; END IF;
  SELECT id,manual_price_original INTO v_menu,v_menu_price FROM public.menu_items
   WHERE public.recipe_key_normalize_v027(name)=v_item.item_key ORDER BY id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
   INSERT INTO public.menu_items(name,manual_price_original,notes)
    VALUES(v_name,v_file_price,'أُضيف من تقرير أمين يومي؛ تكلفة الوصفة تحتاج استكمالًا عند عدم وجود مكونات.') RETURNING id INTO v_menu;
   INSERT INTO public.menu_price_audit_v041(menu_item_id,old_price,new_price,origin,import_id,note)
    VALUES(v_menu,NULL,v_file_price,'ameen_new_item',v_run,'إضافة صنف جديد من تقرير الكاشير');
   v_new_items:=v_new_items+1;
  ELSE
   SELECT a.value->>'mode' INTO v_action FROM jsonb_array_elements(p_actions) a(value)
    WHERE public.recipe_key_normalize_v027(a.value->>'name')=v_item.item_key LIMIT 1;
   v_action:=coalesce(v_action,'keep');
   IF v_action NOT IN('keep','update') THEN RAISE EXCEPTION 'DAILY_PRICE_ACTION_INVALID'; END IF;
   IF v_action='update' AND v_file_price IS DISTINCT FROM v_menu_price THEN
     UPDATE public.menu_items SET manual_price_original=v_file_price WHERE id=v_menu;
     v_price_updates:=v_price_updates+1;
   END IF;
  END IF;
 END LOOP;

 FOR v_rec IN SELECT value FROM jsonb_array_elements(p_records) LOOP
   v_number=btrim(coalesce(v_rec->>'number',''));
   IF length(v_number) NOT BETWEEN 1 AND 100 OR coalesce(v_rec->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR jsonb_typeof(v_rec->'items')<>'array' OR jsonb_array_length(v_rec->'items') NOT BETWEEN 1 AND 3000
    THEN RAISE EXCEPTION 'DAILY_ORDER_INVALID'; END IF;
   v_day=(v_rec->>'date')::date;
   v_ts=(v_rec->>'occurredAt')::timestamptz;
   v_net=(v_rec->>'netTotal')::numeric;
   v_gross=(v_rec->>'grossTotal')::numeric;
   IF v_net IS NULL OR v_net<0 OR v_net>999999999999 OR v_gross IS NULL OR v_gross<0 OR v_gross>999999999999
   THEN RAISE EXCEPTION 'DAILY_ORDER_TOTAL_INVALID'; END IF;
   SELECT id,source_fingerprint INTO v_order,v_name FROM public.ameen_daily_orders_v041
    WHERE business_date=v_day AND external_number=v_number FOR UPDATE;
   IF FOUND THEN
      IF v_name=md5(v_rec::text) THEN v_existing:=v_existing+1;
      ELSE v_conflicts:=v_conflicts+1;
       v_notes:=v_notes||jsonb_build_array(jsonb_build_object('date',v_day,'number',v_number,'reason','رقم وتاريخ موجودان ببيانات مختلفة؛ لم نستبدل السجل القديم'));
      END IF;
      CONTINUE;
   END IF;
   INSERT INTO public.ameen_daily_orders_v041(import_id,business_date,external_number,occurred_at,source_net,source_gross,
    source_fingerprint,source_cashbox,reported_cashbox_id,source_payload)
   VALUES(v_run,v_day,v_number,v_ts,v_net,v_gross,md5(v_rec::text),nullif(btrim(v_rec->>'cashbox'),''),p_reported_cashbox_id,v_rec)
   RETURNING id INTO v_order;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_rec->'items') LOOP
      v_name=btrim(coalesce(v_line->>'name',''));
      v_qty=(v_line->>'quantity')::numeric;v_unit_price=(v_line->>'unitPrice')::numeric;v_line_net=(v_line->>'lineNet')::numeric;
      IF length(v_name) NOT BETWEEN 1 AND 250 OR v_qty IS NULL OR v_qty<=0 OR v_unit_price IS NULL OR v_unit_price<0 OR v_line_net IS NULL OR v_line_net<0
      THEN RAISE EXCEPTION 'DAILY_LINE_INVALID'; END IF;
      SELECT id,manual_price_original INTO v_menu,v_menu_price FROM public.menu_items
       WHERE public.recipe_key_normalize_v027(name)=public.recipe_key_normalize_v027(v_name) ORDER BY id LIMIT 1;
      INSERT INTO public.ameen_daily_lines_v041(order_id,source_row,menu_item_id,item_name,unit_name,quantity,unit_price,line_net,reference_price,note)
       VALUES(v_order,nullif(v_line->>'sourceRow','')::integer,v_menu,v_name,v_line->>'unit',v_qty,v_unit_price,v_line_net,v_menu_price,v_line->>'note');
      v_lines:=v_lines+1;
   END LOOP;
   v_new:=v_new+1;
 END LOOP;
 UPDATE public.ameen_daily_imports_v041 SET summary=jsonb_build_object('created',v_new,'existing',v_existing,
   'conflicts',v_conflicts,'lines',v_lines,'menuItemsAdded',v_new_items,'menuPricesUpdated',v_price_updates,
   'duplicateFile',false,'runId',v_run,'reviewNotes',v_notes)
 WHERE id=v_run;
 RETURN (SELECT summary FROM public.ameen_daily_imports_v041 WHERE id=v_run);
END;$$;

-- Revert ONLY the latest unchanged price. Does not change historical cashier line prices.
CREATE OR REPLACE FUNCTION public.ameen_price_undo_v041(p_audit_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_audit public.menu_price_audit_v041%ROWTYPE;v_current numeric;v_last bigint;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO v_audit FROM public.menu_price_audit_v041 WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR v_audit.undone_at IS NOT NULL OR v_audit.origin IN('undo','ameen_new_item') THEN RAISE EXCEPTION 'PRICE_CHANGE_NOT_REVERSIBLE'; END IF;
 SELECT manual_price_original INTO v_current FROM public.menu_items WHERE id=v_audit.menu_item_id FOR UPDATE;
 SELECT max(id) INTO v_last FROM public.menu_price_audit_v041 WHERE menu_item_id=v_audit.menu_item_id;
 IF v_last<>v_audit.id OR v_current IS DISTINCT FROM v_audit.new_price THEN RAISE EXCEPTION 'PRICE_CHANGED_SINCE_AUDIT'; END IF;
 PERFORM set_config('maria.price_origin_v041','undo',true);
 PERFORM set_config('maria.price_import_v041','',true);
 UPDATE public.menu_items SET manual_price_original=v_audit.old_price WHERE id=v_audit.menu_item_id;
 UPDATE public.menu_price_audit_v041 SET undone_at=now() WHERE id=v_audit.id;
END;$$;

-- Read-only daily report. A source receipt is not a new cashbox posting.
CREATE OR REPLACE FUNCTION public.ameen_daily_report_v041(p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'orders',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'number',o.external_number,'date',o.business_date,'net',o.source_net,
   'gross',o.source_gross,'cashbox',coalesce(o.source_cashbox,cb.name,'غير محدد في التقرير'),
   'cashboxFromFile',o.source_cashbox,'source',imp.origin,'occurredAt',o.occurred_at,
   'difference',o.source_net-o.source_gross
  ) ORDER BY o.occurred_at,o.external_number)
   FROM public.ameen_daily_orders_v041 o JOIN public.ameen_daily_imports_v041 imp ON imp.id=o.import_id
   LEFT JOIN public.cashboxes cb ON cb.id=o.reported_cashbox_id
   WHERE o.business_date=p_day),'[]'::jsonb),
  'lines',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',li.id,'orderId',li.order_id,'name',li.item_name,'menuId',li.menu_item_id,
   'qty',li.quantity,'unitPrice',li.unit_price,'lineNet',li.line_net,
   'referencePrice',li.reference_price,'sourceRow',li.source_row,
   'unit',li.unit_name,'cost',CASE WHEN c.id IS NOT NULL AND c.recipe_cost_base IS NOT NULL
     AND NOT coalesce(c.has_missing_cost,true) THEN c.recipe_cost_base ELSE e.estimated_unit_cost_base END,
   'costKind',CASE WHEN c.id IS NOT NULL AND c.recipe_cost_base IS NOT NULL
     AND NOT coalesce(c.has_missing_cost,true) THEN 'recipe'
     WHEN e.estimated_unit_cost_base IS NOT NULL THEN 'estimate' ELSE 'missing' END
  ) ORDER BY li.id)
   FROM public.ameen_daily_lines_v041 li
   JOIN public.ameen_daily_orders_v041 o ON o.id=li.order_id
   LEFT JOIN public.menu_item_costs c ON c.id=li.menu_item_id
   LEFT JOIN public.event_menu_cost_estimates_v039 e ON e.menu_item_id=li.menu_item_id
   WHERE o.business_date=p_day),'[]'::jsonb),
  'priceHistory',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id,'item',mi.name,'oldPrice',a.old_price,'newPrice',a.new_price,
   'origin',a.origin,'undone',a.undone_at IS NOT NULL,'at',a.occurred_at
  ) ORDER BY a.id DESC) FROM (SELECT * FROM public.menu_price_audit_v041 ORDER BY id DESC LIMIT 250) a
   JOIN public.menu_items mi ON mi.id=a.menu_item_id),'[]'::jsonb)
 ) WHERE public.is_app_owner() AND p_day IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.ameen_daily_days_v041()
RETURNS TABLE(business_date date,order_count bigint,net_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT o.business_date,count(*),sum(o.source_net)
 FROM public.ameen_daily_orders_v041 o WHERE public.is_app_owner()
 GROUP BY o.business_date ORDER BY o.business_date DESC LIMIT 180;
$$;

-- Filter menu by true recipe completeness on the SERVER, so every paginated page is correct.
CREATE OR REPLACE VIEW public.menu_cost_status_v041 AS
 SELECT mi.id,mi.name,mi.category_id,
  ((mc.id IS NULL OR mc.recipe_cost_base IS NULL OR coalesce(mc.has_missing_cost,true))
    AND ce.estimated_unit_cost_base IS NULL) AS cost_is_missing,
  CASE WHEN mc.id IS NOT NULL AND mc.recipe_cost_base IS NOT NULL
    AND NOT coalesce(mc.has_missing_cost,true) THEN mc.recipe_cost_base ELSE ce.estimated_unit_cost_base END AS usable_cost,
  CASE WHEN mc.id IS NOT NULL AND mc.recipe_cost_base IS NOT NULL
    AND NOT coalesce(mc.has_missing_cost,true) THEN 'recipe'
    WHEN ce.estimated_unit_cost_base IS NOT NULL THEN 'estimate' ELSE 'missing' END AS cost_kind
 FROM public.menu_items mi LEFT JOIN public.menu_item_costs mc ON mc.id=mi.id
 LEFT JOIN public.event_menu_cost_estimates_v039 ce ON ce.menu_item_id=mi.id
 WHERE public.is_app_owner();
REVOKE ALL ON public.menu_cost_status_v041 FROM PUBLIC,anon;
GRANT SELECT ON public.menu_cost_status_v041 TO authenticated;

-- Optional, reusable cost estimate in the MENU, never in material inventory valuation.
-- NULL clears an old estimate when the user explicitly removes it.
CREATE OR REPLACE FUNCTION public.menu_set_estimate_v041(p_menu_item_id uuid,p_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.menu_items WHERE id=p_menu_item_id) THEN RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND'; END IF;
 IF p_cost IS NULL THEN
  DELETE FROM public.event_menu_cost_estimates_v039 WHERE menu_item_id=p_menu_item_id;
 ELSE
  PERFORM public.event_save_cost_estimate_v039(p_menu_item_id,p_cost,'تقدير اختياري من صفحة المنيو');
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.menu_set_estimate_v041(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.menu_set_estimate_v041(uuid,numeric) TO authenticated;

-- Carry forward previously imported v0.30 drafts into the NEW read-only daily report,
-- WITHOUT writing new orders or payments or changing old menu prices.
INSERT INTO public.ameen_daily_imports_v041(filename,sha256,created_at,origin,summary)
 SELECT r.filename,'legacy:'||r.sha256,r.created_at,'legacy_v030',r.summary
 FROM public.quick_import_runs_v030 r WHERE r.kind='orders' AND r.undone_at IS NULL
 ON CONFLICT(sha256) DO NOTHING;
INSERT INTO public.ameen_daily_orders_v041(import_id,business_date,external_number,occurred_at,
 source_net,source_gross,source_fingerprint,source_cashbox,source_payload)
 SELECT ni.id,qr.business_date,qr.external_number,
  nullif(qr.source_payload->>'occurredAt','')::timestamptz,
  coalesce(nullif(qr.source_payload->>'netTotal','')::numeric,0),
  coalesce(nullif(qr.source_payload->>'grossTotal','')::numeric,0),
  md5(qr.source_payload::text),nullif(qr.source_payload->>'cashbox',''),qr.source_payload
 FROM public.quick_import_order_rows_v030 qr
 JOIN public.quick_import_runs_v030 rr ON rr.id=qr.run_id AND rr.kind='orders' AND rr.undone_at IS NULL
 JOIN public.ameen_daily_imports_v041 ni ON ni.sha256='legacy:'||rr.sha256
 WHERE jsonb_typeof(qr.source_payload->'items')='array'
 ON CONFLICT(business_date,external_number) DO NOTHING;
INSERT INTO public.ameen_daily_lines_v041(order_id,source_row,menu_item_id,item_name,unit_name,
 quantity,unit_price,line_net,reference_price,note)
 SELECT o.id,nullif(li.value->>'sourceRow','')::integer,mi.id,li.value->>'name',li.value->>'unit',
  (li.value->>'quantity')::numeric,(li.value->>'unitPrice')::numeric,(li.value->>'lineNet')::numeric,
  mi.manual_price_original,li.value->>'note'
 FROM public.ameen_daily_orders_v041 o
 CROSS JOIN LATERAL jsonb_array_elements(o.source_payload->'items') li(value)
 LEFT JOIN LATERAL (SELECT m.id,m.manual_price_original FROM public.menu_items m
  WHERE public.recipe_key_normalize_v027(m.name)=public.recipe_key_normalize_v027(li.value->>'name')
  ORDER BY m.id LIMIT 1) mi ON true
 WHERE NOT EXISTS(SELECT 1 FROM public.ameen_daily_lines_v041 old WHERE old.order_id=o.id)
 AND (li.value->>'quantity')::numeric>0;

REVOKE ALL ON FUNCTION public.ameen_price_preview_v041(jsonb),
 public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid),
 public.ameen_price_undo_v041(bigint),public.ameen_daily_report_v041(date),
 public.ameen_daily_days_v041() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ameen_price_preview_v041(jsonb),
 public.ameen_import_daily_v041(text,text,jsonb,jsonb,uuid),
 public.ameen_price_undo_v041(bigint),public.ameen_daily_report_v041(date),
 public.ameen_daily_days_v041() TO authenticated;
COMMIT;
