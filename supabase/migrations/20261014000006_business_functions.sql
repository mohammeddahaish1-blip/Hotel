-- =====================================================================
-- 0006 — Business functions (RPC). Errors are raised as 'CODE: detail'
-- so the UI can translate them.
-- =====================================================================

alter table public.charges add column invoice_id uuid references public.invoices(id);
create index charges_uninvoiced_idx on public.charges(folio_id) where invoice_id is null and voided_at is null;

-- Invoiced charges are frozen (correct via credit note)
create or replace function private.charge_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CHARGE_LOCKED: charges cannot be deleted, void them instead';
  end if;
  if old.invoice_id is not null
     and (to_jsonb(new) - 'invoice_id') is distinct from (to_jsonb(old) - 'invoice_id') then
    raise exception 'CHARGE_LOCKED: charge already invoiced; issue a credit note';
  end if;
  return new;
end $$;
create trigger charges_guard before update or delete on public.charges
  for each row execute function private.charge_guard();

-- Payments are never deleted, only voided (audited)
create trigger payments_no_delete before delete on public.payments
  for each row execute function private.forbid_mutation();

create or replace function private.property_today(p_property uuid)
returns date language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select timezone from public.properties where id = p_property), 'Asia/Muscat'))::date
$$;

-- ---------------------------------------------------------------------
-- Onboarding: create tenant + owner membership + first property + taxes
-- ---------------------------------------------------------------------
create or replace function public.create_tenant(
  p_tenant_name text,
  p_property_name text,
  p_owner_name text,
  p_property_kind text default 'hotel',
  p_municipality text default 'muscat'
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_property uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED: sign in first'; end if;
  if exists (select 1 from public.memberships where user_id = v_uid and role = 'owner'
             and created_at > now() - interval '1 minute') then
    raise exception 'RATE_LIMIT: try again shortly';
  end if;

  insert into public.tenants(name) values (p_tenant_name) returning id into v_tenant;
  insert into public.memberships(tenant_id, user_id, role, full_name)
    values (v_tenant, v_uid, 'owner', coalesce(p_owner_name, ''));
  insert into public.properties(tenant_id, name_ar, kind, municipality)
    values (v_tenant, p_property_name, coalesce(p_property_kind, 'hotel'), coalesce(p_municipality, 'muscat'))
    returning id into v_property;

  -- Default Oman fee stack (section 7). All configurable per tenant.
  insert into public.tax_rules(tenant_id, code, name_ar, name_en, rate_bp, basis, is_revenue, sort) values
    (v_tenant, 'service',      'رسم الخدمة',          'Service charge',       0,   'base', false, 1),
    (v_tenant, 'tourism',      'رسم السياحة',         'Tourism levy',         400, 'base', false, 2),
    (v_tenant, 'municipality', 'رسم البلدية',         'Municipality fee',     500, 'base', false, 3),
    (v_tenant, 'vat',          'ضريبة القيمة المضافة', 'VAT',                  500, 'base', false, 4);

  return jsonb_build_object('tenant_id', v_tenant, 'property_id', v_property);
end $$;

-- ---------------------------------------------------------------------
-- Tax engine (FR-31). Returns {lines:[...], total}
-- ---------------------------------------------------------------------
create or replace function private.compute_taxes(
  p_tenant uuid, p_property uuid, p_taxable bigint, p_date date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r record;
  v_running bigint := 0;
  v_amt bigint;
  v_base bigint;
  v_lines jsonb := '[]'::jsonb;
begin
  for r in
    select * from public.tax_rules
    where tenant_id = p_tenant and active and rate_bp > 0
      and (property_id is null or property_id = p_property)
      and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
    order by sort, code
  loop
    v_base := case when r.basis = 'cumulative' then p_taxable + v_running else p_taxable end;
    v_amt := round(v_base::numeric * r.rate_bp / 10000.0)::bigint;
    v_running := v_running + v_amt;
    v_lines := v_lines || jsonb_build_object(
      'code', r.code, 'name_ar', r.name_ar, 'name_en', r.name_en,
      'rate_bp', r.rate_bp, 'basis', r.basis, 'base', v_base, 'amount', v_amt,
      'is_revenue', r.is_revenue);
  end loop;
  return jsonb_build_object('lines', v_lines, 'total', v_running);
end $$;

-- ---------------------------------------------------------------------
-- Folio summary: invoiced totals + taxes on not-yet-invoiced charges
-- ---------------------------------------------------------------------
create or replace function public.folio_summary(p_folio uuid)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  f record;
  v_uninv_taxable bigint;
  v_uninv_nontax bigint;
  v_taxes jsonb;
  v_invoiced bigint;
  v_credited bigint;
  v_paid bigint;
  v_deposit bigint;
  v_total bigint;
begin
  select * into f from public.folios where id = p_folio;
  if not found then raise exception 'NOT_FOUND: folio'; end if;

  select coalesce(sum(amount) filter (where taxable), 0),
         coalesce(sum(amount) filter (where not taxable), 0)
    into v_uninv_taxable, v_uninv_nontax
    from public.charges
   where folio_id = p_folio and voided_at is null and invoice_id is null;

  v_taxes := private.compute_taxes(f.tenant_id, f.property_id, greatest(v_uninv_taxable, 0),
                                   private.property_today(f.property_id));

  select coalesce(sum(total), 0) into v_invoiced from public.invoices where folio_id = p_folio;
  select coalesce(sum(cn.total), 0) into v_credited
    from public.credit_notes cn join public.invoices i on i.id = cn.invoice_id
   where i.folio_id = p_folio;

  select
    coalesce(sum(amount) filter (where kind in ('payment', 'deposit_applied')), 0)
      - coalesce(sum(amount) filter (where kind = 'refund'), 0),
    coalesce(sum(amount) filter (where kind = 'deposit'), 0)
      - coalesce(sum(amount) filter (where kind in ('deposit_refund', 'deposit_applied')), 0)
    into v_paid, v_deposit
    from public.payments where folio_id = p_folio and voided_at is null;

  v_total := v_invoiced - v_credited + v_uninv_taxable + v_uninv_nontax + (v_taxes->>'total')::bigint;

  return jsonb_build_object(
    'folio_id', p_folio,
    'invoiced_total', v_invoiced - v_credited,
    'uninvoiced_subtotal', v_uninv_taxable + v_uninv_nontax,
    'uninvoiced_taxes', v_taxes->'lines',
    'uninvoiced_tax_total', (v_taxes->>'total')::bigint,
    'total', v_total,
    'paid', v_paid,
    'deposit_held', v_deposit,
    'balance', v_total - v_paid);
end $$;

-- ---------------------------------------------------------------------
-- Availability (FR-04)
-- ---------------------------------------------------------------------
create or replace function public.available_units(
  p_property uuid, p_from date, p_to date, p_unit_type uuid default null
) returns table (
  unit_id uuid, number text, unit_type_id uuid, type_name text, floor_name text,
  capacity int, quote bigint, monthly_rate bigint
)
language sql stable set search_path = ''
as $$
  select u.id, u.number, u.unit_type_id, ut.name_ar, fl.name, ut.capacity,
         public.quote_stay(u.unit_type_id, p_from, p_to),
         public.monthly_price(u.unit_type_id, p_from)
    from public.units u
    join public.unit_types ut on ut.id = u.unit_type_id
    left join public.floors fl on fl.id = u.floor_id
   where u.property_id = p_property
     and u.active
     and p_to > p_from
     and u.status not in ('maintenance', 'out_of_service')
     and (p_unit_type is null or u.unit_type_id = p_unit_type)
     and not exists (
       select 1 from public.maintenance_tickets m
        where m.unit_id = u.id and m.blocks_availability and m.status <> 'closed')
     and not exists (
       select 1 from public.reservations r
        where r.unit_id = u.id
          and r.status in ('tentative', 'confirmed', 'checked_in')
          and r.stay && daterange(p_from, p_to))
   order by fl.sort nulls last, u.number
$$;

-- ---------------------------------------------------------------------
-- Billing schedule generation for contracts (FR-13)
-- ---------------------------------------------------------------------
create or replace function private.generate_schedule(p_contract uuid, p_from date, p_to date)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_start date := p_from;
  v_end date;
  v_full_end date;
  v_amount bigint;
  v_sum bigint := 0;
begin
  select * into c from public.contracts where id = p_contract;
  while v_start < p_to loop
    v_full_end := (v_start + interval '1 month')::date;
    v_end := least(v_full_end, p_to);
    v_amount := case when v_end = v_full_end then c.monthly_rent
                     else round(c.monthly_rent::numeric * (v_end - v_start) / (v_full_end - v_start))::bigint end;
    insert into public.billing_schedules(tenant_id, contract_id, period, due_date, amount)
      values (c.tenant_id, c.id, daterange(v_start, v_end), v_start, v_amount);
    v_sum := v_sum + v_amount;
    v_start := v_end;
  end loop;
  return v_sum;
end $$;

-- Post due rent rows as folio charges. Callable by staff (own tenants) or cron (all).
create or replace function public.post_due_billing(p_tenant uuid default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  b record;
  v_charge uuid;
  v_count int := 0;
begin
  if auth.uid() is not null and (p_tenant is null
      or not private.has_role(p_tenant, '{owner,manager,reception,accountant}')) then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  for b in
    select bs.*, f.id as folio_id
      from public.billing_schedules bs
      join public.contracts c on c.id = bs.contract_id
      join public.reservations r on r.id = c.reservation_id
      join public.folios f on f.reservation_id = r.id
     where bs.status = 'scheduled'
       and bs.due_date <= private.property_today(r.property_id)
       and r.status in ('confirmed', 'checked_in')
       and (p_tenant is null or bs.tenant_id = p_tenant)
     for update of bs skip locked
  loop
    insert into public.charges(tenant_id, folio_id, kind, description, amount, service_date, created_by)
      values (b.tenant_id, b.folio_id, 'rent',
              'إيجار الفترة ' || to_char(lower(b.period), 'YYYY-MM-DD') || ' – ' || to_char(upper(b.period) - 1, 'YYYY-MM-DD'),
              b.amount, b.due_date, null)
      returning id into v_charge;
    update public.billing_schedules set status = 'posted', charge_id = v_charge where id = b.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- Pricing helper: (re)post room charges for a nightly reservation
-- ---------------------------------------------------------------------
create or replace function private.reprice_nightly(p_res uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_folio uuid;
  v_nights int;
  v_invoiced bigint;
  v_delta bigint;
begin
  select * into r from public.reservations where id = p_res;
  select id into v_folio from public.folios where reservation_id = p_res;
  v_nights := upper(r.stay) - lower(r.stay);

  update public.charges set voided_at = now(), void_reason = 'reprice'
   where folio_id = v_folio and kind in ('room', 'discount') and voided_at is null and invoice_id is null;

  -- Room revenue already invoiced stays; only the difference is posted.
  select coalesce(sum(amount), 0) into v_invoiced from public.charges
   where folio_id = v_folio and kind in ('room', 'discount') and voided_at is null and invoice_id is not null;

  if v_invoiced = 0 then
    insert into public.charges(tenant_id, folio_id, kind, description, amount, service_date)
      values (r.tenant_id, v_folio, 'room',
              'إقامة ' || v_nights || ' ليلة (' || to_char(lower(r.stay), 'YYYY-MM-DD') || ' → ' || to_char(upper(r.stay), 'YYYY-MM-DD') || ')',
              r.room_total, lower(r.stay));
    if r.discount_amount > 0 then
      insert into public.charges(tenant_id, folio_id, kind, description, amount, service_date)
        values (r.tenant_id, v_folio, 'discount', 'خصم', -r.discount_amount, lower(r.stay));
    end if;
  else
    v_delta := (r.room_total - r.discount_amount) - v_invoiced;
    if v_delta <> 0 then
      insert into public.charges(tenant_id, folio_id, kind, description, amount, service_date)
        values (r.tenant_id, v_folio, 'room',
                'تعديل الإقامة إلى ' || v_nights || ' ليلة (حتى ' || to_char(upper(r.stay), 'YYYY-MM-DD') || ')',
                v_delta, private.property_today(r.property_id));
    end if;
  end if;
end $$;

create or replace function private.check_discount(p_tenant uuid, p_total bigint, p_discount bigint)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_max int;
begin
  if p_discount <= 0 then return null; end if;
  if private.has_role(p_tenant, '{owner,manager}') then return auth.uid(); end if;
  select max_reception_discount_bp into v_max from public.tenants where id = p_tenant;
  if p_discount * 10000 > p_total * v_max then
    raise exception 'DISCOUNT_NEEDS_MANAGER: discount above % bp requires a manager', v_max;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- Reservations (FR-10..13)
-- ---------------------------------------------------------------------
create or replace function public.create_reservation(
  p_property uuid,
  p_unit uuid,
  p_guest uuid,
  p_from date,
  p_to date,
  p_source public.booking_source default 'direct',
  p_kind public.reservation_kind default 'nightly',
  p_adults int default 1,
  p_children int default 0,
  p_discount bigint default 0,
  p_notes text default null,
  p_status public.reservation_status default 'confirmed',
  p_monthly_rent bigint default null,
  p_deposit bigint default 0,
  p_billing_day int default 1
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_unit record;
  v_total bigint;
  v_res uuid;
  v_folio uuid;
  v_contract uuid;
  v_approver uuid;
  v_rent bigint;
begin
  select tenant_id into v_tenant from public.properties where id = p_property;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_to <= p_from then raise exception 'INVALID_DATES: check-out must be after check-in'; end if;
  if p_status not in ('tentative', 'confirmed') then raise exception 'INVALID_STATUS: %', p_status; end if;

  select * into v_unit from public.units where id = p_unit and property_id = p_property and active;
  if not found then raise exception 'NOT_FOUND: unit'; end if;
  if v_unit.status in ('maintenance', 'out_of_service') or exists (
       select 1 from public.maintenance_tickets m
        where m.unit_id = p_unit and m.blocks_availability and m.status <> 'closed') then
    raise exception 'UNIT_BLOCKED: unit is under maintenance or out of service';
  end if;
  if not exists (select 1 from public.guests where id = p_guest and tenant_id = v_tenant) then
    raise exception 'NOT_FOUND: guest';
  end if;

  if p_kind = 'nightly' then
    v_total := public.quote_stay(v_unit.unit_type_id, p_from, p_to);
  else
    v_rent := coalesce(p_monthly_rent, public.monthly_price(v_unit.unit_type_id, p_from));
    v_total := 0;   -- computed from schedule below
  end if;

  v_approver := private.check_discount(v_tenant, greatest(v_total, coalesce(v_rent, 0)), coalesce(p_discount, 0));

  begin
    insert into public.reservations(tenant_id, property_id, unit_id, guest_id, stay, kind, source, status,
                                    adults, children, room_total, discount_amount, discount_approved_by, notes)
    values (v_tenant, p_property, p_unit, p_guest, daterange(p_from, p_to), p_kind, p_source, p_status,
            coalesce(p_adults, 1), coalesce(p_children, 0), v_total,
            case when p_kind = 'nightly' then least(coalesce(p_discount, 0), v_total) else 0 end,
            v_approver, p_notes)
    returning id into v_res;
  exception when exclusion_violation then
    raise exception 'CONFLICT: unit already booked for part of this period';
  end;

  insert into public.folios(tenant_id, property_id, reservation_id, guest_id)
    values (v_tenant, p_property, v_res, p_guest) returning id into v_folio;

  if p_kind = 'nightly' then
    perform private.reprice_nightly(v_res);
  else
    insert into public.contracts(tenant_id, reservation_id, monthly_rent, deposit_amount, billing_day)
      values (v_tenant, v_res, greatest(v_rent - coalesce(p_discount, 0), 0), coalesce(p_deposit, 0), coalesce(p_billing_day, 1))
      returning id into v_contract;
    v_total := private.generate_schedule(v_contract, p_from, p_to);
    update public.reservations set room_total = v_total where id = v_res;
    perform public.post_due_billing(v_tenant);
  end if;

  insert into public.outbox_events(tenant_id, event_type, aggregate_id, payload)
    values (v_tenant, 'reservation.created', v_res, jsonb_build_object('unit_id', p_unit, 'from', p_from, 'to', p_to));
  return v_res;
end $$;

-- Move to another unit and/or change dates (extend/shorten) — FR-06, FR-10
create or replace function public.change_reservation(
  p_res uuid, p_unit uuid, p_from date, p_to date
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_unit record;
  v_contract record;
  v_last_end date;
begin
  select * into r from public.reservations where id = p_res for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if r.status not in ('tentative', 'confirmed', 'checked_in') then
    raise exception 'INVALID_STATUS: reservation is %', r.status;
  end if;
  if p_to <= p_from then raise exception 'INVALID_DATES: check-out must be after check-in'; end if;
  if r.status = 'checked_in' and p_from <> lower(r.stay) then
    raise exception 'INVALID_DATES: arrival date of an in-house guest cannot change';
  end if;

  select * into v_unit from public.units where id = p_unit and property_id = r.property_id and active;
  if not found then raise exception 'NOT_FOUND: unit'; end if;
  if p_unit <> r.unit_id then
    if v_unit.status in ('maintenance', 'out_of_service') then
      raise exception 'UNIT_BLOCKED: unit is under maintenance or out of service';
    end if;
    if r.status = 'checked_in' and v_unit.status <> 'available' then
      raise exception 'UNIT_NOT_READY: target unit is not clean/ready';
    end if;
  end if;

  begin
    update public.reservations set unit_id = p_unit, stay = daterange(p_from, p_to) where id = p_res;
  exception when exclusion_violation then
    raise exception 'CONFLICT: unit already booked for part of this period';
  end;

  if r.status = 'checked_in' and p_unit <> r.unit_id then
    update public.units set status = 'dirty' where id = r.unit_id;
    update public.units set status = 'occupied' where id = p_unit;
    insert into public.hk_tasks(tenant_id, property_id, unit_id, kind, priority, due_date)
      values (r.tenant_id, r.property_id, r.unit_id, 'checkout', 1, private.property_today(r.property_id));
  end if;

  if r.kind = 'nightly' then
    if daterange(p_from, p_to) <> r.stay or v_unit.unit_type_id <> (select unit_type_id from public.units where id = r.unit_id) then
      update public.reservations
         set room_total = public.quote_stay(v_unit.unit_type_id, p_from, p_to),
             discount_amount = least(discount_amount, public.quote_stay(v_unit.unit_type_id, p_from, p_to))
       where id = p_res;
      perform private.reprice_nightly(p_res);
    end if;
  elsif daterange(p_from, p_to) <> r.stay then
    select * into v_contract from public.contracts where reservation_id = p_res;
    update public.billing_schedules set status = 'cancelled'
     where contract_id = v_contract.id and status = 'scheduled';
    select coalesce(max(upper(period)), p_from) into v_last_end
      from public.billing_schedules where contract_id = v_contract.id and status = 'posted';
    if v_last_end < p_to then
      perform private.generate_schedule(v_contract.id, v_last_end, p_to);
    end if;
    update public.reservations set room_total = (
      select coalesce(sum(amount), 0) from public.billing_schedules
       where contract_id = v_contract.id and status <> 'cancelled') where id = p_res;
  end if;
end $$;

create or replace function public.cancel_reservation(p_res uuid, p_reason text default null, p_no_show boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  select * into r from public.reservations where id = p_res for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if r.status not in ('tentative', 'confirmed') then
    raise exception 'INVALID_STATUS: reservation is %', r.status;
  end if;
  update public.reservations
     set status = case when p_no_show then 'no_show'::public.reservation_status else 'cancelled' end,
         cancelled_at = now(), cancel_reason = p_reason
   where id = p_res;
  -- Release un-invoiced room charges; a cancellation fee can be posted manually.
  update public.charges set voided_at = now(), void_reason = case when p_no_show then 'no_show' else 'cancelled' end
   where folio_id = (select id from public.folios where reservation_id = p_res)
     and kind in ('room', 'discount', 'rent') and voided_at is null and invoice_id is null;
  update public.billing_schedules set status = 'cancelled'
   where contract_id = (select id from public.contracts where reservation_id = p_res) and status = 'scheduled';
end $$;

-- ---------------------------------------------------------------------
-- Check-in / check-out (FR-23, FR-24)
-- ---------------------------------------------------------------------
create or replace function public.check_in(p_res uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  g record;
  v_unit public.unit_status;
  v_today date;
begin
  select * into r from public.reservations where id = p_res for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if r.status not in ('tentative', 'confirmed') then
    raise exception 'INVALID_STATUS: reservation is %', r.status;
  end if;
  v_today := private.property_today(r.property_id);
  if lower(r.stay) > v_today then
    raise exception 'TOO_EARLY: arrival date is %', lower(r.stay);
  end if;
  if upper(r.stay) <= v_today then
    raise exception 'STAY_ENDED: departure date has passed';
  end if;

  select * into g from public.guests where id = r.guest_id;
  if g.doc_number is null or g.nationality is null or g.doc_type is null then
    raise exception 'GUEST_DATA_INCOMPLETE: document type, number and nationality are required';
  end if;

  select status into v_unit from public.units where id = r.unit_id for update;
  if v_unit <> 'available' or exists (
       select 1 from public.maintenance_tickets m
        where m.unit_id = r.unit_id and m.blocks_availability and m.status <> 'closed') then
    raise exception 'UNIT_NOT_READY: unit status is %', v_unit;
  end if;

  update public.reservations set status = 'checked_in', checked_in_at = now() where id = p_res;
  update public.units set status = 'occupied' where id = r.unit_id;

  -- CR-01: queue the guest for police / ministry reporting
  insert into public.outbox_events(tenant_id, event_type, aggregate_id, payload)
    values (r.tenant_id, 'guest.checked_in', p_res, jsonb_build_object('guest_id', r.guest_id, 'unit_id', r.unit_id));

  return public.folio_summary((select id from public.folios where reservation_id = p_res));
end $$;

create or replace function public.check_out(p_res uuid, p_allow_balance boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_folio uuid;
  v_summary jsonb;
  v_balance bigint;
  v_today date;
  v_arrival_today boolean;
begin
  select * into r from public.reservations where id = p_res for update;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if r.status <> 'checked_in' then
    raise exception 'INVALID_STATUS: reservation is %', r.status;
  end if;
  select id into v_folio from public.folios where reservation_id = p_res;
  v_summary := public.folio_summary(v_folio);
  v_balance := (v_summary->>'balance')::bigint;
  -- FR-24: warn when an unpaid balance remains; staff must confirm explicitly
  if v_balance > 0 and not p_allow_balance then
    raise exception 'BALANCE_DUE: %', v_balance;
  end if;

  v_today := private.property_today(r.property_id);
  update public.reservations set status = 'checked_out', checked_out_at = now() where id = p_res;
  update public.units set status = 'dirty' where id = r.unit_id;
  update public.billing_schedules set status = 'cancelled'
   where contract_id = (select id from public.contracts where reservation_id = p_res)
     and status = 'scheduled';

  select exists (select 1 from public.reservations
                  where unit_id = r.unit_id and lower(stay) = v_today
                    and status in ('tentative', 'confirmed')) into v_arrival_today;
  insert into public.hk_tasks(tenant_id, property_id, unit_id, kind, priority, due_date)
    values (r.tenant_id, r.property_id, r.unit_id, 'checkout',
            case when v_arrival_today then 1 else 2 end, v_today);

  if v_balance <= 0 then
    update public.folios set status = 'closed', closed_at = now() where id = v_folio;
  end if;
  return v_summary;
end $$;

-- ---------------------------------------------------------------------
-- Housekeeping (FR-40) & maintenance blocking (FR-43)
-- ---------------------------------------------------------------------
create or replace function public.set_hk_task_status(p_task uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  select * into t from public.hk_tasks where id = p_task for update;
  if not found or not private.has_role(t.tenant_id, '{owner,manager,reception,housekeeping}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_status = 'in_progress' then
    update public.hk_tasks set status = 'in_progress', started_at = now(), assigned_to = coalesce(assigned_to, auth.uid())
     where id = p_task;
  elsif p_status = 'done' then
    update public.hk_tasks set status = 'done', finished_at = now(), finished_by = auth.uid(),
           started_at = coalesce(started_at, now())
     where id = p_task;
    -- "Ready" returns the unit to availability immediately
    update public.units set status = 'available'
     where id = t.unit_id and status = 'dirty'
       and not exists (select 1 from public.maintenance_tickets m
                        where m.unit_id = t.unit_id and m.blocks_availability and m.status <> 'closed');
  elsif p_status = 'cancelled' then
    update public.hk_tasks set status = 'cancelled' where id = p_task;
  else
    raise exception 'INVALID_STATUS: %', p_status;
  end if;
end $$;

create or replace function private.maintenance_sync()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'closed' and new.closed_at is null then
    new.closed_at := now();
  end if;
  if new.blocks_availability and new.status <> 'closed' then
    update public.units set status = 'maintenance' where id = new.unit_id and status <> 'occupied';
  elsif not exists (select 1 from public.maintenance_tickets m
                     where m.unit_id = new.unit_id and m.id <> new.id
                       and m.blocks_availability and m.status <> 'closed') then
    update public.units set status = 'dirty' where id = new.unit_id and status = 'maintenance';
  end if;
  return new;
end $$;
create trigger maintenance_sync before insert or update on public.maintenance_tickets
  for each row execute function private.maintenance_sync();

-- ---------------------------------------------------------------------
-- Cash shifts (FR-34) — payments/expenses in cash attach to the open shift
-- ---------------------------------------------------------------------
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
    end if;
    select id into new.cash_shift_id from public.cash_shifts
     where property_id = v_property and opened_by = auth.uid() and closed_at is null;
  end if;
  return new;
end $$;
create trigger payments_attach_shift before insert on public.payments
  for each row execute function private.attach_shift();
create trigger expenses_attach_shift before insert on public.expenses
  for each row execute function private.attach_shift();

create or replace function public.shift_expected_cash(p_shift uuid)
returns bigint
language sql stable set search_path = ''
as $$
  select s.opening_float
    + coalesce((select sum(case when p.kind in ('payment', 'deposit') then p.amount
                                when p.kind in ('refund', 'deposit_refund') then -p.amount else 0 end)
                  from public.payments p where p.cash_shift_id = s.id and p.voided_at is null), 0)
    - coalesce((select sum(e.amount) from public.expenses e where e.cash_shift_id = s.id), 0)
  from public.cash_shifts s where s.id = p_shift
$$;

create or replace function public.close_shift(p_shift uuid, p_counted bigint, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_expected bigint;
begin
  select * into s from public.cash_shifts where id = p_shift for update;
  if not found or s.closed_at is not null then raise exception 'NOT_FOUND: open shift'; end if;
  if s.opened_by <> auth.uid() and not private.has_role(s.tenant_id, '{owner,manager,accountant}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  v_expected := public.shift_expected_cash(p_shift);
  update public.cash_shifts
     set closed_at = now(), closed_by = auth.uid(), expected_cash = v_expected,
         counted_cash = p_counted, difference = p_counted - v_expected, notes = p_notes
   where id = p_shift;
  return jsonb_build_object('expected', v_expected, 'counted', p_counted, 'difference', p_counted - v_expected);
end $$;

-- ---------------------------------------------------------------------
-- Invoices & credit notes (FR-30, CR-07)
-- ---------------------------------------------------------------------
create or replace function private.next_number(p_tenant uuid, p_series text)
returns bigint
language sql security definer set search_path = ''
as $$
  insert into public.document_sequences(tenant_id, series, last_value) values (p_tenant, p_series, 1)
  on conflict (tenant_id, series) do update set last_value = public.document_sequences.last_value + 1
  returning last_value
$$;

create or replace function public.issue_invoice(p_folio uuid, p_language text default 'bilingual')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  f record;
  p record;
  g record;
  res record;
  v_lines jsonb;
  v_taxable bigint;
  v_nontax bigint;
  v_taxes jsonb;
  v_number bigint;
  v_id uuid := gen_random_uuid();
  v_today date;
begin
  select * into f from public.folios where id = p_folio for update;
  if not found or not private.has_role(f.tenant_id, '{owner,manager,reception,accountant}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  select * into p from public.properties where id = f.property_id;
  select * into g from public.guests where id = f.guest_id;
  select * into res from public.reservations where id = f.reservation_id;
  v_today := private.property_today(f.property_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'description', c.description, 'amount', c.amount,
           'taxable', c.taxable, 'date', c.service_date) order by c.service_date, c.created_at), '[]'::jsonb),
         coalesce(sum(c.amount) filter (where c.taxable), 0),
         coalesce(sum(c.amount) filter (where not c.taxable), 0)
    into v_lines, v_taxable, v_nontax
    from public.charges c
   where c.folio_id = p_folio and c.voided_at is null and c.invoice_id is null;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'NOTHING_TO_INVOICE: no uninvoiced charges';
  end if;
  if v_taxable + v_nontax < 0 then
    raise exception 'NEGATIVE_INVOICE: use a credit note';
  end if;

  v_taxes := private.compute_taxes(f.tenant_id, f.property_id, greatest(v_taxable, 0), v_today);
  v_number := private.next_number(f.tenant_id, 'INV');

  insert into public.invoices(id, tenant_id, property_id, folio_id, series, number, language,
                              subtotal, tax_total, total, snapshot)
  values (v_id, f.tenant_id, f.property_id, p_folio, 'INV', v_number, coalesce(p_language, 'bilingual'),
          v_taxable + v_nontax, (v_taxes->>'total')::bigint,
          v_taxable + v_nontax + (v_taxes->>'total')::bigint,
          jsonb_build_object(
            'invoice_type', 'tax_invoice',
            'currency', p.currency,
            'issue_date', v_today,
            'seller', jsonb_build_object('name_ar', p.name_ar, 'name_en', p.name_en, 'address', p.address,
                                         'phone', p.phone, 'vat_no', p.vat_no, 'license_no', p.license_no,
                                         'country', p.country),
            'buyer', jsonb_build_object('name', g.full_name, 'name_ar', g.full_name_ar, 'nationality', g.nationality,
                                        'doc_type', g.doc_type, 'doc_number', g.doc_number, 'phone', g.phone,
                                        'language', g.preferred_language),
            'stay', case when res.id is null then null else jsonb_build_object(
                      'code', res.code, 'from', lower(res.stay), 'to', upper(res.stay),
                      'unit', (select number from public.units where id = res.unit_id)) end,
            'lines', v_lines,
            'tax_lines', v_taxes->'lines'));

  update public.charges set invoice_id = v_id
   where folio_id = p_folio and voided_at is null and invoice_id is null;

  insert into public.outbox_events(tenant_id, event_type, aggregate_id, payload)
    values (f.tenant_id, 'invoice.issued', v_id, jsonb_build_object('number', v_number));
  return v_id;
end $$;

create or replace function public.issue_credit_note(p_invoice uuid, p_subtotal bigint, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  i record;
  v_credited bigint;
  v_lines jsonb := '[]'::jsonb;
  t jsonb;
  v_tax bigint := 0;
  v_amt bigint;
  v_id uuid := gen_random_uuid();
  v_number bigint;
begin
  select * into i from public.invoices where id = p_invoice;
  if not found or not private.has_role(i.tenant_id, '{owner,manager,accountant}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_subtotal <= 0 then raise exception 'INVALID_AMOUNT: must be positive'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED: reason is required'; end if;
  select coalesce(sum(subtotal), 0) into v_credited from public.credit_notes where invoice_id = p_invoice;
  if v_credited + p_subtotal > i.subtotal then
    raise exception 'INVALID_AMOUNT: exceeds invoice remaining %', i.subtotal - v_credited;
  end if;

  -- Proportional tax reversal using the invoice's own tax lines
  for t in select * from jsonb_array_elements(i.snapshot->'tax_lines') loop
    v_amt := case when i.subtotal = 0 then 0
                  else round((t->>'amount')::numeric * p_subtotal / i.subtotal)::bigint end;
    v_tax := v_tax + v_amt;
    v_lines := v_lines || (t || jsonb_build_object('amount', v_amt));
  end loop;

  v_number := private.next_number(i.tenant_id, 'CN');
  insert into public.credit_notes(id, tenant_id, invoice_id, number, reason, subtotal, tax_total, total, snapshot)
  values (v_id, i.tenant_id, p_invoice, v_number, p_reason, p_subtotal, v_tax, p_subtotal + v_tax,
          jsonb_build_object('original_invoice', i.series || '-' || i.number,
                             'seller', i.snapshot->'seller', 'buyer', i.snapshot->'buyer',
                             'currency', i.snapshot->'currency', 'tax_lines', v_lines));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Unit board & owner dashboard (FR-03, FR-50, FR-51)
-- ---------------------------------------------------------------------
create or replace function public.unit_board(p_property uuid, p_date date default null)
returns table (
  unit_id uuid, number text, floor_name text, floor_sort int, type_name text,
  stored_status public.unit_status, status text,
  reservation_id uuid, guest_name text, departure date, next_arrival date
)
language sql stable set search_path = ''
as $$
  with d as (select coalesce(p_date, private.property_today(p_property)) as day)
  select u.id, u.number, fl.name, fl.sort, ut.name_ar, u.status,
    case
      when u.status in ('maintenance', 'out_of_service') then u.status::text
      when cur.id is not null then 'occupied'
      when u.status = 'dirty' then 'dirty'
      when arr.id is not null then 'reserved'
      else 'available'
    end,
    coalesce(cur.id, arr.id),
    coalesce(gc.full_name, ga.full_name),
    upper(cur.stay),
    (select min(lower(r2.stay)) from public.reservations r2
      where r2.unit_id = u.id and r2.status in ('tentative', 'confirmed') and lower(r2.stay) >= d.day)
  from public.units u
  cross join d
  join public.unit_types ut on ut.id = u.unit_type_id
  left join public.floors fl on fl.id = u.floor_id
  left join lateral (select r.* from public.reservations r
                      where r.unit_id = u.id and r.status = 'checked_in' limit 1) cur on true
  left join lateral (select r.* from public.reservations r
                      where r.unit_id = u.id and r.status in ('tentative', 'confirmed')
                        and lower(r.stay) = d.day limit 1) arr on true
  left join public.guests gc on gc.id = cur.guest_id
  left join public.guests ga on ga.id = arr.guest_id
  where u.property_id = p_property and u.active
  order by fl.sort nulls last, u.number
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
   where property_id = p_property and expense_date >= v_month_start;

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

-- Occupancy / ADR / RevPAR per day (FR-51). Revenue = net room revenue spread per night.
create or replace function public.occupancy_report(p_property uuid, p_from date, p_to date)
returns table (day date, units int, sold int, room_revenue bigint, occupancy_bp int, adr bigint, revpar bigint)
language sql stable set search_path = ''
as $$
  with days as (
    select d::date as day from generate_series(p_from, p_to - 1, interval '1 day') d
  ), inv as (
    select count(*)::int as n from public.units
     where property_id = p_property and active and status <> 'out_of_service'
  ), nights as (
    select days.day, count(r.id)::int as sold,
           coalesce(sum((r.room_total - r.discount_amount)::numeric / nullif(upper(r.stay) - lower(r.stay), 0)), 0)::bigint as rev
      from days
      left join public.reservations r
        on r.property_id = p_property
       and r.status in ('confirmed', 'checked_in', 'checked_out')
       and r.stay @> days.day
     group by days.day
  )
  select n.day, inv.n, n.sold, n.rev,
         case when inv.n = 0 then 0 else n.sold * 10000 / inv.n end,
         case when n.sold = 0 then 0 else n.rev / n.sold end,
         case when inv.n = 0 then 0 else n.rev / inv.n end
    from nights n cross join inv
   order by n.day
$$;

-- Receivables aging (FR-35)
create or replace function public.aging_report(p_property uuid)
returns table (folio_id uuid, reservation_id uuid, code text, guest_name text, phone text,
               unit text, balance bigint, since date, age_days int, bucket text)
language sql stable set search_path = ''
as $$
  with b as (
    select fo.id, fo.reservation_id, (public.folio_summary(fo.id)->>'balance')::bigint as bal,
           (select min(c.service_date) from public.charges c
             where c.folio_id = fo.id and c.voided_at is null and c.amount > 0) as since
      from public.folios fo
     where fo.property_id = p_property and fo.status = 'open'
  )
  select b.id, b.reservation_id, r.code, g.full_name, g.phone, u.number, b.bal, b.since,
         (private.property_today(p_property) - b.since)::int,
         case when private.property_today(p_property) - b.since > 90 then '90+'
              when private.property_today(p_property) - b.since > 60 then '61-90'
              when private.property_today(p_property) - b.since > 30 then '31-60'
              else '0-30' end
    from b
    left join public.reservations r on r.id = b.reservation_id
    left join public.guests g on g.id = r.guest_id
    left join public.units u on u.id = r.unit_id
   where b.bal > 0 and b.since <= private.property_today(p_property)
   order by b.since
$$;

-- ---------------------------------------------------------------------
-- Compliance exports (CR-01, CR-02, CR-03)
-- ---------------------------------------------------------------------
create or replace function public.police_register(p_property uuid, p_from date, p_to date)
returns table (
  reservation_code text, guest_name text, guest_name_ar text, nationality text, doc_type public.doc_type,
  doc_number text, doc_expiry date, date_of_birth date, gender text, phone text,
  unit text, check_in timestamptz, expected_checkout date, check_out timestamptz, adults int, children int
)
language sql stable set search_path = ''
as $$
  select r.code, g.full_name, g.full_name_ar, g.nationality, g.doc_type, g.doc_number, g.doc_expiry,
         g.date_of_birth, g.gender, g.phone, u.number, r.checked_in_at, upper(r.stay), r.checked_out_at,
         r.adults, r.children
    from public.reservations r
    join public.guests g on g.id = r.guest_id
    join public.units u on u.id = r.unit_id
   where r.property_id = p_property
     and r.checked_in_at is not null
     and r.status in ('checked_in', 'checked_out')
     and (r.checked_in_at at time zone (select timezone from public.properties where id = p_property))::date
         between p_from and p_to
   order by r.checked_in_at
$$;

create or replace function public.ministry_statistics(p_property uuid, p_from date, p_to date)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'by_nationality', (
      select coalesce(jsonb_agg(jsonb_build_object('nationality', nat, 'guests', guests, 'nights', nights)
                                order by guests desc), '[]'::jsonb)
        from (select coalesce(g.nationality, 'UNK') nat, count(distinct g.id) guests,
                     sum(upper(r.stay * daterange(p_from, p_to + 1)) - lower(r.stay * daterange(p_from, p_to + 1))) nights
                from public.reservations r join public.guests g on g.id = r.guest_id
               where r.property_id = p_property and r.status in ('checked_in', 'checked_out')
                 and r.stay && daterange(p_from, p_to + 1)
               group by 1) x),
    'occupancy', (select jsonb_build_object(
                    'room_nights_sold', coalesce(sum(o.sold), 0),
                    'room_nights_available', coalesce(sum(o.units), 0),
                    'room_revenue', coalesce(sum(o.room_revenue), 0))
                    from public.occupancy_report(p_property, p_from, p_to + 1) o),
    'invoiced_revenue', (select coalesce(sum(subtotal), 0) from public.invoices
                          where property_id = p_property and (snapshot->>'issue_date')::date between p_from and p_to),
    'employees', (select count(*) from public.memberships m
                   join public.properties p on p.tenant_id = m.tenant_id
                  where p.id = p_property and m.active))
$$;

-- Tax / fee liability by code for a period (tourism levy is remitted quarterly)
create or replace function public.tax_liability(p_property uuid, p_from date, p_to date)
returns table (code text, name_ar text, invoiced bigint, credited bigint, net bigint)
language sql stable set search_path = ''
as $$
  with inv as (
    select t->>'code' code, t->>'name_ar' name_ar, sum((t->>'amount')::bigint) amt
      from public.invoices i, jsonb_array_elements(i.snapshot->'tax_lines') t
     where i.property_id = p_property and (i.snapshot->>'issue_date')::date between p_from and p_to
     group by 1, 2
  ), cn as (
    select t->>'code' code, sum((t->>'amount')::bigint) amt
      from public.credit_notes c join public.invoices i on i.id = c.invoice_id,
           jsonb_array_elements(c.snapshot->'tax_lines') t
     where i.property_id = p_property and c.issued_at::date between p_from and p_to
     group by 1
  )
  select inv.code, inv.name_ar, inv.amt, coalesce(cn.amt, 0), inv.amt - coalesce(cn.amt, 0)
    from inv left join cn on cn.code = inv.code
$$;

-- Lock down: functions are callable by signed-in users only
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
