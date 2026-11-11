\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000f1', 'mgr@t'),
  ('00000000-0000-0000-0000-0000000000f2', 'rec@t'), ('00000000-0000-0000-0000-0000000000f3', 'hk@t') on conflict do nothing;
create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t from public.create_tenant('T', 'P', 'Owner') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000f1', 'manager', 'Manager' from c;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000f2', 'reception', 'Sara' from c;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000f3', 'housekeeping', 'Mariam' from c;

-- an employee complains about the manager (salary); another stays anonymous
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
select pg_temp.check(public.can_file_staff_complaint((select t from c)), 'reception may write');
select public.submit_staff_complaint((select t from c), 'salary', 'My salary for October was not paid.', '00000000-0000-0000-0000-0000000000f1');
select pg_temp.check((select count(*) from public.staff_complaints) = 1, 'writer sees own complaint');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
set local role authenticated;
select public.submit_staff_complaint((select t from c), 'treatment', 'Shouting at staff.', null, true);
select pg_temp.check((select count(*) from public.staff_complaints) = 0, 'anonymous writer keeps no link');
reset role;
select pg_temp.check((select author_id is null and author_name is null from public.staff_complaints where category = 'treatment'), 'anonymous has no name');

-- the manager can neither write nor read, not even through the activity log
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select pg_temp.check(not public.can_file_staff_complaint((select t from c)), 'manager may not write');
select pg_temp.expect($$select public.submit_staff_complaint((select t from c), 'other', 'test text')$$, 'FORBIDDEN');
select pg_temp.check((select count(*) from public.staff_complaints) = 0, 'manager reads nothing');
select pg_temp.check(not exists (select 1 from public.audit_log where table_name = 'staff_complaints'), 'not in the activity log');
update public.staff_complaints set status = 'resolved';
reset role;
select pg_temp.check((select count(*) from public.staff_complaints where status = 'new') = 2, 'manager cannot change them');

-- the owner reads both and replies; the writer sees the reply
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check((select count(*) from public.staff_complaints) = 2, 'owner reads all');
select pg_temp.check(not public.can_file_staff_complaint((select t from c)), 'owner does not write');
update public.staff_complaints set status = 'resolved', owner_reply = 'Paid today.', replied_at = now() where category = 'salary';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
select pg_temp.check((select owner_reply from public.staff_complaints) = 'Paid today.', 'writer sees the reply');
reset role;
rollback;
select 'STAFF COMPLAINTS OK';
