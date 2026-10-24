-- MARIA CFO WEB v1.0.11 | Repair and optimize USD material reference prices
-- Run in the correct Supabase SQL Editor before deploying Web v1.0.11. Safe to rerun.
-- No historical invoices, inventory movements, purchase snapshots, or cashboxes are rewritten.
-- Installing this migration alone does NOT compute or modify material prices or exchange rates.
-- This file includes all v1.0.10 prerequisites to repair missing installations, then overrides bulk functions.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='120s';

ALTER TABLE public.materials
 ADD COLUMN IF NOT EXISTS price_usd_v110 numeric(20,8),
 ADD COLUMN IF NOT EXISTS price_syp_v110 numeric(20,8),
 ADD COLUMN IF NOT EXISTS price_fx_rate_v110 numeric(20,6),
 ADD COLUMN IF NOT EXISTS price_updated_at_v110 timestamptz;

ALTER TABLE public.materials
 DROP CONSTRAINT IF EXISTS materials_price_usd_nonnegative_v110;
ALTER TABLE public.materials
 ADD CONSTRAINT materials_price_usd_nonnegative_v110
 CHECK (price_usd_v110 IS NULL OR price_usd_v110>0);
ALTER TABLE public.materials
 DROP CONSTRAINT IF EXISTS materials_price_syp_nonnegative_v110;
ALTER TABLE public.materials
 ADD CONSTRAINT materials_price_syp_nonnegative_v110
 CHECK (price_syp_v110 IS NULL OR price_syp_v110>0);

CREATE TABLE IF NOT EXISTS public.material_price_history_v110 (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('initialize_usd','edit_usd','fx_revalue')),
 previous_usd numeric(20,8), new_usd numeric(20,8),
 previous_syp numeric(20,8), new_syp numeric(20,8),
 fx_rate numeric(20,6), changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS material_price_history_mat_time_v110
 ON public.material_price_history_v110(material_id,changed_at DESC);
ALTER TABLE public.material_price_history_v110 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.material_price_history_v110 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.material_price_history_v110 TO authenticated;
DROP POLICY IF EXISTS material_price_history_owner_select_v110 ON public.material_price_history_v110;
CREATE POLICY material_price_history_owner_select_v110 ON public.material_price_history_v110
 FOR SELECT TO authenticated USING (public.is_app_owner());

