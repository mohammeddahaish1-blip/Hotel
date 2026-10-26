-- =====================================================================
-- 0021 — Staff details: phone, civil ID and monthly salary.
-- Kept out of memberships (which every colleague can read): only the owner,
-- managers and the employee themself can see a staff profile.
-- =====================================================================

alter table public.invitations add column phone text check (char_length(phone) <= 30);
alter table public.invitations add column civil_id text check (char_length(civil_id) <= 20);
alter table public.invitations add column salary bigint check (salary >= 0);   -- baisa per month

create table public.staff_profiles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text check (char_length(phone) <= 30),
  civil_id text check (char_length(civil_id) <= 20),
  salary bigint check (salary >= 0),                                         -- baisa per month
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index staff_profiles_user_idx on public.staff_profiles(user_id);
alter table public.staff_profiles enable row level security;

create policy staff_profiles_select on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(tenant_id, '{owner,manager}'));
create policy staff_profiles_write on public.staff_profiles for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));

create trigger staff_profiles_touch before update on public.staff_profiles
  for each row execute function private.touch_updated_at();
-- Not added to the audit log on purpose: accountants can read the log, and salaries
-- must stay visible to the owner, managers and the employee only.

create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_count int;
begin
  if v_uid is null or v_email = '' then return 0; end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return 0;
  end if;
  -- sections on an invitation were set by the owner (enforced by invitations_permissions_guard)
  perform set_config('app.accepting_invite', 'on', true);
  insert into public.memberships(tenant_id, user_id, role, full_name, job_title, permissions)
  select i.tenant_id, v_uid, i.role, i.full_name, i.job_title, i.permissions
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  -- private HR details typed in the invitation (phone, civil ID, salary)
  insert into public.staff_profiles(tenant_id, user_id, phone, civil_id, salary)
  select i.tenant_id, v_uid, i.phone, i.civil_id, i.salary
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
     and (i.phone is not null or i.civil_id is not null or i.salary is not null)
  on conflict (tenant_id, user_id) do nothing;
  perform set_config('app.accepting_invite', 'off', true);
  update public.invitations set accepted_at = now()
   where lower(email) = v_email and accepted_at is null;
  return v_count;
end $$;


-- Fix (0019): the expense date default is the database's UTC date, which can be a day
-- behind the property's local date around midnight. Only expenses dated more than a day
-- before the property's today count as back-dated (imported) and stay out of the drawer.
create or replace function private.attach_shift()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_property uuid;
begin
  if new.method = 'cash' and new.cash_shift_id is null then
    if tg_table_name = 'payments' then
      select property_id into v_property from public.folios where id = new.folio_id;
    else
      v_property := new.property_id;
      if new.expense_date < (select (now() at time zone timezone)::date - 1 from public.properties where id = v_property) then
        return new;
      end if;
    end if;
    select id into new.cash_shift_id from public.cash_shifts
     where property_id = v_property and opened_by = auth.uid() and closed_at is null;
  end if;
  return new;
end $$;
