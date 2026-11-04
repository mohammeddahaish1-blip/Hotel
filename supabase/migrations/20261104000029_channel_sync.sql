-- =====================================================================
-- 0029 — Channel sync by iCal (Airbnb, Booking.com, Agoda, Expedia...).
--  * Export: each unit has a private calendar link (/ical/<token>) to paste into the
--    channel, so it closes the dates we sold.
--  * Import: the channel's calendar link per unit; its bookings become "channel blocks"
--    that close the dates here. Reception turns a block into a real booking when the
--    guest's details arrive. Blocks that disappear from the channel are marked removed.
--  * Fetching runs inside the database (pg_net) every 15 minutes, or on "sync now".
-- A channel manager (two-way prices) can replace this later without changing bookings.
-- =====================================================================

alter table public.units add column ical_token uuid not null default gen_random_uuid();
create unique index units_ical_token_idx on public.units(ical_token);

create table public.ical_feeds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  channel text not null check (channel in ('airbnb', 'booking', 'agoda', 'expedia', 'other')),
  url text not null check (url ~ '^https://' and char_length(url) <= 1000),
  active boolean not null default true,
  pending_request bigint,
  requested_at timestamptz,
  last_synced_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  last_event_count int,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (unit_id, url)
);
create index ical_feeds_property_idx on public.ical_feeds(property_id);
create index ical_feeds_tenant_idx on public.ical_feeds(tenant_id);
create index ical_feeds_created_by_idx on public.ical_feeds(created_by);
alter table public.ical_feeds enable row level security;
create policy ical_feeds_select on public.ical_feeds for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));
create policy ical_feeds_write on public.ical_feeds for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (private.has_role(tenant_id, '{owner,manager}'));
create trigger ical_feeds_audit after insert or update or delete on public.ical_feeds
  for each row execute function private.audit_trigger();

create table public.channel_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  feed_id uuid not null references public.ical_feeds(id) on delete cascade,
  uid text not null check (char_length(uid) <= 500),
  stay daterange not null check (not isempty(stay)),
  summary text check (char_length(summary) <= 300),
  reservation_id uuid references public.reservations(id) on delete set null,
  removed_at timestamptz,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (feed_id, uid)
);
create index channel_blocks_unit_stay_idx on public.channel_blocks using gist (unit_id, stay) where removed_at is null and reservation_id is null;
create index channel_blocks_property_idx on public.channel_blocks(property_id);
create index channel_blocks_tenant_idx on public.channel_blocks(tenant_id);
create index channel_blocks_reservation_idx on public.channel_blocks(reservation_id);
alter table public.channel_blocks enable row level security;
create policy channel_blocks_select on public.channel_blocks for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));

-- ---------------------------------------------------------------- iCal parsing
-- Events of an iCalendar text: all-day (DATE) and timed (DATE-TIME) starts/ends become dates.
create or replace function private.parse_ical(p_body text)
returns table (uid text, start_date date, end_date date, summary text, cancelled boolean)
language plpgsql immutable set search_path = ''
as $$
declare
  v_body text := regexp_replace(coalesce(p_body, ''), E'\r?\n[ \t]', '', 'g');   -- unfold long lines
  ev text;
  s text; e text;
begin
  for ev in select m[1] from regexp_matches(v_body, 'BEGIN:VEVENT(.*?)END:VEVENT', 'g') as m loop
    uid := trim(substring(ev from E'\nUID[^:\n]*:([^\r\n]*)'));
    s := substring(ev from E'\nDTSTART[^:\n]*:([0-9]{8})');
    e := substring(ev from E'\nDTEND[^:\n]*:([0-9]{8})');
    continue when s is null;
    start_date := to_date(s, 'YYYYMMDD');
    end_date := coalesce(to_date(e, 'YYYYMMDD'), start_date + 1);
    if end_date <= start_date then end_date := start_date + 1; end if;
    summary := left(trim(replace(substring(ev from E'\nSUMMARY[^:\n]*:([^\r\n]*)'), E'\\,', ',')), 300);
    cancelled := coalesce(upper(trim(substring(ev from E'\nSTATUS[^:\n]*:([^\r\n]*)'))) = 'CANCELLED', false);
    uid := coalesce(nullif(uid, ''), md5(s || coalesce(e, '') || coalesce(summary, '')));
    return next;
  end loop;
