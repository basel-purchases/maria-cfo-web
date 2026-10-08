begin;

-- =========================================================
-- Maria CFO Web v0.13
-- Orders compatibility + cashbox usability helpers.
-- =========================================================

-- ---------------------------------------------------------
-- Internal helper: make sure the cashbox session exists.
-- It adapts to the installed get_or_create_cashbox_session
-- signature by inspecting its named arguments at runtime.
-- ---------------------------------------------------------
create or replace function public.ensure_cashbox_session_v013(
    p_cashbox_id uuid,
    p_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_timezone text := 'UTC';
    v_business_date date;
    v_session_id uuid;
    v_candidate record;
    v_arg_name text;
    v_parts text[];
    v_required_count integer;
    v_known boolean;
    v_sql text;
    v_result_text text;
    v_last_error text;
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    select coalesce(nullif(to_jsonb(s)->>'timezone',''),'UTC')
    into v_timezone
    from public.app_settings s
    where id = 1;

    v_business_date := (coalesce(p_at, now()) at time zone v_timezone)::date;

    select cs.id
    into v_session_id
    from public.cashbox_sessions cs
    where cs.cashbox_id = p_cashbox_id
      and cs.business_date = v_business_date
    order by cs.id
    limit 1;

    if v_session_id is null then
        for v_candidate in
            select p.oid, p.proargnames, p.pronargs, p.pronargdefaults
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname = 'get_or_create_cashbox_session'
            order by p.pronargs desc, p.oid
        loop
            v_parts := array[]::text[];
            v_known := true;
            v_required_count := v_candidate.pronargs - v_candidate.pronargdefaults;

            if v_candidate.proargnames is null then
                continue;
            end if;

            for i in 1..v_candidate.pronargs loop
                v_arg_name := v_candidate.proargnames[i];
                case v_arg_name
                    when 'p_cashbox_id' then
                        v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_cashbox_id));
                    when 'p_business_date' then
                        v_parts := array_append(v_parts, format('%I => %L::date', v_arg_name, v_business_date));
                    when 'p_date' then
                        v_parts := array_append(v_parts, format('%I => %L::date', v_arg_name, v_business_date));
                    when 'p_occurred_at' then
                        v_parts := array_append(v_parts, format('%I => %L::timestamptz', v_arg_name, coalesce(p_at, now())));
                    when 'p_at' then
                        v_parts := array_append(v_parts, format('%I => %L::timestamptz', v_arg_name, coalesce(p_at, now())));
                    else
                        if i <= v_required_count then
                            v_known := false;
                            exit;
                        end if;
                end case;
            end loop;

            if not v_known then
                continue;
            end if;

            v_sql := format(
                'select public.get_or_create_cashbox_session(%s)::text',
                array_to_string(v_parts, ', ')
            );

            begin
                execute v_sql into v_result_text;
                if nullif(v_result_text,'') is not null then
                    begin
                        v_session_id := v_result_text::uuid;
                    exception when others then
                        v_session_id := null;
                    end;
                end if;

                if v_session_id is null then
                    select cs.id
                    into v_session_id
                    from public.cashbox_sessions cs
                    where cs.cashbox_id = p_cashbox_id
                      and cs.business_date = v_business_date
                    order by cs.id
                    limit 1;
                end if;

                exit when v_session_id is not null;
            exception when others then
                v_last_error := sqlerrm;
            end;
        end loop;
    end if;

    if v_session_id is null then
        raise exception 'CASHBOX_SESSION_CREATE_FAILED: %', coalesce(v_last_error,'No compatible get_or_create_cashbox_session signature was found');
    end if;

    -- Opening rows may already be created by the session helper. If a separate
    -- ensure function exists, invoke it with the signature installed here.
    for v_candidate in
        select p.oid, p.proargnames, p.pronargs, p.pronargdefaults
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'ensure_cashbox_session_openings'
        order by p.pronargs desc, p.oid
    loop
        v_parts := array[]::text[];
        v_known := true;
        v_required_count := v_candidate.pronargs - v_candidate.pronargdefaults;

        if v_candidate.proargnames is null then
            continue;
        end if;

        for i in 1..v_candidate.pronargs loop
            v_arg_name := v_candidate.proargnames[i];
            case v_arg_name
                when 'p_session_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, v_session_id));
                when 'p_cashbox_session_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, v_session_id));
                when 'p_cashbox_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_cashbox_id));
                when 'p_business_date' then
                    v_parts := array_append(v_parts, format('%I => %L::date', v_arg_name, v_business_date));
                when 'p_date' then
                    v_parts := array_append(v_parts, format('%I => %L::date', v_arg_name, v_business_date));
                else
                    if i <= v_required_count then
                        v_known := false;
                        exit;
                    end if;
            end case;
        end loop;

        if not v_known then
            continue;
        end if;

        begin
            v_sql := format(
                'select public.ensure_cashbox_session_openings(%s)',
                array_to_string(v_parts, ', ')
            );
            execute v_sql;
            exit;
        exception when others then
            null;
        end;
    end loop;

    return v_session_id;
