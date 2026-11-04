\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate) select t, p, 'x', 20000, 300000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101-102');
insert into public.guests(tenant_id, full_name, phone, consent_at) select t, 'Guest', '+96890000000', now() from c;
-- arrives tomorrow
create temp table r as select public.create_reservation((select p from c), (select id from public.units where number = '101'), (select id from public.guests),
  private.property_today((select p from c)) + 1, private.property_today((select p from c)) + 3) id;
grant select on r to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000b1', 'reception', 'Rec' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- owner sets rules (created a moment before the booking counts as "new")
set local role authenticated;
insert into public.automation_rules(tenant_id, name, trigger, offset_days, action, template_key, created_at)
  select t, 'Confirm', 'booking_confirmed', 0, 'whatsapp', 'booking_confirmed', now() - interval '1 minute' from c;
insert into public.automation_rules(tenant_id, name, trigger, offset_days, action, template_key)
  select t, 'Day before', 'before_arrival', 1, 'whatsapp', 'pre_arrival' from c;
insert into public.automation_rules(tenant_id, name, trigger, offset_days, action)
  select t, 'Tell manager', 'before_arrival', 1, 'notify' from c;
insert into public.automation_rules(tenant_id, name, trigger, offset_days, action)
  select t, 'Not yet', 'before_arrival', 0, 'notify' from c;   -- arrival is tomorrow: not due today
reset role;

-- reception: cannot write rules, can run them for the property
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
do $$ begin
  insert into public.automation_rules(tenant_id, name, trigger, action) select t, 'x', 'after_checkout', 'notify' from c;
  raise exception 'TEST FAILED: reception wrote a rule';
exception when insufficient_privilege then null; end $$;
select pg_temp.check(public.automation_tick((select p from c)) = 3, 'three actions on first run');
select pg_temp.check(public.automation_tick((select p from c)) = 0, 'rules act once');
select pg_temp.check((select count(*) from public.message_outbox where status = 'pending') = 2, 'two messages queued');
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'messages_due') = 1, 'reception sees messages due');
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'staff_notice') = 0, 'reception does not see notices');
-- sending marks it done
update public.message_outbox set status = 'sent', sent_at = now(), sent_by = auth.uid() where template_key = 'pre_arrival';
select pg_temp.check((select count(*) from public.message_outbox where status = 'pending') = 1, 'one left');
reset role;

-- owner sees the notice; the scheduled run (no user) is the only one that may run all properties
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'staff_notice') = 1, 'owner sees notice');
do $$ begin
  perform public.automation_tick();
  raise exception 'TEST FAILED: a user ran every property';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.check(public.automation_tick() = 0, 'scheduled run finds nothing new');
select 'MESSAGES AUTOMATION OK';
rollback;
