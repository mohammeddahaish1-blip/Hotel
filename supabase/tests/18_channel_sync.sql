\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@t') on conflict do nothing;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
create temp table c as select (x->>'tenant_id')::uuid t, (x->>'property_id')::uuid p from public.create_tenant('T', 'P', 'O') x;
grant select on c to authenticated, anon;
insert into public.unit_types(tenant_id, property_id, name_ar, nightly_rate, monthly_rate) select t, p, 'x', 20000, 300000 from c;
select public.bulk_create_units((select p from c), (select id from public.unit_types), null, '101-102');
insert into public.guests(tenant_id, full_name, consent_at) select t, 'Walk In', now() from c;
insert into public.ical_feeds(tenant_id, property_id, unit_id, channel, url)
  select t, p, (select id from public.units where number = '101'), 'airbnb', 'https://www.airbnb.com/calendar/ical/1.ics' from c;
reset role;

create function pg_temp.check(b bool, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'TEST FAILED: %', msg; end if; end $$;
create temp table d as select private.property_today((select p from c)) today;
grant select on d to authenticated, anon;

-- an Airbnb-style calendar: one all-day booking in 3 days (folded UID line), one cancelled, one timed event
create temp table cal as select format(E'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Airbnb Inc//Hosting Calendar//EN\r\n'
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:%s\r\nDTEND;VALUE=DATE:%s\r\nUID:1418fb94e984-f4b2b2fe4c1\r\n 4f3a@airbnb.com\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\n'
  'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:%s\r\nDTEND;VALUE=DATE:%s\r\nUID:gone@airbnb.com\r\nSTATUS:CANCELLED\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\n'
  'BEGIN:VEVENT\r\nDTSTART:%sT140000Z\r\nDTEND:%sT100000Z\r\nUID:timed@airbnb.com\r\nSUMMARY:Airbnb (Not available)\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
  to_char((select today from d) + 3, 'YYYYMMDD'), to_char((select today from d) + 6, 'YYYYMMDD'),
  to_char((select today from d) + 10, 'YYYYMMDD'), to_char((select today from d) + 12, 'YYYYMMDD'),
  to_char((select today from d) + 20, 'YYYYMMDD'), to_char((select today from d) + 22, 'YYYYMMDD')) body;

select pg_temp.check((select count(*) from private.parse_ical((select body from cal))) = 3, 'three events parsed');
select pg_temp.check((select uid from private.parse_ical((select body from cal)) limit 1) = '1418fb94e984-f4b2b2fe4c14f3a@airbnb.com', 'folded line joined');
select pg_temp.check(private.apply_ical((select id from public.ical_feeds), (select body from cal)) = 2, 'cancelled event skipped');
select pg_temp.check((select stay from public.channel_blocks where uid like 'timed%') = daterange((select today from d) + 20, (select today from d) + 22), 'timed event dates');

-- dates sold on Airbnb are closed here
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select pg_temp.check(not exists (select 1 from public.available_units((select p from c), (select today from d) + 4, (select today from d) + 5) where number = '101'), 'blocked unit hidden');
select pg_temp.check(exists (select 1 from public.available_units((select p from c), (select today from d) + 4, (select today from d) + 5) where number = '102'), 'other unit free');
do $$ begin
  perform public.create_reservation((select p from c), (select id from public.units where number = '101'), (select id from public.guests),
    (select today from d) + 4, (select today from d) + 5);
  raise exception 'TEST FAILED: booked over a channel block';
exception when others then if sqlerrm not like 'CHANNEL_BLOCKED%' then raise; end if; end $$;

-- reception gets the guest's details: block becomes a booking from Airbnb
create temp table cv as select public.convert_channel_block((select id from public.channel_blocks where uid like '1418%'), (select id from public.guests)) res;
select pg_temp.check((select source from public.reservations where id = (select res from cv)) = 'airbnb', 'converted with source');
select pg_temp.check((select stay from public.reservations where id = (select res from cv)) = daterange((select today from d) + 3, (select today from d) + 6), 'same dates');
reset role;

create temp table tk as select ical_token from public.units where number = '101';
grant select on tk to anon;
-- export: anonymous calendar link shows our bookings with no names; Airbnb's own booking is left out of Airbnb's copy
set local role anon;
select pg_temp.check((select count(*) from public.unit_ical_public((select ical_token from tk))) = 2, 'export has booking + block');
select pg_temp.check((select count(*) from public.unit_ical_public((select ical_token from tk), 'airbnb')) = 0, 'airbnb copy excludes its own');
select pg_temp.check(not exists (select 1 from public.unit_ical_public((select ical_token from tk)) where summary like '%Walk%'), 'no guest names');
reset role;

-- next sync without the timed event: that block is marked removed, the converted one stays linked
create temp table cal2 as select regexp_replace((select body from cal), E'BEGIN:VEVENT\r\nDTSTART:[0-9]{8}T.*?END:VEVENT\r\n', '') body;
select pg_temp.check(position('timed@' in (select body from cal2)) = 0, 'test calendar without the timed event');
select private.apply_ical((select id from public.ical_feeds), (select body from cal2));
select pg_temp.check((select removed_at is not null from public.channel_blocks where uid like 'timed%'), 'vanished block removed');
select pg_temp.check((select count(*) from public.channel_blocks where removed_at is null) = 1, 'one live block');

-- double booking alert: a direct booking exists, then Airbnb sells the same nights
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
select public.create_reservation((select p from c), (select id from public.units where number = '101'), (select id from public.guests),
  (select today from d) + 30, (select today from d) + 32);
reset role;
create temp table cal3 as select replace((select body from cal), to_char((select today from d) + 20, 'YYYYMMDD'), to_char((select today from d) + 31, 'YYYYMMDD')) body;
create temp table cal4 as select replace((select body from cal3), to_char((select today from d) + 22, 'YYYYMMDD'), to_char((select today from d) + 33, 'YYYYMMDD')) body;
select private.apply_ical((select id from public.ical_feeds), (select body from cal4));
set local role authenticated;
select pg_temp.check((select count(*) from public.alerts((select p from c)) where kind = 'channel_conflict') = 1, 'double booking alert');
reset role;
select 'CHANNEL SYNC OK';
rollback;