CREATE OR REPLACE FUNCTION public.material_price_set_one_v110(p_material_id uuid,p_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_rate numeric;v_old public.materials%ROWTYPE;v_syp numeric;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_usd IS NOT NULL AND (p_usd<=0 OR p_usd>100000000000)
 THEN RAISE EXCEPTION 'INVALID_MATERIAL_USD_PRICE'; END IF;
 SELECT usd_to_base_rate INTO v_rate FROM public.app_settings WHERE id=1;
 IF p_usd IS NOT NULL AND (v_rate IS NULL OR v_rate<=0)
 THEN RAISE EXCEPTION 'USD_RATE_REQUIRED'; END IF;
 SELECT * INTO v_old FROM public.materials WHERE id=p_material_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_FOUND'; END IF;
 v_syp:=CASE WHEN p_usd IS NULL THEN NULL ELSE round(p_usd*v_rate,8) END;
 IF v_old.price_usd_v110 IS NOT DISTINCT FROM p_usd AND
    v_old.price_syp_v110 IS NOT DISTINCT FROM v_syp THEN RETURN; END IF;
 UPDATE public.materials SET price_usd_v110=p_usd,price_syp_v110=v_syp,
   price_fx_rate_v110=CASE WHEN p_usd IS NULL THEN NULL ELSE v_rate END,
   price_updated_at_v110=now() WHERE id=p_material_id;
 INSERT INTO public.material_price_history_v110(material_id,action,previous_usd,new_usd,
    previous_syp,new_syp,fx_rate)
 VALUES(p_material_id,'edit_usd',v_old.price_usd_v110,p_usd,v_old.price_syp_v110,v_syp,v_rate);
END;$$;

-- Maintain atomicity with the existing name/alias changes: no half-created
-- material or material identity update when USD pricing fails.
CREATE OR REPLACE FUNCTION public.material_identity_create_priced_v110(
 p_name text,p_code text,p_base_unit_id uuid,p_category_id uuid,p_target numeric,
 p_aliases text[],p_price_usd numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 v_id:=public.material_identity_create_v106(p_name,p_code,p_base_unit_id,p_category_id,p_target,p_aliases);
 IF p_price_usd IS NOT NULL THEN PERFORM public.material_price_set_one_v110(v_id,p_price_usd); END IF;
 RETURN v_id;
END;$$;
CREATE OR REPLACE FUNCTION public.material_identity_update_priced_v110(
 p_material_id uuid,p_name text,p_code text,p_category_id uuid,p_aliases text[],p_price_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM public.material_identity_update_v106(p_material_id,p_name,p_code,p_category_id,p_aliases);
 PERFORM public.material_price_set_one_v110(p_material_id,p_price_usd);
END;$$;

-- Reference-price initialization: only existing strictly positive last purchase
-- or previously approved SYP reference prices can be converted. Zero/unknown
-- costs remain NULL. User explicitly confirms overwriting any existing USD anchor.
CREATE OR REPLACE FUNCTION public.material_price_initialize_usd_v110(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;v_syp numeric;v_usd numeric;v_updated integer:=0;v_skipped integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>10000000000
 THEN RAISE EXCEPTION 'INVALID_USD_EXCHANGE_RATE'; END IF;
 -- Lock exchange settings to serialize bulk operations and manual USD edits.
 PERFORM 1 FROM public.app_settings WHERE id=1 FOR UPDATE;
 PERFORM public.set_exchange_rate('USD',p_rate,now(),'تسعير المواد المرجعي بالدولار v1.0.10');
 FOR r IN SELECT * FROM public.materials ORDER BY id FOR UPDATE LOOP
  v_syp:=coalesce(nullif(r.price_syp_v110,0),nullif(r.last_purchase_unit_cost_base,0));
  IF v_syp IS NULL OR v_syp<0 THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
  v_usd:=round(v_syp/p_rate,8);
  IF v_usd<=0 THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
  UPDATE public.materials SET price_usd_v110=v_usd,price_syp_v110=v_syp,
   price_fx_rate_v110=p_rate,price_updated_at_v110=now() WHERE id=r.id;
  IF r.price_usd_v110 IS DISTINCT FROM v_usd OR r.price_syp_v110 IS DISTINCT FROM v_syp THEN
   INSERT INTO public.material_price_history_v110(material_id,action,previous_usd,new_usd,
      previous_syp,new_syp,fx_rate)
   VALUES(r.id,'initialize_usd',r.price_usd_v110,v_usd,r.price_syp_v110,v_syp,p_rate);
  END IF;
  v_updated:=v_updated+1;
 END LOOP;
 RETURN jsonb_build_object('priced',v_updated,'without_known_syp_price',v_skipped,'rate',p_rate);
END;$$;

-- Save new USD exchange rate, optionally recalculate CURRENT SYP REFERENCE
-- prices only. This is ONE transaction: a DB failure cannot update just FX.
CREATE OR REPLACE FUNCTION public.material_price_set_exchange_rate_v110(
 p_rate numeric,p_update_material_prices boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;v_syp numeric;v_count integer:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>10000000000
 THEN RAISE EXCEPTION 'INVALID_USD_EXCHANGE_RATE'; END IF;
 IF p_update_material_prices IS NULL THEN RAISE EXCEPTION 'PRICING_DECISION_REQUIRED'; END IF;
 PERFORM 1 FROM public.app_settings WHERE id=1 FOR UPDATE;
 PERFORM public.set_exchange_rate('USD',p_rate,now(),
   CASE WHEN p_update_material_prices THEN 'تحديث سعر الصرف وأسعار المواد المرجعية v1.0.10'
        ELSE 'تحديث سعر الصرف دون تغيير أسعار المواد v1.0.10' END);
 IF p_update_material_prices THEN
  FOR r IN SELECT * FROM public.materials WHERE price_usd_v110>0 ORDER BY id FOR UPDATE LOOP
   v_syp:=round(r.price_usd_v110*p_rate,8);
   IF r.price_syp_v110 IS DISTINCT FROM v_syp OR r.price_fx_rate_v110 IS DISTINCT FROM p_rate THEN
    UPDATE public.materials SET price_syp_v110=v_syp,price_fx_rate_v110=p_rate,
     price_updated_at_v110=now() WHERE id=r.id;
    INSERT INTO public.material_price_history_v110(material_id,action,previous_usd,new_usd,
     previous_syp,new_syp,fx_rate)
    VALUES(r.id,'fx_revalue',r.price_usd_v110,r.price_usd_v110,r.price_syp_v110,v_syp,p_rate);
    v_count:=v_count+1;
   END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('rate',p_rate,'updated_materials',v_count,'applied',p_update_material_prices);
END;$$;

REVOKE ALL ON FUNCTION public.material_price_set_one_v110(uuid,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_identity_create_priced_v110(text,text,uuid,uuid,numeric,text[],numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_identity_update_priced_v110(uuid,text,text,uuid,text[],numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_price_initialize_usd_v110(numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_price_set_exchange_rate_v110(numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_price_set_one_v110(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_identity_create_priced_v110(text,text,uuid,uuid,numeric,text[],numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_identity_update_priced_v110(uuid,text,text,uuid,text[],numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_price_initialize_usd_v110(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_price_set_exchange_rate_v110(numeric,boolean) TO authenticated;

-- v1.0.11: bulk price conversion uses one set-based UPDATE plus one audit INSERT.
-- This avoids hundreds of sequential UPDATE/INSERT statements inside the older loop,
-- a potential timeout on a live database with material update triggers.
-- Zero/unknown costs remain unpriced; no purchase or stock history is modified.
CREATE OR REPLACE FUNCTION public.material_price_initialize_usd_v110(p_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $pricing_v111$
DECLARE v_priced bigint:=0;v_skipped bigint:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>10000000000
 THEN RAISE EXCEPTION 'INVALID_USD_EXCHANGE_RATE'; END IF;
 -- Serialize bulk repricing and exchange changes. A failure rolls back FX too.
 PERFORM 1 FROM public.app_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APP_SETTINGS_MISSING'; END IF;
 PERFORM public.set_exchange_rate('USD',p_rate,now(),'تسعير المواد المرجعي بالدولار v1.0.11');
 WITH eligible AS MATERIALIZED (
   SELECT m.id,m.price_usd_v110 AS before_usd,m.price_syp_v110 AS before_syp,
     coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0)) AS syp_price
   FROM public.materials m
   WHERE coalesce(nullif(m.price_syp_v110,0),nullif(m.last_purchase_unit_cost_base,0)) > 0
   FOR UPDATE
 ), priced AS (
   UPDATE public.materials AS m
   SET price_usd_v110=round(e.syp_price/p_rate,8),
       price_syp_v110=e.syp_price,price_fx_rate_v110=p_rate,price_updated_at_v110=now()
   FROM eligible AS e
   WHERE m.id=e.id AND round(e.syp_price/p_rate,8)>0
   RETURNING m.id
 ), audit AS (
   INSERT INTO public.material_price_history_v110
     (material_id,action,previous_usd,new_usd,previous_syp,new_syp,fx_rate)
   SELECT e.id,'initialize_usd',e.before_usd,round(e.syp_price/p_rate,8),
          e.before_syp,e.syp_price,p_rate
   FROM eligible AS e JOIN priced AS p ON p.id=e.id
   WHERE e.before_usd IS DISTINCT FROM round(e.syp_price/p_rate,8)
      OR e.before_syp IS DISTINCT FROM e.syp_price
   RETURNING id
 )
 SELECT count(*) INTO v_priced FROM priced;
 SELECT count(*)-v_priced INTO v_skipped FROM public.materials;
 RETURN jsonb_build_object('priced',v_priced,'without_known_syp_price',v_skipped,'rate',p_rate);
END;
$pricing_v111$;

-- FX change affects ONLY already priced USD anchors; no zero/NULL USD anchor is created.
CREATE OR REPLACE FUNCTION public.material_price_set_exchange_rate_v110(
 p_rate numeric,p_update_material_prices boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $pricing_fx_v111$
DECLARE v_count bigint:=0;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_rate IS NULL OR p_rate<=0 OR p_rate>10000000000
 THEN RAISE EXCEPTION 'INVALID_USD_EXCHANGE_RATE'; END IF;
 IF p_update_material_prices IS NULL THEN RAISE EXCEPTION 'PRICING_DECISION_REQUIRED'; END IF;
 PERFORM 1 FROM public.app_settings WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'APP_SETTINGS_MISSING'; END IF;
 PERFORM public.set_exchange_rate('USD',p_rate,now(),
   CASE WHEN p_update_material_prices THEN 'تحديث الصرف مع الأسعار المرجعية v1.0.11'
        ELSE 'تحديث الصرف دون تغيير أسعار المواد v1.0.11' END);
 IF p_update_material_prices THEN
  WITH previous AS MATERIALIZED (
    SELECT m.id,m.price_usd_v110 AS usd,m.price_syp_v110 AS before_syp
    FROM public.materials AS m
    WHERE m.price_usd_v110>0 AND m.price_syp_v110>0
    FOR UPDATE
  ), repriced AS (
    UPDATE public.materials AS m
    SET price_syp_v110=round(p.usd*p_rate,8),price_fx_rate_v110=p_rate,
        price_updated_at_v110=now()
    FROM previous AS p
    WHERE m.id=p.id AND round(p.usd*p_rate,8)>0
      AND (m.price_syp_v110 IS DISTINCT FROM round(p.usd*p_rate,8)
           OR m.price_fx_rate_v110 IS DISTINCT FROM p_rate)
    RETURNING m.id
  ), audit AS (
    INSERT INTO public.material_price_history_v110
      (material_id,action,previous_usd,new_usd,previous_syp,new_syp,fx_rate)
    SELECT p.id,'fx_revalue',p.usd,p.usd,p.before_syp,round(p.usd*p_rate,8),p_rate
    FROM previous AS p JOIN repriced AS r ON r.id=p.id
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM repriced;
 END IF;
 RETURN jsonb_build_object('rate',p_rate,'updated_materials',v_count,'applied',p_update_material_prices);
END;
$pricing_fx_v111$;

-- Idempotent grants for older/partially installed projects.
REVOKE ALL ON FUNCTION public.material_price_initialize_usd_v110(numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.material_price_set_exchange_rate_v110(numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_price_initialize_usd_v110(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.material_price_set_exchange_rate_v110(numeric,boolean) TO authenticated;

COMMIT;
