-- =====================================================================
-- 0023 — Ideas adopted from Sijl:
--   archive instead of removal, correction requests, numbered receipts with
--   a public link and proof photo, ID-image access log, own-activity feed,
--   post-dated cheques, unit owners with statements.
-- =====================================================================

-- ---------------------------------------------------------------- archive
alter table public.expenses add column archived_at timestamptz;
alter table public.expenses add column archived_by uuid references auth.users(id);
alter table public.expenses add column archive_reason text check (char_length(archive_reason) <= 300);
-- expenses can be attributed to a unit (for owner statements)
alter table public.expenses add column unit_id uuid references public.units(id);
create index expenses_unit_idx on public.expenses(unit_id);
create index expenses_archived_by_idx on public.expenses(archived_by);

create or replace function public.shift_expected_cash(p_shift uuid)
returns bigint
language sql stable set search_path = ''
as $$
  select s.opening_float
    + coalesce((select sum(case when p.kind in ('payment', 'deposit') then p.amount
                                when p.kind in ('refund', 'deposit_refund') then -p.amount else 0 end)
                  from public.payments p where p.cash_shift_id = s.id and p.voided_at is null), 0)
    - coalesce((select sum(e.amount) from public.expenses e where e.cash_shift_id = s.id and e.archived_at is null), 0)
  from public.cash_shifts s where s.id = p_shift
$$;

create or replace function public.shift_breakdown(p_shift uuid)
returns table (opening_float bigint, cash_in bigint, cash_refunds bigint, cash_expenses bigint, expected bigint, payments_count int, expenses_count int)
language sql stable security definer set search_path = ''
as $$
  with s as (
    select * from public.cash_shifts
     where id = p_shift
       and (opened_by = auth.uid() or private.has_role(tenant_id, '{owner,manager,accountant}'))
  ),
  pay as (
    select coalesce(sum(case when p.kind in ('payment', 'deposit') then p.amount else 0 end), 0)::bigint as cash_in,
           coalesce(sum(case when p.kind in ('refund', 'deposit_refund') then p.amount else 0 end), 0)::bigint as refunds,
           count(*)::int as n
      from public.payments p, s where p.cash_shift_id = s.id and p.voided_at is null
  ),
  exp as (
    select coalesce(sum(e.amount), 0)::bigint as total, count(*)::int as n
      from public.expenses e, s where e.cash_shift_id = s.id and e.archived_at is null
  )
  select s.opening_float, pay.cash_in, pay.refunds, exp.total,
         s.opening_float + pay.cash_in - pay.refunds - exp.total, pay.n, exp.n
    from s, pay, exp
$$;

create or replace function public.owner_dashboard(p_property uuid)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_today date := private.property_today(p_property);
  v_tz text := (select timezone from public.properties where id = p_property);
  v_month_start date := date_trunc('month', v_today)::date;
  v_counts jsonb;
  v_units int;
  v_in_house int;
  v_income_today bigint;
  v_income_month bigint;
  v_expenses_month bigint;
  v_receivable bigint := 0;
  v_deposits bigint := 0;
  f record;
  s jsonb;
