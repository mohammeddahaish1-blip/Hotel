\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner Name') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101,102');
insert into public.guests(tenant_id, full_name, consent_at, doc_type, doc_number, nationality)
  select t, 'G' || n, now(), 'passport', 'P' || n, 'OMN' from c, generate_series(1, 2) n;
create temp table d as select private.property_today((select p from c)) today;
grant select on d to authenticated;
create temp table r1 as select public.create_reservation((select p from c), (select id from public.units where number = '101'),
  (select id from public.guests where full_name = 'G1'), (select today from d), (select today from d) + 1) id;
select public.check_in((select id from r1));
create temp table r2 as select public.create_reservation((select p from c), (select id from public.units where number = '102'),
  (select id from public.guests where full_name = 'G2'), (select today from d), (select today from d) + 2) id;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
-- make r1 an overstay and r2 a booking whose arrival passed
update public.reservations set stay = daterange((select today from d) - 3, (select today from d) - 1) where id = (select id from r1);
update public.reservations set stay = daterange((select today from d) - 1, (select today from d) + 2) where id = (select id from r2);

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;

select pg_temp.check((private.night_audit_counts((select p from c)) ->> 'overstays')::int = 1, 'one overstay');
select pg_temp.check((private.night_audit_counts((select p from c)) ->> 'no_shows')::int = 1, 'one no-show');

-- reception cannot close with open items, even with a note
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.expect($$select public.close_night_audit((select p from c), 'skip')$$, 'AUDIT_PENDING');
-- clear the items: guest checks out, the other is marked no-show
select public.check_out((select id from r1), true);
select public.cancel_reservation((select id from r2), null, true);
select public.close_night_audit((select p from c));
reset role;
select pg_temp.check((select count(*) from public.night_audits) = 1, 'day closed');
select pg_temp.check((select closed_by from public.night_audits) = '00000000-0000-0000-0000-0000000000b1', 'closed by reception');
select pg_temp.check((select (summary->>'departures')::int from public.night_audits) = 1, 'summary counts the departure');

-- owner/manager may close with open items and a note; closing again updates the same day
update public.reservations set status = 'confirmed' where id = (select id from r2);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.expect($$select public.close_night_audit((select p from c))$$, 'AUDIT_PENDING');
select public.close_night_audit((select p from c), 'guest called, arriving tomorrow');
select pg_temp.check((select count(*) from public.night_audits) = 1, 'still one row for the day');
select pg_temp.check((select pending from public.night_audits) = 1 and (select note from public.night_audits) like 'guest called%', 'pending + note kept');
-- rows are written only through the function
select pg_temp.expect($$insert into public.night_audits(tenant_id, property_id, business_date) select t, p, current_date - 10 from c$$, 'new row violates row-level security');
reset role;
rollback;
select 'NIGHT AUDIT OK';
