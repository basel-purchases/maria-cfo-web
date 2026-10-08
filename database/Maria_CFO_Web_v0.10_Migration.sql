begin;


-- =========================================================


-- Maria CFO Web v0.10


-- Purchases UX + supplier catalog + safe draft/item editing


-- + posted invoice void with inventory reversal.


-- =========================================================


alter table public.purchase_invoices


  add column if not exists is_voided boolean not null default false,


  add column if not exists voided_at timestamptz,


  add column if not exists void_reason text,


  add column if not exists voided_original_total numeric;


-- ---------------------------------------------------------


-- Refresh draft invoice total after item edits.


-- ---------------------------------------------------------


create or replace function public.refresh_purchase_invoice_totals_v010(


    p_invoice_id uuid


)


returns void


language plpgsql


security definer


set search_path = ''


as $$


declare


    v_subtotal numeric;


    v_discount numeric;


begin


    select


        coalesce(sum(coalesce(quantity_purchase_unit,0) * coalesce(unit_price_original,0)),0),


        coalesce(sum(coalesce(line_discount_original,0)),0)


    into v_subtotal, v_discount


    from public.purchase_invoice_items


    where invoice_id = p_invoice_id;


    update public.purchase_invoices


    set total_original = greatest(v_subtotal - v_discount, 0)


    where id = p_invoice_id


      and status = 'draft';


    -- Keep optional snapshot columns in sync when they exist.


    if exists (


        select 1 from information_schema.columns


        where table_schema='public' and table_name='purchase_invoices' and column_name='subtotal_original'


    ) then


        execute 'update public.purchase_invoices set subtotal_original=$1 where id=$2 and status=''draft'''


        using v_subtotal, p_invoice_id;


    end if;


    if exists (


        select 1 from information_schema.columns


        where table_schema='public' and table_name='purchase_invoices' and column_name='discount_total_original'


    ) then


        execute 'update public.purchase_invoices set discount_total_original=$1 where id=$2 and status=''draft'''


        using v_discount, p_invoice_id;


    end if;


end;


$$;


revoke all on function public.refresh_purchase_invoice_totals_v010(uuid) from public;


grant execute on function public.refresh_purchase_invoice_totals_v010(uuid) to authenticated;


-- ---------------------------------------------------------


-- Add purchase item using any material conversion configured.


-- ---------------------------------------------------------


create or replace function public.add_purchase_invoice_item(


    p_invoice_id uuid,


    p_material_id uuid,


    p_purchase_unit_id uuid,


    p_quantity numeric,


    p_unit_price_original numeric,


    p_line_discount_original numeric default 0,


    p_ai_confidence numeric default null,


    p_notes text default null


)


returns uuid


language plpgsql


security definer


set search_path = ''


as $$


declare


    v_item_id uuid;


    v_status text;


    v_base_unit_id uuid;


    v_conversion numeric;


begin


    if not public.is_app_owner() then raise exception 'Access denied'; end if;


    if p_quantity is null or p_quantity <= 0 then raise exception 'Purchase quantity must be greater than zero'; end if;


    if p_unit_price_original is null or p_unit_price_original < 0 then raise exception 'Purchase unit price cannot be negative'; end if;


    select status into v_status from public.purchase_invoices where id=p_invoice_id;


    if v_status is null then raise exception 'Invoice not found'; end if;


    if v_status <> 'draft' then raise exception 'Only draft invoices can be edited'; end if;


    select base_unit_id into v_base_unit_id


    from public.materials


    where id=p_material_id and is_active=true;


    if v_base_unit_id is null then raise exception 'Material not found'; end if;


    if p_purchase_unit_id = v_base_unit_id then


        v_conversion := 1;


    else


        select mu.quantity_in_base into v_conversion


        from public.material_units mu


        where mu.material_id=p_material_id


          and mu.unit_id=p_purchase_unit_id


          and mu.quantity_in_base>0


        order by mu.id


        limit 1;


    end if;


    if v_conversion is null or v_conversion <= 0 then raise exception 'Purchase unit conversion not configured'; end if;


    insert into public.purchase_invoice_items(


        invoice_id,material_id,purchase_unit_id,quantity_purchase_unit,


        conversion_to_base,unit_price_original,line_discount_original,


        ai_confidence,notes


    ) values (


        p_invoice_id,p_material_id,p_purchase_unit_id,p_quantity,


        v_conversion,p_unit_price_original,coalesce(p_line_discount_original,0),


        p_ai_confidence,p_notes


    ) returning id into v_item_id;


    perform public.refresh_purchase_invoice_totals_v010(p_invoice_id);


    return v_item_id;


end;


$$;


revoke all on function public.add_purchase_invoice_item(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text) from public;


grant execute on function public.add_purchase_invoice_item(uuid,uuid,uuid,numeric,numeric,numeric,numeric,text) to authenticated;


-- ---------------------------------------------------------


-- Edit/delete draft items.


-- ---------------------------------------------------------


create or replace function public.update_purchase_invoice_item_v010(


    p_item_id uuid,


    p_purchase_unit_id uuid,


    p_quantity numeric,


    p_unit_price_original numeric,


    p_line_discount_original numeric default 0


)