begin
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb), coalesce(sum(n), 0)::int
    into v_counts, v_units
    from (select b.status, count(*) n from public.unit_board(p_property, v_today) b group by b.status) x;

  select count(*) into v_in_house from public.reservations
   where property_id = p_property and status = 'checked_in';

  select
    coalesce(sum(case when p.kind in ('payment') then p.amount when p.kind = 'refund' then -p.amount else 0 end)
             filter (where (p.received_at at time zone v_tz)::date = v_today), 0),
    coalesce(sum(case when p.kind in ('payment') then p.amount when p.kind = 'refund' then -p.amount else 0 end)
             filter (where (p.received_at at time zone v_tz)::date >= v_month_start), 0)
    into v_income_today, v_income_month
    from public.payments p join public.folios fo on fo.id = p.folio_id
   where fo.property_id = p_property and p.voided_at is null
     and p.received_at >= (v_month_start - 1)::timestamp at time zone v_tz;

  select coalesce(sum(amount), 0) into v_expenses_month from public.expenses
   where property_id = p_property and expense_date >= v_month_start and archived_at is null;

  for f in select fo.id from public.folios fo
            where fo.property_id = p_property and fo.status = 'open' loop
    s := public.folio_summary(f.id);
    v_receivable := v_receivable + greatest((s->>'balance')::bigint, 0);
    v_deposits := v_deposits + (s->>'deposit_held')::bigint;
  end loop;

  return jsonb_build_object(
    'date', v_today,
    'units', v_units,
    'by_status', v_counts,
    'in_house', v_in_house,
    'occupancy_bp', case when v_units = 0 then 0 else (v_in_house * 10000 / v_units) end,
    'income_today', v_income_today,
    'income_month', v_income_month,
    'expenses_month', v_expenses_month,
    'receivable', v_receivable,
    'deposits_held', v_deposits,
    'arrivals', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', r.id, 'code', r.code, 'guest', g.full_name, 'phone', g.phone, 'unit', u.number,
                   'status', r.status, 'to', upper(r.stay)) order by u.number), '[]'::jsonb)
                   from public.reservations r join public.guests g on g.id = r.guest_id
                   join public.units u on u.id = r.unit_id
                  where r.property_id = p_property and lower(r.stay) = v_today
                    and r.status in ('tentative', 'confirmed', 'checked_in')),
    'departures', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', r.id, 'code', r.code, 'guest', g.full_name, 'phone', g.phone, 'unit', u.number,
                   'status', r.status) order by u.number), '[]'::jsonb)
                   from public.reservations r join public.guests g on g.id = r.guest_id
                   join public.units u on u.id = r.unit_id
                  where r.property_id = p_property and upper(r.stay) = v_today
                    and r.status in ('checked_in', 'checked_out')),
    'freeing_soon', (select coalesce(jsonb_agg(jsonb_build_object(
                   'unit', u.number, 'date', upper(r.stay)) order by upper(r.stay), u.number), '[]'::jsonb)
                   from public.reservations r join public.units u on u.id = r.unit_id
                  where r.property_id = p_property and r.status = 'checked_in'
                    and upper(r.stay) between v_today + 1 and v_today + 3));
end $$;

-- ---------------------------------------------------------------- correction requests
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  target text not null check (target in ('payment', 'charge', 'expense')),
  target_id uuid not null,
  action text not null check (action in ('void', 'edit')),
  proposed jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid not null default auth.uid() references auth.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500)
);
create index correction_requests_property_idx on public.correction_requests(property_id, status, requested_at desc);
create index correction_requests_tenant_idx on public.correction_requests(tenant_id);
create index correction_requests_requested_by_idx on public.correction_requests(requested_by);
create index correction_requests_decided_by_idx on public.correction_requests(decided_by);
alter table public.correction_requests enable row level security;
create policy correction_requests_select on public.correction_requests for select to authenticated
  using (requested_by = (select auth.uid()) or private.has_role(tenant_id, '{owner,manager}'));
create policy correction_requests_insert on public.correction_requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and tenant_id in (select private.user_tenant_ids()) and status = 'pending');
create trigger correction_requests_audit after insert or update on public.correction_requests
  for each row execute function private.audit_trigger();

