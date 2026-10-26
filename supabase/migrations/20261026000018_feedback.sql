-- =====================================================================
-- 0018 — Guest suggestions & complaints.
-- Guests scan a QR code (per property, random token) and submit without an
-- account; staff with the 'feedback' section (owner, manager by default)
-- read and handle them.
-- =====================================================================

-- 'feedback' becomes a grantable section
alter table public.memberships drop constraint memberships_permissions_valid;
alter table public.memberships add constraint memberships_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback']::text[]);
alter table public.invitations drop constraint invitations_permissions_valid;
alter table public.invitations add constraint invitations_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback']::text[]);

-- Public, unguessable link per property (the QR code points to it)
alter table public.properties add column feedback_token uuid not null default gen_random_uuid();
create unique index properties_feedback_token_idx on public.properties(feedback_token);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('suggestion', 'complaint')),
  message text not null check (char_length(message) between 3 and 2000),
  rating int check (rating between 1 and 5),
  guest_name text check (char_length(guest_name) <= 120),
  contact text check (char_length(contact) <= 120),
  room text check (char_length(room) <= 20),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  staff_notes text check (char_length(staff_notes) <= 2000),
  handled_by uuid references auth.users(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index feedback_property_idx on public.feedback(property_id, created_at desc);
create index feedback_tenant_idx on public.feedback(tenant_id);
create index feedback_handled_by_idx on public.feedback(handled_by);
alter table public.feedback enable row level security;

-- Owner always; manager by default; anyone else only if the owner ticked 'feedback'
create or replace function private.can_feedback(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (m.role = 'owner'
            or (m.permissions is null and m.role = 'manager')
            or (m.permissions is not null and 'feedback' = any (m.permissions)))
  )
$$;

create policy feedback_select on public.feedback for select to authenticated
  using (private.can_feedback(tenant_id));
create policy feedback_update on public.feedback for update to authenticated
  using (private.can_feedback(tenant_id)) with check (private.can_feedback(tenant_id));
-- No insert/delete policies: guests submit through submit_feedback(); entries are kept.
revoke insert, delete on public.feedback from authenticated;

create trigger feedback_audit after update on public.feedback
  for each row execute function private.audit_trigger();

-- Name shown on the public form
create or replace function public.feedback_property(p_token uuid)
returns table (name_ar text, name_en text)
language sql stable security definer set search_path = ''
as $$
  select name_ar, name_en from public.properties where feedback_token = p_token
$$;

create or replace function public.submit_feedback(
  p_token uuid, p_kind text, p_message text,
  p_rating int default null, p_name text default null, p_contact text default null, p_room text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v record;
begin
  select id, tenant_id into v from public.properties where feedback_token = p_token;
  if not found then raise exception 'NOT_FOUND: property'; end if;
  -- simple flood guard per property
  if (select count(*) from public.feedback where property_id = v.id and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'RATE_LIMIT: too many submissions';
  end if;
  insert into public.feedback(tenant_id, property_id, kind, message, rating, guest_name, contact, room)
  values (v.tenant_id, v.id, p_kind, trim(p_message), p_rating,
          nullif(trim(p_name), ''), nullif(trim(p_contact), ''), nullif(trim(p_room), ''));
end $$;

revoke execute on function public.feedback_property(uuid) from public;
revoke execute on function public.submit_feedback(uuid, text, text, int, text, text, text) from public;
grant execute on function public.feedback_property(uuid) to anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, int, text, text, text) to anon, authenticated;

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
           private.can_feedback(tenant_id) as fb
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
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;
