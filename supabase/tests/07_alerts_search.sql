\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000e2', 'hk@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101-103');
insert into public.guests(tenant_id, full_name, phone, consent_at, doc_type, doc_number, nationality, doc_expiry)
  select t, 'Salim Harthy', '+96891112222', now(), 'passport', 'P99', 'OMN', current_date - 10 from c;
-- arrival today on a dirty unit
select public.create_reservation((select p from c), (select id from public.units where number = '101'), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 2);
update public.units set status = 'dirty' where number = '101';
-- in-house guest whose stay ended yesterday (late check-out) with expired passport
create temp table r2 as select public.create_reservation((select p from c), (select id from public.units where number = '102'), (select id from public.guests),
  private.property_today((select p from c)) - 3, private.property_today((select p from c)) + 1) id;
grant select on r2 to authenticated;
select public.check_in((select id from r2));
reset role;
update public.reservations set stay = daterange(lower(stay), private.property_today((select p from c)) - 1) where id = (select id from r2);
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000e2', 'housekeeping' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table a as select * from public.alerts((select p from c));
select pg_temp.check(exists (select 1 from a where kind = 'arrival_unit_not_ready' and unit = '101' and guest = 'Salim Harthy'), 'arrival on dirty unit');
select pg_temp.check(exists (select 1 from a where kind = 'late_checkout' and unit = '102'), 'late checkout');
select pg_temp.check(exists (select 1 from a where kind = 'document_expired'), 'expired document');
select pg_temp.check((select count(*) from public.global_search((select p from c), 'salim') where kind = 'guest') = 1, 'search guest by name');
select pg_temp.check((select count(*) from public.global_search((select p from c), '9111') where kind = 'reservation') = 2, 'search reservation by phone');
select pg_temp.check((select count(*) from public.global_search((select p from c), '10') where kind = 'unit') = 3, 'search unit by number');
reset role;

-- housekeeping: sees units but never guest data
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.global_search((select p from c), 'salim')) = 0, 'housekeeping cannot search guests');
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'arrival_unit_not_ready' and unit = '101'), 'housekeeping sees arrival on dirty unit');
select pg_temp.check((select count(*) from public.alerts((select p from c)) where guest is not null) = 0, 'housekeeping alerts without guest names');
select pg_temp.check(not exists (select 1 from public.alerts((select p from c)) where kind in ('late_checkout', 'document_expired')), 'front-office alerts hidden from housekeeping');
reset role;
select 'ALERTS SEARCH OK';
rollback;
