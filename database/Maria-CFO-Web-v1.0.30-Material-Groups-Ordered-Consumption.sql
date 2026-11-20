-- Maria CFO Web v1.0.30 | Ordered material pooling (not destructive merging).
-- Requires v1.0.29 and the v1.0.26 physical inventory ledger.
-- Does not modify existing purchase invoices, stock balances, orders, or costs.
-- Owner/accountant approval of cross-SKU pooling, including different costs.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

DO $preflight$
BEGIN
 IF to_regprocedure('public.material_alias_normalize_v106(text)') IS NULL
 OR to_regprocedure('public.post_order(uuid,boolean)') IS NULL
 OR to_regprocedure('public.post_event_food_consumption(uuid,timestamp with time zone,text)') IS NULL
 OR to_regprocedure('public.record_inventory_movement(uuid,text,numeric,numeric,timestamp with time zone,text,uuid,uuid,text)') IS NULL
 OR to_regclass('public.order_item_materials') IS NULL
 OR to_regclass('public.event_food_posting_materials') IS NULL THEN
   RAISE EXCEPTION 'V130_MISSING_REQUIRED_MIGRATIONS';
 END IF;
END;
$preflight$;

CREATE TABLE IF NOT EXISTS public.material_groups_v130 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_groups_unique_name_v130
 ON public.material_groups_v130 (public.material_alias_normalize_v106(name));
CREATE TABLE IF NOT EXISTS public.material_group_members_v130 (
 group_id uuid NOT NULL REFERENCES public.material_groups_v130(id) ON DELETE CASCADE,
 material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
 priority integer NOT NULL CHECK (priority BETWEEN 1 AND 100),
 PRIMARY KEY(group_id,material_id),
 UNIQUE(material_id),
 UNIQUE(group_id,priority)
);
CREATE INDEX IF NOT EXISTS material_group_members_priority_v130
 ON public.material_group_members_v130(group_id,priority);
ALTER TABLE public.material_groups_v130 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_group_members_v130 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS material_group_owner_read_v130 ON public.material_groups_v130;
CREATE POLICY material_group_owner_read_v130 ON public.material_groups_v130
 FOR SELECT TO authenticated USING(public.is_app_owner());
DROP POLICY IF EXISTS material_group_members_owner_read_v130 ON public.material_group_members_v130;
CREATE POLICY material_group_members_owner_read_v130 ON public.material_group_members_v130
 FOR SELECT TO authenticated USING(public.is_app_owner());
REVOKE ALL ON public.material_groups_v130,public.material_group_members_v130 FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.material_groups_v130,public.material_group_members_v130 TO authenticated;

-- Store the originally requested recipe material while retaining the ACTUAL issued SKU.
ALTER TABLE public.order_item_materials
 ADD COLUMN IF NOT EXISTS requested_material_id_v130 uuid REFERENCES public.materials(id) ON DELETE RESTRICT;
ALTER TABLE public.event_food_posting_materials
 ADD COLUMN IF NOT EXISTS requested_material_id_v130 uuid REFERENCES public.materials(id) ON DELETE RESTRICT;

-- A single order line can legitimately draw the same actual material from two
-- distinct recipe components. Preserve the one-to-one movement_id constraint,
-- but allow multiple independently auditable snapshots of that material.
-- Existing rows remain untouched, and reporting uses SUM across snapshots.
ALTER TABLE public.order_item_materials
 DROP CONSTRAINT IF EXISTS order_item_material_unique;
ALTER TABLE public.event_food_posting_materials
 DROP CONSTRAINT IF EXISTS event_food_posting_material_unique;
CREATE INDEX IF NOT EXISTS order_item_material_actual_v130
 ON public.order_item_materials(order_item_id,material_id);
CREATE INDEX IF NOT EXISTS event_food_material_actual_v130
 ON public.event_food_posting_materials(posting_item_id,material_id);

