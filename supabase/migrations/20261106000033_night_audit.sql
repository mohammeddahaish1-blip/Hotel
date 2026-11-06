-- =====================================================================
-- 0033 — Daily close (night audit). Before the day is closed the front office deals with guests
-- past their departure date and bookings whose arrival date has passed. Closing records who closed
-- the day, when, what was still open and the day's figures. Reception must clear everything;
-- the owner or a manager may close with items left if they write a note.
-- =====================================================================

create table public.night_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  business_date date not null,
  closed_by uuid default auth.uid() references auth.users(id),
  closed_at timestamptz not null default now(),
  pending int not null default 0,
  note text check (char_length(note) <= 300),
  summary jsonb not null default '{}'::jsonb,
  unique (property_id, business_date)
);
create index night_audits_tenant_idx on public.night_audits(tenant_id);
create index night_audits_closed_by_idx on public.night_audits(closed_by);
alter table public.night_audits enable row level security;
create policy night_audits_select on public.night_audits for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create trigger night_audits_audit after insert or update on public.night_audits
  for each row execute function private.audit_trigger();

-- What is still open for the property's current business day
create or replace function private.night_audit_counts(p_property uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with p as (select id, timezone, private.property_today(id) as today from public.properties where id = p_property)
  select jsonb_build_object(
    'overstays', (select count(*) from public.reservations r, p
                   where r.property_id = p.id and r.status = 'checked_in' and upper(r.stay) < p.today),
    'no_shows', (select count(*) from public.reservations r, p
                  where r.property_id = p.id and r.status in ('tentative', 'confirmed') and lower(r.stay) < p.today),
    'arrivals_waiting', (select count(*) from public.reservations r, p
                          where r.property_id = p.id and r.status in ('tentative', 'confirmed') and lower(r.stay) = p.today),
    'in_house', (select count(*) from public.reservations r, p where r.property_id = p.id and r.status = 'checked_in'),
    'departures', (select count(*) from public.reservations r, p
                    where r.property_id = p.id and r.status = 'checked_out' and (r.checked_out_at at time zone p.timezone)::date = p.today),
    'arrivals', (select count(*) from public.reservations r, p
                  where r.property_id = p.id and r.status in ('checked_in', 'checked_out') and (r.checked_in_at at time zone p.timezone)::date = p.today),
    'open_shifts', (select count(*) from public.cash_shifts s, p where s.property_id = p.id and s.closed_at is null),
    'collected', (select coalesce(sum(pm.amount), 0) from public.payments pm join public.folios f on f.id = pm.folio_id, p
                   where f.property_id = p.id and pm.voided_at is null and pm.kind = 'payment'
                     and (pm.received_at at time zone p.timezone)::date = p.today),
    'units', (select count(*) from public.units u, p where u.property_id = p.id and u.active))
  from p
$$;
revoke execute on function private.night_audit_counts(uuid) from public, anon;
grant execute on function private.night_audit_counts(uuid) to authenticated;

create or replace function public.close_night_audit(p_property uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date;
  v_counts jsonb;
  v_pending int;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select tenant_id into v_tenant from public.properties where id = p_property;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager,reception}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  v_today := private.property_today(p_property);
  v_counts := private.night_audit_counts(p_property);
  v_pending := (v_counts->>'overstays')::int + (v_counts->>'no_shows')::int;
  if v_pending > 0 and (v_note is null or not private.has_role(v_tenant, '{owner,manager}')) then
    raise exception 'AUDIT_PENDING: % item(s) still open', v_pending;
  end if;
  insert into public.night_audits(tenant_id, property_id, business_date, pending, note, summary)
  values (v_tenant, p_property, v_today, v_pending, left(v_note, 300), v_counts)
  on conflict (property_id, business_date) do update
     set closed_by = auth.uid(), closed_at = now(), pending = excluded.pending,
         note = excluded.note, summary = excluded.summary
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.close_night_audit(uuid, text) from public, anon;
grant execute on function public.close_night_audit(uuid, text) to authenticated;
