\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000e1', 'cashier@t'),
  ('00000000-0000-0000-0000-0000000000e2', 'worker@t') on conflict do nothing;
create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, true) $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'Owner') x;
grant select on c to authenticated;
insert into public.shops(tenant_id, property_id, kind, category, name, daily_photos, photos_since)
  select t, p, 'service', 'minimarket', 'Market', true, current_date - 3 from c;
reset role;
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000e1', 'maintenance', '{}' from c;
insert into public.memberships(tenant_id, user_id, role, permissions) select t, '00000000-0000-0000-0000-0000000000e2', 'maintenance', '{}' from c;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
insert into public.shop_members(shop_id, tenant_id, user_id, access) select (select id from public.shops), t, '00000000-0000-0000-0000-0000000000e1', 'manager' from c;
insert into public.shop_members(shop_id, tenant_id, user_id, access) select (select id from public.shops), t, '00000000-0000-0000-0000-0000000000e2', 'seller' from c;
reset role;

-- the cashier keeps the workers and photographs invoices
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
insert into public.shop_workers(tenant_id, shop_id, full_name, salary, iqama_expiry)
  select tenant_id, id, 'Rahim', 120000, current_date + 20 from public.shops;
insert into public.shop_receipts(tenant_id, shop_id, business_date, kind, amount, photo_path, read_status)
  select tenant_id, id, current_date - 1, 'sales', 350000, 'x/y/z.jpg', 'manual' from public.shops;
select pg_temp.check((select count(*) from public.shop_workers) = 1, 'cashier sees workers');
select pg_temp.check((select count(*) from public.shop_receipts) = 1, 'cashier sees receipts');
delete from public.shop_receipts;   -- no delete policy: nothing is removed
select pg_temp.check((select count(*) from public.shop_receipts) = 1, 'receipts cannot be deleted');
reset role;

-- a worker (seller) sees neither workers' salaries nor receipts and cannot add them
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select pg_temp.check((select count(*) from public.shop_workers) = 0, 'worker cannot see salaries');
select pg_temp.check((select count(*) from public.shop_receipts) = 0, 'worker cannot see receipts');
select pg_temp.expect($$insert into public.shop_workers(tenant_id, shop_id, full_name) select tenant_id, id, 'X' from public.shops$$, 'new row violates');
reset role;

-- the owner sees everything
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set local role authenticated;
select pg_temp.check((select sum(amount) from public.shop_receipts) = 350000, 'owner sees the day income');
select pg_temp.check((select count(*) from public.shop_workers where iqama_expiry < current_date + 30) = 1, 'owner sees the expiring card');
reset role;
rollback;
select 'SHOP BOOKS OK';
