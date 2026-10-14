-- =====================================================================
-- 0002 — Property hierarchy, unit types, rates (FR-01, FR-02, FR-03)
-- =====================================================================

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name_ar text not null,
  name_en text,
  kind text not null default 'hotel' check (kind in ('hotel', 'apartments', 'mixed')),
  country text not null default 'OM',
  governorate text,
  municipality text not null default 'muscat',
  timezone text not null default 'Asia/Muscat',
  currency text not null default 'OMR',
  address text,
  phone text,
  whatsapp text,
  email text,
  license_no text,          -- Ministry of Heritage & Tourism licence
  vat_no text,              -- Tax registration (VATIN)
  check_in_time time not null default '14:00',
  check_out_time time not null default '12:00',
  doc_retention_days int not null default 365,   -- NFR-04
  created_at timestamptz not null default now()
);
create index properties_tenant_idx on public.properties(tenant_id);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  sort int not null default 0
);
create index floors_property_idx on public.floors(property_id);

create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name_ar text not null,
  name_en text,
  kind text not null default 'room' check (kind in ('room', 'apartment', 'suite', 'studio')),
  capacity int not null default 2 check (capacity > 0),
  nightly_rate bigint not null default 0 check (nightly_rate >= 0),   -- baisa
  monthly_rate bigint not null default 0 check (monthly_rate >= 0),   -- baisa
  created_at timestamptz not null default now()
);
create index unit_types_property_idx on public.unit_types(property_id);

-- Seasonal overrides (Ramadan, Eid, Khareef...). Highest priority wins.
create table public.rate_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_type_id uuid not null references public.unit_types(id) on delete cascade,
  name text not null,
  period daterange not null,
  nightly_rate bigint check (nightly_rate >= 0),
  monthly_rate bigint check (monthly_rate >= 0),
  priority int not null default 0,
  created_at timestamptz not null default now()
);
create index rate_plans_type_period_idx on public.rate_plans using gist (unit_type_id, period);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete set null,
  unit_type_id uuid not null references public.unit_types(id),
  number text not null,
  -- Operational status. 'reserved' is derived per-date in views; the
  -- stored value tracks physical state.
  status public.unit_status not null default 'available',
  investor_owner text,       -- optional unit investor (FR-16 later)
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (property_id, number)
);
create index units_property_idx on public.units(property_id);

alter table public.properties enable row level security;
alter table public.floors enable row level security;
alter table public.unit_types enable row level security;
alter table public.rate_plans enable row level security;
alter table public.units enable row level security;

-- Read: every member. Write: owner/manager.
do $$
declare t text;
begin
  foreach t in array array['properties', 'floors', 'unit_types', 'rate_plans', 'units'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (tenant_id in (select private.user_tenant_ids()))', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (private.has_role(tenant_id, ''{owner,manager}''))
         with check (private.has_role(tenant_id, ''{owner,manager}''))', t);
  end loop;
end $$;

-- Housekeeping & maintenance staff may change unit status (FR-03, FR-40)
create policy units_status_ops on public.units for update to authenticated
  using (private.has_role(tenant_id, '{reception,housekeeping,maintenance}'))
  with check (private.has_role(tenant_id, '{reception,housekeeping,maintenance}'));

-- Price changes are audited (FR-54)
create trigger unit_types_audit after insert or update or delete on public.unit_types
  for each row execute function private.audit_trigger();
create trigger rate_plans_audit after insert or update or delete on public.rate_plans
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------------
-- Pricing: nightly price for a unit type on a date (season-aware)
-- ---------------------------------------------------------------------
create or replace function public.nightly_price(p_unit_type uuid, p_date date)
returns bigint
language sql stable set search_path = ''
as $$
  select coalesce(
    (select rp.nightly_rate from public.rate_plans rp
      where rp.unit_type_id = p_unit_type and rp.period @> p_date and rp.nightly_rate is not null
      order by rp.priority desc, rp.created_at desc limit 1),
    (select ut.nightly_rate from public.unit_types ut where ut.id = p_unit_type))
$$;

create or replace function public.monthly_price(p_unit_type uuid, p_date date)
returns bigint
language sql stable set search_path = ''
as $$
  select coalesce(
    (select rp.monthly_rate from public.rate_plans rp
      where rp.unit_type_id = p_unit_type and rp.period @> p_date and rp.monthly_rate is not null
      order by rp.priority desc, rp.created_at desc limit 1),
    (select ut.monthly_rate from public.unit_types ut where ut.id = p_unit_type))
$$;

-- Quote a nightly stay: total of each night's price
create or replace function public.quote_stay(p_unit_type uuid, p_from date, p_to date)
returns bigint
language sql stable set search_path = ''
as $$
  select coalesce(sum(public.nightly_price(p_unit_type, d::date)), 0)::bigint
  from generate_series(p_from, p_to - 1, interval '1 day') d
$$;
