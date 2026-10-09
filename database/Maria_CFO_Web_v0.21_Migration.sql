-- Maria CFO v0.21: audit-only OCR request metering; no financial table changes.
-- Run once in Supabase SQL Editor as project administrator.
begin;
create table if not exists public.ocr_space_usage_v021 (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid(),
  engine smallint not null check (engine in (1,3)),
  status text not null default 'attempted' check (status in ('attempted','completed','failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ocr_space_usage_v021_owner_created_idx
  on public.ocr_space_usage_v021(owner_user_id,created_at desc);
alter table public.ocr_space_usage_v021 enable row level security;
revoke all on table public.ocr_space_usage_v021 from public,anon;
grant select,insert,update on table public.ocr_space_usage_v021 to authenticated;
drop policy if exists ocr_space_usage_v021_owner_select on public.ocr_space_usage_v021;
create policy ocr_space_usage_v021_owner_select on public.ocr_space_usage_v021 for select to authenticated
  using (owner_user_id=auth.uid() and public.is_app_owner());
drop policy if exists ocr_space_usage_v021_owner_insert on public.ocr_space_usage_v021;
create policy ocr_space_usage_v021_owner_insert on public.ocr_space_usage_v021 for insert to authenticated
  with check (owner_user_id=auth.uid() and public.is_app_owner());
drop policy if exists ocr_space_usage_v021_owner_update on public.ocr_space_usage_v021;
create policy ocr_space_usage_v021_owner_update on public.ocr_space_usage_v021 for update to authenticated
  using (owner_user_id=auth.uid() and public.is_app_owner())
  with check (owner_user_id=auth.uid() and public.is_app_owner());

create or replace function public.get_ocr_space_usage_v021()
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  d timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  m timestamptz := date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  result jsonb;
begin
  if not public.is_app_owner() then
    raise exception 'Access denied' using errcode='42501';
  end if;
  select jsonb_build_object(
    '1',jsonb_build_object('day',count(*) filter (where engine=1 and created_at>=d),'month',count(*) filter(where engine=1)),
    '3',jsonb_build_object('day',count(*) filter (where engine=3 and created_at>=d),'month',count(*) filter(where engine=3)),
    'total_day',count(*) filter (where created_at>=d),
    'timezone','UTC',
    'source','maria_cfo_attempts_not_provider_balance'
  ) into result
  from public.ocr_space_usage_v021
  where owner_user_id=auth.uid() and created_at>=m;
  return result;
end;
$$;
revoke all on function public.get_ocr_space_usage_v021() from public,anon;
grant execute on function public.get_ocr_space_usage_v021() to authenticated;
commit;
