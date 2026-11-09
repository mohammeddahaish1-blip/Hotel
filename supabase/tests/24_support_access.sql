\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-00000000000c', 'admin@t'),
  ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
insert into public.platform_admins(user_id) values ('00000000-0000-0000-0000-00000000000c') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('Hotel Co', 'P', 'Owner') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000b1', 'reception', 'Rec' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

-- reception cannot open support requests; the owner can, without granting access
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.expect($$select public.support_create_request((select t from c), 'Change the invoice', null)$$, 'FORBIDDEN');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
create temp table r1 as select public.support_create_request((select t from c), 'Change the invoice footer', 'details') id;
grant select on r1 to authenticated;
reset role;
select pg_temp.check((select status from public.support_requests where id = (select id from r1)) = 'open', 'open without access');

-- the team cannot enter without access; asks for it; the hotel approves
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.expect($$select public.admin_start_session((select id from r1))$$, 'NO_ACCESS');
select pg_temp.check(not exists (select 1 from public.units where tenant_id = (select t from c)) and
                     not exists (select 1 from public.properties where tenant_id = (select t from c)), 'admin sees nothing before access');
select public.admin_request_access((select id from r1), 2, 'need to edit settings');
reset role;
select pg_temp.check((select status from public.support_requests where id = (select id from r1)) = 'awaiting_hotel', 'awaiting hotel');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.expect($$select public.support_decide((select id from r1), true)$$, 'NOT_FOUND');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.support_decide((select id from r1), true, 'ok');
reset role;
select pg_temp.check((select access_until from public.support_requests where id = (select id from r1)) > now() + interval '119 minutes', '2h access');

-- the team enters: it now sees the hotel as a manager; the hotel sees the session
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
create temp table s as select public.admin_start_session((select id from r1)) j;
select pg_temp.check(((select j from s) ->> 'property_id')::uuid = (select p from c), 'returns property');
select pg_temp.check(exists (select 1 from public.properties where tenant_id = (select t from c)), 'admin sees hotel during access');
select pg_temp.check(private.has_role((select t from c), '{manager}'), 'acts as manager');
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'Support type', 20000 from c;
reset role;
select pg_temp.check((select support_until from public.memberships where user_id = '00000000-0000-0000-0000-00000000000c') is not null, 'support membership');
-- nobody can make the support membership permanent by hand
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.expect($$update public.memberships set support_until = null where user_id = '00000000-0000-0000-0000-00000000000c'$$, 'FORBIDDEN');
select pg_temp.check((select count(*) from public.support_sessions where tenant_id = (select t from c)) = 1, 'owner sees the session');
select pg_temp.check(exists (select 1 from public.audit_log where tenant_id = (select t from c) and actor = '00000000-0000-0000-0000-00000000000c' and table_name = 'unit_types'), 'owner sees what changed');
reset role;

-- leaving ends access for this person at once
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select public.admin_end_session((select t from c), 'changed the phone');
select pg_temp.check(not exists (select 1 from public.properties where tenant_id = (select t from c)), 'no access after leaving');
select pg_temp.check(not private.has_role((select t from c), '{manager}'), 'no role after leaving');
-- re-entering while the grant runs works; the hotel revokes; access stops
select public.admin_start_session((select id from r1));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.support_revoke((select id from r1));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.check(not private.has_role((select t from c), '{manager}'), 'revoked');
select pg_temp.expect($$select public.admin_start_session((select id from r1))$$, 'NO_ACCESS');
reset role;
select pg_temp.check((select count(*) from public.support_sessions where tenant_id = (select t from c) and ended_at is null) = 0, 'sessions closed');

-- expiry by time alone: access that ran out stops even without anyone ending it
update public.support_requests set status = 'approved', access_from = now() - interval '3 hours', access_until = now() + interval '1 hour' where id = (select id from r1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select public.admin_start_session((select id from r1));
reset role;
select set_config('app.support_op', 'on', true);
update public.memberships set support_until = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000c';
select set_config('app.support_op', 'off', true);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.check(not private.has_role((select t from c), '{manager}'), 'expired access stops by itself');
select pg_temp.check(not exists (select 1 from public.units where tenant_id = (select t from c)), 'expired: no data');

-- periodic maintenance: the team schedules, the hotel approves or rejects, the team reports
create temp table m1 as select public.admin_create_maintenance((select t from c), 'Monthly check', 'backups', now() + interval '1 day', 3) id;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.support_decide((select id from m1), true);
reset role;
select pg_temp.check((select access_from from public.support_requests where id = (select id from m1)) > now() + interval '23 hours', 'access starts at the scheduled time');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select pg_temp.expect($$select public.admin_start_session((select id from m1))$$, 'NO_ACCESS');
select pg_temp.expect($$select public.admin_complete_request((select id from m1), '')$$, 'INVALID_VALUE');
select public.admin_complete_request((select id from m1), 'All checks passed.');
select pg_temp.check(jsonb_array_length(public.admin_support_list()) >= 2, 'team list');
reset role;
select pg_temp.check((select status from public.support_requests where id = (select id from m1)) = 'done', 'done with report');
-- the hotel cannot use team functions
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.expect($$select public.admin_support_list()$$, 'FORBIDDEN');
select pg_temp.expect($$select public.admin_start_session((select id from r1))$$, 'FORBIDDEN');
reset role;
rollback;
select 'SUPPORT ACCESS OK';
