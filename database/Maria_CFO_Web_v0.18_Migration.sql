-- Maria CFO Web v0.18 - Named material units and visible conversion definitions
-- Run once in Supabase SQL Editor AFTER v0.17. Transactional, no historical data rewrite.
-- Existing duplicate names / ambiguous shared units are NOT merged or deleted.

begin;

alter table public.units
  add column if not exists is_material_specific boolean not null default false;

comment on column public.units.is_material_specific is
  'v0.18: units deliberately bound to exactly one material; relation value lives in material_units.quantity_in_base.';

create or replace function public.normalize_unit_name_v018(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(translate(
    regexp_replace(
      regexp_replace(btrim(coalesce(p_name, '')), '[ًٌٍَُِّْٰـ]', '', 'g'),
      '[[:space:]]+', ' ', 'g'
    ),
    'أإآى', 'اااي'
  ));
$$;

-- Protect new names, including differently cased/spaced spellings, and code collisions.
-- A trigger lets us safely preserve old duplicated names for manual review.
create or replace function public.guard_unit_name_v018()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text := public.normalize_unit_name_v018(new.name);
begin
  if v_name = '' then
    raise exception using message = 'UNIT_NAME_REQUIRED', errcode = '23514';
  end if;
  if length(new.name) > 120 then
    raise exception using message = 'UNIT_NAME_TOO_LONG', errcode = '23514';
  end if;

  -- Serialize conflicting creates, including across concurrent sessions.
  perform pg_advisory_xact_lock(hashtextextended('maria-unit-name:' || v_name, 0));

  if exists (
    select 1 from public.units u
    where u.id is distinct from new.id
      and public.normalize_unit_name_v018(u.name) = v_name
  ) then
    raise exception using message = 'UNIT_NAME_EXISTS', errcode = '23505';
  end if;

  -- The Arabic labels of built-in units are also reserved to prevent a
  -- newly created custom unit being indistinguishable in selection lists.
  if exists (
    select 1 from public.units u
    where u.id is distinct from new.id
      and public.normalize_unit_name_v018(
        case upper(u.code)
          when 'KG' then 'كيلوغرام'
          when 'G' then 'غرام'
          when 'L' then 'لتر'
          when 'ML' then 'مل'
          when 'PCS' then 'قطعة'
          when 'SPOON' then 'ملعقة'
          when 'TBSP' then 'ملعقة كبيرة'
          when 'TSP' then 'ملعقة صغيرة'
          when 'CUP' then 'كوب'
          when 'SCOOP' then 'مكيال'
          when 'BOX' then 'صندوق'
          when 'BAG' then 'كيس'
          when 'CARTON' then 'كرتونة'
          when 'PACK' then 'عبوة'
          else u.name
        end
      ) = v_name
  ) then
    raise exception using message = 'UNIT_NAME_EXISTS', errcode = '23505';
  end if;

  if exists (
    select 1 from public.units u
    where u.id is distinct from new.id
      and upper(btrim(u.code)) = upper(btrim(new.code))
  ) then
    raise exception using message = 'UNIT_CODE_EXISTS', errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_unit_name_v018_trg on public.units;
create trigger guard_unit_name_v018_trg
before insert or update of name, code on public.units
for each row execute function public.guard_unit_name_v018();

-- Enforce this new invariant ONLY for explicitly material-specific units.
-- Old generic units and existing multi-material conversions remain untouched.
create or replace function public.guard_specific_unit_binding_v018()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_specific boolean;
begin
  select u.is_material_specific into v_specific
  from public.units u where u.id = new.unit_id;

  if coalesce(v_specific, false) and exists (
    select 1 from public.material_units mu
    where mu.unit_id = new.unit_id
      and mu.material_id <> new.material_id
      and mu.id is distinct from new.id
  ) then
    raise exception using message='UNIT_BELONGS_TO_OTHER_MATERIAL', errcode='23514';
  end if;

  if coalesce(v_specific, false) and exists (
    select 1 from public.materials m
    where m.base_unit_id = new.unit_id and m.id <> new.material_id
  ) then
    raise exception using message='UNIT_BELONGS_TO_OTHER_MATERIAL', errcode='23514';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_specific_unit_binding_v018_trg on public.material_units;
create trigger guard_specific_unit_binding_v018_trg
before insert or update of material_id, unit_id, quantity_in_base on public.material_units
for each row execute function public.guard_specific_unit_binding_v018();

create or replace function public.guard_material_base_specific_v018()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.units u
    join public.material_units mu on mu.unit_id=u.id
    where u.id=new.base_unit_id and u.is_material_specific
      and mu.material_id <> new.id
  ) then
    raise exception using message='UNIT_BELONGS_TO_OTHER_MATERIAL', errcode='23514';
  end if;
  if exists (
    select 1 from public.units u
    join public.material_units mu on mu.unit_id=u.id
    where u.id=new.base_unit_id and u.is_material_specific
      and mu.material_id=new.id and mu.quantity_in_base<>1
  ) then
    raise exception using message='UNIT_BASE_FACTOR_MUST_BE_ONE', errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_material_base_specific_v018_trg on public.materials;
