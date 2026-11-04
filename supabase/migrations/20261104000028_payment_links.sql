-- =====================================================================
-- 0028 — Payment links.
-- A link (/p/<token>) tells the guest how much to pay. Until an online payment gateway
-- is connected the page shows the hotel's bank transfer details and the guest uploads the
-- transfer proof; staff confirm it and the payment is booked on the guest's account.
-- mark_payment_link_paid() is the entry point a gateway webhook will use later.
-- =====================================================================

alter table public.properties add column bank_name text check (char_length(bank_name) <= 80);
alter table public.properties add column bank_account_name text check (char_length(bank_account_name) <= 120);
alter table public.properties add column bank_iban text check (char_length(bank_iban) <= 40);
alter table public.properties add column payment_instructions text check (char_length(payment_instructions) <= 500);

create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  folio_id uuid not null references public.folios(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  amount bigint not null check (amount > 0),
  purpose text not null default 'balance' check (purpose in ('balance', 'deposit', 'rent', 'other')),
  note text check (char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'proof_submitted', 'paid', 'cancelled')),
  expires_at timestamptz not null default now() + interval '14 days',
  provider text check (char_length(provider) <= 40),
  provider_ref text check (char_length(provider_ref) <= 120),
  proof_path text check (char_length(proof_path) <= 300),
  proof_submitted_at timestamptz,
  payer_note text check (char_length(payer_note) <= 300),
  payment_id uuid references public.payments(id),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz
);
create index payment_links_property_idx on public.payment_links(property_id, status);
create index payment_links_tenant_idx on public.payment_links(tenant_id);
create index payment_links_reservation_idx on public.payment_links(reservation_id);
create index payment_links_folio_idx on public.payment_links(folio_id);
create index payment_links_payment_idx on public.payment_links(payment_id);
create index payment_links_created_by_idx on public.payment_links(created_by);
alter table public.payment_links enable row level security;
create policy payment_links_select on public.payment_links for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy payment_links_insert on public.payment_links for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}') and status = 'open');
create policy payment_links_update on public.payment_links for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,accountant}') and status in ('open', 'proof_submitted', 'cancelled'));
create trigger payment_links_audit after insert or update on public.payment_links
  for each row execute function private.audit_trigger();

