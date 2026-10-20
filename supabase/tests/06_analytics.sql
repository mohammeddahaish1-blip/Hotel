\set ON_ERROR_STOP 1
-- Staff performance counts real actions per employee; only owner/manager may read it.
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'),
  ('00000000-0000-0000-0000-0000000000d1', 'rec@t'),
  ('00000000-0000-0000-0000-0000000000d2', 'hk@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000d1', 'reception' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000d2', 'housekeeping' from c;

create function pg_temp.check(p bool, msg text) returns void language plpgsql as $$
begin if p is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- reception: guest, booking, check-in, payment, check-out
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
insert into public.guests(tenant_id, full_name, consent_at, doc_type, doc_number, nationality)
  select t, 'G', now(), 'passport', 'X1', 'OMN' from c;
create temp table r as select public.create_reservation((select p from c), (select id from public.units), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 1) id;
grant select on r to authenticated;
select public.check_in((select id from r));
insert into public.payments(tenant_id, folio_id, method, amount)
  select t, (select id from public.folios), 'cash', 22800 from c;
select public.check_out((select id from r));
reset role;

-- housekeeping finishes the cleaning task
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
set local role authenticated;
select public.set_hk_task_status((select id from public.hk_tasks), 'done');
do $$ begin
  perform public.staff_performance((select p from c), current_date - 1, current_date + 1);
  raise exception 'TEST FAILED: housekeeping read staff performance';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table sp as select * from public.staff_performance((select p from c), current_date - 1, current_date + 1);
select pg_temp.check((select reservations_created = 1 and check_ins = 1 and check_outs = 1 and payments_count = 1 and payments_amount = 22800
                        from sp where user_id = '00000000-0000-0000-0000-0000000000d1'), 'reception metrics');
select pg_temp.check((select hk_tasks_done = 1 from sp where user_id = '00000000-0000-0000-0000-0000000000d2'), 'housekeeping metrics');
select pg_temp.check((select sum(amount) from public.daily_income((select p from c), current_date - 1, current_date + 1)) = 22800, 'daily income');
reset role;
select 'ANALYTICS OK';
rollback;
