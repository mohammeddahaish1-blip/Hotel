-- Core flow tests. Run against a database with the migrations applied:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/01_core_flows.sql
-- Every assertion raises on failure; the transaction is rolled back at the end.
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'TEST FAILED: expected error % but statement succeeded: %', p_code, p_sql;
  elsif v_err not like '%' || p_code || '%' then
    raise exception 'TEST FAILED: expected %, got: %', p_code, v_err;
  end if;
end $$;

create or replace function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if p is not true then raise exception 'TEST FAILED: %', p_msg; end if;
end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner-a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'owner-b@test'),
  ('00000000-0000-0000-0000-0000000000a1', 'reception-a@test'),
  ('00000000-0000-0000-0000-0000000000a2', 'hk-a@test');

create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;

-- ---------- Onboarding ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into ctx select 'tenant_a', (r->>'tenant_id')::uuid from (select public.create_tenant('فندق أ', 'فندق الشاطئ', 'مالك أ') r) x;
insert into ctx select 'prop_a', id from public.properties limit 1;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ctx select 'tenant_b', (r->>'tenant_id')::uuid from (select public.create_tenant('فندق ب', 'شقق ب', 'مالك ب', 'apartments') r) x;
reset role;

-- staff of tenant A
insert into public.memberships(tenant_id, user_id, role, full_name)
select v, '00000000-0000-0000-0000-0000000000a1', 'reception', 'موظف استقبال' from ctx where k = 'tenant_a';
insert into public.memberships(tenant_id, user_id, role, full_name)
select v, '00000000-0000-0000-0000-0000000000a2', 'housekeeping', 'عاملة نظافة' from ctx where k = 'tenant_a';

-- ---------- Units & rates (owner A) ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
with x as (
  insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate)
  select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'prop_a'), 'غرفة قياسية', 25000, 450000
  returning id)
insert into ctx select 'type_std', id from x;
insert into public.units(tenant_id, property_id, unit_type_id, number)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'type_std'), n
  from unnest(array['101', '102', '103']) n;
insert into ctx select 'u101', id from public.units where number = '101';
insert into ctx select 'u102', id from public.units where number = '102';
insert into ctx select 'u103', id from public.units where number = '103';

-- Seasonal rate (Khareef) overrides the base nightly rate
insert into public.rate_plans(tenant_id, unit_type_id, name, period, nightly_rate, priority)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'type_std'), 'خريف',
       daterange('2027-07-01', '2027-09-01'), 40000, 10;
select pg_temp.ok(public.quote_stay((select v from ctx where k = 'type_std'), '2027-06-30', '2027-07-02') = 65000,
                  'seasonal pricing: 25 + 40 OMR');

-- FR-21: no consent, no profile
select pg_temp.expect_error($$insert into public.guests(tenant_id, full_name) values ((select v from ctx where k = 'tenant_a'), 'x')$$, 'consent_at');

with x as (
  insert into public.guests(tenant_id, full_name, phone, consent_at)
  values ((select v from ctx where k = 'tenant_a'), 'Ahmed Al Balushi', '+96899000000', now()) returning id)
insert into ctx select 'guest1', id from x;

select pg_temp.ok((select count(*) from public.available_units(
  (select v from ctx where k = 'prop_a'), private.property_today((select v from ctx where k = 'prop_a')),
  private.property_today((select v from ctx where k = 'prop_a')) + 3)) = 3, 'three units available');

