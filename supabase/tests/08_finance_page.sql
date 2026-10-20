\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t')
  on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- reception opens a drawer and pays a cash expense from it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
insert into public.cash_shifts(tenant_id, property_id, opening_float) select t, p, 50000 from c;
insert into public.expenses(tenant_id, property_id, category, description, amount, method) select t, p, 'supplies', 'soap', 7000, 'cash' from c;
create temp table b as select * from public.shift_breakdown((select id from public.cash_shifts));
select pg_temp.check((select expected from b) = 43000, 'reception sees expected incl. cash expense');
select pg_temp.check((select cash_expenses from b) = 7000 and (select expenses_count from b) = 1, 'expense counted');
select public.close_shift((select id from public.cash_shifts), 40000);
reset role;

-- owner: breakdown of someone else's drawer + shortage alert
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select expected from public.shift_breakdown((select id from public.cash_shifts))) = 43000, 'owner sees breakdown');
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'cash_shortage' and info = '3000'), 'cash shortage alert');
reset role;

-- reception: no shortage alert (not a cash-review role)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check(not exists (select 1 from public.alerts((select p from c)) where kind = 'cash_shortage'), 'reception has no shortage alert');
reset role;
select 'FINANCE PAGE OK';
rollback;
