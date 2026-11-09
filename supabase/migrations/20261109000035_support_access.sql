-- =====================================================================
-- 0035 — Support requests and temporary access for the Nuzul team.
-- * Periodic maintenance: the team schedules a visit, the hotel's owner or a manager approves it,
--   the team does the work and leaves a report.
-- * Change requests: the hotel asks for a change and may grant temporary access straight away;
--   if it did not, the team asks for access and the hotel approves it.
-- Access is a membership marked support_until: it works only until that moment and then stops by itself
-- (every access check below ignores an expired support membership). The hotel sees every entry and exit
-- (who, when, how long, what changed) and can revoke access at any time.
-- =====================================================================

alter table public.memberships add column support_until timestamptz;
comment on column public.memberships.support_until is
  'Set only for Nuzul support staff: their access ends at this moment. Null for the hotel''s own staff.';

-- ---------------------------------------------------------------- access checks ignore expired support
create or replace function private.user_tenant_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tenant_id from public.memberships
  where user_id = (select auth.uid()) and active and (support_until is null or support_until > now())
$$;

create or replace function private.has_role(p_tenant uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (m.support_until is null or m.support_until > now())
       and (
         ((m.permissions is null or m.role = 'owner') and m.role = any (p_roles))
         or (m.permissions is not null and m.role <> 'owner'
             and exists (select 1 from unnest(m.permissions) a where private.area_role(a) = any (p_roles)))
       )
  )
$$;

create or replace function private.current_role(p_tenant uuid)
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select role from public.memberships
  where user_id = (select auth.uid()) and tenant_id = p_tenant and active
    and (support_until is null or support_until > now())
$$;

create or replace function private.can_feedback(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (m.support_until is null or m.support_until > now())
       and (m.role = 'owner'
            or (m.permissions is null and m.role = 'manager')
            or (m.permissions is not null and 'feedback' = any (m.permissions)))
  )
$$;

create or replace function private.can_import(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (m.support_until is null or m.support_until > now())
       and (m.role = 'owner'
            or (m.permissions is null and m.role = 'manager')
            or (m.permissions is not null and 'import' = any (m.permissions)))
  )
$$;

-- Only the support functions below may set or change support_until (the hotel can still switch a
-- support member off with active = false, which ends access at once).
create or replace function private.memberships_support_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.support_until is distinct from (case when tg_op = 'UPDATE' then old.support_until end)
     and coalesce(current_setting('app.support_op', true), '') <> 'on' then
    raise exception 'FORBIDDEN: support access is managed by support requests';
  end if;
  return new;
end $$;
create or replace trigger memberships_support_guard before insert or update on public.memberships
  for each row execute function private.memberships_support_guard();

-- ---------------------------------------------------------------- requests
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('maintenance', 'change')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  details text check (char_length(details) <= 2000),
  -- open: waiting for the team · awaiting_hotel: the team asks the hotel to approve access ·
  -- approved: access granted · rejected · done: finished with a report · cancelled by the hotel
  status text not null default 'open'
    check (status in ('open', 'awaiting_hotel', 'approved', 'rejected', 'done', 'cancelled')),
  scheduled_for timestamptz,
  access_hours int check (access_hours between 1 and 72),
  access_from timestamptz,
  access_until timestamptz,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  from_team boolean not null default false,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  report text check (char_length(report) <= 4000),
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_tenant_idx on public.support_requests(tenant_id, created_at desc);
create index support_requests_status_idx on public.support_requests(status);
create index support_requests_requested_by_idx on public.support_requests(requested_by);
create index support_requests_decided_by_idx on public.support_requests(decided_by);
create index support_requests_completed_by_idx on public.support_requests(completed_by);
alter table public.support_requests enable row level security;
create policy support_requests_select on public.support_requests for select to authenticated
  using (private.is_platform_admin() or private.has_role(tenant_id, '{owner,manager}'));
create trigger support_requests_audit after insert or update on public.support_requests
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------- sessions (entries and exits)
create table public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.support_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  staff_name text not null,
  started_at timestamptz not null default now(),
  ends_by timestamptz not null,            -- when access would end by itself
  ended_at timestamptz,
  summary text check (char_length(summary) <= 2000)
);
create index support_sessions_tenant_idx on public.support_sessions(tenant_id, started_at desc);
create index support_sessions_request_idx on public.support_sessions(request_id);
create index support_sessions_user_idx on public.support_sessions(user_id);
alter table public.support_sessions enable row level security;
create policy support_sessions_select on public.support_sessions for select to authenticated
  using (private.is_platform_admin() or private.has_role(tenant_id, '{owner,manager}'));

