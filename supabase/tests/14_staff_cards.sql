\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email, email_confirmed_at) values ('00000000-0000-0000-0000-00000000000a', 'owner@t', now()), ('00000000-0000-0000-0000-0000000000b1', 'rec@t', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'rec2@t', now()) on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
insert into public.invitations(tenant_id, email, full_name, role, phone, salary, work_card_no, work_card_expiry)
  select t, 'rec@t', 'Rec', 'reception', '+96890000000', 350000, 'WC-1', current_date + 10 from c;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000b2', 'reception', 'Rec2' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- invited employee signs in: the work card moves to their profile; they see their own profile with email
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select set_config('request.jwt.claims', '{"email":"rec@t"}', true);
set local role authenticated;
select pg_temp.check(public.accept_invitations() = 1, 'invitation accepted');
select pg_temp.check((select work_card_no from public.staff_profile((select t from c), '00000000-0000-0000-0000-0000000000b1')) = 'WC-1', 'own profile has card');
select pg_temp.check((select email from public.staff_profile((select t from c), '00000000-0000-0000-0000-0000000000b1')) = 'rec@t', 'own profile has email');
select pg_temp.check((select salary from public.staff_profile((select t from c), '00000000-0000-0000-0000-0000000000b1')) = 350000, 'own profile has salary');
-- a colleague's profile is hidden, and reception gets no card alert
select pg_temp.check((select count(*) from public.staff_profile((select t from c), '00000000-0000-0000-0000-0000000000b2')) = 0, 'colleague profile hidden');
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'work_card_expiring') = 0, 'reception gets no card alert');
reset role;

-- owner: sees the profile and the expiry alert (severity 2 while not yet expired)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select full_name from public.staff_profile((select t from c), '00000000-0000-0000-0000-0000000000b1')) = 'Rec', 'owner sees profile');
select pg_temp.check((select severity from public.alerts((select p from c)) where kind = 'work_card_expiring') = 2, 'owner gets card alert');
-- card far in the future: no alert; expired: urgent
update public.staff_profiles set work_card_expiry = current_date + 90;
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'work_card_expiring') = 0, 'no alert for distant expiry');
update public.staff_profiles set work_card_expiry = current_date - 3;
select pg_temp.check((select severity from public.alerts((select p from c)) where kind = 'work_card_expiring') = 1, 'expired card is urgent');
-- inactive staff are ignored
reset role;
update public.memberships set active = false where user_id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'work_card_expiring') = 0, 'inactive staff ignored');
reset role;
select 'STAFF CARDS OK';
rollback;
