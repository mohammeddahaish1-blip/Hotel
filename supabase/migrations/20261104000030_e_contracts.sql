-- =====================================================================
-- 0030 — Electronic contracts and signatures.
-- A contract document is generated from the hotel's template, then frozen: its text and
-- SHA-256 fingerprint never change. The hotel signs when issuing it; the guest signs on a
-- private link (/s/<token>) by drawing a signature and typing their name. Time, IP and
-- device are recorded with each signature. A wrong document is voided, never edited.
-- =====================================================================

alter table public.tenants add column contract_template text check (char_length(contract_template) <= 20000);

create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 40000),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'awaiting_guest' check (status in ('awaiting_guest', 'signed', 'void')),
  hotel_signed_by uuid references auth.users(id),
  hotel_signer_name text check (char_length(hotel_signer_name) <= 120),
  hotel_signed_at timestamptz,
  guest_sign_name text check (char_length(guest_sign_name) <= 120),
  guest_signature text check (char_length(guest_signature) <= 300000),
  guest_signed_at timestamptz,
  guest_ip text check (char_length(guest_ip) <= 64),
  guest_ua text check (char_length(guest_ua) <= 300),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300),
  created_at timestamptz not null default now()
);
create index contract_documents_reservation_idx on public.contract_documents(reservation_id);
create index contract_documents_tenant_idx on public.contract_documents(tenant_id);
create index contract_documents_property_idx on public.contract_documents(property_id);
create index contract_documents_hotel_signed_by_idx on public.contract_documents(hotel_signed_by);
alter table public.contract_documents enable row level security;
create policy contract_documents_select on public.contract_documents for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'));
create trigger contract_documents_audit after insert or update on public.contract_documents
  for each row execute function private.audit_trigger();

-- Issue: the hotel's signature is the issuing staff member (name from their membership)
create or replace function public.create_contract_document(p_reservation uuid, p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare r record; v_id uuid; v_name text;
begin
  select * into r from public.reservations where id = p_reservation;
  if not found or not private.has_role(r.tenant_id, '{owner,manager,reception}') then raise exception 'FORBIDDEN: not allowed'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'INVALID: empty contract'; end if;
  select nullif(full_name, '') into v_name from public.memberships where tenant_id = r.tenant_id and user_id = auth.uid();
  insert into public.contract_documents(tenant_id, property_id, reservation_id, title, body, body_hash,
                                        hotel_signed_by, hotel_signer_name, hotel_signed_at)
  values (r.tenant_id, r.property_id, r.id, left(coalesce(nullif(trim(p_title), ''), 'عقد إيجار'), 200), p_body,
          encode(extensions.digest(p_body, 'sha256'), 'hex'), auth.uid(), left(coalesce(v_name, ''), 120), now())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_contract_document(uuid, text, text) from public, anon;
grant execute on function public.create_contract_document(uuid, text, text) to authenticated;

create or replace function public.void_contract_document(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.contract_documents where id = p_id and status <> 'void' for update;
  if not found then raise exception 'NOT_FOUND: contract'; end if;
  if not private.has_role(v_tenant, '{owner,manager}') then raise exception 'FORBIDDEN: not allowed'; end if;
  update public.contract_documents set status = 'void', voided_at = now(), void_reason = left(p_reason, 300) where id = p_id;
end $$;
revoke execute on function public.void_contract_document(uuid, text) from public, anon;
grant execute on function public.void_contract_document(uuid, text) to authenticated;

-- What the signing page shows (the person holding the private link)
create or replace function public.contract_document_public(p_token uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'title', d.title, 'body', d.body, 'hash', d.body_hash, 'status', d.status,
    'intact', encode(extensions.digest(d.body, 'sha256'), 'hex') = d.body_hash,
    'hotel_ar', pr.name_ar, 'hotel_en', pr.name_en, 'lang', g.preferred_language,
    'hotel_signer', d.hotel_signer_name, 'hotel_signed_at', d.hotel_signed_at,
    'guest_sign_name', d.guest_sign_name, 'guest_signature', d.guest_signature, 'guest_signed_at', d.guest_signed_at,
    'created_at', d.created_at, 'timezone', pr.timezone)
    from public.contract_documents d
    join public.reservations r on r.id = d.reservation_id
    join public.guests g on g.id = r.guest_id
    join public.properties pr on pr.id = d.property_id
   where d.token = p_token
$$;
revoke execute on function public.contract_document_public(uuid) from public;
grant execute on function public.contract_document_public(uuid) to anon, authenticated;

create or replace function public.sign_contract_document(p_token uuid, p_name text, p_signature text, p_ip text default null, p_ua text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare d record;
begin
  select * into d from public.contract_documents where token = p_token for update;
  if not found then raise exception 'NOT_FOUND: contract'; end if;
  if d.status <> 'awaiting_guest' then raise exception 'INVALID_STATUS: contract'; end if;
  if encode(extensions.digest(d.body, 'sha256'), 'hex') <> d.body_hash then raise exception 'INVALID: contract changed'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'INVALID: name'; end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or char_length(p_signature) > 300000 or char_length(p_signature) < 200 then
    raise exception 'INVALID: signature';
  end if;
  update public.contract_documents
     set status = 'signed', guest_sign_name = left(trim(p_name), 120), guest_signature = p_signature,
         guest_signed_at = now(), guest_ip = left(p_ip, 64), guest_ua = left(p_ua, 300)
   where id = d.id;
end $$;
revoke execute on function public.sign_contract_document(uuid, text, text, text, text) from public;
grant execute on function public.sign_contract_document(uuid, text, text, text, text) to anon, authenticated;

-- Body text and fingerprint can never be changed after issuing
create or replace function private.contract_document_frozen()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.body is distinct from old.body or new.body_hash is distinct from old.body_hash or new.token is distinct from old.token then
    raise exception 'FORBIDDEN: a signed contract text cannot change';
  end if;
  return new;
end $$;
create trigger contract_documents_frozen before update on public.contract_documents
  for each row execute function private.contract_document_frozen();
