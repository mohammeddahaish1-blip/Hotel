\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner Name') x;
grant select on c to authenticated, anon;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate) select t, p, 'x', 20000, 300000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
insert into public.guests(tenant_id, full_name, consent_at) select t, 'Tenant Guest', now() from c;
create temp table r as select public.create_reservation((select p from c), (select id from public.units), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 60) id;
grant select on r to authenticated, anon;
create temp table doc as select public.create_contract_document((select id from r), 'عقد إيجار', E'الطرف الأول: الفندق\nالطرف الثاني: Tenant Guest') id;
grant select on doc to authenticated, anon;
create temp table tk as select token from public.contract_documents;
grant select on tk to anon;
reset role;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create temp table sig as select 'data:image/png;base64,' || repeat('iVBORw0KGgo', 30) s;
grant select on sig to anon;

select pg_temp.check((select body_hash from public.contract_documents) = encode(extensions.digest(E'الطرف الأول: الفندق\nالطرف الثاني: Tenant Guest', 'sha256'), 'hex'), 'fingerprint');
select pg_temp.check((select hotel_signed_at is not null from public.contract_documents), 'hotel signed on issue');

-- the text is frozen, even for the owner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
update public.contract_documents set body = 'changed';   -- no write permission: nothing changes
reset role;
select pg_temp.check((select body from public.contract_documents) like 'الطرف الأول%', 'staff cannot edit text');
do $$ begin
  update public.contract_documents set body = 'changed';
  raise exception 'TEST FAILED: body changed by superuser';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;

-- guest (anonymous) reads and signs
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check((public.contract_document_public((select token from tk)) ->> 'intact')::boolean, 'intact');
do $$ begin
  perform public.sign_contract_document((select token from tk), 'Tenant Guest', 'not-an-image');
  raise exception 'TEST FAILED: bad signature accepted';
exception when others then if sqlerrm not like 'INVALID%' then raise; end if; end $$;
select public.sign_contract_document((select token from tk), 'Tenant Guest', (select s from sig), '1.2.3.4', 'test-agent');
select pg_temp.check((public.contract_document_public((select token from tk)) ->> 'status') = 'signed', 'signed');
do $$ begin
  perform public.sign_contract_document((select token from tk), 'Someone', (select s from sig));
  raise exception 'TEST FAILED: signed twice';
exception when others then if sqlerrm not like 'INVALID_STATUS%' then raise; end if; end $$;
select pg_temp.check((select count(*) from public.contract_documents) = 0, 'anon cannot list contracts');
reset role;

-- reception cannot void; owner can
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
do $$ begin
  perform public.void_contract_document((select id from doc));
  raise exception 'TEST FAILED: reception voided';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.void_contract_document((select id from doc), 'wrong unit');
select pg_temp.check((select status from public.contract_documents) = 'void', 'voided');
reset role;
select 'E CONTRACTS OK';
rollback;