-- Bring every support membership of a company down to the latest access still granted (never raises it).
create or replace function private.sync_support_access(p_tenant uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_until timestamptz;
begin
  select max(access_until) into v_until from public.support_requests
   where tenant_id = p_tenant and status = 'approved' and access_until > now();
  perform set_config('app.support_op', 'on', true);
  update public.memberships set support_until = least(support_until, coalesce(v_until, now()))
   where tenant_id = p_tenant and support_until is not null and support_until > now()
     and support_until > coalesce(v_until, now());
  update public.support_sessions set ended_at = least(ends_by, now())
   where tenant_id = p_tenant and ended_at is null and (v_until is null or ends_by > v_until);
  perform set_config('app.support_op', 'off', true);
end $$;

-- ---------------------------------------------------------------- for the hotel
-- The hotel asks for a change; with p_grant_hours it also grants access right away.
create or replace function public.support_create_request(p_tenant uuid, p_title text, p_details text default null,
  p_grant_hours int default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.has_role(p_tenant, '{owner,manager}') then raise exception 'FORBIDDEN: owner or manager only'; end if;
  if p_grant_hours is not null and (p_grant_hours < 1 or p_grant_hours > 72) then raise exception 'INVALID_VALUE: hours 1-72'; end if;
  insert into public.support_requests(tenant_id, kind, title, details, status, access_hours, access_from, access_until,
                                      decided_by, decided_at)
  values (p_tenant, 'change', btrim(p_title), nullif(btrim(p_details), ''),
          case when p_grant_hours is null then 'open' else 'approved' end, p_grant_hours,
          case when p_grant_hours is null then null else now() end,
          case when p_grant_hours is null then null else now() + make_interval(hours => p_grant_hours) end,
          case when p_grant_hours is null then null else auth.uid() end,
          case when p_grant_hours is null then null else now() end)
  returning id into v_id;
  return v_id;
end $$;

-- Approve or reject what the team asked for (a maintenance visit, or access for a change request).
create or replace function public.support_decide(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.support_requests; v_from timestamptz;
begin
  select * into r from public.support_requests where id = p_id for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager}') then raise exception 'NOT_FOUND: request'; end if;
  if r.status <> 'awaiting_hotel' then raise exception 'INVALID_STATUS: %', r.status; end if;
  v_from := greatest(coalesce(r.scheduled_for, now()), now());
  update public.support_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         access_from = case when p_approve then v_from end,
         access_until = case when p_approve then v_from + make_interval(hours => coalesce(r.access_hours, 4)) end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(left(p_note, 500)), ''),
         updated_at = now()
   where id = p_id;
end $$;

-- The hotel ends access now (the request stays open for the team to finish or ask again).
create or replace function public.support_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.support_requests;
begin
  select * into r from public.support_requests where id = p_id for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager}') then raise exception 'NOT_FOUND: request'; end if;
  if r.status <> 'approved' then raise exception 'INVALID_STATUS: %', r.status; end if;
  update public.support_requests set status = 'open', access_until = least(access_until, now()), updated_at = now()
   where id = p_id;
  perform private.sync_support_access(r.tenant_id);
end $$;

create or replace function public.support_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.support_requests;
begin
  select * into r from public.support_requests where id = p_id for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager}') then raise exception 'NOT_FOUND: request'; end if;
  if r.status in ('done', 'cancelled') then raise exception 'INVALID_STATUS: %', r.status; end if;
  update public.support_requests set status = 'cancelled', access_until = least(access_until, now()), updated_at = now()
   where id = p_id;
  perform private.sync_support_access(r.tenant_id);
end $$;

-- ---------------------------------------------------------------- for the Nuzul team
create or replace function public.admin_support_list()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.sort_key, x.created_at desc)
      from (
        select r.*, t.name as tenant_name,
               case r.status when 'approved' then 0 when 'open' then 1 when 'awaiting_hotel' then 2 else 3 end as sort_key,
               (r.status = 'approved' and now() >= r.access_from and r.access_until > now()) as access_live,
               (select count(*) from public.support_sessions s where s.request_id = r.id) as sessions
          from public.support_requests r join public.tenants t on t.id = r.tenant_id
         where r.status not in ('done', 'cancelled', 'rejected') or r.updated_at > now() - interval '30 days'
      ) x), '[]'::jsonb);
end $$;

-- The team schedules a maintenance visit (or any visit) and waits for the hotel's approval.
create or replace function public.admin_create_maintenance(p_tenant uuid, p_title text, p_details text,
  p_scheduled_for timestamptz, p_hours int)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 72 then raise exception 'INVALID_VALUE: hours 1-72'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'NOT_FOUND: tenant'; end if;
  insert into public.support_requests(tenant_id, kind, title, details, status, scheduled_for, access_hours, from_team)
  values (p_tenant, 'maintenance', btrim(p_title), nullif(btrim(p_details), ''), 'awaiting_hotel', p_scheduled_for, p_hours, true)
  returning id into v_id;
  return v_id;
end $$;

