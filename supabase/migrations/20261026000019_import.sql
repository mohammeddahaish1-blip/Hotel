-- =====================================================================
-- 0019 — Import from office files (Excel / CSV / PDF).
-- A job stores what was read from each sheet and how each row validated;
-- nothing reaches the business tables until the user confirms.
-- =====================================================================

-- 'import' becomes a grantable section
alter table public.memberships drop constraint memberships_permissions_valid;
alter table public.memberships add constraint memberships_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback', 'import']::text[]);
alter table public.invitations drop constraint invitations_permissions_valid;
alter table public.invitations add constraint invitations_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback', 'import']::text[]);

-- Owner always; manager by default; anyone else only if the owner ticked 'import'
create or replace function private.can_import(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (m.role = 'owner'
            or (m.permissions is null and m.role = 'manager')
            or (m.permissions is not null and 'import' = any (m.permissions)))
  )
$$;

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  file_name text not null check (char_length(file_name) <= 255),
  file_kind text not null check (file_kind in ('excel', 'csv', 'pdf')),
  sheets int not null default 0,
  ready int not null default 0,
  warnings int not null default 0,
  errors int not null default 0,
  saved int not null default 0,
  failed int not null default 0,
  status text not null default 'validated' check (status in ('validated', 'saved', 'partial', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  saved_at timestamptz
);
create index import_jobs_property_idx on public.import_jobs(property_id, created_at desc);
create index import_jobs_tenant_idx on public.import_jobs(tenant_id);
create index import_jobs_created_by_idx on public.import_jobs(created_by);
alter table public.import_jobs enable row level security;

create policy import_jobs_select on public.import_jobs for select to authenticated
  using (private.can_import(tenant_id));
create policy import_jobs_insert on public.import_jobs for insert to authenticated
  with check (private.can_import(tenant_id));
create policy import_jobs_update on public.import_jobs for update to authenticated
  using (private.can_import(tenant_id)) with check (private.can_import(tenant_id));

-- Imported (back-dated) cash expenses must not land in today's cash drawer:
-- only same-day cash expenses attach to the open shift.
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
      if new.expense_date < (select (now() at time zone timezone)::date from public.properties where id = v_property) then
        return new;
      end if;
    end if;
    select id into new.cash_shift_id from public.cash_shifts
     where property_id = v_property and opened_by = auth.uid() and closed_at is null;
  end if;
  return new;
end $$;
