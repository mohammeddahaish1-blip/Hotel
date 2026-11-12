-- =====================================================================
-- 0041 — Shop staff are separate from hotel staff.
-- A shop employee (cashier, shop manager, renter) is invited from the Shops section, belongs to one
-- or more shops, never appears among hotel staff and cannot read hotel data (units, housekeeping,
-- maintenance, colleagues, alerts). Hotel staff can no longer be added to a shop; rows that already
-- link a hotel employee to a shop stay until the owner removes them.
-- =====================================================================

alter table public.memberships add column staff_kind text not null default 'hotel'
  check (staff_kind in ('hotel', 'shop'));
-- people already invited as "works only in a shop" (no hotel section)
update public.memberships set staff_kind = 'shop'
 where role not in ('owner', 'manager') and permissions = '{}';

alter table public.invitations
  add column staff_kind text not null default 'hotel' check (staff_kind in ('hotel', 'shop')),
  add column shop_id uuid references public.shops(id) on delete cascade,
  add column shop_access text check (shop_access in ('seller', 'manager', 'renter'));
update public.invitations set staff_kind = 'shop'
 where role not in ('owner', 'manager') and permissions = '{}' and accepted_at is null;
alter table public.invitations add constraint invitations_shop_staff check (
  (staff_kind = 'hotel' and shop_id is null and shop_access is null)
  or (staff_kind = 'shop' and role not in ('owner', 'manager') and permissions = '{}'
      and (shop_id is null) = (shop_access is null)));

-- A shop employee has no hotel section, ever; the kind is fixed once the person joins.
create or replace function private.memberships_staff_kind_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.permissions = '{}' and new.role not in ('owner', 'manager') then
    new.staff_kind := 'shop';
  end if;
  if tg_op = 'UPDATE' and new.staff_kind is distinct from old.staff_kind then
    raise exception 'FORBIDDEN: a hotel employee cannot become shop staff or the other way round';
  end if;
  if new.staff_kind = 'shop'
     and (new.role in ('owner', 'manager') or new.permissions is null or cardinality(new.permissions) > 0) then
    raise exception 'INVALID_VALUE: shop staff have no hotel sections';
  end if;
  return new;
end $$;
create trigger memberships_staff_kind_guard before insert or update on public.memberships
  for each row execute function private.memberships_staff_kind_guard();

-- Owner or manager may invite shop staff (no hotel section); only the owner sets hotel sections.
create or replace function private.invitations_permissions_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.permissions is not null
     and not (new.staff_kind = 'shop' and new.permissions = '{}')
     and new.permissions is distinct from (case when tg_op = 'UPDATE' then old.permissions end)
     and auth.uid() is not null and not exists (
       select 1 from public.memberships
        where user_id = auth.uid() and tenant_id = new.tenant_id and role = 'owner' and active) then
    raise exception 'FORBIDDEN: only the owner can set permissions';
  end if;
  return new;
end $$;

-- The shop on an invitation belongs to the same company and suits the access.
create or replace function private.invitations_shop_check()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare s public.shops;
begin
  if new.shop_id is null then return new; end if;
  select * into s from public.shops where id = new.shop_id;
  if s.tenant_id <> new.tenant_id then raise exception 'FORBIDDEN: other company'; end if;
  if (s.kind = 'rental') <> (new.shop_access = 'renter') then raise exception 'INVALID_VALUE: role does not suit this shop'; end if;
  return new;
end $$;
create trigger invitations_shop_check before insert or update on public.invitations
  for each row execute function private.invitations_shop_check();

-- Only shop staff can be added to a shop (rows that exist already are left alone).
create or replace function private.shop_member_check()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare s public.shops;
begin
  select * into s from public.shops where id = new.shop_id;
  if s.tenant_id <> new.tenant_id then raise exception 'FORBIDDEN: other company'; end if;
  if (s.kind = 'rental') <> (new.access = 'renter') then raise exception 'INVALID_VALUE: role does not suit this shop'; end if;
  if (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) and not exists (
       select 1 from public.memberships m
        where m.tenant_id = new.tenant_id and m.user_id = new.user_id and m.staff_kind = 'shop') then
    raise exception 'INVALID_VALUE: only shop staff can work in a shop';
  end if;
  return new;
end $$;

-- Companies where the caller is hotel staff (shop staff are left out).
create or replace function private.hotel_tenant_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select tenant_id from public.memberships
  where user_id = (select auth.uid()) and active and staff_kind = 'hotel'
    and (support_until is null or support_until > now())
$$;

-- Which colleagues a shop employee may see: people of their own shops, and the owner / managers
-- (so a complaint can name them).
create or replace function private.shop_staff_sees(p_tenant uuid, p_user uuid, p_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships me
                  where me.user_id = (select auth.uid()) and me.tenant_id = p_tenant and me.active
                    and me.staff_kind = 'shop')
     and (p_role in ('owner', 'manager')
          or exists (select 1 from public.shop_members a join public.shop_members b on b.shop_id = a.shop_id
                      where a.user_id = (select auth.uid()) and b.user_id = p_user))
$$;

-- Hotel data is read by hotel staff only.
alter policy memberships_select on public.memberships using (
  user_id = (select auth.uid())
  or tenant_id in (select private.hotel_tenant_ids())
  or private.shop_staff_sees(tenant_id, user_id, role));
