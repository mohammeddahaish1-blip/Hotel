\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'rec@t'),
  ('00000000-0000-0000-0000-0000000000c1', 'acc@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated, anon;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate) select t, p, 'x', 20000, 300000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101-102');
insert into public.guests(tenant_id, full_name, consent_at) select t, 'Guest', now() from c;
create temp table r as select public.create_reservation((select p from c), (select id from public.units where number = '101'), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 20) id;
grant select on r to authenticated, anon;
create temp table f as select id from public.folios where reservation_id = (select id from r);
grant select on f to authenticated, anon;
reset role;
insert into public.memberships(tenant_id, user_id, role, full_name) select t, '00000000-0000-0000-0000-0000000000b1', 'reception', 'Rec' from c;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000c1', 'accountant' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- receipts are numbered per tenant and readable through the public token
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
insert into public.payments(tenant_id, folio_id, method, amount) select t, (select id from f), 'card', 10000 from c;
insert into public.payments(tenant_id, folio_id, method, amount) select t, (select id from f), 'card', 5000 from c;
select pg_temp.check((select array_agg(receipt_no order by receipt_no) from public.payments) = '{1,2}', 'receipts numbered 1,2');
-- reception asks to void the second payment, and can see own activity but not others'
insert into public.correction_requests(tenant_id, property_id, target, target_id, action, reason)
  select t, p, 'payment', (select id from public.payments where receipt_no = 2), 'void', 'wrong amount' from c;
select pg_temp.check((select count(*) from public.audit_log where actor = '00000000-0000-0000-0000-0000000000b1') > 0, 'reception sees own activity');
select pg_temp.check((select count(*) from public.audit_log where actor is distinct from '00000000-0000-0000-0000-0000000000b1') = 0, 'reception sees only own activity');
do $$ begin perform public.decide_correction((select id from public.correction_requests), true);
  raise exception 'TEST FAILED: reception approved'; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end $$;
reset role;
create temp table tok as select receipt_token k from public.payments where receipt_no = 1;
grant select on tok to anon;
set local role anon;
select pg_temp.check((public.receipt_public((select k from tok)))->>'guest' = 'Guest', 'public receipt');
reset role;

-- owner approves: payment voided; alert gone
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'correction_pending'), 'pending correction alert');
select public.decide_correction((select id from public.correction_requests), true, 'ok');
select pg_temp.check((select voided_at is not null from public.payments where receipt_no = 2), 'approved correction voids payment');
select pg_temp.check(not exists (select 1 from public.alerts((select p from c)) where kind = 'correction_pending'), 'alert cleared');

-- archived expenses leave the totals
insert into public.expenses(tenant_id, property_id, category, description, amount, method) select t, p, 'other', 'x', 7000, 'transfer' from c;
update public.expenses set archived_at = now();
select pg_temp.check(((public.owner_dashboard((select p from c)))->>'expenses_month')::bigint = 0, 'archived expense excluded');

-- cheques: clear books a payment, bounce reverses it
insert into public.cheques(tenant_id, property_id, reservation_id, guest_id, cheque_no, amount, due_date)
  select t, p, (select id from r), (select id from public.guests), '1001', 30000, private.property_today(p) - 1 from c;
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'cheque_due' and severity = 1), 'overdue cheque alert');
select public.set_cheque_status((select id from public.cheques), 'deposited');
select public.set_cheque_status((select id from public.cheques), 'cleared');
select pg_temp.check((select count(*) from public.payments where reference = 'شيك 1001' and voided_at is null) = 1, 'cleared cheque booked');
select public.set_cheque_status((select id from public.cheques), 'bounced', 'insufficient funds');
select pg_temp.check((select voided_at is not null from public.payments where reference = 'شيك 1001'), 'bounce reverses payment');
select pg_temp.check(exists (select 1 from public.alerts((select p from c)) where kind = 'cheque_bounced'), 'bounced alert');

-- owner statement
insert into public.unit_owners(tenant_id, name, commission_bp) select t, 'Investor', 1000 from c;
update public.units set owner_id = (select id from public.unit_owners) where number = '101';
insert into public.expenses(tenant_id, property_id, category, description, amount, method, unit_id)
  select t, p, 'maintenance', 'AC', 5000, 'transfer', (select id from public.units where number = '101') from c;
insert into public.owner_payouts(tenant_id, owner_id, amount, paid_on) select t, (select id from public.unit_owners), 1000, private.property_today(p) from c;
create temp table st as select public.owner_statement((select id from public.unit_owners), private.property_today((select p from c)) - 5, private.property_today((select p from c)) + 30) j;
select pg_temp.check((select (j->>'revenue')::bigint from st) > 0, 'statement revenue');
select pg_temp.check((select (j->>'closing')::bigint = (j->>'revenue')::bigint - (j->>'commission')::bigint - 5000 - 1000 from st), 'statement closing');
-- ID access log
insert into public.guest_documents(tenant_id, guest_id, storage_path) select t, (select id from public.guests), 'x/y.jpg' from c;
insert into public.document_access_log(tenant_id, guest_document_id, guest_id) select t, (select id from public.guest_documents), (select id from public.guests) from c;
select pg_temp.check((select count(*) from public.document_access_log) = 1, 'owner reads access log');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.document_access_log) = 0, 'reception cannot read access log');
select pg_temp.check((select count(*) from public.unit_owners) = 0, 'reception cannot see owners');
reset role;
select 'SIJL IDEAS OK';
rollback;
