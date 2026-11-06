-- =====================================================================
-- 0032 — Found while testing as a hotel owner:
--  1) Guests: the name may not be blank and the phone must be a phone number (Arabic digits,
--     spaces and dashes are cleaned up; a number already stored is left alone until it is edited).
--  2) Bookings in the past: only the owner or a manager may enter them (late entry, imports);
--     reception gets a clear message instead of silently creating a "no-show".
-- =====================================================================

create or replace function private.guest_clean()
returns trigger
language plpgsql set search_path = ''
as $$
declare v text;
begin
  new.full_name := btrim(regexp_replace(coalesce(new.full_name, ''), '[[:space:]]+', ' ', 'g'));
  if new.full_name = '' then
    raise exception 'GUEST_NAME_REQUIRED: guest name is required';
  end if;
  if new.phone is not null then
    v := translate(new.phone, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
    v := regexp_replace(v, '[[:space:]().-]', '', 'g');
    if v like '00%' then v := '+' || substr(v, 3); end if;
    if v = '' then
      new.phone := null;
    elsif v ~ '^[+]?[0-9]{7,15}$' then
      new.phone := v;
    elsif tg_op = 'UPDATE' and new.phone is not distinct from old.phone then
      null;   -- an old value saved before this check: kept until someone edits it
    else
      raise exception 'INVALID_PHONE: %', left(new.phone, 30);
    end if;
  end if;
  return new;
end $$;

create or replace trigger guests_clean before insert or update of full_name, phone on public.guests
  for each row execute function private.guest_clean();

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
  if p_from < private.property_today(p_property) and not private.has_role(v_tenant, '{owner,manager}') then
    raise exception 'PAST_DATES: arrival date has passed';
  end if;

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
  if p_from <> lower(r.stay) and p_from < private.property_today(r.property_id)
     and not private.has_role(r.tenant_id, '{owner,manager}') then
    raise exception 'PAST_DATES: arrival date has passed';
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