-- ---------- Reservation & conflict (FR-05) ----------
insert into ctx select 'res1', public.create_reservation(
  (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u101'), (select v from ctx where k = 'guest1'),
  private.property_today((select v from ctx where k = 'prop_a')),
  private.property_today((select v from ctx where k = 'prop_a')) + 3, 'whatsapp');

select pg_temp.ok((select room_total from public.reservations where id = (select v from ctx where k = 'res1')) = 75000, 'room total 3 x 25');
select pg_temp.expect_error($$select public.create_reservation(
  (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u101'), (select v from ctx where k = 'guest1'),
  private.property_today((select v from ctx where k = 'prop_a')) + 2,
  private.property_today((select v from ctx where k = 'prop_a')) + 5)$$, 'CONFLICT');
select pg_temp.ok((select count(*) from public.available_units(
  (select v from ctx where k = 'prop_a'), private.property_today((select v from ctx where k = 'prop_a')),
  private.property_today((select v from ctx where k = 'prop_a')) + 3)) = 2, 'booked unit hidden from availability');
reset role;

-- ---------- Tenant isolation (NFR-01) ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from public.units) = 0, 'tenant B sees no units of A');
select pg_temp.ok((select count(*) from public.reservations) = 0, 'tenant B sees no reservations of A');
select pg_temp.ok((select count(*) from public.guests) = 0, 'tenant B sees no guests of A');
select pg_temp.ok((select count(*) from public.properties) = 1, 'tenant B sees only its property');
select pg_temp.expect_error($$select public.check_in((select v from ctx where k = 'res1'))$$, 'FORBIDDEN');
select pg_temp.expect_error($$select public.create_reservation(
  (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u102'), (select v from ctx where k = 'guest1'),
  current_date, current_date + 1)$$, 'FORBIDDEN');
update public.units set status = 'out_of_service';  -- silently affects 0 rows of A
reset role;
select pg_temp.ok((select count(*) from public.units where status = 'out_of_service') = 0, 'tenant B cannot update A');

-- ---------- Reception discount limit (FR-12) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$select public.create_reservation(
  (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u102'), (select v from ctx where k = 'guest1'),
  private.property_today((select v from ctx where k = 'prop_a')),
  private.property_today((select v from ctx where k = 'prop_a')) + 2, 'phone', 'nightly', 1, 0, 20000)$$,
  'DISCOUNT_NEEDS_MANAGER');

-- ---------- Check-in (FR-23) ----------
select pg_temp.expect_error($$select public.check_in((select v from ctx where k = 'res1'))$$, 'GUEST_DATA_INCOMPLETE');
update public.guests set doc_type = 'oman_id', doc_number = '12345678', nationality = 'OMN'
 where id = (select v from ctx where k = 'guest1');
update public.units set status = 'dirty' where id = (select v from ctx where k = 'u101');
select pg_temp.expect_error($$select public.check_in((select v from ctx where k = 'res1'))$$, 'UNIT_NOT_READY');
update public.units set status = 'available' where id = (select v from ctx where k = 'u101');
select public.check_in((select v from ctx where k = 'res1'));
select pg_temp.ok((select status from public.units where id = (select v from ctx where k = 'u101')) = 'occupied', 'unit occupied');

-- ---------- Folio, taxes, payments (FR-31, FR-32) ----------
insert into ctx select 'folio1', id from public.folios where reservation_id = (select v from ctx where k = 'res1');
-- 75.000 + 4% tourism + 5% municipality + 5% VAT = 85.500
select pg_temp.ok((public.folio_summary((select v from ctx where k = 'folio1'))->>'total')::bigint = 85500, 'taxes 14% on base');
insert into public.payments(tenant_id, folio_id, method, amount)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'folio1'), 'card', 50000;
insert into public.payments(tenant_id, folio_id, kind, method, amount)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'folio1'), 'deposit', 'cash', 20000;
select pg_temp.ok((public.folio_summary((select v from ctx where k = 'folio1'))->>'balance')::bigint = 35500, 'balance after payment');
select pg_temp.ok((public.folio_summary((select v from ctx where k = 'folio1'))->>'deposit_held')::bigint = 20000, 'deposit is a liability, not payment');

-- ---------- Invoice (FR-30) ----------
insert into ctx select 'inv1', public.issue_invoice((select v from ctx where k = 'folio1'));
select pg_temp.ok((select number from public.invoices where id = (select v from ctx where k = 'inv1')) = 1, 'first invoice number = 1');
select pg_temp.ok((select total from public.invoices where id = (select v from ctx where k = 'inv1')) = 85500, 'invoice total');
select pg_temp.expect_error($$select public.issue_invoice((select v from ctx where k = 'folio1'))$$, 'NOTHING_TO_INVOICE');
reset role;
select pg_temp.expect_error($$update public.invoices set total = 1 where id = (select v from ctx where k = 'inv1')$$, 'IMMUTABLE');
select pg_temp.expect_error($$update public.charges set amount = 1 where invoice_id = (select v from ctx where k = 'inv1')$$, 'CHARGE_LOCKED');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
-- reception cannot issue credit notes
select pg_temp.expect_error($$select public.issue_credit_note((select v from ctx where k = 'inv1'), 10000, 'x')$$, 'FORBIDDEN');

