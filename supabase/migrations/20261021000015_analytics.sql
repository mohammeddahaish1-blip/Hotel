-- =====================================================================
-- 0015 — Analytics: daily collected income and staff performance
-- (bonus decisions). Read-only; staff performance is owner/manager only.
-- =====================================================================

-- Net collected income per day (payments − refunds; deposits excluded), property timezone
create or replace function public.daily_income(p_property uuid, p_from date, p_to date)
returns table (day date, amount bigint)
language sql stable set search_path = ''
as $$
  with tz as (select coalesce((select timezone from public.properties where id = p_property), 'Asia/Muscat') as name),
  days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d)
  select days.day,
         coalesce(sum(case p.kind when 'payment' then p.amount when 'refund' then -p.amount else 0 end), 0)::bigint
    from days
    cross join tz
    left join public.folios f on f.property_id = p_property
    left join public.payments p
      on p.folio_id = f.id and p.voided_at is null
     and (p.received_at at time zone tz.name)::date = days.day
   group by days.day
   order by days.day
$$;

-- Per-employee activity for a period. Counts come from the business tables and the
-- append-only audit log, so they can't be edited after the fact.
create or replace function public.staff_performance(p_property uuid, p_from date, p_to date)
returns table (
  user_id uuid, full_name text, job_title text, role public.app_role,
  reservations_created int, check_ins int, check_outs int,
  payments_count int, payments_amount bigint, invoices_issued int,
  hk_tasks_done int, hk_avg_minutes int, tickets_closed int,
  shifts_closed int, cash_shortage bigint
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
begin
  select tenant_id, timezone into v_tenant, v_tz from public.properties where id = p_property;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  return query
  select m.user_id, m.full_name, m.job_title, m.role,
    (select count(*)::int from public.reservations r
      where r.property_id = p_property and r.created_by = m.user_id
        and r.created_at >= v_start and r.created_at < v_end),
    (select count(*)::int from public.audit_log a
      where a.tenant_id = v_tenant and a.table_name = 'reservations' and a.actor = m.user_id
        and a.at >= v_start and a.at < v_end and a.action = 'update'
        and a.new_data->>'status' = 'checked_in' and a.old_data->>'status' is distinct from 'checked_in'
        and a.new_data->>'property_id' = p_property::text),
    (select count(*)::int from public.audit_log a
      where a.tenant_id = v_tenant and a.table_name = 'reservations' and a.actor = m.user_id
        and a.at >= v_start and a.at < v_end and a.action = 'update'
        and a.new_data->>'status' = 'checked_out' and a.old_data->>'status' is distinct from 'checked_out'
        and a.new_data->>'property_id' = p_property::text),
    (select count(*)::int from public.payments p join public.folios f on f.id = p.folio_id
      where f.property_id = p_property and p.received_by = m.user_id and p.kind = 'payment'
        and p.voided_at is null and p.received_at >= v_start and p.received_at < v_end),
    (select coalesce(sum(p.amount), 0)::bigint from public.payments p join public.folios f on f.id = p.folio_id
      where f.property_id = p_property and p.received_by = m.user_id and p.kind = 'payment'
        and p.voided_at is null and p.received_at >= v_start and p.received_at < v_end),
    (select count(*)::int from public.invoices i
      where i.property_id = p_property and i.issued_by = m.user_id
        and i.issued_at >= v_start and i.issued_at < v_end),
    (select count(*)::int from public.hk_tasks h
      where h.property_id = p_property and h.finished_by = m.user_id and h.status = 'done'
        and h.finished_at >= v_start and h.finished_at < v_end),
    (select coalesce(round(avg(extract(epoch from (h.finished_at - h.started_at)) / 60)), 0)::int from public.hk_tasks h
      where h.property_id = p_property and h.finished_by = m.user_id and h.status = 'done'
        and h.started_at is not null and h.finished_at > h.started_at
        and h.finished_at >= v_start and h.finished_at < v_end),
    (select count(*)::int from public.audit_log a
      where a.tenant_id = v_tenant and a.table_name = 'maintenance_tickets' and a.actor = m.user_id
        and a.at >= v_start and a.at < v_end and a.action = 'update'
        and a.new_data->>'status' = 'closed' and a.old_data->>'status' is distinct from 'closed'
        and a.new_data->>'property_id' = p_property::text),
    (select count(*)::int from public.cash_shifts s
      where s.property_id = p_property and s.opened_by = m.user_id
        and s.closed_at >= v_start and s.closed_at < v_end),
    (select coalesce(sum(-s.difference), 0)::bigint from public.cash_shifts s
      where s.property_id = p_property and s.opened_by = m.user_id and s.difference < 0
        and s.closed_at >= v_start and s.closed_at < v_end)
  from public.memberships m
  where m.tenant_id = v_tenant and m.role <> 'owner'
  order by m.created_at;
end $$;

revoke execute on function public.daily_income(uuid, date, date) from public, anon;
revoke execute on function public.staff_performance(uuid, date, date) from public, anon;
grant execute on function public.daily_income(uuid, date, date) to authenticated;
grant execute on function public.staff_performance(uuid, date, date) to authenticated;
