\set ON_ERROR_STOP 1
-- Housekeeping may change a unit's status but nothing else; managers may edit details.
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'o@t'), ('00000000-0000-0000-0000-0000000000c2', 'hk@t');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (public.create_tenant('T', 'P', 'O')->>'property_id')::uuid p;
insert into public.unit_types(tenant_id, property_id, name_ar) select tenant_id, id, 'x' from public.properties;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
update public.units set notes = 'manager edit ok';
reset role;
insert into public.memberships(tenant_id, user_id, role) select id, '00000000-0000-0000-0000-0000000000c2', 'housekeeping' from public.tenants;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
set local role authenticated;
update public.units set status = 'dirty';
do $$ begin
  update public.units set number = '999';
  raise exception 'TEST FAILED: housekeeping renamed a unit';
exception when others then
  if sqlerrm not like 'FORBIDDEN%' then raise; end if;
end $$;
select case when (select status from public.units) = 'dirty' and (select notes from public.units) = 'manager edit ok'
  then 'UNIT GUARD OK' else 'TEST FAILED' end;
rollback;
