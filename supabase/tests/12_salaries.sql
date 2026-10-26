\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'acc@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000b1', 'reception', 'Ali' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c1', 'accountant' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table pay as select public.pay_salary((select p from c), '00000000-0000-0000-0000-0000000000b1', '2026-10-15', 350000, 'transfer') id;
grant select on pay to authenticated;
select pg_temp.check((select month from public.salary_payments) = '2026-10-01', 'month normalised');
select pg_temp.check((select count(*) from public.expenses where category = 'salaries' and amount = 350000 and description not like '%Ali%') = 1, 'expense without the name');
reset role;

-- accountant: sees the expense, not who was paid
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.salary_payments) = 0, 'accountant cannot see salary payments');
select pg_temp.check((select count(*) from public.expenses where category = 'salaries') = 1, 'accountant sees the salaries expense');
do $$ begin perform public.pay_salary((select p from c), '00000000-0000-0000-0000-0000000000b1', '2026-11-01', 1, 'cash');
  raise exception 'TEST FAILED: accountant paid a salary'; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end $$;
reset role;

-- employee sees their own payment; owner can undo it (expense removed too)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.salary_payments) = 1, 'employee sees own salary payment');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.cancel_salary((select id from pay));
select pg_temp.check((select count(*) from public.expenses where category = 'salaries') = 0, 'undo removes the expense');
reset role;
select 'SALARIES OK';
rollback;
