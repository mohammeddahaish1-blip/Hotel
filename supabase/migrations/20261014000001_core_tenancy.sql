-- =====================================================================
-- 0001 — Core tenancy, roles, audit log (NFR-01, FR-53, FR-54)
-- Every business table carries tenant_id and is protected by RLS.
-- Money is stored as integer baisa (1 OMR = 1000 baisa).
-- =====================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum
  ('owner', 'manager', 'reception', 'accountant', 'housekeeping', 'maintenance');

create type public.unit_status as enum
  ('available', 'reserved', 'occupied', 'dirty', 'maintenance', 'out_of_service');

create type public.reservation_status as enum
  ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');

create type public.reservation_kind as enum ('nightly', 'contract');

create type public.booking_source as enum
  ('direct', 'walk_in', 'phone', 'whatsapp', 'booking', 'agoda', 'expedia', 'airbnb', 'corporate', 'other');

create type public.payment_method as enum ('cash', 'card', 'transfer', 'link');

create type public.payment_kind as enum
  ('payment', 'refund', 'deposit', 'deposit_refund', 'deposit_applied');

create type public.doc_type as enum ('oman_id', 'gcc_id', 'passport', 'resident_card', 'other');

-- ---------------------------------------------------------------------
-- Tenants & memberships
-- ---------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null default 'OM',
  plan text not null default 'basic' check (plan in ('basic', 'pro', 'long_stay')),
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at date default (current_date + 30),
  -- Discount (basis points) reception may grant without manager approval (FR-12)
  max_reception_discount_bp int not null default 1000,
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  full_name text not null default '',
  ui_language text not null default 'ar' check (ui_language in ('ar', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- ---------------------------------------------------------------------
-- Session helpers. SECURITY DEFINER so RLS policies can call them
-- without recursing into memberships' own policies.
-- ---------------------------------------------------------------------
create or replace function private.user_tenant_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tenant_id from public.memberships
  where user_id = (select auth.uid()) and active
$$;

create or replace function private.has_role(p_tenant uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and tenant_id = p_tenant
      and active and role = any (p_roles)
  )
$$;

create or replace function private.current_role(p_tenant uuid)
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select role from public.memberships
  where user_id = (select auth.uid()) and tenant_id = p_tenant and active
$$;

grant execute on all functions in schema private to authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

create policy tenants_select on public.tenants for select to authenticated
  using (id in (select private.user_tenant_ids()));
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_role(id, '{owner}'));

create policy memberships_select on public.memberships for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy memberships_write on public.memberships for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (
    private.has_role(tenant_id, '{owner}')
    or (private.has_role(tenant_id, '{manager}') and role not in ('owner', 'manager'))
  );

-- ---------------------------------------------------------------------
-- Append-only audit log (FR-54). Filled by triggers only.
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index audit_log_tenant_at_idx on public.audit_log(tenant_id, at desc);
create index audit_log_record_idx on public.audit_log(record_id);

alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'));
-- No insert/update/delete policies: only the SECURITY DEFINER trigger writes.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

create or replace function private.forbid_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE: % rows cannot be modified or deleted', tg_table_name
    using errcode = 'P0001';
end $$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.forbid_mutation();

create or replace function private.audit_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log(tenant_id, table_name, record_id, action, old_data, new_data)
  values ((v_row->>'tenant_id')::uuid, tg_table_name, (v_row->>'id')::uuid,
          lower(tg_op), v_old, v_new);
  return coalesce(new, old);
end $$;

-- Generic updated_at maintenance
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;