end $$;

-- Apply one fetched calendar to its feed's blocks
create or replace function private.apply_ical(p_feed uuid, p_body text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare f record; v_today date; v_n int; v_start timestamptz := clock_timestamp();
begin
  select fd.*, pr.timezone into f from public.ical_feeds fd join public.properties pr on pr.id = fd.property_id where fd.id = p_feed;
  if not found then return 0; end if;
  v_today := (now() at time zone f.timezone)::date;
  if position('BEGIN:VCALENDAR' in coalesce(p_body, '')) = 0 then
    update public.ical_feeds set last_synced_at = now(), last_error = 'not an iCal calendar', pending_request = null where id = p_feed;
    return 0;
  end if;
  insert into public.channel_blocks(tenant_id, property_id, unit_id, feed_id, uid, stay, summary, seen_at, removed_at)
  select f.tenant_id, f.property_id, f.unit_id, f.id, ev.uid, daterange(ev.start_date, ev.end_date), ev.summary, clock_timestamp(), null
    from private.parse_ical(p_body) ev
   where not ev.cancelled and ev.end_date >= v_today - 1
  on conflict (feed_id, uid) do update
     set stay = excluded.stay, summary = excluded.summary, seen_at = clock_timestamp(), removed_at = null;
  get diagnostics v_n = row_count;
  -- gone from the channel (cancelled there): close it here too, keep the record
  update public.channel_blocks set removed_at = now()
   where feed_id = f.id and removed_at is null and seen_at < v_start and upper(stay) >= v_today;
  update public.ical_feeds set last_synced_at = now(), last_error = null, last_event_count = v_n, pending_request = null where id = p_feed;
  return v_n;
end $$;

-- ---------------------------------------------------------------- fetching (pg_net)
create or replace function private.ical_start(p_property uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare f record; v_req bigint; v_n int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then raise exception 'UNAVAILABLE: sync'; end if;
  for f in select * from public.ical_feeds
            where active and (p_property is null or property_id = p_property)
              and (requested_at is null or requested_at < now() - interval '2 minutes') loop
    execute 'select net.http_get(url := $1, timeout_milliseconds := 20000)' into v_req using f.url;
    update public.ical_feeds set pending_request = v_req, requested_at = now() where id = f.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function private.ical_collect(p_property uuid)
returns int
language plpgsql security definer set search_path = ''
as $$
declare f record; v_status int; v_body text; v_err text; v_n int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return 0; end if;
  for f in select * from public.ical_feeds
            where pending_request is not null and (p_property is null or property_id = p_property) loop
    execute 'select status_code, content, error_msg from net._http_response where id = $1'
      into v_status, v_body, v_err using f.pending_request;
    if v_status is null and v_err is null then
      if f.requested_at < now() - interval '10 minutes' then
        update public.ical_feeds set pending_request = null, last_synced_at = now(), last_error = 'no answer' where id = f.id;
      end if;
      continue;
    end if;
    if v_status = 200 then
      perform private.apply_ical(f.id, v_body);
      v_n := v_n + 1;
    else
      update public.ical_feeds set pending_request = null, last_synced_at = now(),
             last_error = left(coalesce(v_err, 'HTTP ' || v_status), 300) where id = f.id;
    end if;
  end loop;
  return v_n;
end $$;

-- Staff: "sync now" (start) and, a few seconds later, read the answers (collect)
create or replace function public.ical_sync(p_property uuid, p_step text)
returns int
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.properties pr where pr.id = p_property
                  and private.has_role(pr.tenant_id, '{owner,manager,reception}')) then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_step = 'start' then return private.ical_start(p_property); end if;
  return private.ical_collect(p_property);
end $$;
revoke execute on function public.ical_sync(uuid, text) from public, anon;
grant execute on function public.ical_sync(uuid, text) to authenticated;

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('ical-sync', '*/15 * * * *', 'select private.ical_collect(null); select private.ical_start(null);');
  end if;
end $outer$;

-- ---------------------------------------------------------------- export (public calendar link)
-- Our bookings and other channels' blocks for one unit, without any guest details.
create or replace function public.unit_ical_public(p_token uuid, p_exclude_channel text default null)
returns table (uid text, start_date date, end_date date, summary text)
language sql stable security definer set search_path = ''
as $$
  select r.id::text || '@nuzul', lower(r.stay), upper(r.stay), 'Reserved'
    from public.units u join public.reservations r on r.unit_id = u.id
   where u.ical_token = p_token and r.status in ('tentative', 'confirmed', 'checked_in')
     and upper(r.stay) >= current_date - 1
     and not exists (select 1 from public.channel_blocks cb join public.ical_feeds f on f.id = cb.feed_id
                      where cb.reservation_id = r.id and f.channel = p_exclude_channel)
  union all
  select b.id::text || '@nuzul', lower(b.stay), upper(b.stay), 'Not available'
    from public.units u join public.channel_blocks b on b.unit_id = u.id join public.ical_feeds f on f.id = b.feed_id
   where u.ical_token = p_token and b.removed_at is null and b.reservation_id is null
     and upper(b.stay) >= current_date - 1 and f.channel is distinct from p_exclude_channel
  union all
  select 'mt-' || m.id::text || '@nuzul', (m.created_at at time zone 'UTC')::date, current_date + 1, 'Not available'
    from public.units u join public.maintenance_tickets m on m.unit_id = u.id
   where u.ical_token = p_token and m.blocks_availability and m.status <> 'closed'
$$;
revoke execute on function public.unit_ical_public(uuid, text) from public;
grant execute on function public.unit_ical_public(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------- availability & safety
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
     and not exists (
       select 1 from public.channel_blocks b
        where b.unit_id = u.id and b.removed_at is null and b.reservation_id is null
          and b.stay && daterange(p_from, p_to))
   order by fl.sort nulls last, u.number
$$;

-- The database refuses a booking on dates a channel already sold (unless converting that block)
create or replace function private.channel_block_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('tentative', 'confirmed', 'checked_in')
     and coalesce(current_setting('app.converting_block', true), '') <> 'on'
     and exists (select 1 from public.channel_blocks b
                  where b.unit_id = new.unit_id and b.removed_at is null and b.reservation_id is null and b.stay && new.stay) then
    raise exception 'CHANNEL_BLOCKED: dates sold on another channel';
  end if;
  return new;
end $$;
create trigger reservations_channel_guard before insert or update of unit_id, stay, status on public.reservations
  for each row execute function private.channel_block_guard();

-- Turn a channel block into a real booking once the guest's details are in
create or replace function public.convert_channel_block(p_block uuid, p_guest uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare b record; v_res uuid; v_source public.booking_source;
begin
  select cb.*, f.channel into b from public.channel_blocks cb join public.ical_feeds f on f.id = cb.feed_id where cb.id = p_block for update of cb;
  if not found or not private.has_role(b.tenant_id, '{owner,manager,reception}') then raise exception 'FORBIDDEN: not allowed'; end if;
  if b.reservation_id is not null or b.removed_at is not null then raise exception 'INVALID_STATUS: block'; end if;
  v_source := case b.channel when 'airbnb' then 'airbnb' when 'booking' then 'booking' when 'agoda' then 'agoda' when 'expedia' then 'expedia' else 'other' end;
  perform set_config('app.converting_block', 'on', true);
  v_res := public.create_reservation(b.property_id, b.unit_id, p_guest, lower(b.stay), upper(b.stay), v_source);
  perform set_config('app.converting_block', 'off', true);
  update public.channel_blocks set reservation_id = v_res where id = b.id;
  return v_res;
end $$;
revoke execute on function public.convert_channel_block(uuid, uuid) from public, anon;
grant execute on function public.convert_channel_block(uuid, uuid) to authenticated;

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
