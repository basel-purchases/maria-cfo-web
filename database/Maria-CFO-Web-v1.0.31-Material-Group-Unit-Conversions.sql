-- Maria CFO Web v1.0.31: explicit per-member unit conversions in ordered stock groups.
-- Requires the FIXED v1.0.30 migration. Non-destructive to historic stock and invoices.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '180s';

DO $preflight$
BEGIN
 IF to_regclass('public.material_groups_v130') IS NULL
   OR to_regclass('public.material_group_members_v130') IS NULL
   OR to_regclass('public.units') IS NULL
   OR to_regprocedure('public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone)') IS NULL
 THEN RAISE EXCEPTION 'V131_GROUP_CONVERSIONS_REQUIRE_V130_FIXED'; END IF;
END;
$preflight$;

-- One reference unit per group. 1 actual base unit = ratio reference units.
-- Old groups had identical units; migrate their ratios as 1:1.
ALTER TABLE public.material_groups_v130
 ADD COLUMN IF NOT EXISTS reference_unit_id_v131 uuid REFERENCES public.units(id) ON DELETE RESTRICT;
ALTER TABLE public.material_group_members_v130
 ADD COLUMN IF NOT EXISTS group_units_per_base_v131 numeric(24,12) NOT NULL DEFAULT 1;
UPDATE public.material_groups_v130 g
SET reference_unit_id_v131=(
 SELECT m.base_unit_id
 FROM public.material_group_members_v130 gm JOIN public.materials m ON m.id=gm.material_id
 WHERE gm.group_id=g.id ORDER BY gm.priority,gm.material_id LIMIT 1)
WHERE g.reference_unit_id_v131 IS NULL;
DO $validate_legacy$
BEGIN
 IF EXISTS(SELECT 1 FROM public.material_groups_v130 WHERE reference_unit_id_v131 IS NULL)
 THEN RAISE EXCEPTION 'V131_GROUP_WITHOUT_REFERENCE_UNIT'; END IF;
END;
$validate_legacy$;
ALTER TABLE public.material_groups_v130
 ALTER COLUMN reference_unit_id_v131 SET NOT NULL;
ALTER TABLE public.material_group_members_v130
 DROP CONSTRAINT IF EXISTS v131_group_conversion_ratio_check;
ALTER TABLE public.material_group_members_v130
 ADD CONSTRAINT v131_group_conversion_ratio_check
 CHECK (group_units_per_base_v131 BETWEEN 0.000001 AND 1000000);