-- extend the stay by one night after invoicing: only the delta is posted
select public.change_reservation((select v from ctx where k = 'res1'), (select v from ctx where k = 'u101'),
  private.property_today((select v from ctx where k = 'prop_a')), private.property_today((select v from ctx where k = 'prop_a')) + 4);
select pg_temp.ok((public.folio_summary((select v from ctx where k = 'folio1'))->>'uninvoiced_subtotal')::bigint = 25000, 'extension posts one more night');

-- ---------- Check-out (FR-24) ----------
select pg_temp.expect_error($$select public.check_out((select v from ctx where k = 'res1'))$$, 'BALANCE_DUE');
insert into public.payments(tenant_id, folio_id, kind, method, amount)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'folio1'), 'deposit_applied', 'cash', 20000;
insert into public.payments(tenant_id, folio_id, method, amount)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'folio1'), 'cash', 44000;
select pg_temp.ok((public.folio_summary((select v from ctx where k = 'folio1'))->>'balance')::bigint = 0, 'settled');
select public.check_out((select v from ctx where k = 'res1'));
select pg_temp.ok((select status from public.units where id = (select v from ctx where k = 'u101')) = 'dirty', 'unit dirty after checkout');
reset role;

-- ---------- Housekeeping (FR-40) & role limits (FR-53) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select pg_temp.ok((select count(*) from public.guests) = 0, 'housekeeping cannot read guest PII');
select pg_temp.ok((select count(*) from public.payments) = 0, 'housekeeping cannot read payments');
select public.set_hk_task_status((select id from public.hk_tasks where unit_id = (select v from ctx where k = 'u101') and status = 'pending'), 'done');
select pg_temp.ok((select status from public.units where id = (select v from ctx where k = 'u101')) = 'available', 'clean => available');
select pg_temp.ok((select count(*) from public.unit_board((select v from ctx where k = 'prop_a'))) = 3, 'hk sees unit board');
reset role;

-- ---------- Maintenance blocks availability (FR-43) ----------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.maintenance_tickets(tenant_id, property_id, unit_id, title, blocks_availability)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u103'), 'تسرب مياه', true;
select pg_temp.ok((select status from public.units where id = (select v from ctx where k = 'u103')) = 'maintenance', 'blocking ticket => maintenance');
select pg_temp.ok(not exists (select 1 from public.available_units((select v from ctx where k = 'prop_a'), '2030-01-01', '2030-01-02')
                               where unit_id = (select v from ctx where k = 'u103')), 'blocked unit not sellable');
update public.maintenance_tickets set status = 'closed' where unit_id = (select v from ctx where k = 'u103');
select pg_temp.ok((select status from public.units where id = (select v from ctx where k = 'u103')) = 'dirty', 'closed ticket => needs cleaning');

-- ---------- Credit note (owner) ----------
insert into ctx select 'cn1', public.issue_credit_note((select v from ctx where k = 'inv1'), 25000, 'تعويض');
select pg_temp.ok((select total from public.credit_notes where id = (select v from ctx where k = 'cn1')) = 28500, 'credit note with taxes');
select pg_temp.expect_error($$select public.issue_credit_note((select v from ctx where k = 'inv1'), 60000, 'x')$$, 'INVALID_AMOUNT');

-- ---------- Long-stay contract (FR-13) ----------
with x as (
  insert into public.guests(tenant_id, full_name, consent_at, doc_type, doc_number, nationality)
  values ((select v from ctx where k = 'tenant_a'), 'Ravi Kumar', now(), 'passport', 'P1234567', 'IND') returning id)
insert into ctx select 'guest2', id from x;
insert into ctx select 'res2', public.create_reservation(
  (select v from ctx where k = 'prop_a'), (select v from ctx where k = 'u102'), (select v from ctx where k = 'guest2'),
  private.property_today((select v from ctx where k = 'prop_a')),
  (private.property_today((select v from ctx where k = 'prop_a')) + interval '3 months' + interval '10 days')::date,
  'direct', 'contract', 1, 0, 0, null, 'confirmed', 400000, 200000);