-- Owner/manager approves (the change is applied here) or rejects a request.
create or replace function public.decide_correction(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_reason text;
begin
  select * into c from public.correction_requests where id = p_id for update;
  if not found or not private.has_role(c.tenant_id, '{owner,manager}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if c.status <> 'pending' then raise exception 'INVALID_STATUS: already decided'; end if;
  if p_approve then
    v_reason := 'تصحيح: ' || c.reason;
    if c.target = 'payment' then
      update public.payments set voided_at = now(), void_reason = v_reason
       where id = c.target_id and tenant_id = c.tenant_id and voided_at is null;
    elsif c.target = 'charge' then
      update public.charges set voided_at = now(), void_reason = v_reason
       where id = c.target_id and tenant_id = c.tenant_id and voided_at is null;
    elsif c.action = 'void' then
      update public.expenses set archived_at = now(), archived_by = auth.uid(), archive_reason = v_reason
       where id = c.target_id and tenant_id = c.tenant_id and archived_at is null;
    else
      update public.expenses set
        amount = coalesce((c.proposed->>'amount')::bigint, amount),
        description = coalesce(c.proposed->>'description', description),
        category = coalesce(c.proposed->>'category', category),
        expense_date = coalesce((c.proposed->>'expense_date')::date, expense_date)
       where id = c.target_id and tenant_id = c.tenant_id;
    end if;
  end if;
  update public.correction_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;
end $$;
revoke execute on function public.decide_correction(uuid, boolean, text) from public, anon;
grant execute on function public.decide_correction(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------- receipts & proof
alter table public.payments add column receipt_no bigint;
alter table public.payments add column receipt_token uuid not null default gen_random_uuid();
alter table public.payments add column proof_path text check (char_length(proof_path) <= 300);
create unique index payments_receipt_token_idx on public.payments(receipt_token);

create or replace function private.number_receipt()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.receipt_no is null then new.receipt_no := private.next_number(new.tenant_id, 'RCPT'); end if;
  return new;
end $$;
create trigger payments_number_receipt before insert on public.payments
  for each row execute function private.number_receipt();

-- number existing payments in the order they were received
do $$
declare r record;
begin
  for r in select id, tenant_id from public.payments where receipt_no is null order by received_at loop
    update public.payments set receipt_no = private.next_number(r.tenant_id, 'RCPT') where id = r.id;
  end loop;
end $$;
create unique index payments_receipt_no_idx on public.payments(tenant_id, receipt_no);

-- Public receipt (opened from the WhatsApp link): only what the guest needs to see.
create or replace function public.receipt_public(p_token uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'receipt_no', p.receipt_no, 'amount', p.amount, 'kind', p.kind, 'method', p.method,
    'reference', p.reference, 'received_at', p.received_at, 'voided', p.voided_at is not null,
    'property', pr.name_ar, 'property_en', pr.name_en, 'phone', pr.phone, 'address', pr.address,
    'vat_no', pr.vat_no, 'timezone', pr.timezone,
    'guest', g.full_name, 'code', r.code, 'unit', u.number, 'staff', m.full_name)
  from public.payments p
  join public.folios f on f.id = p.folio_id
  join public.properties pr on pr.id = f.property_id
  left join public.reservations r on r.id = f.reservation_id
  left join public.units u on u.id = r.unit_id
  left join public.guests g on g.id = coalesce(f.guest_id, r.guest_id)
  left join public.memberships m on m.user_id = p.received_by and m.tenant_id = p.tenant_id
  where p.receipt_token = p_token
$$;
revoke execute on function public.receipt_public(uuid) from public;
grant execute on function public.receipt_public(uuid) to anon, authenticated;

-- Finance roles may attach a proof photo to an existing payment (nothing else)
create or replace function public.set_payment_proof(p_payment uuid, p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.payments where id = p_payment;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager,reception,accountant}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if split_part(p_path, '/', 1) <> v_tenant::text then raise exception 'FORBIDDEN: path'; end if;
  update public.payments set proof_path = p_path where id = p_payment;
end $$;
revoke execute on function public.set_payment_proof(uuid, text) from public, anon;
grant execute on function public.set_payment_proof(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy payment_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception,accountant}'));
create policy payment_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception,accountant}'));

-- ---------------------------------------------------------------- ID image access log
create table public.document_access_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guest_document_id uuid references public.guest_documents(id) on delete set null,
  guest_id uuid references public.guests(id) on delete set null,
  viewed_by uuid not null default auth.uid() references auth.users(id),
  viewed_at timestamptz not null default now()
);
create index document_access_log_tenant_idx on public.document_access_log(tenant_id, viewed_at desc);
create index document_access_log_doc_idx on public.document_access_log(guest_document_id);
create index document_access_log_guest_idx on public.document_access_log(guest_id);
create index document_access_log_viewer_idx on public.document_access_log(viewed_by);
alter table public.document_access_log enable row level security;
create policy document_access_log_select on public.document_access_log for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'));
create policy document_access_log_insert on public.document_access_log for insert to authenticated
  with check (viewed_by = (select auth.uid()) and private.has_role(tenant_id, '{owner,manager,reception}'));

-- ---------------------------------------------------------------- own activity feed
-- every employee may read the audit entries of their own actions
create policy audit_select_own on public.audit_log for select to authenticated
  using (actor = (select auth.uid()) and tenant_id in (select private.user_tenant_ids()));

-- ---------------------------------------------------------------- post-dated cheques
create table public.cheques (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  guest_id uuid references public.guests(id) on delete set null,
  cheque_no text not null check (char_length(cheque_no) <= 40),
  bank text check (char_length(bank) <= 80),
  amount bigint not null check (amount > 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'deposited', 'cleared', 'bounced', 'cancelled')),
  deposited_at timestamptz,
  cleared_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text check (char_length(bounce_reason) <= 300),
  payment_id uuid references public.payments(id) on delete set null,
  photo_path text check (char_length(photo_path) <= 300),
  notes text check (char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index cheques_property_idx on public.cheques(property_id, status, due_date);
create index cheques_tenant_idx on public.cheques(tenant_id);
create index cheques_reservation_idx on public.cheques(reservation_id);
create index cheques_guest_idx on public.cheques(guest_id);
create index cheques_payment_idx on public.cheques(payment_id);
create index cheques_created_by_idx on public.cheques(created_by);
alter table public.cheques enable row level security;
create policy cheques_select on public.cheques for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy cheques_insert on public.cheques for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}') and status = 'pending');
create policy cheques_update on public.cheques for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,accountant}'));
create trigger cheques_audit after insert or update on public.cheques
  for each row execute function private.audit_trigger();

