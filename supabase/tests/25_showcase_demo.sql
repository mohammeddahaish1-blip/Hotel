\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000d1', 'visitor@nuzul.test') on conflict do nothing;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;

create temp table s1 as select private.seed_showcase() t;
create temp table s2 as select private.seed_showcase() t;   -- the nightly reset
grant select on s1, s2 to authenticated;

select pg_temp.check((select count(*) from public.units where tenant_id = (select t from s2)) = 17, '17 units');
select pg_temp.check((select count(*) from public.reservations where tenant_id = (select t from s2) and status = 'checked_in') = 6, '6 in house');
select pg_temp.check((select count(*) from public.reservations where tenant_id = (select t from s2) and status = 'confirmed') = 6, '6 coming');
select pg_temp.check((select count(*) from public.payments where tenant_id = (select t from s2)) = 5, 'payments');
select pg_temp.check((select status from public.subscriptions where tenant_id = (select t from s2)) = 'active', 'full plan');

-- the visitor sees only tonight's showcase, as a manager
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.properties) = 1, 'one property visible');
select pg_temp.check((select tenant_id from public.properties) = (select t from s2), 'the new showcase');
select pg_temp.check(not exists (select 1 from public.reservations where tenant_id = (select t from s1)), 'yesterday gone');
select pg_temp.check(private.has_role((select t from s2), '{manager}'), 'manager');
select pg_temp.expect($$insert into public.invitations(tenant_id, email, full_name, role) select t, 'x@y.z', 'X', 'reception' from s2$$, 'DEMO_ONLY');
select pg_temp.expect($$select public.support_create_request((select t from s2), 'Change something')$$, 'DEMO_ONLY');
reset role;

-- visitors without an account read the plans
set local role anon;
select pg_temp.check((select count(*) from public.plans) >= 3, 'anon reads plans');
reset role;
rollback;
select 'SHOWCASE DEMO OK';