-- A change request without access: the team asks the hotel for it.
create or replace function public.admin_request_access(p_id uuid, p_hours int, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_hours is null or p_hours < 1 or p_hours > 72 then raise exception 'INVALID_VALUE: hours 1-72'; end if;
  update public.support_requests
     set status = 'awaiting_hotel', access_hours = p_hours, scheduled_for = null,
         details = case when nullif(btrim(p_note), '') is null then details
                        else left(coalesce(details || E'\n\n', '') || 'فريق نُزُل: ' || btrim(p_note), 2000) end,
         updated_at = now()
   where id = p_id and status = 'open';
  if not found then raise exception 'INVALID_STATUS: request is not open'; end if;
end $$;

-- Enter the hotel: only while access granted by the hotel is running. Returns where to go.
create or replace function public.admin_start_session(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare r public.support_requests; v_name text; v_member boolean; v_session uuid; v_property uuid;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  select * into r from public.support_requests where id = p_id;
  if not found then raise exception 'NOT_FOUND: request'; end if;
  if r.status <> 'approved' or r.access_from > now() or r.access_until <= now() then
    raise exception 'NO_ACCESS: the hotel has not granted access for now';
  end if;
  select coalesce(nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'full_name', ''), u.email) into v_name from auth.users u where u.id = auth.uid();
  -- staff of the hotel themselves (e.g. a demo owner) keep their own membership: only the session is logged
  select exists (select 1 from public.memberships where tenant_id = r.tenant_id and user_id = auth.uid() and support_until is null)
    into v_member;
  if not v_member then
    perform set_config('app.support_op', 'on', true);
    insert into public.memberships(tenant_id, user_id, role, full_name, job_title, active, support_until)
    values (r.tenant_id, auth.uid(), 'manager', 'فريق نُزُل — ' || v_name, 'فريق دعم نُزُل', true, r.access_until)
    on conflict (tenant_id, user_id) do update set role = 'manager', permissions = null, active = true,
      support_until = excluded.support_until, full_name = excluded.full_name, job_title = excluded.job_title;
    perform set_config('app.support_op', 'off', true);
  end if;
  update public.support_sessions set ended_at = now()
   where tenant_id = r.tenant_id and user_id = auth.uid() and ended_at is null;
  insert into public.support_sessions(tenant_id, request_id, user_id, staff_name, ends_by)
  values (r.tenant_id, r.id, auth.uid(), v_name, r.access_until) returning id into v_session;
  select id into v_property from public.properties where tenant_id = r.tenant_id order by created_at limit 1;
  return jsonb_build_object('session_id', v_session, 'tenant_id', r.tenant_id, 'property_id', v_property);
end $$;

-- Leave the hotel: the session closes and this person's access stops now (the grant stays for a later entry).
create or replace function public.admin_end_session(p_tenant uuid, p_summary text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  update public.support_sessions set ended_at = now(), summary = coalesce(nullif(btrim(left(p_summary, 2000)), ''), summary)
   where tenant_id = p_tenant and user_id = auth.uid() and ended_at is null;
  perform set_config('app.support_op', 'on', true);
  update public.memberships set support_until = now()
   where tenant_id = p_tenant and user_id = auth.uid() and support_until > now();
  perform set_config('app.support_op', 'off', true);
end $$;

-- Finish a request with a report for the hotel; access granted for it ends.
create or replace function public.admin_complete_request(p_id uuid, p_report text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.support_requests;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if char_length(btrim(coalesce(p_report, ''))) < 3 then raise exception 'INVALID_VALUE: report required'; end if;
  select * into r from public.support_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: request'; end if;
  if r.status in ('done', 'cancelled', 'rejected') then raise exception 'INVALID_STATUS: %', r.status; end if;
  update public.support_requests
     set status = 'done', report = left(btrim(p_report), 4000), completed_by = auth.uid(), completed_at = now(),
         access_until = least(access_until, now()), updated_at = now()
   where id = p_id;
  perform private.sync_support_access(r.tenant_id);
end $$;

revoke execute on function public.support_create_request(uuid, text, text, int) from public, anon;
revoke execute on function public.support_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.support_revoke(uuid) from public, anon;
revoke execute on function public.support_cancel(uuid) from public, anon;
revoke execute on function public.admin_support_list() from public, anon;
revoke execute on function public.admin_create_maintenance(uuid, text, text, timestamptz, int) from public, anon;
revoke execute on function public.admin_request_access(uuid, int, text) from public, anon;
revoke execute on function public.admin_start_session(uuid) from public, anon;
revoke execute on function public.admin_end_session(uuid, text) from public, anon;
revoke execute on function public.admin_complete_request(uuid, text) from public, anon;
grant execute on function public.support_create_request(uuid, text, text, int) to authenticated;
grant execute on function public.support_decide(uuid, boolean, text) to authenticated;
grant execute on function public.support_revoke(uuid) to authenticated;
grant execute on function public.support_cancel(uuid) to authenticated;
grant execute on function public.admin_support_list() to authenticated;
grant execute on function public.admin_create_maintenance(uuid, text, text, timestamptz, int) to authenticated;
grant execute on function public.admin_request_access(uuid, int, text) to authenticated;
grant execute on function public.admin_start_session(uuid) to authenticated;
grant execute on function public.admin_end_session(uuid, text) to authenticated;
grant execute on function public.admin_complete_request(uuid, text) to authenticated;
revoke execute on function private.sync_support_access(uuid) from public, anon, authenticated;
revoke execute on function private.memberships_support_guard() from public, anon, authenticated;
