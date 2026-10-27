-- =====================================================================
-- 0025 — Staff profiles: work / resident card number and expiry, an alert to the
-- owner and managers before a card expires, and a "my profile" view for every
-- employee (name, job title, email, phone, salary).
-- =====================================================================

alter table public.staff_profiles add column work_card_no text check (char_length(work_card_no) <= 30);
alter table public.staff_profiles add column work_card_expiry date;
alter table public.invitations add column work_card_no text check (char_length(work_card_no) <= 30);
alter table public.invitations add column work_card_expiry date;

-- ---------------------------------------------------------------- profile
-- One employee's profile. Readable by the employee themself, and by the owner and
-- managers of the same company. Email comes from the sign-in account.
create or replace function public.staff_profile(p_tenant uuid, p_user uuid)
returns table (
  user_id uuid, full_name text, job_title text, role public.app_role, active boolean, joined_at timestamptz,
  email text, phone text, civil_id text, salary bigint, work_card_no text, work_card_expiry date
)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, m.full_name, m.job_title, m.role, m.active, m.created_at,
         u.email::text, sp.phone, sp.civil_id, sp.salary, sp.work_card_no, sp.work_card_expiry
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.staff_profiles sp on sp.tenant_id = m.tenant_id and sp.user_id = m.user_id
   where m.tenant_id = p_tenant and m.user_id = p_user
     and (p_user = (select auth.uid()) or private.has_role(p_tenant, '{owner,manager}'))
$$;
revoke execute on function public.staff_profile(uuid, uuid) from public, anon;
grant execute on function public.staff_profile(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- invitations
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
  -- sections on an invitation were set by the owner (enforced by invitations_permissions_guard)
  perform set_config('app.accepting_invite', 'on', true);
  insert into public.memberships(tenant_id, user_id, role, full_name, job_title, permissions)
  select i.tenant_id, v_uid, i.role, i.full_name, i.job_title, i.permissions
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  -- private HR details typed in the invitation (phone, civil ID, salary, work card)
  insert into public.staff_profiles(tenant_id, user_id, phone, civil_id, salary, work_card_no, work_card_expiry)
  select i.tenant_id, v_uid, i.phone, i.civil_id, i.salary, i.work_card_no, i.work_card_expiry
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
     and (i.phone is not null or i.civil_id is not null or i.salary is not null
          or i.work_card_no is not null or i.work_card_expiry is not null)
  on conflict (tenant_id, user_id) do nothing;
  perform set_config('app.accepting_invite', 'off', true);
  update public.invitations set accepted_at = now()
   where lower(email) = v_email and accepted_at is null;
  return v_count;
end $$;

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
  -- 13) staff work / resident card expired or ending within 30 days (owner & manager)
  select 'work_card_expiring', case when sp.work_card_expiry < p.today then 1 else 2 end, sp.user_id, null, m.full_name, sp.work_card_expiry::text
    from p
    join public.staff_profiles sp on sp.tenant_id = p.tenant_id and sp.work_card_expiry <= p.today + 30
    join public.memberships m on m.user_id = sp.user_id and m.tenant_id = p.tenant_id and m.active
   where p.approver
  union all
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;
