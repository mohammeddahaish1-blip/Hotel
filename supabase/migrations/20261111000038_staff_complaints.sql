-- =====================================================================
-- 0038 — Staff complaint box («صندوق الشكاوي»).
-- Every employee except managers can write a complaint that goes straight to the owner (e.g. salary not
-- paid by the manager). Only the owner reads them; managers never see them, not even in the activity
-- log (this table is deliberately not audited, because managers can read the log). The employee sees
-- their own complaints and the owner's reply, unless they chose to stay anonymous (then no name is kept).
-- =====================================================================

create table public.staff_complaints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,     -- null when anonymous
  author_name text check (char_length(author_name) <= 120),
  category text not null default 'other'
    check (category in ('salary', 'treatment', 'schedule', 'workload', 'safety', 'other')),
  about_user_id uuid references auth.users(id) on delete set null, -- who it is about (optional)
  body text not null check (char_length(btrim(body)) between 3 and 3000),
  status text not null default 'new' check (status in ('new', 'seen', 'resolved')),
  owner_reply text check (char_length(owner_reply) <= 2000),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_complaints_tenant_idx on public.staff_complaints(tenant_id, created_at desc);
create index staff_complaints_author_idx on public.staff_complaints(author_id);
create index staff_complaints_about_idx on public.staff_complaints(about_user_id);
alter table public.staff_complaints enable row level security;

-- the owner reads and answers; the writer reads their own; nobody else (managers included)
create policy staff_complaints_select on public.staff_complaints for select to authenticated
  using (private.has_role(tenant_id, '{owner}') or author_id = (select auth.uid()));
create policy staff_complaints_owner_update on public.staff_complaints for update to authenticated
  using (private.has_role(tenant_id, '{owner}')) with check (private.has_role(tenant_id, '{owner}'));

-- Who may write: active staff of the company who are not the owner or a manager.
create or replace function public.can_file_staff_complaint(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m
                  where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.active
                    and m.support_until is null)
     and not private.has_role(p_tenant, '{owner,manager}')
$$;

create or replace function public.submit_staff_complaint(p_tenant uuid, p_category text, p_body text,
  p_about uuid default null, p_anonymous boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_name text;
begin
  if not public.can_file_staff_complaint(p_tenant) then raise exception 'FORBIDDEN: staff complaints are for employees'; end if;
  if (select count(*) from public.staff_complaints
       where tenant_id = p_tenant and author_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT: too many complaints today';
  end if;
  if p_about is not null and not exists (select 1 from public.memberships where tenant_id = p_tenant and user_id = p_about) then
    raise exception 'NOT_FOUND: employee';
  end if;
  select nullif(full_name, '') into v_name from public.memberships where tenant_id = p_tenant and user_id = auth.uid();
  insert into public.staff_complaints(tenant_id, author_id, author_name, category, about_user_id, body)
  values (p_tenant, case when p_anonymous then null else auth.uid() end, case when p_anonymous then null else v_name end,
          coalesce(nullif(p_category, ''), 'other'), p_about, btrim(p_body))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.can_file_staff_complaint(uuid) from public, anon;
revoke execute on function public.submit_staff_complaint(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.can_file_staff_complaint(uuid) to authenticated;
grant execute on function public.submit_staff_complaint(uuid, text, text, uuid, boolean) to authenticated;