create trigger guard_material_base_specific_v018_trg
before insert or update of base_unit_id on public.materials
for each row execute function public.guard_material_base_specific_v018();

-- Save name and relation together: 1 named unit = N base units of ONE material.
create or replace function public.save_named_unit_v018(
  p_unit_id uuid default null,
  p_name text default null,
  p_code text default null,
  p_material_id uuid default null,
  p_quantity_in_base numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_unit public.units%rowtype;
  v_base_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_code text := upper(nullif(btrim(p_code), ''));
begin
  if not public.is_app_owner() then
    raise exception 'Access denied';
  end if;
  if v_name is null then
    raise exception 'UNIT_NAME_REQUIRED';
  end if;
  if p_material_id is null or p_quantity_in_base is null then
    raise exception 'UNIT_RELATION_REQUIRED';
  end if;
  if p_quantity_in_base < 0.00000001 or p_quantity_in_base > 99999999999 then
    raise exception 'INVALID_MATERIAL_UNIT_CONVERSION';
  end if;

  select m.base_unit_id into v_base_id
  from public.materials m where m.id=p_material_id for share;
  if v_base_id is null then
    raise exception 'UNIT_MATERIAL_NOT_FOUND';
  end if;

  if p_unit_id is null then
    if v_code is null then
      v_code := 'U_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    end if;
    insert into public.units
      (name, code, unit_type, is_system, is_active, is_material_specific)
    values (v_name, v_code, 'custom', false, true, true)
    returning id into v_id;
  else
    select * into v_unit from public.units where id=p_unit_id for update;
    if not found then
      raise exception 'UNIT_NOT_FOUND';
    end if;
    if v_unit.is_system or upper(v_unit.code) in
      ('KG','G','L','ML','PCS','PC','UNIT','DOZ','DOZEN') then
      raise exception 'UNIT_SYSTEM_READONLY';
    end if;
    if exists (
      select 1 from public.unit_conversions uc
      where uc.from_unit_id=p_unit_id or uc.to_unit_id=p_unit_id
    ) then
      raise exception 'UNIT_HAS_GLOBAL_CONVERSIONS';
    end if;
    if exists (
      select 1 from public.material_units mu
      where mu.unit_id=p_unit_id and mu.material_id<>p_material_id
    ) or exists (
      select 1 from public.materials m
      where m.base_unit_id=p_unit_id and m.id<>p_material_id
    ) then
      raise exception 'UNIT_BELONGS_TO_OTHER_MATERIAL';
    end if;
    v_id := p_unit_id;
    update public.units set name=v_name,
      code=coalesce(v_code,code),
      is_material_specific=true
    where id=v_id;
  end if;

  if v_base_id=v_id and p_quantity_in_base<>1 then
    raise exception 'UNIT_BASE_FACTOR_MUST_BE_ONE';
  end if;

  insert into public.material_units
    (material_id, unit_id, quantity_in_base, is_purchase_unit)
  values (p_material_id, v_id, p_quantity_in_base, false)
  on conflict (material_id, unit_id)
  do update set quantity_in_base=excluded.quantity_in_base;

  return v_id;
end;
$$;

revoke all on function public.save_named_unit_v018(uuid,text,text,uuid,numeric) from public;
grant execute on function public.save_named_unit_v018(uuid,text,text,uuid,numeric) to authenticated;

-- Delete only a non-system unit, and only when every other FK allows it.
-- Removing its material_units link and the unit is one atomic transaction.
create or replace function public.delete_named_unit_v018(p_unit_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit public.units%rowtype;
begin
  if not public.is_app_owner() then
    raise exception 'Access denied';
  end if;
  select * into v_unit from public.units where id=p_unit_id for update;
  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;
  if v_unit.is_system or upper(v_unit.code) in
     ('KG','G','L','ML','PCS','PC','UNIT','DOZ','DOZEN') then
    raise exception 'UNIT_SYSTEM_READONLY';
  end if;
  if exists (
    select 1 from public.unit_conversions uc
    where uc.from_unit_id=p_unit_id or uc.to_unit_id=p_unit_id
  ) then
    raise exception 'UNIT_HAS_GLOBAL_CONVERSIONS';
  end if;
  if (select count(*) from public.material_units where unit_id=p_unit_id)>1 then
    raise exception 'UNIT_HAS_MULTIPLE_MATERIALS';
  end if;

  delete from public.material_units where unit_id=p_unit_id;
  begin
    delete from public.units where id=p_unit_id;
  exception when foreign_key_violation then
    raise exception 'UNIT_IN_USE';
  end;

  return true;
end;
$$;

revoke all on function public.delete_named_unit_v018(uuid) from public;
grant execute on function public.delete_named_unit_v018(uuid) to authenticated;

-- Index safely only if older duplicate names have already been resolved.
-- The trigger above still protects new inserts while legacy duplicates exist.
do $$
begin
  if not exists (
    select 1 from public.units
    group by public.normalize_unit_name_v018(name)
    having count(*)>1
  ) then
    create unique index if not exists units_name_normalized_unique_v018
      on public.units (public.normalize_unit_name_v018(name));
  else
    raise notice 'Maria CFO: existing duplicate unit names were preserved. Resolve them in Settings, then rerun this migration to enable unique index.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