end;
$$;

revoke all on function public.ensure_cashbox_session_v013(uuid,timestamptz) from public;
grant execute on function public.ensure_cashbox_session_v013(uuid,timestamptz) to authenticated;

-- ---------------------------------------------------------
-- Ensure today's sessions for all active cashboxes.
-- ---------------------------------------------------------
create or replace function public.ensure_cashbox_day_v013(
    p_business_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_box record;
    v_count integer := 0;
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    for v_box in
        select id
        from public.cashboxes
        where coalesce(is_active,true) = true
        order by display_order nulls last, id
    loop
        perform public.ensure_cashbox_session_v013(
            v_box.id,
            p_business_date::timestamp at time zone 'UTC'
        );
        v_count := v_count + 1;
    end loop;

    return v_count;
end;
$$;

revoke all on function public.ensure_cashbox_day_v013(date) from public;
grant execute on function public.ensure_cashbox_day_v013(date) to authenticated;

-- ---------------------------------------------------------
-- Cashbox overview. The existing summary view is preserved as
-- source of truth; JSON keeps this helper compatible with minor
-- column-name differences between database revisions.
-- ---------------------------------------------------------
create or replace function public.get_cashbox_overview_v013(
    p_business_date date default current_date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
    v_box record;
    v_session record;
    v_summary jsonb;
    v_result jsonb := '[]'::jsonb;
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    for v_box in
        select *
        from public.cashboxes
        order by display_order nulls last, id
    loop
        select *
        into v_session
        from public.cashbox_sessions cs
        where cs.cashbox_id = v_box.id
          and cs.business_date = p_business_date
        order by cs.id
        limit 1;

        v_summary := '{}'::jsonb;
        if found then
            begin
                select to_jsonb(x)
                into v_summary
                from public.cashbox_session_summary x
                where coalesce(
                    to_jsonb(x)->>'session_id',
                    to_jsonb(x)->>'cashbox_session_id',
                    to_jsonb(x)->>'id'
                ) = v_session.id::text
                limit 1;
            exception when undefined_table then
                v_summary := '{}'::jsonb;
            end;
        end if;

        v_result := v_result || jsonb_build_array(
            jsonb_build_object(
                'cashbox', to_jsonb(v_box),
                'session', case when v_session.id is null then null else to_jsonb(v_session) end,
                'summary', coalesce(v_summary,'{}'::jsonb)
            )
        );
    end loop;

    return v_result;
end;
$$;

revoke all on function public.get_cashbox_overview_v013(date) from public;
grant execute on function public.get_cashbox_overview_v013(date) to authenticated;

-- ---------------------------------------------------------
-- Explicit cashbox balance adjustment. This uses the protected
-- central cashbox ledger instead of direct table writes.
-- ---------------------------------------------------------
create or replace function public.record_cashbox_adjustment_v013(
    p_cashbox_id uuid,
    p_direction text,
    p_amount numeric,
    p_currency_code text default 'SYP',
    p_note text default null,
    p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
    v_direction text := lower(trim(coalesce(p_direction,'')));
    v_currency text := upper(trim(coalesce(p_currency_code,'SYP')));
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;
    if v_direction not in ('in','out') then
        raise exception 'INVALID_CASHBOX_ADJUSTMENT_DIRECTION';
    end if;
    if p_amount is null or p_amount <= 0 then
        raise exception 'CASHBOX_ADJUSTMENT_AMOUNT_REQUIRED';
    end if;

    perform public.ensure_cashbox_session_v013(p_cashbox_id, coalesce(p_occurred_at,now()));

    v_id := public.record_cashbox_transaction(
        p_cashbox_id,
        v_direction,
        'adjustment',
        p_amount,
        v_currency,
        coalesce(p_occurred_at,now()),
        coalesce(nullif(trim(p_note),''),'ضبط رصيد الصندوق'),
        'cashbox_adjustment',
        null
    );

    return v_id;
end;
$$;

revoke all on function public.record_cashbox_adjustment_v013(uuid,text,numeric,text,text,timestamptz) from public;
grant execute on function public.record_cashbox_adjustment_v013(uuid,text,numeric,text,text,timestamptz) to authenticated;

-- ---------------------------------------------------------
-- Order item compatibility adapter.
-- The historic database has had more than one add_order_item
-- signature. This adapter inspects the installed signature and
-- passes only arguments that actually exist.
-- ---------------------------------------------------------
create or replace function public.add_order_item_v013(
    p_order_id uuid,
    p_menu_item_id uuid,
    p_quantity numeric,
    p_unit_price_original numeric,
    p_discount_percent numeric default 0,
    p_raw_item_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_status text;
    v_candidate record;
    v_arg_name text;
    v_parts text[];
    v_required_count integer;
    v_known boolean;
    v_sql text;
    v_last_error text;
    v_adjustment_type text := case when coalesce(p_discount_percent,0) > 0 then 'percent' else 'none' end;
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'ORDER_ITEM_QUANTITY_REQUIRED';
    end if;
    if p_unit_price_original is null or p_unit_price_original < 0 then
        raise exception 'ORDER_ITEM_PRICE_INVALID';
    end if;
    if coalesce(p_discount_percent,0) < 0 or coalesce(p_discount_percent,0) > 100 then
        raise exception 'ORDER_ITEM_DISCOUNT_INVALID';
    end if;

    select status into v_status from public.orders where id = p_order_id;
    if v_status is null then
        raise exception 'ORDER_NOT_FOUND';
    end if;
    if v_status <> 'draft' then
        raise exception 'ORDER_NOT_DRAFT';
    end if;

    for v_candidate in
        select p.oid, p.proargnames, p.pronargs, p.pronargdefaults
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'add_order_item'
        order by p.pronargs desc, p.oid
    loop
        if v_candidate.proargnames is null then
            continue;
        end if;

        v_parts := array[]::text[];
        v_known := true;
        v_required_count := v_candidate.pronargs - v_candidate.pronargdefaults;

        for i in 1..v_candidate.pronargs loop
            v_arg_name := v_candidate.proargnames[i];
            case v_arg_name
                when 'p_order_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_order_id));
                when 'p_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_order_id));
                when 'p_menu_item_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_menu_item_id));
                when 'p_item_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_menu_item_id));
                when 'p_raw_item_name' then
                    v_parts := array_append(v_parts, format('%I => %L::text', v_arg_name, p_raw_item_name));
                when 'p_item_name' then
                    v_parts := array_append(v_parts, format('%I => %L::text', v_arg_name, p_raw_item_name));
                when 'p_quantity' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_quantity));
                when 'p_qty' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_quantity));
                when 'p_unit_price_original' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_unit_price_original));
                when 'p_unit_price' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_unit_price_original));
                when 'p_price_original' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_unit_price_original));
                when 'p_price' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, p_unit_price_original));
                when 'p_adjustment_type' then
                    v_parts := array_append(v_parts, format('%I => %L::text', v_arg_name, v_adjustment_type));
                when 'p_adjustment_value' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, coalesce(p_discount_percent,0)));
                when 'p_adjustment_reason_id' then
                    v_parts := array_append(v_parts, format('%I => null::uuid', v_arg_name));
                when 'p_discount_percent' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, coalesce(p_discount_percent,0)));
                when 'p_discount_percentage' then
                    v_parts := array_append(v_parts, format('%I => %L::numeric', v_arg_name, coalesce(p_discount_percent,0)));
                when 'p_note' then
                    v_parts := array_append(v_parts, format('%I => null::text', v_arg_name));
                when 'p_notes' then
                    v_parts := array_append(v_parts, format('%I => null::text', v_arg_name));
                when 'p_ai_confidence' then
                    v_parts := array_append(v_parts, format('%I => null::numeric', v_arg_name));
                when 'p_confidence' then
                    v_parts := array_append(v_parts, format('%I => null::numeric', v_arg_name));
                else
                    if i <= v_required_count then
                        v_known := false;
                        exit;
                    end if;
            end case;
        end loop;

        if not v_known then
            continue;
        end if;

        v_sql := format('select public.add_order_item(%s)', array_to_string(v_parts, ', '));
        begin
            execute v_sql;
            return true;
        exception when others then
            v_last_error := sqlerrm;
        end;
    end loop;

    raise exception 'ORDER_ITEM_COMPAT_FAILED: %', coalesce(v_last_error,'No compatible add_order_item signature was found');