returns uuid


language plpgsql


security definer


set search_path = ''


as $$


declare


    v_item public.purchase_invoice_items%rowtype;


    v_status text;


    v_base_unit_id uuid;


    v_conversion numeric;


begin


    if not public.is_app_owner() then raise exception 'Access denied'; end if;


    if p_quantity is null or p_quantity <= 0 then raise exception 'Purchase quantity must be greater than zero'; end if;


    if p_unit_price_original is null or p_unit_price_original < 0 then raise exception 'Purchase unit price cannot be negative'; end if;


    select * into v_item from public.purchase_invoice_items where id=p_item_id;


    if not found then raise exception 'Purchase item not found'; end if;


    select status into v_status from public.purchase_invoices where id=v_item.invoice_id;


    if v_status <> 'draft' then raise exception 'Only draft invoices can be edited'; end if;


    select base_unit_id into v_base_unit_id from public.materials where id=v_item.material_id;


    if p_purchase_unit_id=v_base_unit_id then v_conversion:=1;


    else


        select quantity_in_base into v_conversion


        from public.material_units


        where material_id=v_item.material_id and unit_id=p_purchase_unit_id and quantity_in_base>0


        order by id limit 1;


    end if;


    if v_conversion is null or v_conversion<=0 then raise exception 'Purchase unit conversion not configured'; end if;


    update public.purchase_invoice_items


    set purchase_unit_id=p_purchase_unit_id,


        quantity_purchase_unit=p_quantity,


        conversion_to_base=v_conversion,


        unit_price_original=p_unit_price_original,


        line_discount_original=coalesce(p_line_discount_original,0)


    where id=p_item_id;


    perform public.refresh_purchase_invoice_totals_v010(v_item.invoice_id);


    return p_item_id;


end;


$$;


revoke all on function public.update_purchase_invoice_item_v010(uuid,uuid,numeric,numeric,numeric) from public;


grant execute on function public.update_purchase_invoice_item_v010(uuid,uuid,numeric,numeric,numeric) to authenticated;


create or replace function public.delete_purchase_invoice_item_v010(p_item_id uuid)


returns boolean


language plpgsql


security definer


set search_path = ''


as $$


declare


    v_invoice_id uuid;


    v_status text;


begin


    if not public.is_app_owner() then raise exception 'Access denied'; end if;


    select invoice_id into v_invoice_id from public.purchase_invoice_items where id=p_item_id;


    if v_invoice_id is null then return false; end if;


    select status into v_status from public.purchase_invoices where id=v_invoice_id;


    if v_status <> 'draft' then raise exception 'Only draft invoices can be edited'; end if;


    delete from public.purchase_invoice_items where id=p_item_id;


    perform public.refresh_purchase_invoice_totals_v010(v_invoice_id);


    return true;


end;


$$;


revoke all on function public.delete_purchase_invoice_item_v010(uuid) from public;


grant execute on function public.delete_purchase_invoice_item_v010(uuid) to authenticated;


create or replace function public.delete_purchase_invoice_draft_v010(p_invoice_id uuid)


returns boolean


language plpgsql


security definer


set search_path = ''


as $$


declare v_status text;


begin


    if not public.is_app_owner() then raise exception 'Access denied'; end if;


    select status into v_status from public.purchase_invoices where id=p_invoice_id for update;


    if v_status is null then return false; end if;


    if v_status <> 'draft' then raise exception 'ONLY_DRAFT_INVOICE_CAN_BE_DELETED'; end if;


    delete from public.purchase_invoice_items where invoice_id=p_invoice_id;


    delete from public.purchase_invoices where id=p_invoice_id;


    return true;


end;


$$;


revoke all on function public.delete_purchase_invoice_draft_v010(uuid) from public;


grant execute on function public.delete_purchase_invoice_draft_v010(uuid) to authenticated;


-- ---------------------------------------------------------


-- Supplier material catalog: cumulative history, one latest


-- row per material for this supplier (not only last invoice).


-- ---------------------------------------------------------


create or replace function public.get_supplier_purchase_catalog_v010(


    p_supplier_id uuid


)


returns table(


    material_id uuid,


    material_name text,


    material_code text,


    purchase_unit_id uuid,


    quantity_purchase_unit numeric,


    unit_price_original numeric,


    line_discount_original numeric,


    last_purchased_at timestamptz


)


language sql


security definer


stable


set search_path = ''


as $$


    select distinct on (pii.material_id)


        pii.material_id,


        m.name::text as material_name,


        coalesce(to_jsonb(m)->>'quick_code', to_jsonb(m)->>'code')::text as material_code,


        pii.purchase_unit_id,


        pii.quantity_purchase_unit,


        pii.unit_price_original,


        coalesce(pii.line_discount_original,0),


        pi.occurred_at


    from public.purchase_invoices pi


    join public.purchase_invoice_items pii on pii.invoice_id=pi.id


    join public.materials m on m.id=pii.material_id


    where pi.supplier_id=p_supplier_id


      and pi.status='posted'


      and coalesce(pi.is_voided,false)=false


      and m.is_active=true


    order by pii.material_id, pi.occurred_at desc, pii.id desc;


