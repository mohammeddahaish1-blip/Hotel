\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'o@t'), ('00000000-0000-0000-0000-0000000000c1', 'staff@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (public.create_tenant('T', 'P', 'O')->>'property_id')::uuid p;
insert into public.unit_types(tenant_id, property_id, name_ar) select tenant_id, id, 'x' from public.properties;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101-105, 201, 201') as created;
insert into public.invitations(tenant_id, email, role) select tenant_id, 'STAFF@t', 'reception' from public.properties;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
select set_config('request.jwt.claims', '{"email":"staff@t"}', true);
set local role authenticated;
select public.accept_invitations() as accepted;
select role from public.memberships where user_id = auth.uid();
select count(*) as units_visible from public.units;
rollback;