-- Save the pool without combining historical ledger rows. Member positions are 1-based.
CREATE OR REPLACE FUNCTION public.material_group_save_v130(
 p_group_id uuid, p_name text, p_members uuid[], p_accept_price_warning boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE v_id uuid;v_count integer;v_units integer;v_missing integer;
 v_missing_base integer;v_missing_unit integer;v_min_base numeric;v_max_base numeric;
 v_missing_usd integer;v_min_usd numeric;v_max_usd numeric;v_warning boolean;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 120
 THEN RAISE EXCEPTION 'GROUP_NAME_REQUIRED'; END IF;
 v_count:=coalesce(cardinality(p_members),0);
 IF v_count NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'GROUP_MEMBER_COUNT_INVALID'; END IF;
 IF (SELECT count(DISTINCT x.id) FROM unnest(p_members) x(id))<>v_count
 THEN RAISE EXCEPTION 'GROUP_MEMBERS_DUPLICATED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-config-v130',0));
 IF p_group_id IS NOT NULL THEN
   PERFORM 1 FROM public.material_groups_v130 WHERE id=p_group_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-v130:'||p_group_id::text,0));
 END IF;
 SELECT count(*),count(DISTINCT base_unit_id),
   count(*) FILTER (WHERE NOT is_active),
   count(*) FILTER (WHERE base_unit_id IS NULL),
   count(*) FILTER (WHERE last_purchase_unit_cost_base IS NULL OR last_purchase_unit_cost_base<=0),
   min(last_purchase_unit_cost_base) FILTER (WHERE last_purchase_unit_cost_base>0),
   max(last_purchase_unit_cost_base) FILTER (WHERE last_purchase_unit_cost_base>0),
   count(*) FILTER (WHERE price_usd_v110 IS NULL OR price_usd_v110<=0),
   min(price_usd_v110) FILTER (WHERE price_usd_v110>0),
   max(price_usd_v110) FILTER (WHERE price_usd_v110>0)
 INTO v_count,v_units,v_missing,v_missing_unit,v_missing_base,v_min_base,v_max_base,
      v_missing_usd,v_min_usd,v_max_usd
 FROM public.materials WHERE id=ANY(p_members);
 IF v_count<>cardinality(p_members) OR v_missing>0 THEN RAISE EXCEPTION 'GROUP_MATERIAL_NOT_ACTIVE'; END IF;
 IF v_units<>1 OR v_missing_unit>0 THEN RAISE EXCEPTION 'GROUP_UNITS_MUST_MATCH'; END IF;
 IF EXISTS(SELECT 1 FROM public.material_group_members_v130 mg
    WHERE mg.material_id=ANY(p_members) AND mg.group_id IS DISTINCT FROM p_group_id)
 THEN RAISE EXCEPTION 'GROUP_MATERIAL_ALREADY_ASSIGNED'; END IF;
 IF EXISTS(SELECT 1 FROM public.material_groups_v130 g
    WHERE public.material_alias_normalize_v106(g.name)=public.material_alias_normalize_v106(p_name)
      AND g.id IS DISTINCT FROM p_group_id)
 THEN RAISE EXCEPTION 'GROUP_NAME_ALREADY_USED'; END IF;
 v_warning:=(v_missing_base>0 OR coalesce(v_max_base-v_min_base,0)>0.0001
             OR (v_missing_usd=0 AND coalesce(v_max_usd-v_min_usd,0)>0.0001));
 IF v_warning AND NOT coalesce(p_accept_price_warning,false)
 THEN RAISE EXCEPTION 'GROUP_PRICE_WARNING_CONFIRMATION_REQUIRED'; END IF;
 IF p_group_id IS NULL THEN
    INSERT INTO public.material_groups_v130(name) VALUES (btrim(p_name)) RETURNING id INTO v_id;
 ELSE
    v_id:=p_group_id;
    UPDATE public.material_groups_v130 SET name=btrim(p_name),updated_at=now() WHERE id=v_id;
    DELETE FROM public.material_group_members_v130 WHERE group_id=v_id;
 END IF;
 INSERT INTO public.material_group_members_v130(group_id,material_id,priority)
 SELECT v_id,u.material_id,u.pos::integer
 FROM unnest(p_members) WITH ORDINALITY AS u(material_id,pos);
 RETURN jsonb_build_object('groupId',v_id,'members',cardinality(p_members),
   'priceWarningAcknowledged',v_warning);
