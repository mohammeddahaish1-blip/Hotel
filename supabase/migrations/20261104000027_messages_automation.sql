-- =====================================================================
-- 0027 — Guest messages (WhatsApp) and automation rules.
--  * message_templates: the hotel's own wording per message (defaults live in the app)
--  * message_outbox: messages waiting to be sent. Today staff send each one with one tap
--    (wa.me); once a WhatsApp Business provider is connected the same queue is sent by itself.
--  * automation_rules: "when X happens (N days before/after) do Y": queue a message,
--    create a housekeeping task, or raise a notice for the owner/manager.
--  * automation_tick(): runs the rules (hourly via pg_cron, or "run now"); each rule acts
--    once per booking / rent instalment (automation_runs).
-- =====================================================================

create table public.message_templates (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  body_ar text not null check (char_length(body_ar) <= 2000),
  body_en text not null check (char_length(body_en) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table public.message_templates enable row level security;
create policy message_templates_select on public.message_templates for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy message_templates_write on public.message_templates for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,   -- null = every property
  name text not null check (char_length(name) between 1 and 120),
  trigger text not null check (trigger in ('booking_confirmed', 'before_arrival', 'after_checkin', 'after_checkout', 'rent_overdue', 'contract_ending')),
  offset_days int not null default 0 check (offset_days between 0 and 90),
  action text not null check (action in ('whatsapp', 'hk_task', 'notify')),
  template_key text check (template_key ~ '^[a-z0-9_]{2,40}$'),
  hk_kind text check (hk_kind in ('checkout', 'stayover', 'weekly', 'deep', 'inspection')),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (action <> 'whatsapp' or template_key is not null)
);
create index automation_rules_tenant_idx on public.automation_rules(tenant_id) where active;
create index automation_rules_property_idx on public.automation_rules(property_id);
create index automation_rules_created_by_idx on public.automation_rules(created_by);
alter table public.automation_rules enable row level security;
create policy automation_rules_select on public.automation_rules for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));
create policy automation_rules_write on public.automation_rules for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));
create trigger automation_rules_audit after insert or update or delete on public.automation_rules
  for each row execute function private.audit_trigger();

-- One action per rule and booking / rent instalment
create table public.automation_runs (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  ref_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rule_id, ref_id)
);
create index automation_runs_tenant_idx on public.automation_runs(tenant_id);
alter table public.automation_runs enable row level security;
create policy automation_runs_select on public.automation_runs for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'));

create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade,
  guest_id uuid references public.guests(id) on delete set null,
  template_key text not null check (template_key ~ '^[a-z0-9_]{2,40}$'),
  payload jsonb not null default '{}'::jsonb,
  rule_id uuid references public.automation_rules(id) on delete set null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped')),
  due_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_text text check (char_length(sent_text) <= 4000),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index message_outbox_pending_idx on public.message_outbox(property_id, due_at) where status = 'pending';
create index message_outbox_tenant_idx on public.message_outbox(tenant_id);
create index message_outbox_reservation_idx on public.message_outbox(reservation_id);
create index message_outbox_guest_idx on public.message_outbox(guest_id);
create index message_outbox_rule_idx on public.message_outbox(rule_id);
create index message_outbox_sent_by_idx on public.message_outbox(sent_by);
create index message_outbox_created_by_idx on public.message_outbox(created_by);
alter table public.message_outbox enable row level security;
create policy message_outbox_select on public.message_outbox for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));
create policy message_outbox_insert on public.message_outbox for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager,reception}') and status = 'pending');
create policy message_outbox_update on public.message_outbox for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception}'));

create table public.staff_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete cascade,
  rule_id uuid references public.automation_rules(id) on delete set null,
  title text not null check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references auth.users(id)
);
create index staff_notices_open_idx on public.staff_notices(property_id) where done_at is null;
create index staff_notices_tenant_idx on public.staff_notices(tenant_id);
create index staff_notices_reservation_idx on public.staff_notices(reservation_id);
create index staff_notices_rule_idx on public.staff_notices(rule_id);
create index staff_notices_done_by_idx on public.staff_notices(done_by);
alter table public.staff_notices enable row level security;
create policy staff_notices_select on public.staff_notices for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'));
create policy staff_notices_update on public.staff_notices for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));