$$;


revoke all on function public.get_supplier_purchase_catalog_v010(uuid) from public;


grant execute on function public.get_supplier_purchase_catalog_v010(uuid) to authenticated;


-- ---------------------------------------------------------


-- Void posted purchase without destroying history.


-- We preserve original items and amount, create opposite


-- inventory movements, and zero the live payable total.


-- ---------------------------------------------------------


create or replace function public.void_purchase_invoice_v010(


    p_invoice_id uuid,


    p_reason text default null


)


returns boolean


language plpgsql


security definer


set search_path = ''


as $$


declare


    v_invoice public.purchase_invoices%rowtype;


    v_move record;


    v_has_payment boolean := false;


    v_material_id uuid;


begin


    if not public.is_app_owner() then raise exception 'Access denied'; end if;


    select * into v_invoice from public.purchase_invoices where id=p_invoice_id for update;


    if not found then raise exception 'Invoice not found'; end if;


    if coalesce(v_invoice.is_voided,false) then raise exception 'PURCHASE_INVOICE_ALREADY_VOIDED'; end if;


    if v_invoice.status <> 'posted' then raise exception 'Only posted invoices can be voided'; end if;


    if exists (


        select 1 from information_schema.columns


        where table_schema='public' and table_name='supplier_payment_allocations' and column_name='invoice_id'


    ) then


        execute 'select exists(select 1 from public.supplier_payment_allocations where invoice_id=$1)'


        into v_has_payment using p_invoice_id;


    elsif exists (


        select 1 from information_schema.columns


        where table_schema='public' and table_name='supplier_payment_allocations' and column_name='purchase_invoice_id'


    ) then


        execute 'select exists(select 1 from public.supplier_payment_allocations where purchase_invoice_id=$1)'


        into v_has_payment using p_invoice_id;


    end if;


    if v_has_payment then raise exception 'PURCHASE_INVOICE_HAS_PAYMENTS'; end if;


    for v_move in


        select id,material_id,quantity_delta_base,unit_cost_base_per_base_unit


        from public.inventory_movements


        where reference_type='purchase_invoice'


          and reference_id=p_invoice_id


          and movement_type='purchase'


          and quantity_delta_base>0


    loop


        perform public.record_inventory_movement(


            v_move.material_id,


            'adjustment_out',


            -abs(v_move.quantity_delta_base),


            v_move.unit_cost_base_per_base_unit,


            now(),


            'purchase_void',


            p_invoice_id,


            v_move.id,


            coalesce(p_reason,'إلغاء فاتورة شراء منشورة')


        );


    end loop;


    update public.purchase_invoices


    set is_voided=true,


        voided_at=now(),


        void_reason=nullif(trim(coalesce(p_reason,'')),''),


        voided_original_total=total_original,


        total_original=0


    where id=p_invoice_id;


    for v_material_id in


        select distinct material_id from public.purchase_invoice_items where invoice_id=p_invoice_id


    loop


        begin


            perform public.repair_material_latest_purchase_snapshot(v_material_id);


        exception when undefined_function then


            null;


        end;


    end loop;


    return true;


end;


$$;


revoke all on function public.void_purchase_invoice_v010(uuid,text) from public;


grant execute on function public.void_purchase_invoice_v010(uuid,text) to authenticated;


-- ---------------------------------------------------------


-- Historical material cost: ignore voided purchase invoices.


-- ---------------------------------------------------------


create or replace function public.get_material_cost_at(


    p_material_id uuid,


    p_at timestamptz


)


returns numeric


language plpgsql


security definer


stable


set search_path = ''


as $$


declare v_cost numeric;


begin


    select im.unit_cost_base_per_base_unit into v_cost


    from public.inventory_movements im


    where im.material_id=p_material_id


      and im.movement_type='purchase'


      and im.quantity_delta_base>0


      and im.unit_cost_base_per_base_unit is not null


      and im.occurred_at<=p_at


      and not (


          im.reference_type='purchase_invoice'


          and exists (


              select 1 from public.purchase_invoices pi


              where pi.id=im.reference_id and coalesce(pi.is_voided,false)=true


          )


      )


    order by im.occurred_at desc, im.created_at desc, im.id::text desc


    limit 1;


    if v_cost is not null then return v_cost; end if;


    select im.unit_cost_base_per_base_unit into v_cost


    from public.inventory_movements im


    where im.material_id=p_material_id


      and im.movement_type in ('opening','adjustment_in')


      and im.quantity_delta_base>0


      and im.unit_cost_base_per_base_unit is not null


      and im.occurred_at<=p_at


    order by im.occurred_at desc, im.created_at desc, im.id::text desc


    limit 1;


    return v_cost;


end;


$$;


revoke all on function public.get_material_cost_at(uuid,timestamptz) from public;


grant execute on function public.get_material_cost_at(uuid,timestamptz) to authenticated;


commit;


notify pgrst, 'reload schema';
