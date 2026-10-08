begin;

-- =========================================================
-- Maria CFO Web v0.9
-- توحيد تحويلات المادة للشراء والوصفة.
--
-- سابقًا كانت add_purchase_invoice_item تشترط:
-- material_units.is_purchase_unit = true
-- بينما الواجهة الجديدة تتعامل مع التحويل كعلاقة واحدة للمادة
-- يمكن استخدامها في الشراء أو الوصفة.
--
-- بعد هذا التحديث يكفي وجود تحويل صحيح للمادة والوحدة.
-- =========================================================

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
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    if p_quantity is null or p_quantity <= 0 then
        raise exception 'Purchase quantity must be greater than zero';
    end if;

    if p_unit_price_original is null or p_unit_price_original < 0 then
        raise exception 'Purchase unit price cannot be negative';
    end if;

    select status
    into v_status
    from public.purchase_invoices
    where id = p_invoice_id;

    if v_status is null then
        raise exception 'Invoice not found';
    end if;

    if v_status <> 'draft' then
        raise exception 'Only draft invoices can be edited';
    end if;

    select base_unit_id
    into v_base_unit_id
    from public.materials
    where id = p_material_id
      and is_active = true;

    if v_base_unit_id is null then
        raise exception 'Material not found';
    end if;

    if p_purchase_unit_id = v_base_unit_id then
        v_conversion := 1;
    else
        select mu.quantity_in_base
        into v_conversion
        from public.material_units mu
        where mu.material_id = p_material_id
          and mu.unit_id = p_purchase_unit_id
          and mu.quantity_in_base > 0
        order by mu.id
        limit 1;
    end if;

    if v_conversion is null or v_conversion <= 0 then
        raise exception 'Purchase unit conversion not configured';
    end if;

    insert into public.purchase_invoice_items (
        invoice_id,
        material_id,
        purchase_unit_id,
        quantity_purchase_unit,
        conversion_to_base,
        unit_price_original,
        line_discount_original,
        ai_confidence,
        notes
    )
    values (
        p_invoice_id,
        p_material_id,
        p_purchase_unit_id,
        p_quantity,
        v_conversion,
        p_unit_price_original,
        coalesce(p_line_discount_original, 0),
        p_ai_confidence,
        p_notes
    )
    returning id into v_item_id;

    return v_item_id;
end;
$$;

revoke all
on function public.add_purchase_invoice_item(
    uuid, uuid, uuid, numeric, numeric, numeric, numeric, text
)
from public;

grant execute
on function public.add_purchase_invoice_item(
    uuid, uuid, uuid, numeric, numeric, numeric, numeric, text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
