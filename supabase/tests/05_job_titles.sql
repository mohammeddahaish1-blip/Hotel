\set ON_ERROR_STOP 1
-- Free-text job title + owner-chosen sections travel from the invitation to the membership.
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'night@t'),
  ('00000000-0000-0000-0000-0000000000c2', 'mgr@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (public.create_tenant('T', 'P', 'O')->>'tenant_id')::uuid t;
grant select on c to authenticated;
insert into public.guests(tenant_id, full_name, consent_at) select t, 'Guest', now() from c;
insert into public.invitations(tenant_id, email, role, full_name, job_title, permissions)
  select t, 'night@t', 'reception', 'Night lead', 'مشرف الوردية الليلية', '{board,housekeeping}' from c;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c2', 'manager' from c;

create function pg_temp.check(p bool, msg text) returns void language plpgsql as $$
begin if p is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- a manager cannot pre-set sections on an invitation
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
set local role authenticated;
do $$ begin
  insert into public.invitations(tenant_id, email, role, permissions)
    select t, 'x@t', 'reception', '{settings}' from c;
  raise exception 'TEST FAILED: manager set invitation permissions';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;

-- the invited employee signs in: title and sections are copied, and enforced
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
select set_config('request.jwt.claims', '{"email":"night@t"}', true);
set local role authenticated;
select pg_temp.check(public.accept_invitations() = 1, 'invitation accepted');
select pg_temp.check((select job_title from public.memberships where user_id = auth.uid()) = 'مشرف الوردية الليلية', 'job title copied');
select pg_temp.check((select permissions from public.memberships where user_id = auth.uid()) = '{board,housekeeping}', 'sections copied');
select pg_temp.check((select count(*) from public.guests) = 0, 'reception role does not leak guests when sections exclude them');
update public.memberships set permissions = '{settings}' where user_id = auth.uid();  -- RLS: 0 rows
select pg_temp.check((select permissions from public.memberships where user_id = auth.uid()) = '{board,housekeeping}', 'employee cannot escalate');
reset role;

select 'JOB TITLES OK';
rollback;
