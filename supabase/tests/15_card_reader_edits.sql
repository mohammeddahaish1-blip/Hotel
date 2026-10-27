\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000c1', 'acc@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c1', 'accountant' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- guest read from the card reader keeps its source; bad source values are refused
set local role authenticated;
insert into public.guests(tenant_id, full_name, doc_number, consent_at, doc_source, doc_scanned_at)
  select t, 'TEST CARD', 'T0000001', now(), 'reader', now() from c;
select pg_temp.check((select doc_source from public.guests) = 'reader', 'source stored');
do $$ begin
  update public.guests set doc_source = 'fax';
  raise exception 'TEST FAILED: invalid source accepted';
exception when check_violation then null; end $$;

-- payouts: cancelled ones drop out of the owner statement and stay on record
insert into public.unit_owners(tenant_id, name, commission_bp) select t, 'Investor', 1000 from c;
insert into public.owner_payouts(tenant_id, owner_id, amount, paid_on, reference)
  select t, (select id from public.unit_owners), v, private.property_today(p), 'r' || v from c, (values (1000), (2500)) x(v);
reset role;

-- accountant may record but not cancel
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
set local role authenticated;
do $$ begin
  perform public.cancel_owner_payout((select id from public.owner_payouts where amount = 2500), 'x');
  raise exception 'TEST FAILED: accountant cancelled a payout';
exception when others then
  if sqlerrm not like 'FORBIDDEN%' then raise; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.cancel_owner_payout((select id from public.owner_payouts where amount = 2500), 'typo');
select pg_temp.check((select cancel_reason from public.owner_payouts where amount = 2500) = 'typo', 'reason kept');
select pg_temp.check((select count(*) from public.owner_payouts) = 2, 'cancelled payout kept');
create temp table st as select public.owner_statement((select id from public.unit_owners),
  private.property_today((select p from c)) - 5, private.property_today((select p from c)) + 5) j;
select pg_temp.check(((select j from st)->>'payouts')::bigint = 1000, 'statement excludes cancelled payout');
select pg_temp.check(jsonb_array_length((select j from st)->'payout_lines') = 1, 'one payout line');
select pg_temp.check(((select j from st)->'payout_lines'->0->>'id') is not null, 'payout line has id');
-- cancelling twice is refused
do $$ begin
  perform public.cancel_owner_payout((select id from public.owner_payouts where amount = 2500), null);
  raise exception 'TEST FAILED: cancelled twice';
exception when others then
  if sqlerrm not like 'NOT_FOUND%' then raise; end if;
end $$;
reset role;
select 'CARD READER EDITS OK';
rollback;
