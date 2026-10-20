-- =====================================================================
-- 0016 — Today's alerts and global search.
-- Search runs with the caller's rights (RLS decides what each employee finds);
-- alerts are role-gated explicitly (see below).
-- =====================================================================

-- SECURITY DEFINER so housekeeping still learns "arrival today, room not ready",
-- but each alert is gated by role and guest names are shown only to front-office
-- and finance roles.
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
           private.has_role(tenant_id, '{owner,manager,accountant}') as cash
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
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;

create or replace function public.global_search(p_property uuid, p_q text)
returns table (kind text, ref_id uuid, title text, subtitle text)
language sql stable set search_path = ''
as $$
  with q as (select '%' || replace(replace(trim(p_q), '%', ''), '_', '') || '%' as pat, trim(p_q) as raw),
  p as (select id, tenant_id from public.properties where id = p_property)
  (select 'unit', u.id, u.number, ut.name_ar
     from public.units u join public.unit_types ut on ut.id = u.unit_type_id, p, q
    where u.property_id = p.id and u.active and u.number ilike q.raw || '%'
    order by u.number limit 5)
  union all
  (select 'reservation', r.id, r.code, coalesce(g.full_name, '') || ' · ' || coalesce(u.number, '')
     from public.reservations r
     join public.units u on u.id = r.unit_id
     left join public.guests g on g.id = r.guest_id, p, q
    where r.property_id = p.id and (r.code ilike q.pat or g.full_name ilike q.pat or g.phone ilike q.pat)
    order by r.created_at desc limit 6)
  union all
  (select 'guest', g.id, g.full_name, coalesce(g.phone, g.doc_number, '')
     from public.guests g, p, q
    where g.tenant_id = p.tenant_id
      and (g.full_name ilike q.pat or g.full_name_ar ilike q.pat or g.phone ilike q.pat or g.doc_number ilike q.pat)
    order by g.created_at desc limit 6)
$$;

revoke execute on function public.alerts(uuid) from public, anon;
revoke execute on function public.global_search(uuid, text) from public, anon;
grant execute on function public.alerts(uuid) to authenticated;
grant execute on function public.global_search(uuid, text) to authenticated;
