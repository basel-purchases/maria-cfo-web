-- =========================================================
-- Maria CFO Web v0.4
-- Units + menu default discount
-- Idempotent migration: safe to run more than once.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 1) Default discount for a menu item.
-- It is only a default used when a new order item is created.
-- Historical orders continue to keep their own snapshots.
-- ---------------------------------------------------------

alter table public.menu_items
  add column if not exists default_discount_percent numeric;

update public.menu_items
set default_discount_percent = 0
where default_discount_percent is null;

alter table public.menu_items
  alter column default_discount_percent set default 0;

-- Add a safe range check if it does not already exist.
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
-- 2) Restaurant-friendly unit catalog.
-- Existing codes are not duplicated.
-- If units.unit_type exists, clone the type from a compatible
-- existing unit so we do not guess enum/check values.
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

  -- Arabic labels preferred by Maria CFO.
  update public.units set name='كرتونة' where upper(code)='CARTON';
  update public.units set name='سفط'    where upper(code)='TRAY';
  update public.units set name='كيس'    where upper(code)='BAG';
  update public.units set name='علبة'   where upper(code)='CAN';
end $$;

commit;

notify pgrst, 'reload schema';