select pg_temp.ok((select count(*) from public.billing_schedules bs join public.contracts c on c.id = bs.contract_id
                    where c.reservation_id = (select v from ctx where k = 'res2')) = 4, '3 full months + 1 partial');
select pg_temp.ok((select count(*) from public.billing_schedules bs join public.contracts c on c.id = bs.contract_id
                    where c.reservation_id = (select v from ctx where k = 'res2') and bs.status = 'posted') = 1, 'first month posted');
select pg_temp.ok((public.folio_summary((select id from public.folios where reservation_id = (select v from ctx where k = 'res2')))->>'uninvoiced_subtotal')::bigint = 400000, 'rent charge');

-- move contract to another unit is blocked by the nightly booking? (u101 free now) — move ok
select public.change_reservation((select v from ctx where k = 'res2'), (select v from ctx where k = 'u101'),
  private.property_today((select v from ctx where k = 'prop_a')),
  (private.property_today((select v from ctx where k = 'prop_a')) + interval '2 months')::date);
select pg_temp.ok((select count(*) from public.billing_schedules bs join public.contracts c on c.id = bs.contract_id
                    where c.reservation_id = (select v from ctx where k = 'res2') and bs.status <> 'cancelled') = 2, 'shortened schedule');

-- ---------- Cash shift (FR-34) ----------
insert into public.cash_shifts(tenant_id, property_id, opening_float)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'prop_a'), 10000;
insert into public.payments(tenant_id, folio_id, method, amount)
select (select v from ctx where k = 'tenant_a'), (select id from public.folios where reservation_id = (select v from ctx where k = 'res2')), 'cash', 100000;
insert into public.expenses(tenant_id, property_id, category, description, amount)
select (select v from ctx where k = 'tenant_a'), (select v from ctx where k = 'prop_a'), 'supplies', 'منظفات', 5000;
select pg_temp.ok((public.close_shift((select id from public.cash_shifts where closed_at is null), 104000)->>'difference')::bigint = -1000,
                  'shift difference: 10 + 100 - 5 = 105 expected, 104 counted');

-- ---------- Reports run ----------
select pg_temp.ok((public.owner_dashboard((select v from ctx where k = 'prop_a'))->>'units')::int = 3, 'dashboard units');
select pg_temp.ok((select count(*) from public.occupancy_report((select v from ctx where k = 'prop_a'),
  private.property_today((select v from ctx where k = 'prop_a')), private.property_today((select v from ctx where k = 'prop_a')) + 7)) = 7, 'occupancy rows');
select pg_temp.ok((select count(*) from public.police_register((select v from ctx where k = 'prop_a'), current_date - 1, current_date + 1)) = 1, 'police register row');
select pg_temp.ok(public.ministry_statistics((select v from ctx where k = 'prop_a'), current_date - 1, current_date + 1) ? 'by_nationality', 'ministry stats');
select pg_temp.ok((select net from public.tax_liability((select v from ctx where k = 'prop_a'), current_date - 1, current_date + 1) where code = 'tourism') = 2000, 'tourism levy net: 3000 - 1000');
select count(*) from public.aging_report((select v from ctx where k = 'prop_a'));

-- ---------- Audit log (FR-54) ----------
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'reservations') > 0, 'reservations audited');
select pg_temp.ok((select count(*) from public.audit_log where table_name = 'payments') >= 4, 'payments audited');
select pg_temp.expect_error($$insert into public.audit_log(tenant_id, table_name, action) values ((select v from ctx where k = 'tenant_a'), 'x', 'x')$$, 'permission denied');
reset role;
select pg_temp.expect_error($$delete from public.audit_log$$, 'IMMUTABLE');

-- ---------- Concurrency guard is in the schema itself ----------
select pg_temp.ok(exists (select 1 from pg_constraint where conname = 'reservations_no_overlap' and contype = 'x'), 'exclusion constraint present');

select 'ALL TESTS PASSED' as result;
rollback;
