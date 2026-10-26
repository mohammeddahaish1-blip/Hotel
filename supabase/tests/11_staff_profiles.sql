\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000000000a', 'owner@t', now()), ('00000000-0000-0000-0000-0000000000b1', 'rec@t', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'rec2@t', now()) on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
insert into public.invitations(tenant_id, email, full_name, role, phone, civil_id, salary)
  select t, 'rec@t', 'Rec', 'reception', '+96890000000', '12345678', 350000 from c;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b2', 'reception' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- the invited employee signs in: details move to their staff profile
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select set_config('request.jwt.claims', '{"email":"rec@t"}', true);
set local role authenticated;
select pg_temp.check(public.accept_invitations() = 1, 'invitation accepted');
select pg_temp.check((select salary from public.staff_profiles) = 350000, 'employee sees own salary');
reset role;
-- a colleague cannot see it; the owner can
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.staff_profiles) = 0, 'colleague cannot see salaries');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select civil_id from public.staff_profiles where user_id = '00000000-0000-0000-0000-0000000000b1') = '12345678', 'owner sees civil id');
reset role;
select 'STAFF PROFILES OK';
rollback;
