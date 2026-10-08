begin;

-- =========================================================
-- Maria CFO Web v0.12
-- Persistent background AI jobs + in-app notifications.
-- =========================================================

create table if not exists public.ai_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    job_type text not null,
    status text not null default 'queued',
    title text,
    related_entity_type text,
    related_entity_id uuid,
    input_meta jsonb not null default '{}'::jsonb,
    result_json jsonb,
    public_message text,
    error_code text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    seen_at timestamptz
);

alter table public.ai_jobs
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists job_type text,
    add column if not exists status text default 'queued',
    add column if not exists title text,
    add column if not exists related_entity_type text,
    add column if not exists related_entity_id uuid,
    add column if not exists input_meta jsonb not null default '{}'::jsonb,
    add column if not exists result_json jsonb,
    add column if not exists public_message text,
    add column if not exists error_code text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists started_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists seen_at timestamptz;

create index if not exists ai_jobs_user_created_idx
    on public.ai_jobs(user_id, created_at desc);

create index if not exists ai_jobs_user_status_idx
    on public.ai_jobs(user_id, status, seen_at, created_at desc);

create index if not exists ai_jobs_related_idx
    on public.ai_jobs(related_entity_type, related_entity_id, created_at desc);

alter table public.ai_jobs enable row level security;

revoke all on table public.ai_jobs from public;
revoke insert, update, delete on table public.ai_jobs from authenticated;
grant select on table public.ai_jobs to authenticated;
grant all on table public.ai_jobs to service_role;

-- Re-create the owner read policy idempotently.
drop policy if exists ai_jobs_owner_read on public.ai_jobs;
create policy ai_jobs_owner_read
on public.ai_jobs
for select
to authenticated
using (
    user_id = auth.uid()
    and exists (
        select 1
        from public.app_users au
        where au.user_id = auth.uid()
          and au.role = 'owner'
    )
);

-- Mark a result as seen only by its owner.
create or replace function public.mark_ai_job_seen_v012(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_app_owner() then
        raise exception 'Access denied';
    end if;

    update public.ai_jobs
    set seen_at = coalesce(seen_at, now())
    where id = p_job_id
      and user_id = auth.uid();

    return found;
end;
$$;

revoke all on function public.mark_ai_job_seen_v012(uuid) from public;
grant execute on function public.mark_ai_job_seen_v012(uuid) to authenticated;

-- Link a reviewed AI job to a created entity and finish it.
create or replace function public.complete_ai_job_v012(
    p_job_id uuid,
    p_related_entity_type text,
    p_related_entity_id uuid
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

    update public.ai_jobs
    set status = 'completed',
        related_entity_type = nullif(trim(coalesce(p_related_entity_type, '')), ''),
        related_entity_id = p_related_entity_id,
        completed_at = coalesce(completed_at, now()),
        seen_at = now(),
        public_message = coalesce(public_message, 'تمت مراجعة النتيجة وحفظها.')
    where id = p_job_id
      and user_id = auth.uid();

    return found;
end;
$$;

revoke all on function public.complete_ai_job_v012(uuid, text, uuid) from public;
grant execute on function public.complete_ai_job_v012(uuid, text, uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