end;
$$;

revoke all on function public.add_order_item_v013(uuid,uuid,numeric,numeric,numeric,text) from public;
grant execute on function public.add_order_item_v013(uuid,uuid,numeric,numeric,numeric,text) to authenticated;

-- ---------------------------------------------------------
-- Safe order posting wrapper. It makes sure the selected
-- cashbox has a session/openings before the historic post_order
-- function records the sale and inventory consumption.
-- ---------------------------------------------------------
create or replace function public.post_order_v013(
    p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_order jsonb;
    v_status text;
    v_cashbox_id uuid;
    v_occurred_at timestamptz;
    v_candidate record;
    v_arg_name text;
    v_parts text[];
    v_required_count integer;
    v_known boolean;
    v_sql text;
    v_last_error text;
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    select to_jsonb(o)
    into v_order
    from public.orders o
    where o.id = p_order_id;

    if v_order is null then
        raise exception 'ORDER_NOT_FOUND';
    end if;

    v_status := coalesce(v_order->>'status','');
    if v_status <> 'draft' then
        raise exception 'ORDER_NOT_DRAFT';
    end if;

    if not exists(select 1 from public.order_items oi where oi.order_id = p_order_id) then
        raise exception 'ORDER_HAS_NO_ITEMS';
    end if;

    v_cashbox_id := nullif(v_order->>'cashbox_id','')::uuid;
    if v_cashbox_id is null then
        raise exception 'ORDER_CASHBOX_REQUIRED';
    end if;

    begin
        v_occurred_at := nullif(v_order->>'occurred_at','')::timestamptz;
    exception when others then
        v_occurred_at := now();
    end;
    v_occurred_at := coalesce(v_occurred_at,now());

    perform public.ensure_cashbox_session_v013(v_cashbox_id,v_occurred_at);

    for v_candidate in
        select p.oid, p.proargnames, p.pronargs, p.pronargdefaults
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'post_order'
        order by p.pronargs desc, p.oid
    loop
        if v_candidate.proargnames is null then
            continue;
        end if;

        v_parts := array[]::text[];
        v_known := true;
        v_required_count := v_candidate.pronargs - v_candidate.pronargdefaults;

        for i in 1..v_candidate.pronargs loop
            v_arg_name := v_candidate.proargnames[i];
            case v_arg_name
                when 'p_order_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_order_id));
                when 'p_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, p_order_id));
                when 'p_cashbox_id' then
                    v_parts := array_append(v_parts, format('%I => %L::uuid', v_arg_name, v_cashbox_id));
                when 'p_occurred_at' then
                    v_parts := array_append(v_parts, format('%I => %L::timestamptz', v_arg_name, v_occurred_at));
                when 'p_posted_at' then
                    v_parts := array_append(v_parts, format('%I => %L::timestamptz', v_arg_name, now()));
                when 'p_note' then
                    v_parts := array_append(v_parts, format('%I => null::text', v_arg_name));
                when 'p_notes' then
                    v_parts := array_append(v_parts, format('%I => null::text', v_arg_name));
                else
                    if i <= v_required_count then
                        v_known := false;
                        exit;
                    end if;
            end case;
        end loop;

        if not v_known then
            continue;
        end if;

        v_sql := format('select public.post_order(%s)', array_to_string(v_parts, ', '));
        begin
            execute v_sql;
            select status into v_status from public.orders where id = p_order_id;
            if v_status <> 'posted' then
                raise exception 'ORDER_POST_NOT_CONFIRMED';
            end if;
            return true;
        exception when others then
            v_last_error := sqlerrm;
        end;
    end loop;

    raise exception 'ORDER_POST_FAILED: %', coalesce(v_last_error,'No compatible post_order signature was found');
end;
$$;

revoke all on function public.post_order_v013(uuid) from public;
grant execute on function public.post_order_v013(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
