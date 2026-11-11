\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000e1', 'seller@t'),
  ('00000000-0000-0000-0000-0000000000e2', 'renter@t'), ('00000000-0000-0000-0000-0000000000e3', 'other@t') on conflict do nothing;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

-- owner: a hotel with one guest in house, a laundry and a rented shop
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
insert into public.guests(tenant_id, full_name, consent_at, doc_type, doc_number, nationality) select t, 'Guest', now(), 'passport', 'P1', 'OMN' from c;
create temp table r as select public.create_reservation((select p from c), (select id from public.units), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 2) id;
grant select on r to authenticated;
select public.check_in((select id from r));
insert into public.shops(tenant_id, property_id, kind, category, name) select t, p, 'service', 'laundry', 'Laundry' from c;
insert into public.shops(tenant_id, property_id, kind, category, name, renter_name, monthly_rent, contract_start, contract_end)
  select t, p, 'rental', 'office', 'Shop 1', 'ACME', 150000, current_date - 45, current_date + 320 from c;
insert into public.shop_items(tenant_id, shop_id, name, price)
  select t, (select id from public.shops where name = 'Laundry'), n, pr from c, (values ('Shirt', 500), ('Thobe', 800)) v(n, pr);
reset role;

-- staff: a seller of the laundry, the renter of the shop, and someone with no shop
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000e1', 'maintenance', '{}' from c;
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000e2', 'maintenance', '{}' from c;
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000e3', 'maintenance', '{}' from c;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into public.shop_members(shop_id, tenant_id, user_id, access)
  select (select id from public.shops where name = 'Laundry'), t, '00000000-0000-0000-0000-0000000000e1', 'seller' from c;
insert into public.shop_members(shop_id, tenant_id, user_id, access)
  select (select id from public.shops where name = 'Shop 1'), t, '00000000-0000-0000-0000-0000000000e2', 'renter' from c;
select pg_temp.expect($$insert into public.shop_members(shop_id, tenant_id, user_id, access)
  select (select id from public.shops where name = 'Shop 1'), t, '00000000-0000-0000-0000-0000000000e3', 'seller' from c$$, 'INVALID_VALUE');
insert into public.shop_rent_payments(tenant_id, shop_id, amount, period) select t, (select id from public.shops where name = 'Shop 1'), 150000, 'month 1' from c;
reset role;

-- the seller sees only the laundry; sells for cash and to the room
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 1, 'seller sees one shop');
select pg_temp.check((select count(*) from public.reservations) = 0, 'seller cannot read reservations');
select pg_temp.check((select count(*) from public.shop_in_house((select id from public.shops))) = 1, 'in-house list for the seller');
create temp table s1 as select public.record_shop_sale((select id from public.shops),
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.shop_items where name = 'Shirt'), 'qty', 3)), 'cash') id;
create temp table s2 as select public.record_shop_sale((select id from public.shops),
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.shop_items where name = 'Thobe'), 'qty', 2)), 'room',
  (select reservation_id from public.shop_in_house((select id from public.shops)))) id;
select pg_temp.check((select total from public.shop_sales where id = (select id from s1)) = 1500, 'cash total from item prices');
select pg_temp.expect($$select public.record_shop_sale((select id from public.shops), '[]', 'cash')$$, 'NO_ITEMS');
select pg_temp.expect($$select public.void_shop_sale((select id from s1), 'mistake')$$, 'FORBIDDEN');
select pg_temp.expect($$insert into public.shop_items(tenant_id, shop_id, name, price) select tenant_id, id, 'Free', 0 from public.shops$$, 'new row violates');
select pg_temp.check((select count(*) from public.shop_rent_payments) = 0, 'seller cannot see rent');
reset role;
select pg_temp.check((select amount from public.charges where id = (select charge_id from public.shop_sales where id = (select id from s2))) = 1600, 'charged to the room');

-- the renter sees their shop and its rent, not the laundry or sales
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select pg_temp.check((select name from public.shops) = 'Shop 1', 'renter sees their shop');
select pg_temp.check((select count(*) from public.shop_sales) = 0, 'renter sees no sales');
select pg_temp.check((select count(*) from public.shop_rent_payments) = 1, 'renter sees payments');
select pg_temp.check((public.shop_rent_status((select id from public.shops)) ->> 'months')::int = 2, '2 months due');
select pg_temp.check((public.shop_rent_status((select id from public.shops)) ->> 'balance')::bigint = 150000, 'one month owed');
select pg_temp.expect($$insert into public.shop_rent_payments(tenant_id, shop_id, amount) select tenant_id, id, 1000 from public.shops$$, 'new row violates');
reset role;

-- someone with the section but no shop sees nothing
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 0, 'no shop, nothing visible');
reset role;

-- the owner voids the room sale: the room charge is voided too; switching the seller off ends shop access
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select public.void_shop_sale((select id from s2), 'wrong room');
update public.memberships set active = false where user_id = '00000000-0000-0000-0000-0000000000e1';
reset role;
select pg_temp.check((select voided_at from public.charges where id = (select charge_id from public.shop_sales where id = (select id from s2))) is not null, 'room charge voided');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select pg_temp.check((select count(*) from public.shops) = 0, 'inactive staff, no shop');
reset role;
rollback;
select 'SHOPS OK';
