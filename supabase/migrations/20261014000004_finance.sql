-- =====================================================================
-- 0004 — Folios, charges, payments, taxes, invoices, expenses, shifts
-- (FR-30..35, CR-03..07)
-- =====================================================================

grant usage on sequence public.reservation_code_seq to authenticated;

create table public.folios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid unique references public.reservations(id) on delete cascade,
  guest_id uuid references public.guests(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index folios_tenant_idx on public.folios(tenant_id, status);

-- Charges are pre-tax amounts; taxes are derived from tax_rules.
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  folio_id uuid not null references public.folios(id) on delete cascade,
  kind text not null default 'room'
    check (kind in ('room', 'rent', 'service', 'food', 'laundry', 'damage', 'utility', 'discount', 'other')),
  description text not null,
  amount bigint not null,                       -- baisa; discount lines are negative
  taxable boolean not null default true,
  service_date date not null default current_date,
  voided_at timestamptz,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index charges_folio_idx on public.charges(folio_id);

create table public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  opened_by uuid not null default auth.uid(),
  opened_at timestamptz not null default now(),
  opening_float bigint not null default 0,
  closed_by uuid,
  closed_at timestamptz,
  expected_cash bigint,
  counted_cash bigint,
  difference bigint,
  notes text
);
create unique index cash_shifts_one_open on public.cash_shifts(property_id, opened_by) where closed_at is null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  folio_id uuid not null references public.folios(id) on delete cascade,
  kind public.payment_kind not null default 'payment',
  method public.payment_method not null,
  amount bigint not null check (amount > 0),    -- always positive; kind gives direction
  reference text,
  notes text,
  cash_shift_id uuid references public.cash_shifts(id),
  received_by uuid default auth.uid(),
  received_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);
create index payments_folio_idx on public.payments(folio_id);
create index payments_tenant_at_idx on public.payments(tenant_id, received_at);

-- Configurable tax / fee engine (FR-31). rate in basis points (500 = 5%).
-- basis 'base' = on charges subtotal; 'cumulative' = subtotal + earlier lines.
create table public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,   -- null = all properties
  code text not null check (code in ('service', 'tourism', 'municipality', 'vat', 'other')),
  name_ar text not null,
  name_en text not null,
  rate_bp int not null check (rate_bp between 0 and 10000),
  basis text not null default 'base' check (basis in ('base', 'cumulative')),
  is_revenue boolean not null default false,  -- service charge is staff money, not revenue (CR-06)
  sort int not null default 0,
  effective_from date not null default '2026-01-01',
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index tax_rules_tenant_idx on public.tax_rules(tenant_id, active);
create trigger tax_rules_audit after insert or update or delete on public.tax_rules
  for each row execute function private.audit_trigger();

-- Gap-free sequential numbering per tenant & series (FR-30)
create table public.document_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  series text not null,
  last_value bigint not null default 0,
  primary key (tenant_id, series)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id),
  folio_id uuid not null references public.folios(id),
  series text not null default 'INV',
  number bigint not null,
  issued_at timestamptz not null default now(),
  language text not null default 'ar' check (language in ('ar', 'en', 'bilingual')),
  subtotal bigint not null,
  tax_total bigint not null,
  total bigint not null,
  -- Immutable snapshot: seller, buyer, lines, tax lines (UBL-ready, CR-07)
  snapshot jsonb not null,
  fawtara_status text not null default 'not_submitted'
    check (fawtara_status in ('not_submitted', 'queued', 'submitted', 'accepted', 'rejected')),
  fawtara_ref text,
  issued_by uuid default auth.uid(),
  unique (tenant_id, series, number)
);
create index invoices_folio_idx on public.invoices(folio_id);

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id),
  series text not null default 'CN',
  number bigint not null,
  issued_at timestamptz not null default now(),
  reason text not null,
  subtotal bigint not null,
  tax_total bigint not null,
  total bigint not null,
  snapshot jsonb not null,
  fawtara_status text not null default 'not_submitted',
  issued_by uuid default auth.uid(),
  unique (tenant_id, series, number)
);

-- Invoices & credit notes are immutable except their e-invoicing status.
create or replace function private.invoice_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE: issued % cannot be deleted; issue a credit note', tg_table_name;
  end if;
  if (to_jsonb(new) - 'fawtara_status' - 'fawtara_ref')
     is distinct from (to_jsonb(old) - 'fawtara_status' - 'fawtara_ref') then
    raise exception 'IMMUTABLE: issued % cannot be edited; issue a credit note', tg_table_name;
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function private.invoice_guard();
create trigger credit_notes_guard before update or delete on public.credit_notes
  for each row execute function private.invoice_guard();

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  category text not null
    check (category in ('utilities', 'salaries', 'maintenance', 'supplies', 'laundry', 'marketing', 'rent', 'commission', 'government', 'other')),
  description text not null,
  amount bigint not null check (amount > 0),
  expense_date date not null default current_date,
  attachment_path text,
  method public.payment_method not null default 'cash',
  cash_shift_id uuid references public.cash_shifts(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index expenses_property_date_idx on public.expenses(property_id, expense_date);

alter table public.folios enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.cash_shifts enable row level security;
alter table public.tax_rules enable row level security;
alter table public.document_sequences enable row level security;
alter table public.invoices enable row level security;
alter table public.credit_notes enable row level security;
alter table public.expenses enable row level security;

do $$
declare t text;
begin
  foreach t in array array['folios', 'charges', 'payments', 'invoices', 'credit_notes', 'cash_shifts'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (private.has_role(tenant_id, ''{owner,manager,reception,accountant}''))', t);
  end loop;
end $$;

create policy folios_write on public.folios for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy charges_write on public.charges for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy payments_insert on public.payments for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
-- Editing/voiding a payment needs manager-level rights (and is audited)
create policy payments_update on public.payments for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,accountant}'));
create policy cash_shifts_write on public.cash_shifts for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));

create policy tax_rules_select on public.tax_rules for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy tax_rules_write on public.tax_rules for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,accountant}'));

-- Invoices are only created through issue_invoice() (SECURITY DEFINER)
revoke insert, update, delete on public.invoices, public.credit_notes, public.document_sequences from authenticated;

create policy expenses_select on public.expenses for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'));
create policy expenses_write on public.expenses for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,accountant,reception}'));

create trigger charges_audit after insert or update or delete on public.charges
  for each row execute function private.audit_trigger();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function private.audit_trigger();
create trigger invoices_audit after insert or update on public.invoices
  for each row execute function private.audit_trigger();
create trigger credit_notes_audit after insert on public.credit_notes
  for each row execute function private.audit_trigger();
create trigger cash_shifts_audit after insert or update on public.cash_shifts
  for each row execute function private.audit_trigger();
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function private.audit_trigger();