-- Move a cheque along: deposited → cleared (books the payment) or bounced (reverses it).
create or replace function public.set_cheque_status(p_cheque uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_folio uuid;
  v_payment uuid;
begin
  select * into c from public.cheques where id = p_cheque for update;
  if not found then raise exception 'NOT_FOUND: cheque'; end if;
  if p_status = 'deposited' then
    if not private.has_role(c.tenant_id, '{owner,manager,reception,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
    if c.status <> 'pending' then raise exception 'INVALID_STATUS: cheque'; end if;
    update public.cheques set status = 'deposited', deposited_at = now() where id = c.id;
  elsif p_status = 'cleared' then
    if not private.has_role(c.tenant_id, '{owner,manager,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
    if c.status not in ('pending', 'deposited') then raise exception 'INVALID_STATUS: cheque'; end if;
    select id into v_folio from public.folios where reservation_id = c.reservation_id;
    if v_folio is not null then
      insert into public.payments(tenant_id, folio_id, kind, method, amount, reference, notes)
      values (c.tenant_id, v_folio, 'payment', 'transfer', c.amount, 'شيك ' || c.cheque_no, coalesce(c.bank, ''))
      returning id into v_payment;
    end if;
    update public.cheques set status = 'cleared', cleared_at = now(), payment_id = v_payment where id = c.id;
  elsif p_status = 'bounced' then
    if not private.has_role(c.tenant_id, '{owner,manager,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
    if c.status not in ('deposited', 'cleared', 'pending') then raise exception 'INVALID_STATUS: cheque'; end if;
    -- a returned cheque puts the instalment back as unpaid
    if c.payment_id is not null then
      update public.payments set voided_at = now(), void_reason = 'شيك مرتجع: ' || coalesce(p_reason, '')
       where id = c.payment_id and voided_at is null;
    end if;
    update public.cheques set status = 'bounced', bounced_at = now(), bounce_reason = p_reason where id = c.id;
  elsif p_status = 'cancelled' then
    if not private.has_role(c.tenant_id, '{owner,manager,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
    if c.status not in ('pending', 'bounced') then raise exception 'INVALID_STATUS: cheque'; end if;
    update public.cheques set status = 'cancelled', notes = coalesce(p_reason, notes) where id = c.id;
  else
    raise exception 'INVALID_STATUS: %', p_status;
  end if;
end $$;
revoke execute on function public.set_cheque_status(uuid, text, text) from public, anon;
grant execute on function public.set_cheque_status(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheque-photos', 'cheque-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy cheque_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'cheque-photos'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception,accountant}'));
create policy cheque_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cheque-photos'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception,accountant}'));

-- ---------------------------------------------------------------- unit owners & statements
create table public.unit_owners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  phone text check (char_length(phone) <= 30),
  email text check (char_length(email) <= 160),
  commission_bp int not null default 1000 check (commission_bp between 0 and 10000),
  language text not null default 'ar' check (language in ('ar', 'en')),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index unit_owners_tenant_idx on public.unit_owners(tenant_id);
alter table public.units add column owner_id uuid references public.unit_owners(id) on delete set null;
create index units_owner_idx on public.units(owner_id);

create table public.owner_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_id uuid not null references public.unit_owners(id) on delete cascade,
  amount bigint not null check (amount > 0),
  paid_on date not null,
  method text not null default 'transfer' check (method in ('cash', 'card', 'transfer')),
  reference text check (char_length(reference) <= 120),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index owner_payouts_owner_idx on public.owner_payouts(owner_id, paid_on);
create index owner_payouts_tenant_idx on public.owner_payouts(tenant_id);
create index owner_payouts_created_by_idx on public.owner_payouts(created_by);

alter table public.unit_owners enable row level security;
alter table public.owner_payouts enable row level security;
create policy unit_owners_select on public.unit_owners for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'));
create policy unit_owners_write on public.unit_owners for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));
create policy owner_payouts_select on public.owner_payouts for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,accountant}'));
create policy owner_payouts_insert on public.owner_payouts for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager,accountant}'));
create trigger unit_owners_audit after insert or update on public.unit_owners
  for each row execute function private.audit_trigger();