-- Explicit ratios are required when the member's base unit differs from reference.
-- Price approval compares costs per reference unit, never raw per-SKU prices.
CREATE OR REPLACE FUNCTION public.material_group_save_v131(
 p_group_id uuid,p_name text,p_reference_unit_id uuid,p_members uuid[],
 p_factors numeric[],p_accept_price_warning boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE v_id uuid;v_count int;v_mat_count int;v_inactive int;v_null_units int;
 v_bad_factor int;v_wrong_identity int;v_missing_base int;v_min_base numeric;v_max_base numeric;
 v_missing_usd int;v_min_usd numeric;v_max_usd numeric;v_warning boolean;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'GROUP_NAME_REQUIRED';END IF;
 v_count:=coalesce(cardinality(p_members),0);
 IF v_count NOT BETWEEN 2 AND 100 OR cardinality(p_factors) IS DISTINCT FROM v_count
 THEN RAISE EXCEPTION 'GROUP_CONVERSION_MEMBER_COUNT_INVALID';END IF;
 IF p_reference_unit_id IS NULL THEN RAISE EXCEPTION 'GROUP_REFERENCE_UNIT_REQUIRED';END IF;
 IF (SELECT count(DISTINCT x.material_id) FROM unnest(p_members) AS x(material_id))<>v_count
 THEN RAISE EXCEPTION 'GROUP_MEMBERS_DUPLICATED';END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_factors) AS f(ratio)
   WHERE f.ratio IS NULL OR f.ratio NOT BETWEEN 0.000001 AND 1000000
     OR f.ratio::text IN ('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'GROUP_CONVERSION_INVALID_FACTOR';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-config-v130',0));
 IF p_group_id IS NOT NULL THEN
   PERFORM 1 FROM public.material_groups_v130 WHERE id=p_group_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-v130:'||p_group_id::text,0));
 END IF;
 SELECT count(*),count(*) FILTER (WHERE NOT m.is_active),
        count(*) FILTER (WHERE m.base_unit_id IS NULL),
        count(*) FILTER (WHERE m.base_unit_id=p_reference_unit_id AND p_factors[u.ord::int]<>1)
 INTO v_mat_count,v_inactive,v_null_units,v_wrong_identity
 FROM unnest(p_members) WITH ORDINALITY AS u(material_id,ord)
 JOIN public.materials m ON m.id=u.material_id;
 IF v_mat_count<>v_count OR v_inactive>0 OR v_null_units>0
 THEN RAISE EXCEPTION 'GROUP_MATERIAL_NOT_ACTIVE';END IF;
 IF v_wrong_identity>0 THEN RAISE EXCEPTION 'GROUP_SAME_UNIT_FACTOR_MUST_BE_ONE';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.materials m
     WHERE m.id=ANY(p_members) AND m.base_unit_id=p_reference_unit_id)
 THEN RAISE EXCEPTION 'GROUP_REFERENCE_UNIT_MUST_BELONG_TO_MEMBER';END IF;
 IF EXISTS(SELECT 1 FROM public.material_group_members_v130 gm
   WHERE gm.material_id=ANY(p_members) AND gm.group_id IS DISTINCT FROM p_group_id)
 THEN RAISE EXCEPTION 'GROUP_MATERIAL_ALREADY_ASSIGNED';END IF;
 IF EXISTS(SELECT 1 FROM public.material_groups_v130 g
    WHERE public.material_alias_normalize_v106(g.name)=public.material_alias_normalize_v106(p_name)
      AND g.id IS DISTINCT FROM p_group_id)
 THEN RAISE EXCEPTION 'GROUP_NAME_ALREADY_USED';END IF;
 SELECT count(*) FILTER (WHERE m.last_purchase_unit_cost_base IS NULL OR m.last_purchase_unit_cost_base<=0),
        min(m.last_purchase_unit_cost_base/p_factors[u.ord::int])
          FILTER (WHERE m.last_purchase_unit_cost_base>0),
        max(m.last_purchase_unit_cost_base/p_factors[u.ord::int])
          FILTER (WHERE m.last_purchase_unit_cost_base>0),
        count(*) FILTER (WHERE m.price_usd_v110 IS NULL OR m.price_usd_v110<=0),
        min(m.price_usd_v110/p_factors[u.ord::int]) FILTER (WHERE m.price_usd_v110>0),
        max(m.price_usd_v110/p_factors[u.ord::int]) FILTER (WHERE m.price_usd_v110>0)
 INTO v_missing_base,v_min_base,v_max_base,v_missing_usd,v_min_usd,v_max_usd
 FROM unnest(p_members) WITH ORDINALITY AS u(material_id,ord)
 JOIN public.materials m ON m.id=u.material_id;
 v_warning:=v_missing_base>0 OR coalesce(v_max_base-v_min_base,0)>0.0001
   OR (v_missing_usd=0 AND coalesce(v_max_usd-v_min_usd,0)>0.0001);
 IF v_warning AND NOT coalesce(p_accept_price_warning,false)
 THEN RAISE EXCEPTION 'GROUP_PRICE_WARNING_CONFIRMATION_REQUIRED';END IF;
 IF p_group_id IS NULL THEN
   INSERT INTO public.material_groups_v130(name,reference_unit_id_v131)
      VALUES(btrim(p_name),p_reference_unit_id) RETURNING id INTO v_id;
 ELSE
   v_id:=p_group_id;
   UPDATE public.material_groups_v130
     SET name=btrim(p_name),reference_unit_id_v131=p_reference_unit_id,updated_at=now()
     WHERE id=v_id;
   DELETE FROM public.material_group_members_v130 WHERE group_id=v_id;
 END IF;
 INSERT INTO public.material_group_members_v130(group_id,material_id,priority,group_units_per_base_v131)
 SELECT v_id,u.material_id,u.ord::int,p_factors[u.ord::int]
 FROM unnest(p_members) WITH ORDINALITY AS u(material_id,ord);
 RETURN jsonb_build_object('groupId',v_id,'members',v_count,
    'referenceUnitId',p_reference_unit_id,'priceWarningAcknowledged',v_warning);
END;
$save$;