END;
$save$;

CREATE OR REPLACE FUNCTION public.material_group_delete_v130(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $delete$
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-config-v130',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-v130:'||p_group_id::text,0));
 DELETE FROM public.material_groups_v130 WHERE id=p_group_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_FOUND'; END IF;
END;
$delete$;

-- Returns the exact physical materials to issue. Called from order/event posting in the
-- SAME database transaction; advisory and row locks prevent concurrent overdraw.
-- Requested item FIRST, then remaining group members by accountant-defined priority.
CREATE OR REPLACE FUNCTION public.material_consumption_plan_v130(
 p_requested uuid,p_quantity numeric,p_at timestamptz)
RETURNS TABLE(actual_material_id uuid,issued_base numeric,unit_cost_base numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $plan$
DECLARE v_group uuid;v_left numeric;v_take numeric;v_row record;v_unit uuid;
BEGIN
 IF NOT public.is_app_owner() THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_quantity IS NULL OR p_quantity<=0 OR p_quantity>10000000000
 THEN RAISE EXCEPTION 'GROUP_INVALID_CONSUMPTION_QUANTITY'; END IF;
 PERFORM 1 FROM public.materials WHERE id=p_requested AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'MATERIAL_NOT_ACTIVE'; END IF;
 SELECT group_id INTO v_group FROM public.material_group_members_v130 WHERE material_id=p_requested;
 IF v_group IS NULL THEN
   -- Keep the application's previous behaviour for materials not in any group.
   actual_material_id:=p_requested;issued_base:=p_quantity;
   unit_cost_base:=public.get_material_cost_at(p_requested,p_at);RETURN NEXT;RETURN;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('maria-material-group-v130:'||v_group::text,0));
 v_left:=p_quantity;
 FOR v_row IN
   SELECT m.id,m.current_stock_base,m.base_unit_id,m.is_active
   FROM public.material_group_members_v130 gm
   JOIN public.materials m ON m.id=gm.material_id
   WHERE gm.group_id=v_group
   ORDER BY CASE WHEN m.id=p_requested THEN 0 ELSE 1 END,gm.priority,m.id
   FOR UPDATE OF m
 LOOP
   IF NOT v_row.is_active THEN RAISE EXCEPTION 'GROUP_MATERIAL_NOT_ACTIVE'; END IF;
   IF v_unit IS NULL THEN v_unit:=v_row.base_unit_id;
   ELSIF v_row.base_unit_id<>v_unit THEN RAISE EXCEPTION 'GROUP_UNITS_MUST_MATCH'; END IF;
   v_take:=least(v_left,greatest(coalesce(v_row.current_stock_base,0),0));
   IF v_take>0 THEN
     actual_material_id:=v_row.id;issued_base:=v_take;
     unit_cost_base:=public.get_material_cost_at(v_row.id,p_at);
     RETURN NEXT;
     v_left:=v_left-v_take;
   END IF;
   EXIT WHEN v_left<=0.00000001;
 END LOOP;
 IF v_left>0.00000001 THEN
   RAISE EXCEPTION 'GROUP_STOCK_INSUFFICIENT: missing % units',round(v_left,6);
 END IF;
END;
$plan$;

