\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner Name') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101,102');
reset role;
create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;

-- guest name and phone
select pg_temp.expect($$insert into public.guests(tenant_id, full_name, consent_at) select t, '   ', now() from c$$, 'GUEST_NAME_REQUIRED');
select pg_temp.expect($$insert into public.guests(tenant_id, full_name, phone, consent_at) select t, 'A', 'abc-not-a-phone', now() from c$$, 'INVALID_PHONE');
select pg_temp.expect($$insert into public.guests(tenant_id, full_name, phone, consent_at) select t, 'A', '123', now() from c$$, 'INVALID_PHONE');
insert into public.guests(tenant_id, full_name, phone, consent_at, doc_type, doc_number, nationality)
  select t, '  Salim   Al Harthy ', '٠٠٩٦٨ ٩١٢٣-٤٥٦٧', now(), 'passport', 'P1', 'OMN' from c;
select pg_temp.check((select full_name from public.guests) = 'Salim Al Harthy', 'name tidied');
select pg_temp.check((select phone from public.guests) = '+96891234567', 'phone normalised: ' || (select phone from public.guests));
update public.guests set phone = '  ' where full_name = 'Salim Al Harthy';
select pg_temp.check((select phone from public.guests) is null, 'blank phone becomes null');
-- a value saved before the check is kept while other fields are edited
alter table public.guests disable trigger guests_clean;
update public.guests set phone = 'old-bad' where full_name = 'Salim Al Harthy';
alter table public.guests enable trigger guests_clean;
update public.guests set full_name = 'Salim A', phone = 'old-bad' where full_name = 'Salim Al Harthy';
select pg_temp.check((select phone from public.guests) = 'old-bad', 'legacy phone kept on unrelated edit');
select pg_temp.expect($$update public.guests set phone = 'new-bad'$$, 'INVALID_PHONE');

-- past dates: reception refused, owner allowed
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
create temp table ids as select (select id from public.guests) g, (select id from public.units where number = '101') u1, (select id from public.units where number = '102') u2,
  private.property_today((select p from c)) today;
grant select on ids to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.expect($$select public.create_reservation((select p from c), (select u1 from ids), (select g from ids), (select today from ids) - 3, (select today from ids) - 1)$$, 'PAST_DATES');
create temp table r as select public.create_reservation((select p from c), (select u1 from ids), (select g from ids), (select today from ids), (select today from ids) + 2) id;
select pg_temp.expect($$select public.change_reservation((select id from r), (select u1 from ids), (select today from ids) - 2, (select today from ids) + 2)$$, 'PAST_DATES');
select public.change_reservation((select id from r), (select u2 from ids), (select today from ids), (select today from ids) + 3);   -- other edits still fine
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.create_reservation((select p from c), (select u1 from ids), (select g from ids), (select today from ids) - 5, (select today from ids) - 3);
reset role;
rollback;
select 'GUEST CHECKS PAST DATES OK';