-- ---------------------------------------------------------------- rule runner
-- p_property null = every property (the hourly job); otherwise one property, for staff ("run now").
create or replace function public.automation_tick(p_property uuid default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  ru record;
  c record;
  v_done int := 0;
  v_ins int;
begin
  if p_property is not null then
    if not exists (select 1 from public.properties pr where pr.id = p_property
                    and private.has_role(pr.tenant_id, '{owner,manager,reception}')) then
      raise exception 'FORBIDDEN: not allowed';
    end if;
  elsif auth.uid() is not null then
    raise exception 'FORBIDDEN: not allowed';   -- only the scheduled job runs every property
  end if;

  for ru in
    select r.*, pr.id as prop_id, (now() at time zone pr.timezone)::date as today
      from public.automation_rules r
      join public.properties pr on pr.tenant_id = r.tenant_id and (r.property_id is null or r.property_id = pr.id)
     where r.active and (p_property is null or pr.id = p_property)
  loop
    for c in
      -- each candidate: ref (what the rule acts on once), reservation, guest, unit, extra payload
      select x.ref_id, x.reservation_id, x.guest_id, x.unit_id, x.payload from (
        select r.id as ref_id, r.id as reservation_id, r.guest_id, r.unit_id, '{}'::jsonb as payload
          from public.reservations r
         where ru.trigger = 'booking_confirmed' and r.property_id = ru.prop_id
           and r.status in ('confirmed', 'checked_in') and r.created_at >= greatest(ru.created_at, now() - interval '3 days')
        union all
        select r.id, r.id, r.guest_id, r.unit_id, '{}'::jsonb
          from public.reservations r
         where ru.trigger = 'before_arrival' and r.property_id = ru.prop_id
           and r.status in ('tentative', 'confirmed')
           and lower(r.stay) - ru.offset_days <= ru.today and lower(r.stay) >= ru.today
        union all
        select r.id, r.id, r.guest_id, r.unit_id, '{}'::jsonb
          from public.reservations r join public.properties pr on pr.id = r.property_id
         where ru.trigger = 'after_checkin' and r.property_id = ru.prop_id and r.status = 'checked_in'
           and (r.checked_in_at at time zone pr.timezone)::date + ru.offset_days <= ru.today
           and r.checked_in_at > now() - make_interval(days => ru.offset_days + 7)
        union all
        select r.id, r.id, r.guest_id, r.unit_id, '{}'::jsonb
          from public.reservations r join public.properties pr on pr.id = r.property_id
         where ru.trigger = 'after_checkout' and r.property_id = ru.prop_id and r.status = 'checked_out'
           and (r.checked_out_at at time zone pr.timezone)::date + ru.offset_days <= ru.today
           and r.checked_out_at > now() - make_interval(days => ru.offset_days + 3)
        union all
        select b.id, r.id, r.guest_id, r.unit_id, jsonb_build_object('billing_schedule_id', b.id, 'due_date', b.due_date)
          from public.billing_schedules b
          join public.contracts ct on ct.id = b.contract_id
          join public.reservations r on r.id = ct.reservation_id
          join public.folios f on f.reservation_id = r.id
         where ru.trigger = 'rent_overdue' and r.property_id = ru.prop_id
           and b.status = 'posted' and r.status in ('confirmed', 'checked_in')
           and b.due_date + ru.offset_days <= ru.today and b.due_date > ru.today - 60
           and coalesce((public.folio_summary(f.id) ->> 'balance')::bigint, 0) > 0
        union all
        select r.id, r.id, r.guest_id, r.unit_id, '{}'::jsonb
          from public.reservations r
         where ru.trigger = 'contract_ending' and r.property_id = ru.prop_id
           and r.kind = 'contract' and r.status in ('confirmed', 'checked_in')
           and upper(r.stay) - ru.offset_days <= ru.today and upper(r.stay) > ru.today
      ) x
    loop
      insert into public.automation_runs(rule_id, ref_id, tenant_id) values (ru.id, c.ref_id, ru.tenant_id)
      on conflict do nothing;
      get diagnostics v_ins = row_count;
      continue when v_ins = 0;
      if ru.action = 'whatsapp' then
        insert into public.message_outbox(tenant_id, property_id, reservation_id, guest_id, template_key, payload, rule_id, created_by)
        values (ru.tenant_id, ru.prop_id, c.reservation_id, c.guest_id, ru.template_key, c.payload, ru.id, null);
      elsif ru.action = 'hk_task' then
        insert into public.hk_tasks(tenant_id, property_id, unit_id, kind, due_date, notes)
        values (ru.tenant_id, ru.prop_id, c.unit_id, coalesce(ru.hk_kind, 'stayover'), ru.today, left(ru.name, 200));
      else
        insert into public.staff_notices(tenant_id, property_id, reservation_id, rule_id, title)
        values (ru.tenant_id, ru.prop_id, c.reservation_id, ru.id, left(ru.name, 200));
      end if;
      v_done := v_done + 1;
    end loop;
  end loop;
  return v_done;
end $$;
revoke execute on function public.automation_tick(uuid) from public, anon;
grant execute on function public.automation_tick(uuid) to authenticated;

-- Hourly, where pg_cron exists (skipped in local tests)
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('automation-tick', '7 * * * *', 'select public.automation_tick()');
  end if;
end $outer$;

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
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;
