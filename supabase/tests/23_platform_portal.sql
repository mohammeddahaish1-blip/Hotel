\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-00000000000c', 'admin@t'),
  ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
insert into public.platform_admins(user_id) values ('00000000-0000-0000-0000-00000000000c');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('Hotel Co', 'P', 'Owner') x;
grant select on c to authenticated;
reset role;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create function pg_temp.expect(sql text, code text) returns void language plpgsql as $$
begin execute sql; raise exception 'TEST FAILED: expected %', code;
exception when others then if sqlerrm not like code || '%' then raise exception 'TEST FAILED: expected %, got %', code, sqlerrm; end if; end $$;

-- a new company starts with a free month on the full plan
select pg_temp.check((select status from public.subscriptions where tenant_id = (select t from c)) = 'trial', 'trial on signup');
select pg_temp.check((select trial_ends_at from public.subscriptions where tenant_id = (select t from c)) = current_date + 30, 'trial 30 days');

-- the hotel owner sees their own plan, but is not a platform admin and cannot use admin functions
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((public.my_subscription((select t from c)) ->> 'plan_code') = 'enterprise', 'owner sees plan');
select pg_temp.check((public.my_subscription((select t from c)) ->> 'is_admin')::boolean = false, 'owner is not admin');
select pg_temp.expect($$select public.admin_overview()$$, 'FORBIDDEN');
select pg_temp.expect($$select public.admin_set_subscription((select t from c), 'basic', 'active')$$, 'FORBIDDEN');
update public.subscriptions set status = 'active';   -- RLS: no effect for the hotel
reset role;
select pg_temp.check((select status from public.subscriptions where tenant_id = (select t from c)) = 'trial', 'owner cannot change own subscription');

-- the platform admin sees every company and changes plans
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select pg_temp.check(jsonb_array_length(public.admin_overview()) >= 1, 'overview lists companies');
select pg_temp.check((select (x->>'owner_email') from jsonb_array_elements(public.admin_overview()) x where (x->>'id')::uuid = (select t from c)) = 'owner@t', 'owner email shown');
select public.admin_set_subscription((select t from c), 'basic', 'active', current_date + 5);
create temp table pay as select public.admin_record_payment((select t from c), 15000, 2, 'transfer', 'TRX-1') id;
reset role;
select pg_temp.check((select current_period_end from public.subscriptions where tenant_id = (select t from c)) = (current_date + 5 + interval '2 months')::date, 'payment extends paid-until');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
select public.admin_void_payment((select id from pay));
reset role;
select pg_temp.check((select current_period_end from public.subscriptions where tenant_id = (select t from c)) = current_date + 5, 'void takes the months back');

-- plan limits: basic = 1 property, 20 units
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate) select t, p, 'x', 20000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '1-20');
select pg_temp.expect($$select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '21')$$, 'PLAN_LIMIT');
select pg_temp.expect($$insert into public.properties(tenant_id, name_ar) select t, 'Second' from c$$, 'PLAN_LIMIT');
select pg_temp.check((public.my_subscription((select t from c)) -> 'features') = '[]'::jsonb, 'basic has no extra features');
reset role;
rollback;
select 'PLATFORM PORTAL OK';