-- Compatibility: forbid old clients from resetting ratios through the pre-v131 RPC.
REVOKE ALL ON FUNCTION public.material_group_save_v130(uuid,text,uuid[],boolean)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.material_group_save_v131(uuid,text,uuid,uuid[],numeric[],boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_group_save_v131(uuid,text,uuid,uuid[],numeric[],boolean)
 TO authenticated;

-- Same signature / return columns as v130, so restaurant orders, event hospitality
-- and deferred imported sales use correct per-SKU stock amounts without rewrites.
CREATE OR REPLACE FUNCTION public.material_consumption_plan_v130(
 p_requested uuid,p_quantity numeric,p_at timestamptz)
RETURNS TABLE(actual_material_id uuid,issued_base numeric,unit_cost_base numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $plan$
DECLARE v_group uuid;v_left_reference numeric;v_take_actual numeric;
 v_row record;v_ref uuid;v_requested_factor numeric;v_material_unit uuid;
 v_stock_tolerance numeric:=0.000000000001;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied';END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>10000000000
 THEN RAISE EXCEPTION 'GROUP_INVALID_CONSUMPTION_QUANTITY';END IF;
 SELECT base_unit_id INTO v_material_unit FROM public.materials WHERE id=p_requested AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_ACTIVE';END IF;
 SELECT group_id INTO v_group FROM public.material_group_members_v130 WHERE material_id=p_requested;
 IF v_group IS NULL THEN
   actual_material_id:=p_requested;issued_base:=p_quantity;
   unit_cost_base:=public.get_material_cost_at(p_requested,p_at);RETURN NEXT;RETURN;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-v130:'||v_group::text,0));
 SELECT reference_unit_id_v131 INTO v_ref FROM public.material_groups_v130 WHERE id=v_group;
 SELECT group_units_per_base_v131 INTO v_requested_factor
  FROM public.material_group_members_v130 WHERE group_id=v_group AND material_id=p_requested;
 IF v_ref IS NULL OR v_requested_factor IS NULL OR v_requested_factor<=0
 THEN RAISE EXCEPTION 'GROUP_CONVERSION_NOT_CONFIGURED';END IF;
 v_left_reference:=p_quantity*v_requested_factor;
 FOR v_row IN
   SELECT m.id,m.current_stock_base,m.base_unit_id,m.is_active,gm.group_units_per_base_v131 AS factor
   FROM public.material_group_members_v130 gm JOIN public.materials m ON m.id=gm.material_id
   WHERE gm.group_id=v_group
   ORDER BY CASE WHEN m.id=p_requested THEN 0 ELSE 1 END,gm.priority,m.id
   FOR UPDATE OF m
 LOOP
   IF NOT v_row.is_active THEN RAISE EXCEPTION 'GROUP_MATERIAL_NOT_ACTIVE';END IF;
   IF v_row.factor IS NULL OR v_row.factor<=0 OR
      (v_row.base_unit_id=v_ref AND v_row.factor<>1)
   THEN RAISE EXCEPTION 'GROUP_CONVERSION_NOT_CONFIGURED';END IF;
   -- Stock and movement ledger are both numeric(20,6). Use the same rounded
   -- quantity in snapshots, movements and cost; avoid silent inconsistent casts.
   v_take_actual:=least(greatest(coalesce(v_row.current_stock_base,0),0),
                         round(v_left_reference/v_row.factor,6));
   IF v_take_actual=0 AND v_left_reference>v_stock_tolerance
        AND coalesce(v_row.current_stock_base,0)>0
   THEN RAISE EXCEPTION 'GROUP_CONVERSION_BELOW_STOCK_PRECISION';END IF;
   IF v_take_actual>0 THEN
     actual_material_id:=v_row.id;
     issued_base:=v_take_actual;
     unit_cost_base:=public.get_material_cost_at(v_row.id,p_at);
     RETURN NEXT;
     v_left_reference:=greatest(0,v_left_reference-v_take_actual*v_row.factor);
     v_stock_tolerance:=greatest(v_stock_tolerance,v_row.factor*0.0000005);
   END IF;
   EXIT WHEN v_left_reference<=v_stock_tolerance;
 END LOOP;
 IF v_left_reference>v_stock_tolerance
 THEN RAISE EXCEPTION 'GROUP_STOCK_INSUFFICIENT: remaining % reference units',
   round(v_left_reference,9);END IF;
END;
$plan$;
REVOKE ALL ON FUNCTION public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone)
 TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
