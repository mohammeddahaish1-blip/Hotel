\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'mgr@t'), ('00000000-0000-0000-0000-0000000000d1', 'custom@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated, anon;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c1', 'manager' from c;
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000d1', 'reception', '{feedback,board}' from c;
create temp table tok as select feedback_token k from public.properties;
grant select on tok to anon, authenticated;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- anonymous guest submits through the token
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check((select name_ar from public.feedback_property((select k from tok))) = 'P', 'public property name');
select public.submit_feedback((select k from tok), 'complaint', 'Air conditioning is noisy', 2, 'Ali', '+96890000000', '101');
select public.submit_feedback((select k from tok), 'suggestion', 'Add a kettle in the room');
select pg_temp.check((select count(*) from public.feedback_property('00000000-0000-0000-0000-000000000000')) = 0, 'wrong token gives nothing');
reset role;

-- owner & manager see them; complaint raises an alert
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.feedback) = 2, 'owner sees feedback');
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'new_complaint' and unit = '101'), 'complaint alert');
update public.feedback set status = 'resolved' where kind = 'complaint';
select pg_temp.check(not exists (select 1 from public.alerts((select p from c)) where kind = 'new_complaint'), 'resolved complaint leaves alerts');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.feedback) = 2, 'manager sees feedback');
reset role;
-- reception: nothing; custom member granted 'feedback': sees it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.feedback) = 0, 'reception cannot see feedback');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.feedback) = 2, 'granted member sees feedback');
reset role;
select 'FEEDBACK OK';
rollback;
