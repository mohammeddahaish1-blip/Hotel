-- =====================================================================
-- 0003 — Guests, reservations, contracts (FR-05, FR-10..14, FR-20..22)
-- =====================================================================

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  full_name_ar text,
  nationality text,                 -- ISO 3166 alpha-3 (as in MRZ)
  doc_type public.doc_type,
  doc_number text,
  doc_expiry date,
  date_of_birth date,
  gender text check (gender in ('M', 'F', 'X')),
  phone text,
  email text,
  preferred_language text not null default 'ar' check (preferred_language in ('ar', 'en')),
  notes text,
  -- FR-21 / CR-08: explicit consent is mandatory to store the profile
  consent_at timestamptz not null,
  consent_version text not null default 'v1',
  consent_transfer_abroad boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guests_tenant_idx on public.guests(tenant_id);
create index guests_name_trgm on public.guests using gin (full_name extensions.gin_trgm_ops);
create index guests_phone_idx on public.guests(tenant_id, phone);
create index guests_doc_idx on public.guests(tenant_id, doc_number);
create trigger guests_touch before update on public.guests
  for each row execute function private.touch_updated_at();

-- Scans of ID / passport live in a private storage bucket; only the path is kept.
create table public.guest_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  storage_path text not null,
  kind public.doc_type not null default 'passport',
  delete_after date,                -- NFR-04 retention
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index guest_documents_guest_idx on public.guest_documents(guest_id);

create sequence public.reservation_code_seq;

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  guest_id uuid not null references public.guests(id),
  code text not null default ('R' || lpad(nextval('public.reservation_code_seq')::text, 6, '0')),
  stay daterange not null check (not isempty(stay) and lower_inc(stay) and not upper_inc(stay)),
  kind public.reservation_kind not null default 'nightly',
  source public.booking_source not null default 'direct',
  status public.reservation_status not null default 'confirmed',
  adults int not null default 1 check (adults > 0),
  children int not null default 0 check (children >= 0),
  room_total bigint not null default 0 check (room_total >= 0),        -- baisa, before discount
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  discount_approved_by uuid,
  notes text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_amount <= room_total),
  -- FR-05: the database itself refuses overlapping active stays on a unit.
  constraint reservations_no_overlap exclude using gist (
    unit_id with =, stay with &&
  ) where (status in ('tentative', 'confirmed', 'checked_in'))
);
create index reservations_property_stay_idx on public.reservations using gist (property_id, stay);
create index reservations_guest_idx on public.reservations(guest_id);
create index reservations_tenant_status_idx on public.reservations(tenant_id, status);
create trigger reservations_touch before update on public.reservations
  for each row execute function private.touch_updated_at();
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function private.audit_trigger();

-- Long stays (FR-13): the contract's reservation occupies the same
-- availability engine; billing_schedules generate periodic charges.
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reservation_id uuid not null unique references public.reservations(id) on delete cascade,
  monthly_rent bigint not null check (monthly_rent >= 0),
  deposit_amount bigint not null default 0 check (deposit_amount >= 0),
  billing_day int not null default 1 check (billing_day between 1 and 28),
  electricity_included boolean not null default true,
  water_included boolean not null default true,
  terms text,
  created_at timestamptz not null default now()
);

create table public.billing_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.contracts(id) on delete cascade,
  period daterange not null,
  due_date date not null,
  amount bigint not null check (amount >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'posted', 'cancelled')),
  charge_id uuid,
  created_at timestamptz not null default now()
);
create index billing_schedules_due_idx on public.billing_schedules(tenant_id, status, due_date);

alter table public.guests enable row level security;
alter table public.guest_documents enable row level security;
alter table public.reservations enable row level security;
alter table public.contracts enable row level security;
alter table public.billing_schedules enable row level security;

-- Guest PII: front-office & finance roles only (housekeeping/maintenance never see it)
create policy guests_select on public.guests for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy guests_write on public.guests for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception}'));

create policy guest_documents_select on public.guest_documents for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));
create policy guest_documents_write on public.guest_documents for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception}'));

create policy reservations_select on public.reservations for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy reservations_write on public.reservations for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception}'));

create policy contracts_select on public.contracts for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy contracts_write on public.contracts for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));

create policy billing_select on public.billing_schedules for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy billing_write on public.billing_schedules for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,accountant}'));

-- ---------------------------------------------------------------------
-- Private bucket for ID scans (NFR-03): path = <tenant_id>/<guest_id>/<file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guest-docs', 'guest-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy guest_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'guest-docs'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception}'));
create policy guest_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'guest-docs'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception}'));
create policy guest_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'guest-docs'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager}'));