-- Replaces ONLY these two consumption routines. Preserves all existing financial posting logic.
CREATE OR REPLACE FUNCTION public.post_order(p_order_id uuid, p_auto_record_payment boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_order public.orders%rowtype;

    v_item record;
    v_recipe record;
    v_alloc record;

    v_recipe_count integer;

    v_material_cost numeric;
    v_total_material_quantity numeric;

    v_snapshot_id uuid;
    v_inventory_movement_id uuid;

    v_item_known_cost numeric;
    v_item_missing_cost boolean;

    v_gross numeric;
    v_discount numeric;
    v_complimentary numeric;
    v_net numeric;

    v_known_cost numeric;
    v_has_incomplete boolean;

    v_payment_id uuid;
    v_cash_transaction_id uuid;
begin

    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;


    select *
    into v_order
    from public.orders
    where id = p_order_id
    for update;


    if not found then
        raise exception 'Order not found';
    end if;


    if v_order.status <> 'draft' then
        raise exception
            'Only draft orders can be posted';
    end if;


    if v_order.cashbox_id is null then
        raise exception
            'Cashbox must be selected before posting the order';
    end if;


    if not exists (
        select 1
        from public.order_items
        where order_id = p_order_id
    ) then

        raise exception
            'Order must contain at least one item';

    end if;


    -- لا نعتمد سطر OCR لم يتم التعرف عليه بعد
    if exists (
        select 1
        from public.order_items
        where order_id = p_order_id
          and menu_item_id is null
    ) then

        raise exception
            'Order contains unmatched OCR items';

    end if;


    -- =====================================================
    -- تفكيك كل صنف إلى مواده
    -- =====================================================

    for v_item in

        select *
        from public.order_items
        where order_id = p_order_id
        order by created_at

    loop

        v_item_known_cost := 0;
        v_item_missing_cost := false;


        select count(*)
        into v_recipe_count
        from public.menu_item_recipe_items
        where menu_item_id =
            v_item.menu_item_id;


        -- صنف بلا وصفة:
        -- نسمح ببيعه ولكن نعتبر تكلفته ناقصة.
        if v_recipe_count = 0 then

            v_item_missing_cost := true;

        else

            for v_recipe in

                select *
                from public.menu_item_recipe_items
                where menu_item_id =
                    v_item.menu_item_id

            loop

                v_total_material_quantity :=
                    round(
                        v_recipe.quantity_base
                        * v_item.quantity,
                        8
                    );


                -- Actual FIFO-by-priority depletion of merged materials.
                -- Each source has a separate snapshot so refunds restore the correct SKU.
                for v_alloc in
                    select * from public.material_consumption_plan_v130(
                        v_recipe.material_id, v_total_material_quantity, v_order.occurred_at)
                loop
                    v_material_cost := v_alloc.unit_cost_base;
                    if v_material_cost is null then
                        v_item_missing_cost := true;
                    else
                        v_item_known_cost := v_item_known_cost
                            + (v_alloc.issued_base * v_material_cost);
                    end if;

                    v_snapshot_id := gen_random_uuid();
                    insert into public.order_item_materials (
                        id, order_item_id, material_id, quantity_per_item_base,
                        total_quantity_base, unit_cost_base_snapshot, requested_material_id_v130
                    ) values (
                        v_snapshot_id, v_item.id, v_alloc.actual_material_id,
                        round(v_alloc.issued_base / v_item.quantity, 8),
                        v_alloc.issued_base, v_material_cost, v_recipe.material_id
                    );
                    v_inventory_movement_id := public.record_inventory_movement(
                        v_alloc.actual_material_id, 'sale', -v_alloc.issued_base,
                        v_material_cost, v_order.occurred_at, 'order',
                        p_order_id, v_snapshot_id, 'Restaurant order consumption (merged material)'
                    );
                    update public.order_item_materials
                    set inventory_movement_id = v_inventory_movement_id
                    where id = v_snapshot_id;
                end loop;

            end loop;

        end if;


        update public.order_items
        set
            known_cost_total_base =
                round(v_item_known_cost, 4),

            has_incomplete_cost =
                v_item_missing_cost

        where id = v_item.id;

    end loop;


    -- =====================================================
    -- إجماليات الأوردر
    -- =====================================================

    select
        coalesce(sum(line_gross_original), 0),
        coalesce(sum(discount_original), 0),
        coalesce(sum(complimentary_value_original), 0),
        coalesce(sum(line_net_original), 0),
        coalesce(sum(known_cost_total_base), 0),
        coalesce(bool_or(has_incomplete_cost), false)

    into
        v_gross,
        v_discount,
        v_complimentary,
        v_net,
        v_known_cost,
        v_has_incomplete

    from public.order_items

    where order_id = p_order_id;


    update public.orders
    set
        gross_total_original =
            v_gross,

        discount_total_original =
            v_discount,

        complimentary_total_original =
            v_complimentary,

        net_total_original =
            v_net,

        known_cost_total_base =
            round(v_known_cost, 4),

        has_incomplete_cost =
            v_has_incomplete,

        status = 'posted',

        posted_at = now()

    where id = p_order_id;


    -- =====================================================
    -- تحصيل المال
    --
    -- إذا الأوردر كله ضيافة:
    -- المبلغ = صفر ولا توجد حركة نقدية.
    -- =====================================================

    if p_auto_record_payment
       and v_net > 0 then

        v_payment_id :=
            gen_random_uuid();


        v_cash_transaction_id :=
            public.record_cashbox_transaction(
                v_order.cashbox_id,
                'in',
                'sale',
                v_net,
                v_order.currency_code,
                v_order.occurred_at,
                coalesce(
                    'Order '
                    || v_order.external_order_number,
                    'Restaurant sale'
                ),
                'order_payment',
                v_payment_id
            );


        insert into public.order_payments (
            id,
            order_id,
            cashbox_id,
            cashbox_transaction_id,
            currency_code,
            amount_original,
            exchange_rate_to_base,
            occurred_at
        )
        values (
            v_payment_id,
            p_order_id,
            v_order.cashbox_id,
            v_cash_transaction_id,
            v_order.currency_code,
            v_net,
            v_order.exchange_rate_to_base,
            v_order.occurred_at
        );

    end if;

end;
$function$;

CREATE OR REPLACE FUNCTION public.post_event_food_consumption(p_event_id uuid, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_event public.events%rowtype;

    v_posting_id uuid;
    v_item_id uuid;
    v_material_snapshot_id uuid;

    v_menu record;
    v_recipe record;
    v_alloc record;

    v_recipe_count integer;

    v_total_quantity numeric;
    v_material_cost numeric;

    v_item_known_cost numeric;
    v_item_missing_cost boolean;

    v_inventory_movement_id uuid;

    v_timezone text;
    v_occurred_at timestamptz;
begin

    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;


    select *
    into v_event

    from public.events

    where id =
        p_event_id

    for update;


    if not found then

        raise exception
            'Event not found';

    end if;


    if v_event.status =
       'cancelled' then

        raise exception
            'Cancelled event cannot post food consumption';

    end if;


    if v_event.revenue_mode =
       'orders' then

        raise exception
            'Order-based event food is consumed through restaurant orders';

    end if;


    -- =====================================================
    -- Idempotency
    -- =====================================================

    select id
    into v_posting_id

    from public.event_food_postings

    where event_id =
            p_event_id

      and status =
            'posted'

    limit 1;


    if v_posting_id
       is not null then

        return v_posting_id;

    end if;


    select timezone
    into v_timezone

    from public.app_settings

    where id = 1;


    v_occurred_at :=
        coalesce(
            p_occurred_at,

            v_event.start_at,

            (
                v_event.event_date::timestamp
                +
                interval '12 hours'
            )
            at time zone v_timezone
        );


    insert into public.event_food_postings (
        event_id,
        occurred_at,
        note
    )
    values (
        p_event_id,
        v_occurred_at,
        p_note
    )

    returning id
    into v_posting_id;


    -- =====================================================
    -- نجمع كل Rules الخاصة بنفس الوجبة
    -- قبل تثبيتها.
    -- =====================================================

    for v_menu in

        select

            eamr.menu_item_id,

            max(
                eamr.menu_item_name
            ) as menu_item_name,

            sum(
                eamr.estimated_actual_quantity
            ) as estimated_actual_quantity

        from
            public.event_actual_menu_requirements
            eamr

        where eamr.event_id =
                p_event_id

        group by
            eamr.menu_item_id

        having
            sum(
                eamr.estimated_actual_quantity
            ) > 0

        order by
            eamr.menu_item_id

    loop

        v_item_known_cost := 0;
        v_item_missing_cost := false;


        insert into
        public.event_food_posting_items (
            posting_id,
            event_id,
            menu_item_id,
            menu_item_name_snapshot,
            quantity
        )
        values (
            v_posting_id,
            p_event_id,
            v_menu.menu_item_id,
            v_menu.menu_item_name,
            v_menu.estimated_actual_quantity
        )

        returning id
        into v_item_id;


        select count(*)

        into v_recipe_count

        from public.menu_item_recipe_items

        where menu_item_id =
            v_menu.menu_item_id;


        -- =================================================
        -- وجبة بلا وصفة
        -- =================================================

        if v_recipe_count = 0 then

            v_item_missing_cost :=
                true;


        else

            for v_recipe in

                select *

                from public.menu_item_recipe_items

                where menu_item_id =
                    v_menu.menu_item_id

            loop

                v_total_quantity :=
                    round(
                        v_recipe.quantity_base
                        *
                        v_menu.estimated_actual_quantity,
                        8
                    );


                for v_alloc in
                    select * from public.material_consumption_plan_v130(
                        v_recipe.material_id, v_total_quantity, v_occurred_at)
                loop
                    v_material_cost := v_alloc.unit_cost_base;
                    if v_material_cost is null then
                        v_item_missing_cost := true;
                    else
                        v_item_known_cost := v_item_known_cost
                            + (v_alloc.issued_base * v_material_cost);
                    end if;
                    v_material_snapshot_id := gen_random_uuid();
                    insert into public.event_food_posting_materials (
                        id, posting_item_id, material_id, quantity_per_menu_item_base,
                        total_quantity_base, unit_cost_base_snapshot, requested_material_id_v130
                    ) values (
                        v_material_snapshot_id, v_item_id, v_alloc.actual_material_id,
                        round(v_alloc.issued_base / v_menu.estimated_actual_quantity, 8),
                        v_alloc.issued_base, v_material_cost, v_recipe.material_id
                    );
                    v_inventory_movement_id := public.record_inventory_movement(
                        v_alloc.actual_material_id, 'event', -v_alloc.issued_base,
                        v_material_cost, v_occurred_at, 'event_food',
                        p_event_id, v_material_snapshot_id, 'Event food consumption (merged material)'
                    );
                    update public.event_food_posting_materials
                    set inventory_movement_id=v_inventory_movement_id
                    where id=v_material_snapshot_id;
                end loop;

            end loop;

        end if;


        update
            public.event_food_posting_items

        set

            known_cost_base =
                round(
                    v_item_known_cost,
                    4
                ),

            has_incomplete_cost =
                v_item_missing_cost

        where id =
            v_item_id;

    end loop;


    return v_posting_id;

end;
$function$;

REVOKE ALL ON FUNCTION public.material_group_save_v130(uuid,text,uuid[],boolean),
 public.material_group_delete_v130(uuid),
 public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.material_group_save_v130(uuid,text,uuid[],boolean),
 public.material_group_delete_v130(uuid),
 public.material_consumption_plan_v130(uuid,numeric,timestamp with time zone) TO authenticated;

COMMIT;
