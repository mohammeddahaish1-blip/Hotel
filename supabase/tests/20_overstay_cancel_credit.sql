\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner Name') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101,102,103');
insert into public.guests(tenant_id, full_name, consent_at, doc_type, doc_number, nationality)
  select t, 'G ' || n, now(), 'passport', 'P' || n, 'OMN' from c, generate_series(1, 6) n;
create temp table d as select private.property_today((select p from c)) today;
grant select on d to authenticated;
create temp table u as select number, id from public.units;
grant select on u to authenticated;
create temp table g as select row_number() over (order by full_name) n, id from public.guests;
grant select on g to authenticated;
reset role;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.unit(n text) returns uuid language sql as $$ select id from u where number = n $$;
create function pg_temp.guest(n int) returns uuid language sql as $$ select id from g where g.n = $1 $$;

-- an overstaying guest in 101: booked [today, today+1), checked in, then the stay is pushed into the past
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table r1 as select public.create_reservation((select p from c), pg_temp.unit('101'), pg_temp.guest(1), (select today from d), (select today from d) + 1) id;
select public.check_in((select id from r1));
reset role;
update public.reservations set stay = daterange((select today from d) - 5, (select today from d) - 2) where id = (select id from r1);

set local role authenticated;
select pg_temp.check(not exists (select 1 from public.available_units((select p from c), (select today from d), (select today from d) + 1) where unit_id = pg_temp.unit('101')), '101 not offered tonight');
select pg_temp.check(exists (select 1 from public.available_units((select p from c), (select today from d), (select today from d) + 1) where unit_id = pg_temp.unit('102')), '102 still offered');
select pg_temp.check(exists (select 1 from public.available_units((select p from c), (select today from d) + 3, (select today from d) + 4) where unit_id = pg_temp.unit('101')), '101 offered for later dates');
do $$ begin
  perform public.create_reservation((select p from c), pg_temp.unit('101'), pg_temp.guest(2), (select today from d), (select today from d) + 2);
  raise exception 'TEST FAILED: booked over an overstaying guest';
exception when others then if sqlerrm not like 'UNIT_OCCUPIED%' then raise; end if; end $$;
-- a back-dated entry before the overstay is still possible (import of old bookings)
select public.create_reservation((select p from c), pg_temp.unit('101'), pg_temp.guest(2), (select today from d) - 12, (select today from d) - 10);
-- extending the overstaying guest's own booking is allowed
select public.change_reservation((select id from r1), pg_temp.unit('101'), (select today from d) - 5, (select today from d) + 1);
reset role;
update public.reservations set stay = daterange((select today from d) - 5, (select today from d) - 2) where id = (select id from r1);
set local role authenticated;
-- moving another booking into 101 tonight is refused
create temp table r2 as select public.create_reservation((select p from c), pg_temp.unit('103'), pg_temp.guest(3), (select today from d), (select today from d) + 1) id;
do $$ begin
  perform public.change_reservation((select id from r2), pg_temp.unit('101'), (select today from d), (select today from d) + 1);
  raise exception 'TEST FAILED: moved into an overstaying guest''s room';
exception when others then if sqlerrm not like 'UNIT_OCCUPIED%' then raise; end if; end $$;

-- same-day turnover: guest in 102 leaves today and is still in-house; a new arrival can be booked ...
create temp table r3 as select public.create_reservation((select p from c), pg_temp.unit('102'), pg_temp.guest(4), (select today from d), (select today from d) + 1) id;
select public.check_in((select id from r3));
reset role;
update public.reservations set stay = daterange((select today from d) - 1, (select today from d)) where id = (select id from r3);
set local role authenticated;
create temp table r4 as select public.create_reservation((select p from c), pg_temp.unit('102'), pg_temp.guest(5), (select today from d), (select today from d) + 2) id;
-- ... but cannot check in until the departing guest has checked out, and the message says so
do $$ begin
  perform public.check_in((select id from r4));
  raise exception 'TEST FAILED: checked in over a guest still in the room';
exception when others then if sqlerrm not like 'UNIT_OCCUPIED%' then raise; end if; end $$;
select public.check_out((select id from r3), true);
do $$ begin
  perform public.check_in((select id from r4));
  raise exception 'TEST FAILED: checked in to a dirty room';
exception when others then if sqlerrm not like 'UNIT_DIRTY%' then raise; end if; end $$;

-- cancelling an invoiced booking credits the room charges
create temp table r5 as select public.create_reservation((select p from c), pg_temp.unit('103'), pg_temp.guest(6), (select today from d) + 5, (select today from d) + 7) id;
create temp table f5 as select id from public.folios where reservation_id = (select id from r5);
create temp table i5 as select public.issue_invoice((select id from f5)) id;
select pg_temp.check((public.folio_summary((select id from f5)) ->> 'balance')::bigint > 0, 'invoiced booking has a balance');
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select public.cancel_reservation((select id from r5), 'guest changed plans');
-- reception still cannot issue credit notes by hand
do $$ begin
  perform public.issue_credit_note((select id from i5), 1000, 'x');
  raise exception 'TEST FAILED: reception issued a credit note';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;
select pg_temp.check((select count(*) from public.credit_notes where invoice_id = (select id from i5)) = 1, 'one credit note');
select pg_temp.check((select total from public.credit_notes where invoice_id = (select id from i5)) = (select total from public.invoices where id = (select id from i5)), 'credit equals invoice');
select pg_temp.check((public.folio_summary((select id from f5)) ->> 'balance')::bigint = 0, 'no debt left after cancel');
select pg_temp.check((select reason from public.credit_notes where invoice_id = (select id from i5)) like 'إلغاء الحجز — guest changed plans', 'reason recorded');
rollback;
select 'PASSED 20_overstay_cancel_credit';
