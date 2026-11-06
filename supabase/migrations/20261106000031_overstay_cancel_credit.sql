-- =====================================================================
-- 0031 — Found while testing as a hotel owner:
--  1) A guest still checked in after their departure date keeps the room. Until they are checked
--     out the room is not offered or bookable from the original departure date to tomorrow, and
--     check-in says the room is still occupied instead of "needs cleaning".
--  2) Cancelling a booking whose room charges were already invoiced issues a credit note for them,
--     so the guest's account no longer shows a debt for a stay that will not happen.
-- =====================================================================

-- The in-house booking that still holds p_unit during [p_from, p_to) after its own departure date.
create or replace function private.overstay_on(p_unit uuid, p_from date, p_to date, p_exclude uuid default null)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.id
    from public.reservations r
   where r.unit_id = p_unit
     and r.status = 'checked_in'
     and (p_exclude is null or r.id <> p_exclude)
     and upper(r.stay) < private.property_today(r.property_id)   -- departure date already passed (same-day turnover stays allowed)
     and daterange(upper(r.stay), private.property_today(r.property_id) + 1) && daterange(p_from, p_to)
   limit 1
$$;
revoke execute on function private.overstay_on(uuid, date, date, uuid) from public, anon;
grant execute on function private.overstay_on(uuid, date, date, uuid) to authenticated;

create or replace function public.available_units(p_property uuid, p_from date, p_to date, p_unit_type uuid DEFAULT NULL::uuid)
 RETURNS TABLE(unit_id uuid, number text, unit_type_id uuid, type_name text, floor_name text, capacity integer, quote bigint, monthly_rate bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
     and private.overstay_on(u.id, p_from, p_to) is null
     and not exists (
       select 1 from public.channel_blocks b
        where b.unit_id = u.id and b.removed_at is null and b.reservation_id is null
          and b.stay && daterange(p_from, p_to))
   order by fl.sort nulls last, u.number
$function$;

CREATE OR REPLACE FUNCTION public.create_reservation(p_property uuid, p_unit uuid, p_guest uuid, p_from date, p_to date, p_source booking_source DEFAULT 'direct'::booking_source, p_kind reservation_kind DEFAULT 'nightly'::reservation_kind, p_adults integer DEFAULT 1, p_children integer DEFAULT 0, p_discount bigint DEFAULT 0, p_notes text DEFAULT NULL::text, p_status reservation_status DEFAULT 'confirmed'::reservation_status, p_monthly_rent bigint DEFAULT NULL::bigint, p_deposit bigint DEFAULT 0, p_billing_day integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if private.overstay_on(p_unit, p_from, p_to) is not null then
    raise exception 'UNIT_OCCUPIED: a guest past their departure date has not checked out';
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
end $function$;

CREATE OR REPLACE FUNCTION public.change_reservation(p_res uuid, p_unit uuid, p_from date, p_to date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if private.overstay_on(p_unit, p_from, p_to, p_res) is not null then
    raise exception 'UNIT_OCCUPIED: a guest past their departure date has not checked out';
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
end $function$;

CREATE OR REPLACE FUNCTION public.check_in(p_res uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- say exactly why the room cannot be given
  if exists (select 1 from public.reservations o
              where o.unit_id = r.unit_id and o.status = 'checked_in' and o.id <> p_res) then
    raise exception 'UNIT_OCCUPIED: another guest has not checked out of this unit';
  end if;
  if v_unit in ('maintenance', 'out_of_service') or exists (
       select 1 from public.maintenance_tickets m
        where m.unit_id = r.unit_id and m.blocks_availability and m.status <> 'closed') then
    raise exception 'UNIT_BLOCKED: unit is under maintenance or out of service';
  end if;
  if v_unit = 'dirty' then
    raise exception 'UNIT_DIRTY: unit needs cleaning';
  end if;
  if v_unit <> 'available' then
    raise exception 'UNIT_NOT_READY: unit status is %', v_unit;
  end if;

  update public.reservations set status = 'checked_in', checked_in_at = now() where id = p_res;
  update public.units set status = 'occupied' where id = r.unit_id;

  -- CR-01: queue the guest for police / ministry reporting
  insert into public.outbox_events(tenant_id, event_type, aggregate_id, payload)
    values (r.tenant_id, 'guest.checked_in', p_res, jsonb_build_object('guest_id', r.guest_id, 'unit_id', r.unit_id));

  return public.folio_summary((select id from public.folios where reservation_id = p_res));
end $function$;

-- ---------------------------------------------------------------- credit notes
-- Body of issue_credit_note without the role check, so a cancellation by reception can credit too.
create or replace function private.credit_invoice(p_invoice uuid, p_subtotal bigint, p_reason text)
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
  select * into i from public.invoices where id = p_invoice for update;
  if not found then raise exception 'NOT_FOUND: invoice'; end if;
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
revoke execute on function private.credit_invoice(uuid, bigint, text) from public, anon, authenticated;

create or replace function public.issue_credit_note(p_invoice uuid, p_subtotal bigint, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.invoices where id = p_invoice;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager,accountant}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  return private.credit_invoice(p_invoice, p_subtotal, p_reason);
end $$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(p_res uuid, p_reason text DEFAULT NULL::text, p_no_show boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_folio uuid;
  inv record;
  v_amt bigint;
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
  select id into v_folio from public.folios where reservation_id = p_res;
  -- Release un-invoiced room charges; a cancellation fee can be posted manually.
  update public.charges set voided_at = now(), void_reason = case when p_no_show then 'no_show' else 'cancelled' end
   where folio_id = v_folio
     and kind in ('room', 'discount', 'rent') and voided_at is null and invoice_id is null;
  -- Room charges already invoiced cannot be voided: credit them on each invoice instead.
  for inv in
    select i.id, i.subtotal,
           (select coalesce(sum(cn.subtotal), 0) from public.credit_notes cn where cn.invoice_id = i.id) as credited,
           (select coalesce(sum(c.amount), 0) from public.charges c
             where c.invoice_id = i.id and c.voided_at is null and c.kind in ('room', 'discount', 'rent')) as stay_amount
      from public.invoices i
     where i.folio_id = v_folio
  loop
    v_amt := least(inv.stay_amount, inv.subtotal - inv.credited);
    if v_amt > 0 then
      perform private.credit_invoice(inv.id, v_amt,
        case when p_no_show then 'لم يحضر النزيل' else 'إلغاء الحجز' end
        || coalesce(' — ' || nullif(trim(p_reason), ''), ''));
    end if;
  end loop;
  update public.billing_schedules set status = 'cancelled'
   where contract_id = (select id from public.contracts where reservation_id = p_res) and status = 'scheduled';
end $function$;
