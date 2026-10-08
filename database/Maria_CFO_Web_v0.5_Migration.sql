-- =========================================================
-- Maria CFO Web v0.5
-- Cumulative migration for v0.4 + v0.5
-- Safe to run more than once.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1) Default discount for menu items (from v0.4)
-- ---------------------------------------------------------

alter table public.menu_items
  add column if not exists default_discount_percent numeric;

update public.menu_items
set default_discount_percent = 0
where default_discount_percent is null;

alter table public.menu_items
  alter column default_discount_percent set default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'menu_items_default_discount_percent_check'
      and conrelid = 'public.menu_items'::regclass
  ) then
    alter table public.menu_items
      add constraint menu_items_default_discount_percent_check
      check (default_discount_percent >= 0 and default_discount_percent <= 100);
  end if;
end $$;

-- ---------------------------------------------------------
-- 2) Restaurant-friendly unit catalog (from v0.4)
-- ---------------------------------------------------------

do $$
declare
  has_unit_type boolean;
  r record;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='units'
      and column_name='unit_type'
  ) into has_unit_type;

  for r in
    select * from (values
      ('SACK',    'شوال',          'PCS'),
      ('CAN',     'علبة',          'PCS'),
      ('TIN',     'علبة معدنية',   'PCS'),
      ('SACHET',  'ظرف',           'PCS'),
      ('PACKET',  'باكيت',         'PCS'),
      ('CUP',     'كوب',           'PCS'),
      ('GLASS',   'كأس',           'PCS'),
      ('SPOON',   'ملعقة',         'PCS'),
      ('TBSP',    'ملعقة كبيرة',   'PCS'),
      ('TSP',     'ملعقة صغيرة',   'PCS'),
      ('SCOOP',   'مكيال',         'PCS'),
      ('BOWL',    'وعاء',          'PCS'),
      ('SLICE',   'شريحة',         'PCS'),
      ('PORTION', 'حصة',           'PCS'),
      ('SERVING', 'حصة تقديم',     'PCS'),
      ('BUNCH',   'ربطة',          'PCS'),
      ('BUNDLE',  'حزمة',          'PCS'),
      ('ROLL',    'رول',           'PCS'),
      ('SHEET',   'ورقة',          'PCS'),
      ('LOAF',    'رغيف',          'PCS'),
      ('JAR',     'مرطبان',        'PCS'),
      ('PAIL',    'سطل',           'PCS'),
      ('CRATE',   'قفص',           'PCS')
    ) v(code, name, template_code)
  loop
    if not exists (select 1 from public.units u where upper(u.code)=r.code) then
      if has_unit_type then
        execute format(
          'insert into public.units (code, name, unit_type)
           select %L, %L, u.unit_type
           from public.units u
           where upper(u.code)=%L
           limit 1',
          r.code, r.name, r.template_code
        );
      else
        execute format(
          'insert into public.units (code, name) values (%L, %L)',
          r.code, r.name
        );
      end if;
    end if;
  end loop;

  update public.units set name='كرتونة' where upper(code)='CARTON';
  update public.units set name='سفط'     where upper(code)='TRAY';
  update public.units set name='كيس'     where upper(code)='BAG';
  update public.units set name='علبة'    where upper(code)='CAN';
end $$;

-- ---------------------------------------------------------
-- 3) Preserve the unit and quantity that the user typed in
--    a recipe. The accounting engine still receives the
--    converted base-unit quantity.
-- ---------------------------------------------------------

alter table public.menu_item_recipe_items
  add column if not exists input_unit_id uuid references public.units(id),
  add column if not exists input_quantity numeric;

-- Backfill old recipe rows using the material base unit and
-- whichever base-quantity column exists in the live schema.
do $$
declare
  qty_col text;
begin
  select c.column_name
  into qty_col
  from information_schema.columns c
  where c.table_schema='public'
    and c.table_name='menu_item_recipe_items'
    and c.is_generated='NEVER'
    and c.column_name in ('quantity_base','quantity_in_base','base_quantity','quantity')
  order by case c.column_name
    when 'quantity_base' then 1
    when 'quantity_in_base' then 2
    when 'base_quantity' then 3
    when 'quantity' then 4
    else 99
  end
  limit 1;

  update public.menu_item_recipe_items ri
  set input_unit_id = coalesce(ri.input_unit_id, m.base_unit_id)
  from public.materials m
  where m.id = ri.material_id
    and ri.input_unit_id is null;

  if qty_col is not null then
    execute format(
      'update public.menu_item_recipe_items
       set input_quantity = %I
       where input_quantity is null',
      qty_col
    );
  end if;
end $$;

-- ---------------------------------------------------------
-- 4) Stable recipe RPC used by the website.
--    It adapts to the existing v1.0 recipe quantity column,
--    so the browser no longer guesses the table schema.
-- ---------------------------------------------------------

