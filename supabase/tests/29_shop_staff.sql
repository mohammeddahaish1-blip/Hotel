\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t', now()), ('00000000-0000-0000-0000-0000000000c1', 'hotel@t', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'cashier@t', now()), ('00000000-0000-0000-0000-0000000000c3', 'renter@t', now()),
  ('00000000-0000-0000-0000-0000000000c4', 'mgr@t', now())
on conflict do nothing;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text, email text default '') returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('request.jwt.claims', json_build_object('sub', u, 'email', email)::text, true) $$;

-- owner: a hotel with a unit, a maintenance ticket, a laundry and a rented shop
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
insert into public.maintenance_tickets(tenant_id, property_id, unit_id, title, priority) select t, p, (select id from public.units), 'AC broken', 1 from c;
create temp table u as select id from public.units;
grant select on u to authenticated;
insert into public.shops(tenant_id, property_id, kind, category, name) select t, p, 'service', 'laundry', 'Laundry' from c;
insert into public.shops(tenant_id, property_id, kind, category, name, renter_name, monthly_rent) select t, p, 'rental', 'office', 'Shop 1', 'ACME', 100000 from c;
-- a hotel employee, and invitations for shop staff
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000c1', 'reception', 'Sara' from c;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000c4', 'manager', 'Mgr' from c;
insert into public.invitations(tenant_id, email, role, full_name, permissions, staff_kind, shop_id, shop_access)
  select t, 'cashier@t', 'reception', 'Fatima', '{}', 'shop', (select id from public.shops where name = 'Laundry'), 'seller' from c;
-- a renter's invitation must point at a rental shop with renter access
select pg_temp.expect($$insert into public.invitations(tenant_id, email, role, full_name, permissions, staff_kind, shop_id, shop_access)
  select t, 'renter@t', 'reception', 'R', '{}', 'shop', (select id from public.shops where name = 'Laundry'), 'renter' from c$$, 'INVALID_VALUE');
-- shop staff never carry hotel sections
select pg_temp.expect($$insert into public.invitations(tenant_id, email, role, full_name, permissions, staff_kind)
  select t, 'x@t', 'reception', 'X', '{guests}', 'shop' from c$$, 'new row for relation');
-- a hotel employee cannot be put in a shop
select pg_temp.expect($$insert into public.shop_members(shop_id, tenant_id, user_id, access)
  select (select id from public.shops where name = 'Laundry'), t, '00000000-0000-0000-0000-0000000000c1', 'seller' from c$$, 'INVALID_VALUE');
reset role;

-- a manager (not the owner) may invite shop staff
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
set local role authenticated;
insert into public.invitations(tenant_id, email, role, full_name, permissions, staff_kind, shop_id, shop_access)
  select t, 'renter@t', 'reception', 'Rashid', '{}', 'shop', (select id from public.shops where name = 'Shop 1'), 'renter' from c;
reset role;

-- the cashier joins: shop staff, in the laundry
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2', 'cashier@t');
set local role authenticated;
select pg_temp.check(public.accept_invitations() = 1, 'cashier joined');
select pg_temp.check((select staff_kind from public.memberships where user_id = auth.uid()) = 'shop', 'shop staff kind');
select pg_temp.check((select access from public.shop_members where user_id = auth.uid()) = 'seller', 'placed in the laundry');
select pg_temp.check((select name from public.shops) = 'Laundry', 'sees only the laundry');
-- no hotel data
select pg_temp.check((select count(*) from public.units) = 0, 'no units');
select pg_temp.check((select count(*) from public.unit_types) = 0, 'no unit types');
select pg_temp.check((select count(*) from public.maintenance_tickets) = 0, 'no maintenance tickets');
select pg_temp.check((select count(*) from public.alerts((select p from c))) = 0, 'no hotel alerts');
select pg_temp.expect($$insert into public.maintenance_tickets(tenant_id, property_id, unit_id, title) select t, p, (select id from u), 'x' from c$$, 'new row violates');
-- colleagues: themselves and the owner / manager, not hotel staff
select pg_temp.check((select count(*) from public.memberships where full_name = 'Sara') = 0, 'cannot see hotel staff');
select pg_temp.check((select count(*) from public.memberships where role in ('owner', 'manager')) = 2, 'sees owner and manager');
select pg_temp.check(public.can_file_staff_complaint((select t from c)), 'can still file a complaint');
reset role;

-- the renter joins into the rented shop
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3', 'renter@t');
set local role authenticated;
select pg_temp.check(public.accept_invitations() = 1, 'renter joined');
select pg_temp.check((select name from public.shops) = 'Shop 1', 'renter sees their shop');
reset role;

-- hotel staff still read hotel data; shop staff kind cannot be changed or given sections
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp.check((select count(*) from public.units) = 1, 'hotel staff see units');
select pg_temp.check((select count(*) from public.memberships) = 5, 'hotel staff see everyone');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect($$update public.memberships set permissions = '{guests}' where user_id = '00000000-0000-0000-0000-0000000000c2'$$, 'INVALID_VALUE');
select pg_temp.expect($$update public.memberships set staff_kind = 'hotel' where user_id = '00000000-0000-0000-0000-0000000000c2'$$, 'FORBIDDEN');

select 'SHOP STAFF OK';
rollback;