create trigger owner_payouts_audit after insert on public.owner_payouts
  for each row execute function private.audit_trigger();

-- Owner statement for a period: room/rent revenue of the owner's units (pre-tax),
-- management commission, unit expenses, payouts, opening and closing balance.
create or replace function public.owner_statement(p_owner uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  o record;
  v_rev_before bigint; v_exp_before bigint; v_pay_before bigint;
  v_rev bigint; v_exp bigint; v_pay bigint;
  v_opening bigint; v_comm bigint;
begin
  select * into o from public.unit_owners where id = p_owner;
  if not found then raise exception 'NOT_FOUND: owner'; end if;

  -- revenue = non-voided room/rent charges on reservations of the owner's units
  select coalesce(sum(ch.amount) filter (where ch.service_date < p_from), 0),
         coalesce(sum(ch.amount) filter (where ch.service_date between p_from and p_to), 0)
    into v_rev_before, v_rev
    from public.charges ch
    join public.folios f on f.id = ch.folio_id
    join public.reservations r on r.id = f.reservation_id
    join public.units u on u.id = r.unit_id
   where u.owner_id = p_owner and ch.voided_at is null and ch.kind in ('room', 'rent') and ch.service_date <= p_to;

  select coalesce(sum(e.amount) filter (where e.expense_date < p_from), 0),
         coalesce(sum(e.amount) filter (where e.expense_date between p_from and p_to), 0)
    into v_exp_before, v_exp
    from public.expenses e join public.units u on u.id = e.unit_id
   where u.owner_id = p_owner and e.archived_at is null and e.expense_date <= p_to;

  select coalesce(sum(amount) filter (where paid_on < p_from), 0),
         coalesce(sum(amount) filter (where paid_on between p_from and p_to), 0)
    into v_pay_before, v_pay
    from public.owner_payouts where owner_id = p_owner and paid_on <= p_to;

  v_opening := v_rev_before - (v_rev_before * o.commission_bp / 10000) - v_exp_before - v_pay_before;
  v_comm := v_rev * o.commission_bp / 10000;

  return jsonb_build_object(
    'owner', jsonb_build_object('id', o.id, 'name', o.name, 'phone', o.phone, 'commission_bp', o.commission_bp, 'language', o.language),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'revenue', v_rev,
    'commission', v_comm,
    'expenses', v_exp,
    'payouts', v_pay,
    'closing', v_opening + v_rev - v_comm - v_exp - v_pay,
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'number', u.number,
                'revenue', (select coalesce(sum(ch.amount), 0) from public.charges ch
                              join public.folios f on f.id = ch.folio_id join public.reservations r on r.id = f.reservation_id
                             where r.unit_id = u.id and ch.voided_at is null and ch.kind in ('room', 'rent')
                               and ch.service_date between p_from and p_to),
                'expenses', (select coalesce(sum(e.amount), 0) from public.expenses e
                              where e.unit_id = u.id and e.archived_at is null and e.expense_date between p_from and p_to))
              order by u.number), '[]'::jsonb) from public.units u where u.owner_id = p_owner),
    'expense_lines', (select coalesce(jsonb_agg(jsonb_build_object('date', e.expense_date, 'unit', u.number,
                'description', e.description, 'category', e.category, 'amount', e.amount) order by e.expense_date), '[]'::jsonb)
              from public.expenses e join public.units u on u.id = e.unit_id
             where u.owner_id = p_owner and e.archived_at is null and e.expense_date between p_from and p_to),
    'payout_lines', (select coalesce(jsonb_agg(jsonb_build_object('date', paid_on, 'amount', amount, 'method', method,
                'reference', reference) order by paid_on), '[]'::jsonb)
              from public.owner_payouts where owner_id = p_owner and paid_on between p_from and p_to));