create or replace function public.save_menu_recipe_item(
  p_menu_item_id uuid,
  p_material_id uuid,
  p_input_unit_id uuid,
  p_input_quantity numeric,
  p_recipe_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_unit_id uuid;
  v_factor numeric;
  v_quantity_base numeric;
  v_id uuid;
  v_has_quantity_base boolean;
  v_has_quantity_in_base boolean;
  v_has_base_quantity boolean;
  v_has_quantity boolean;
  v_has_quantity_original boolean;
  v_has_unit_id boolean;
  v_cols text;
  v_vals text;
  v_sets text;
begin
  if not public.is_app_owner() then
    raise exception 'Access denied';
  end if;

  if p_input_quantity is null or p_input_quantity <= 0 then
    raise exception 'INVALID_RECIPE_QUANTITY';
  end if;

  select m.base_unit_id
  into v_base_unit_id
  from public.materials m
  where m.id = p_material_id;

  if v_base_unit_id is null then
    raise exception 'MATERIAL_BASE_UNIT_NOT_FOUND';
  end if;

  if p_input_unit_id = v_base_unit_id then
    v_factor := 1;
  else
    select mu.quantity_in_base
    into v_factor
    from public.material_units mu
    where mu.material_id = p_material_id
      and mu.unit_id = p_input_unit_id
    order by mu.id
    limit 1;
  end if;

  if v_factor is null or v_factor <= 0 then
    raise exception 'RECIPE_UNIT_NOT_CONFIGURED';
  end if;

  v_quantity_base := p_input_quantity * v_factor;

  select
    bool_or(column_name='quantity_base' and is_generated='NEVER'),
    bool_or(column_name='quantity_in_base' and is_generated='NEVER'),
    bool_or(column_name='base_quantity' and is_generated='NEVER'),
    bool_or(column_name='quantity' and is_generated='NEVER'),
    bool_or(column_name='quantity_original' and is_generated='NEVER'),
    bool_or(column_name='unit_id' and is_generated='NEVER')
  into
    v_has_quantity_base,
    v_has_quantity_in_base,
    v_has_base_quantity,
    v_has_quantity,
    v_has_quantity_original,
    v_has_unit_id
  from information_schema.columns
  where table_schema='public'
    and table_name='menu_item_recipe_items';

  if not coalesce(v_has_quantity_base,false)
     and not coalesce(v_has_quantity_in_base,false)
     and not coalesce(v_has_base_quantity,false)
     and not coalesce(v_has_quantity,false) then
    raise exception 'RECIPE_QUANTITY_COLUMN_NOT_FOUND';
  end if;

  if p_recipe_item_id is null then
    v_id := gen_random_uuid();
    v_cols := 'id, menu_item_id, material_id, input_unit_id, input_quantity';
    v_vals := '$1, $2, $3, $4, $5';

    if coalesce(v_has_unit_id,false) then
      v_cols := v_cols || ', unit_id';
      v_vals := v_vals || ', $4';
    end if;
    if coalesce(v_has_quantity_original,false) then
      v_cols := v_cols || ', quantity_original';
      v_vals := v_vals || ', $5';
    end if;
    if coalesce(v_has_quantity_base,false) then
      v_cols := v_cols || ', quantity_base';
      v_vals := v_vals || ', $6';
    end if;
    if coalesce(v_has_quantity_in_base,false) then
      v_cols := v_cols || ', quantity_in_base';
      v_vals := v_vals || ', $6';
    end if;
    if coalesce(v_has_base_quantity,false) then
      v_cols := v_cols || ', base_quantity';
      v_vals := v_vals || ', $6';
    end if;
    if coalesce(v_has_quantity,false) then
      v_cols := v_cols || ', quantity';
      if coalesce(v_has_quantity_base,false)
         or coalesce(v_has_quantity_in_base,false)
         or coalesce(v_has_base_quantity,false) then
        v_vals := v_vals || ', $5';
      else
        v_vals := v_vals || ', $6';
      end if;
    end if;

    execute format(
      'insert into public.menu_item_recipe_items (%s) values (%s)',
      v_cols,
      v_vals
    )
    using
      v_id,
      p_menu_item_id,
      p_material_id,
      p_input_unit_id,
      p_input_quantity,
      v_quantity_base;
  else
    v_sets := 'material_id=$1, input_unit_id=$2, input_quantity=$3';

    if coalesce(v_has_unit_id,false) then
      v_sets := v_sets || ', unit_id=$2';
    end if;
    if coalesce(v_has_quantity_original,false) then
      v_sets := v_sets || ', quantity_original=$3';
    end if;
    if coalesce(v_has_quantity_base,false) then
      v_sets := v_sets || ', quantity_base=$4';
    end if;
    if coalesce(v_has_quantity_in_base,false) then
      v_sets := v_sets || ', quantity_in_base=$4';
    end if;
    if coalesce(v_has_base_quantity,false) then
      v_sets := v_sets || ', base_quantity=$4';
    end if;
    if coalesce(v_has_quantity,false) then
      if coalesce(v_has_quantity_base,false)
         or coalesce(v_has_quantity_in_base,false)
         or coalesce(v_has_base_quantity,false) then
        v_sets := v_sets || ', quantity=$3';
      else
        v_sets := v_sets || ', quantity=$4';
      end if;
    end if;

    execute format(
      'update public.menu_item_recipe_items
       set %s
       where id=$5
         and menu_item_id=$6
       returning id',
      v_sets
    )
    into v_id
    using
      p_material_id,
      p_input_unit_id,
      p_input_quantity,
      v_quantity_base,
      p_recipe_item_id,
      p_menu_item_id;

    if v_id is null then
      raise exception 'RECIPE_ITEM_NOT_FOUND';
    end if;
  end if;

  return v_id;
end;
$$;
revoke all on function public.save_menu_recipe_item(uuid,uuid,uuid,numeric,uuid) from public;
grant execute on function public.save_menu_recipe_item(uuid,uuid,uuid,numeric,uuid) to authenticated;

create or replace function public.delete_menu_recipe_item(
  p_recipe_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_owner() then
    raise exception 'Access denied';
  end if;

  delete from public.menu_item_recipe_items
  where id = p_recipe_item_id;

  return found;
end;
$$;

revoke all on function public.delete_menu_recipe_item(uuid) from public;
grant execute on function public.delete_menu_recipe_item(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
