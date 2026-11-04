\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t'), ('00000000-0000-0000-0000-0000000000b1', 'hk@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated, anon;
update public.properties set bank_name = 'Bank Muscat', bank_iban = 'OM00TEST' where id = (select p from c);
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate) select t, p, 'x', 20000, 300000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101');
insert into public.guests(tenant_id, full_name, phone, consent_at) select t, 'Salim Test', '+96890000000', now() from c;
create temp table r as select public.create_reservation((select p from c), (select id from public.units), (select id from public.guests),
  private.property_today((select p from c)), private.property_today((select p from c)) + 2) id;
grant select on r to authenticated, anon;
create temp table f as select id from public.folios where reservation_id = (select id from r);
grant select on f to authenticated, anon;
insert into public.charges(tenant_id, folio_id, kind, description, amount, taxable) select t, (select id from f), 'service', 'x', 15000, false from c;
reset role;
insert into public.memberships(tenant_id, user_id, role) select t, '00000000-0000-0000-0000-0000000000b1', 'housekeeping' from c;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;

-- owner creates a link for the balance
set local role authenticated;
create temp table lk as select public.create_payment_link((select id from r)) token;
grant select on lk to authenticated, anon;
select pg_temp.check((select amount from public.payment_links) = (public.folio_summary((select id from f)) ->> 'balance')::bigint, 'amount = balance');
reset role;

-- housekeeping may not create links
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
set local role authenticated;
do $$ begin
  perform public.create_payment_link((select id from r), 1000);
  raise exception 'TEST FAILED: housekeeping created a link';
exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end $$;
reset role;

-- the guest (anonymous) sees the page and submits a proof
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select pg_temp.check((public.payment_link_public((select token from lk)) ->> 'bank_iban') = 'OM00TEST', 'public page shows bank');
select pg_temp.check((public.payment_link_public((select token from lk)) ->> 'guest') = 'Salim', 'first name only');
select pg_temp.check(public.payment_link_public(gen_random_uuid()) is null, 'unknown token');
do $$ begin
  perform public.submit_payment_link_proof((select token from lk), 'other/receipt.jpg', null);
  raise exception 'TEST FAILED: proof outside the link folder';
exception when others then if sqlerrm not like 'INVALID%' then raise; end if; end $$;
select public.submit_payment_link_proof((select token from lk), (select token from lk)::text || '/receipt.jpg', 'paid from Bank Dhofar');
select pg_temp.check((public.payment_link_public((select token from lk)) ->> 'status') = 'proof_submitted', 'proof recorded');
select pg_temp.check((select count(*) from public.payment_links) = 0, 'anon cannot list links');
reset role;

-- owner sees the alert and confirms: payment booked, balance cleared
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'payment_proof') = 1, 'proof alert');
select public.confirm_payment_link((select id from public.payment_links), 'transfer');
select pg_temp.check((select status from public.payment_links) = 'paid', 'link paid');
select pg_temp.check((public.folio_summary((select id from f)) ->> 'balance')::bigint = 0, 'balance cleared');
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'payment_proof') = 0, 'alert gone');
do $$ begin
  perform public.confirm_payment_link((select id from public.payment_links));
  raise exception 'TEST FAILED: confirmed twice';
exception when others then if sqlerrm not like 'INVALID_STATUS%' then raise; end if; end $$;
-- nothing due now: no new link
do $$ begin
  perform public.create_payment_link((select id from r));
  raise exception 'TEST FAILED: link with nothing due';
exception when others then if sqlerrm not like 'NOTHING_DUE%' then raise; end if; end $$;
-- browsers can never call the gateway entry point
do $$ begin
  perform public.mark_payment_link_paid((select token from lk), 'x', 'y', 1);
  raise exception 'TEST FAILED: webhook function callable';
exception when insufficient_privilege then null; end $$;
reset role;
select 'PAYMENT LINKS OK';
rollback;
