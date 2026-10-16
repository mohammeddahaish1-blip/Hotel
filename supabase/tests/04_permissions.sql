\set ON_ERROR_STOP 1
-- Owner-controlled per-employee permissions are enforced by the database.
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'),
  ('00000000-0000-0000-0000-0000000000b1', 'reception@t'),
  ('00000000-0000-0000-0000-0000000000b2', 'hk@t'),
  ('00000000-0000-0000-0000-0000000000b3', 'manager@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (public.create_tenant('T', 'P', 'O')->>'tenant_id')::uuid t;
grant select on c to authenticated;
insert into public.guests(tenant_id, full_name, consent_at) select t, 'Guest', now() from c;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'reception' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b2', 'housekeeping' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b3', 'manager' from c;

create function pg_temp.check(p bool, msg text) returns void language plpgsql as $$
begin if p is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- defaults: reception sees guests, housekeeping does not
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.guests) = 1, 'reception sees guests by default');
reset role;

-- a manager cannot change permissions
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
do $$ begin
  update public.memberships set permissions = '{board}' where user_id = '00000000-0000-0000-0000-0000000000b1';
  raise exception 'TEST FAILED: manager changed permissions';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;

-- owner revokes "guests" from reception and grants it to housekeeping
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
update public.memberships set permissions = '{board,housekeeping}' where user_id = '00000000-0000-0000-0000-0000000000b1';
update public.memberships set permissions = '{board,housekeeping,guests}' where user_id = '00000000-0000-0000-0000-0000000000b2';
do $$ begin
  update public.memberships set permissions = '{board}' where role = 'owner';
  raise exception 'TEST FAILED: owner restricted';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.guests) = 0, 'revoked: reception no longer sees guests');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.guests) = 1, 'granted: housekeeping now sees guests');
reset role;

-- back to role defaults
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
update public.memberships set permissions = null where user_id = '00000000-0000-0000-0000-0000000000b1';
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.guests) = 1, 'defaults restored');
reset role;

select 'PERMISSIONS OK';
rollback;
