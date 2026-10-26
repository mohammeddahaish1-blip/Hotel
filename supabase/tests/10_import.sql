\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'mgr@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c1', 'manager' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into public.import_jobs(tenant_id, property_id, file_name, file_kind) select t, p, 'x.xlsx', 'excel' from c;
-- owner's open drawer: a back-dated cash expense must not attach, a same-day one must
insert into public.cash_shifts(tenant_id, property_id, opening_float) select t, p, 0 from c;
insert into public.expenses(tenant_id, property_id, category, description, amount, method, expense_date)
  select t, p, 'other', 'old', 1000, 'cash', private.property_today(p) - 30 from c;
insert into public.expenses(tenant_id, property_id, category, description, amount, method)
  select t, p, 'other', 'today', 2000, 'cash' from c;
select pg_temp.check((select cash_shift_id from public.expenses where description = 'old') is null, 'back-dated cash expense not in drawer');
select pg_temp.check((select cash_shift_id from public.expenses where description = 'today') is not null, 'same-day cash expense in drawer');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.import_jobs) = 1, 'manager sees import jobs');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.import_jobs) = 0, 'reception cannot see import jobs');
reset role;
select 'IMPORT OK';
rollback;