end $$;
revoke execute on function public.owner_statement(uuid, date, date) from public, anon;
grant execute on function public.owner_statement(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------- alerts
create or replace function public.alerts(p_property uuid)
returns table (kind text, severity int, ref_id uuid, unit text, guest text, info text)
language sql stable security definer set search_path = ''
as $$
  with p as (
    select id, tenant_id, timezone, check_out_time,
           (now() at time zone timezone)::date as today,
           (now() at time zone timezone)::time as now_time,
           private.has_role(tenant_id, '{owner,manager,reception,accountant}') as sees_guests,
           private.has_role(tenant_id, '{owner,manager,reception}') as front_office,
           private.has_role(tenant_id, '{owner,manager,reception,accountant}') as finance,
           private.has_role(tenant_id, '{owner,manager,accountant}') as cash,
           private.can_feedback(tenant_id) as fb,
           private.has_role(tenant_id, '{owner,manager}') as approver
      from public.properties
     where id = p_property and tenant_id in (select private.user_tenant_ids())
  )
  -- 1) arrival today, but the unit is not ready (everyone, incl. housekeeping)
  select 'arrival_unit_not_ready', 1, r.id, u.number, case when p.sees_guests then g.full_name end, u.status::text
    from p
    join public.reservations r on r.property_id = p.id and lower(r.stay) = p.today and r.status in ('tentative', 'confirmed')
    join public.units u on u.id = r.unit_id and u.status <> 'available'
    left join public.guests g on g.id = r.guest_id
  union all
  -- 2) guest still in house after the departure date / check-out time
  select 'late_checkout', 1, r.id, u.number, g.full_name, upper(r.stay)::text
    from p
    join public.reservations r on r.property_id = p.id and r.status = 'checked_in'
     and (upper(r.stay) < p.today or (upper(r.stay) = p.today and p.now_time > p.check_out_time))
    join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.front_office
  union all
  -- 3) booked guest never arrived (arrival date passed)
  select 'possible_no_show', 2, r.id, u.number, g.full_name, lower(r.stay)::text
    from p
    join public.reservations r on r.property_id = p.id and r.status in ('tentative', 'confirmed') and lower(r.stay) < p.today
    join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.front_office
  union all
  -- 4) in-house guest with an expired ID / passport
  select 'document_expired', 2, r.id, u.number, g.full_name, g.doc_expiry::text
    from p
    join public.reservations r on r.property_id = p.id and r.status = 'checked_in'
    join public.guests g on g.id = r.guest_id and g.doc_expiry is not null and g.doc_expiry < p.today
    join public.units u on u.id = r.unit_id
   where p.front_office
  union all
  -- 5) rent due but not yet posted to the guest's account
  select 'rent_due', 2, r.id, u.number, g.full_name, b.due_date::text
    from p
    join public.reservations r on r.property_id = p.id and r.status in ('confirmed', 'checked_in')
    join public.contracts c on c.reservation_id = r.id
    join public.billing_schedules b on b.contract_id = c.id and b.status = 'scheduled' and b.due_date <= p.today
    join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.finance
  union all
  -- 6) cash drawer open for more than 14 hours
  select 'shift_open_long', 3, s.id, null, m.full_name, s.opened_at::text
    from p
    join public.cash_shifts s on s.property_id = p.id and s.closed_at is null and s.opened_at < now() - interval '14 hours'
    left join public.memberships m on m.user_id = s.opened_by and m.tenant_id = p.tenant_id
   where p.cash
  union all
  -- 6b) cash drawer closed short in the last 3 days
  select 'cash_shortage', 1, s.id, null, m.full_name, (-s.difference)::text
    from p
    join public.cash_shifts s on s.property_id = p.id and s.closed_at > now() - interval '3 days' and s.difference < 0
    left join public.memberships m on m.user_id = s.opened_by and m.tenant_id = p.tenant_id
   where p.cash
  union all
  -- 8) guest complaint not yet handled
  select 'new_complaint', 2, f.id, f.room, f.guest_name, left(f.message, 80)
    from p
    join public.feedback f on f.property_id = p.id and f.kind = 'complaint' and f.status = 'new'
   where p.fb
  union all
  -- 9) correction requests waiting for a decision
  select 'correction_pending', 2, c.id, null, m.full_name, c.target
    from p
    join public.correction_requests c on c.property_id = p.id and c.status = 'pending'
    left join public.memberships m on m.user_id = c.requested_by and m.tenant_id = p.tenant_id
   where p.approver
  union all
  -- 10) cheques due today or overdue and not yet deposited
  select 'cheque_due', case when ch.due_date < p.today then 1 else 2 end, ch.id, u.number, g.full_name, ch.due_date::text
    from p
    join public.cheques ch on ch.property_id = p.id and ch.status = 'pending' and ch.due_date <= p.today
    left join public.reservations r on r.id = ch.reservation_id
    left join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = ch.guest_id
   where p.finance
  union all
  -- 11) cheques returned by the bank in the last 14 days
  select 'cheque_bounced', 1, ch.id, u.number, g.full_name, ch.amount::text
    from p
    join public.cheques ch on ch.property_id = p.id and ch.status = 'bounced' and ch.bounced_at > now() - interval '14 days'
    left join public.reservations r on r.id = ch.reservation_id
    left join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = ch.guest_id
   where p.finance
  union all
  -- 12) monthly contracts ending within 30 days
  select 'contract_ending', 3, r.id, u.number, g.full_name, upper(r.stay)::text
    from p
    join public.reservations r on r.property_id = p.id and r.kind = 'contract' and r.status in ('confirmed', 'checked_in')
     and upper(r.stay) between p.today and p.today + 30
    join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.front_office
  union all
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;