-- (every policy on these tables that let any member in now lets hotel staff in; written so it works
-- whether the write policies are one FOR ALL policy or split per command)
do $$
declare p record;
begin
  for p in
    select tablename, policyname, cmd, qual, with_check from pg_policies
     where schemaname = 'public'
       and tablename in ('floors', 'unit_types', 'rate_plans', 'units', 'hk_tasks', 'maintenance_tickets',
                         'tax_rules', 'message_templates')
       and (qual like '%user_tenant_ids()%' or with_check like '%user_tenant_ids()%')
  loop
    execute format('alter policy %I on public.%I', p.policyname, p.tablename)
      || case when p.qual is not null
              then format(' using (%s)', replace(p.qual, 'private.user_tenant_ids()', 'private.hotel_tenant_ids()')) else '' end
      || case when p.with_check is not null
              then format(' with check (%s)', replace(p.with_check, 'private.user_tenant_ids()', 'private.hotel_tenant_ids()')) else '' end;
  end loop;
end $$;

-- Joining from an invitation: keep the staff kind and put shop staff in their shop.
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
  perform set_config('app.accepting_invite', 'on', true);
  insert into public.memberships(tenant_id, user_id, role, full_name, job_title, permissions, staff_kind)
  select i.tenant_id, v_uid, i.role, i.full_name, i.job_title, i.permissions, i.staff_kind
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  insert into public.staff_profiles(tenant_id, user_id, phone, civil_id, salary, work_card_no, work_card_expiry)
  select i.tenant_id, v_uid, i.phone, i.civil_id, i.salary, i.work_card_no, i.work_card_expiry
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
     and (i.phone is not null or i.civil_id is not null or i.salary is not null
          or i.work_card_no is not null or i.work_card_expiry is not null)
  on conflict (tenant_id, user_id) do nothing;
  insert into public.shop_members(shop_id, tenant_id, user_id, access)
  select i.shop_id, i.tenant_id, v_uid, i.shop_access
    from public.invitations i
    join public.memberships m on m.tenant_id = i.tenant_id and m.user_id = v_uid and m.staff_kind = 'shop'
   where lower(i.email) = v_email and i.accepted_at is null and i.shop_id is not null
  on conflict (shop_id, user_id) do nothing;
  perform set_config('app.accepting_invite', 'off', true);
  update public.invitations set accepted_at = now()
   where lower(email) = v_email and accepted_at is null;
  return v_count;
end $$;
revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.accept_invitations() to authenticated;

-- Hotel alerts are for hotel staff only.
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
     where id = p_property and tenant_id in (select private.hotel_tenant_ids())
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
  -- 13) staff work / resident card expired or ending within 30 days (owner & manager)
  select 'work_card_expiring', case when sp.work_card_expiry < p.today then 1 else 2 end, sp.user_id, null, m.full_name, sp.work_card_expiry::text
    from p
    join public.staff_profiles sp on sp.tenant_id = p.tenant_id and sp.work_card_expiry <= p.today + 30
    join public.memberships m on m.user_id = sp.user_id and m.tenant_id = p.tenant_id and m.active
   where p.approver
  union all
  -- 14) guest messages waiting to be sent (front office)
  select 'messages_due', 3, p.id, null, null, count(*)::text
    from p
    join public.message_outbox o on o.property_id = p.id and o.status = 'pending' and o.due_at <= now()
   where p.front_office
   group by p.id
  union all
  -- 15) notices raised by automation rules (owner & manager)
  select 'staff_notice', 2, n.id, u.number, g.full_name, n.title
    from p
    join public.staff_notices n on n.property_id = p.id and n.done_at is null
    left join public.reservations r on r.id = n.reservation_id
    left join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.approver
  union all
  -- 16) guest sent a transfer proof through a payment link: confirm it
  select 'payment_proof', 2, l.id, u.number, g.full_name, l.amount::text
    from p
    join public.payment_links l on l.property_id = p.id and l.status = 'proof_submitted'
    left join public.reservations r on r.id = l.reservation_id
    left join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where p.finance
  union all
  -- 17) a booking from Airbnb/Booking/... overlaps one of ours: double booking
  select 'channel_conflict', 1, b.id, u.number, b.channel, lower(b.stay)::text
    from p
    join (select cb.*, f.channel from public.channel_blocks cb join public.ical_feeds f on f.id = cb.feed_id) b
      on b.property_id = p.id and b.removed_at is null and b.reservation_id is null and upper(b.stay) > p.today
    join public.units u on u.id = b.unit_id
   where p.front_office
     and exists (select 1 from public.reservations r where r.unit_id = b.unit_id
                  and r.status in ('tentative', 'confirmed', 'checked_in') and r.stay && b.stay)
  union all
  -- 18) a channel calendar could not be read in the last day
  select 'channel_sync_error', 3, f.id, u.number, f.channel, left(f.last_error, 80)
    from p
    join public.ical_feeds f on f.property_id = p.id and f.active and f.last_error is not null and f.last_synced_at > now() - interval '1 day'
    join public.units u on u.id = f.unit_id
   where p.front_office
  union all
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;

