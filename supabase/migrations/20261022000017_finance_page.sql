-- =====================================================================
-- 0017 — Finance page: cash-drawer breakdown, expense receipts,
-- and a "cash shortage" alert.
-- =====================================================================

-- What makes up the expected cash in a drawer. SECURITY DEFINER because reception
-- (who opens drawers) can't read expenses, yet cash expenses do leave their drawer.
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
      from public.expenses e, s where e.cash_shift_id = s.id
  )
  select s.opening_float, pay.cash_in, pay.refunds, exp.total,
         s.opening_float + pay.cash_in - pay.refunds - exp.total, pay.n, exp.n
    from s, pay, exp
$$;
revoke execute on function public.shift_breakdown(uuid) from public, anon;
grant execute on function public.shift_breakdown(uuid) to authenticated;

-- Receipt / invoice photos attached to expenses: <tenant>/<expense>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy expense_receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'expense-receipts'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,accountant}'));
create policy expense_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expense-receipts'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,accountant,reception}'));

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
  -- 6b) cash drawer closed short in the last 3 days
  select 'cash_shortage', 1, s.id, null, m.full_name, (-s.difference)::text
    from p
    join public.cash_shifts s on s.property_id = p.id and s.closed_at > now() - interval '3 days' and s.difference < 0
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