-- New link for a booking (default amount = current balance)
create or replace function public.create_payment_link(p_reservation uuid, p_amount bigint default null, p_purpose text default 'balance', p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r record; v_folio uuid; v_amount bigint; v_token uuid;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
  select id into v_folio from public.folios where reservation_id = r.id;
  if v_folio is null then raise exception 'NOT_FOUND: folio'; end if;
  v_amount := coalesce(p_amount, (public.folio_summary(v_folio) ->> 'balance')::bigint);
  if v_amount is null or v_amount <= 0 then raise exception 'NOTHING_DUE: balance'; end if;
  insert into public.payment_links(tenant_id, property_id, reservation_id, folio_id, amount, purpose, note)
  values (r.tenant_id, r.property_id, r.id, v_folio, v_amount,
          case when p_purpose in ('balance', 'deposit', 'rent', 'other') then p_purpose else 'balance' end, left(p_note, 200))
  returning token into v_token;
  return v_token;
end $$;
revoke execute on function public.create_payment_link(uuid, bigint, text, text) from public, anon;
grant execute on function public.create_payment_link(uuid, bigint, text, text) to authenticated;

-- A queued "payment request" message gets its link when staff open the messages list
create or replace function public.ensure_outbox_payment_link(p_outbox uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare o record; v_token uuid;
begin
  select * into o from public.message_outbox where id = p_outbox for update;
  if not found or not private.has_role(o.tenant_id, '{owner,manager,reception}') then raise exception 'FORBIDDEN: not allowed'; end if;
  if o.payload ? 'payment_link_token' then return (o.payload ->> 'payment_link_token')::uuid; end if;
  if o.reservation_id is null or o.status <> 'pending' then return null; end if;
  -- reuse an open link of the booking when there is one
  select token into v_token from public.payment_links
   where reservation_id = o.reservation_id and status = 'open' and expires_at > now() order by created_at desc limit 1;
  if v_token is null then
    begin
      v_token := public.create_payment_link(o.reservation_id, null, case when o.payload ? 'billing_schedule_id' then 'rent' else 'balance' end, null);
    exception when others then
      return null;   -- nothing due: the message goes without a link
    end;
  end if;
  update public.message_outbox set payload = payload || jsonb_build_object('payment_link_token', v_token) where id = o.id;
  return v_token;
end $$;
revoke execute on function public.ensure_outbox_payment_link(uuid) from public, anon;
grant execute on function public.ensure_outbox_payment_link(uuid) to authenticated;

-- What the public page shows (no guest personal data beyond the first name)
create or replace function public.payment_link_public(p_token uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'status', case when l.status = 'open' and l.expires_at < now() then 'expired' else l.status end,
    'amount', l.amount, 'purpose', l.purpose, 'note', l.note, 'expires_at', l.expires_at,
    'code', r.code, 'unit', u.number, 'guest', split_part(g.full_name, ' ', 1), 'lang', g.preferred_language,
    'hotel_ar', pr.name_ar, 'hotel_en', pr.name_en, 'phone', coalesce(pr.whatsapp, pr.phone),
    'bank_name', pr.bank_name, 'bank_account_name', pr.bank_account_name, 'bank_iban', pr.bank_iban,
    'instructions', pr.payment_instructions, 'currency', pr.currency)
    from public.payment_links l
    join public.reservations r on r.id = l.reservation_id
    join public.units u on u.id = r.unit_id
    join public.guests g on g.id = r.guest_id
    join public.properties pr on pr.id = l.property_id
   where l.token = p_token
$$;
revoke execute on function public.payment_link_public(uuid) from public;
grant execute on function public.payment_link_public(uuid) to anon, authenticated;

create or replace function public.payment_link_open(p_token text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.payment_links
                  where token::text = p_token and status in ('open', 'proof_submitted') and expires_at > now())
$$;
grant execute on function public.payment_link_open(text) to anon, authenticated;

-- Guest uploads the transfer receipt: files live under <token>/ in a private bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('link-proofs', 'link-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy link_proofs_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'link-proofs' and public.payment_link_open((storage.foldername(name))[1]));
create policy link_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'link-proofs' and exists (
    select 1 from public.payment_links l
     where l.token::text = (storage.foldername(name))[1]
       and private.has_role(l.tenant_id, '{owner,manager,reception,accountant}')));

create or replace function public.submit_payment_link_proof(p_token uuid, p_path text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_path is null or split_part(p_path, '/', 1) <> p_token::text or p_path like '%..%' then raise exception 'INVALID: path'; end if;
  update public.payment_links
     set status = 'proof_submitted', proof_path = left(p_path, 300), proof_submitted_at = now(), payer_note = left(nullif(trim(p_note), ''), 300)
   where token = p_token and status in ('open', 'proof_submitted') and expires_at > now();
  if not found then raise exception 'NOT_FOUND: link'; end if;
end $$;
revoke execute on function public.submit_payment_link_proof(uuid, text, text) from public;
grant execute on function public.submit_payment_link_proof(uuid, text, text) to anon, authenticated;

-- Staff confirm the money arrived: the payment is booked on the guest's account
create or replace function public.confirm_payment_link(p_id uuid, p_method text default 'transfer', p_amount bigint default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare l record; v_payment uuid;
begin
  select * into l from public.payment_links where id = p_id for update;
  if not found or not private.has_role(l.tenant_id, '{owner,manager,reception,accountant}') then raise exception 'FORBIDDEN: not allowed'; end if;
  if l.status not in ('open', 'proof_submitted') then raise exception 'INVALID_STATUS: link'; end if;
  insert into public.payments(tenant_id, folio_id, kind, method, amount, reference, notes)
  values (l.tenant_id, l.folio_id, 'payment',
          (case when p_method in ('cash', 'card', 'transfer', 'link') then p_method else 'transfer' end)::public.payment_method,
          coalesce(nullif(p_amount, 0), l.amount), 'رابط دفع ' || left(l.token::text, 8), l.payer_note)
  returning id into v_payment;
  update public.payment_links set status = 'paid', paid_at = now(), payment_id = v_payment where id = l.id;
  return v_payment;
end $$;
revoke execute on function public.confirm_payment_link(uuid, text, bigint) from public, anon;
grant execute on function public.confirm_payment_link(uuid, text, bigint) to authenticated;

-- For a payment gateway's webhook (service role only, never browsers)
create or replace function public.mark_payment_link_paid(p_token uuid, p_provider text, p_ref text, p_amount bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare l record; v_payment uuid;
begin
  select * into l from public.payment_links where token = p_token for update;
  if not found then raise exception 'NOT_FOUND: link'; end if;
  if l.status = 'paid' then return l.payment_id; end if;   -- webhooks may repeat
  if l.status = 'cancelled' then raise exception 'INVALID_STATUS: link'; end if;
  insert into public.payments(tenant_id, folio_id, kind, method, amount, reference, notes)
  values (l.tenant_id, l.folio_id, 'payment', 'link', p_amount, left(p_provider || ' ' || p_ref, 120), null)
  returning id into v_payment;
  update public.payment_links set status = 'paid', paid_at = now(), payment_id = v_payment,
         provider = left(p_provider, 40), provider_ref = left(p_ref, 120) where id = l.id;
  return v_payment;
end $$;
revoke execute on function public.mark_payment_link_paid(uuid, text, text, bigint) from public, anon, authenticated;

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
  -- 7) urgent maintenance still open (everyone)
  select 'urgent_maintenance', 2, t.id, u.number, null, t.title
    from p
    join public.maintenance_tickets t on t.property_id = p.id and t.status <> 'closed' and t.priority = 1
    join public.units u on u.id = t.unit_id
  order by 2, 1
$$;
