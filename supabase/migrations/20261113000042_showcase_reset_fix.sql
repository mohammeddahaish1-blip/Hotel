-- =====================================================================
-- 0042 — The nightly showcase reset failed (STAY_ENDED) from 9 November.
-- It runs at 23:10 UTC, already the next day in Muscat, but built the stays from the UTC date: a
-- guest "leaving today" got a stay that had already ended in hotel time and check-in refused it.
-- The showcase now counts days in the hotel's own time zone (Asia/Muscat, the property default).
-- =====================================================================

create or replace function private.seed_showcase()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_visitor uuid; v_tenant uuid; v_prop uuid; d date := (now() at time zone 'Asia/Muscat')::date;
  t_room uuid; t_suite uuid; t_apt uuid; f1 uuid; f2 uuid; f3 uuid;
  g uuid[]; r uuid; v_folio uuid;
  u record;
begin
  select id into v_visitor from auth.users where email = 'visitor@nuzul.test';
  if v_visitor is null then raise exception 'NOT_FOUND: demo visitor'; end if;

  insert into public.tenants(name, is_showcase) values ('فندق الواحة — نسخة العرض', true) returning id into v_tenant;
  update public.subscriptions set plan_code = 'enterprise', status = 'active', trial_ends_at = null,
         current_period_end = d + 3650 where tenant_id = v_tenant;
  -- the visitor moves to the new showcase; yesterday's is switched off
  update public.memberships set active = false where user_id = v_visitor and active;
  insert into public.memberships(tenant_id, user_id, role, full_name, job_title)
    values (v_tenant, v_visitor, 'manager', 'زائر العرض', 'مدير الفندق (تجريبي)');
  -- act as the visitor so the hotel's own rules (permissions, prices, taxes) build the data
  perform set_config('request.jwt.claim.sub', v_visitor::text, true);

  insert into public.properties(tenant_id, name_ar, name_en, kind, municipality, phone, whatsapp, address)
    values (v_tenant, 'فندق الواحة', 'Al Waha Hotel', 'hotel', 'muscat', '+96824000000', '+96890000000', 'مسقط — الخوير')
    returning id into v_prop;
  insert into public.tax_rules(tenant_id, code, name_ar, name_en, rate_bp, basis, is_revenue, sort) values
    (v_tenant, 'service', 'رسم الخدمة', 'Service charge', 0, 'base', false, 1),
    (v_tenant, 'tourism', 'رسم السياحة', 'Tourism levy', 400, 'base', false, 2),
    (v_tenant, 'municipality', 'رسم البلدية', 'Municipality fee', 500, 'base', false, 3),
    (v_tenant, 'vat', 'ضريبة القيمة المضافة', 'VAT', 500, 'base', false, 4);

  insert into public.unit_types(tenant_id, property_id, name_ar, name_en, kind, capacity, nightly_rate, monthly_rate)
    values (v_tenant, v_prop, 'غرفة مزدوجة', 'Double room', 'room', 2, 25000, 450000) returning id into t_room;
  insert into public.unit_types(tenant_id, property_id, name_ar, name_en, kind, capacity, nightly_rate, monthly_rate)
    values (v_tenant, v_prop, 'جناح عائلي', 'Family suite', 'suite', 4, 45000, 750000) returning id into t_suite;
  insert into public.unit_types(tenant_id, property_id, name_ar, name_en, kind, capacity, nightly_rate, monthly_rate)
    values (v_tenant, v_prop, 'شقة غرفتين', 'Two-bedroom apartment', 'apartment', 5, 60000, 550000) returning id into t_apt;
  insert into public.floors(tenant_id, property_id, name, sort) values (v_tenant, v_prop, 'الطابق الأول', 1) returning id into f1;
  insert into public.floors(tenant_id, property_id, name, sort) values (v_tenant, v_prop, 'الطابق الثاني', 2) returning id into f2;
  insert into public.floors(tenant_id, property_id, name, sort) values (v_tenant, v_prop, 'الطابق الثالث', 3) returning id into f3;
  perform public.bulk_create_units(v_prop, t_room, f1, '101-108');
  perform public.bulk_create_units(v_prop, t_suite, f2, '201-205');
  perform public.bulk_create_units(v_prop, t_apt, f3, '301-304');

  with rows(n, ar, nat, dt, doc, ph) as (values
    (1, 'سالم بن خلفان الحارثي', 'OMN', 'oman_id', '10293847', '+96891234501'),
    (2, 'مريم بنت سعيد البلوشية', 'OMN', 'oman_id', '11928374', '+96892234502'),
    (3, 'عبدالله محمد القحطاني', 'SAU', 'gcc_id', '1093847561', '+966501234503'),
    (4, 'Fatima Al Mansoori', 'ARE', 'gcc_id', '784199012345', '+971501234504'),
    (5, 'Rahul Menon', 'IND', 'passport', 'Z1234567', '+919812345605'),
    (6, 'James Whitfield', 'GBR', 'passport', '533912845', '+447700900606'),
    (7, 'خالد بن ناصر الرواحي', 'OMN', 'oman_id', '12039485', '+96893234507'),
    (8, 'نورة عبدالرحمن الكعبي', 'QAT', 'gcc_id', '28563400123', '+97455123408'),
    (9, 'Ahmed Raza', 'PAK', 'passport', 'AB9876543', '+923001234509'),
    (10, 'Sophie Laurent', 'FRA', 'passport', '19FR33452', '+33612345610'),
    (11, 'يوسف بن علي الشكيلي', 'OMN', 'oman_id', '13948572', '+96894234511'),
    (12, 'هند جاسم المطيري', 'KWT', 'gcc_id', '290010112233', '+96550123412'))
  , ins as (
    insert into public.guests(tenant_id, full_name, nationality, doc_type, doc_number, doc_expiry, phone, consent_at)
    select v_tenant, ar, nat, dt::public.doc_type, doc, d + 900, ph, now() from rows order by n
    returning id, full_name)
  select array_agg(i.id order by rw.n) into g from ins i join rows rw on rw.ar = i.full_name;

  -- in the hotel now (some leave today), arriving today, and coming soon
  for u in select * from (values
      ('101', 1, -2, 2, 'direct', true, 30000), ('103', 3, -1, 3, 'booking', true, 0),
      ('201', 4, -3, 0, 'phone', true, 120000), ('202', 6, -1, 1, 'agoda', true, 50000),
      ('105', 5, 0, 2, 'walk_in', true, 25000), ('301', 9, -6, 8, 'corporate', true, 300000),
      ('102', 2, 0, 3, 'whatsapp', false, 0), ('204', 8, 0, 1, 'booking', false, 0),
      ('104', 7, 2, 5, 'direct', false, 0), ('106', 10, 1, 4, 'agoda', false, 0),
      ('203', 11, 3, 7, 'phone', false, 0), ('302', 12, 5, 12, 'airbnb', false, 0))
    as x(unit_no, guest_n, from_d, to_d, src, in_house, paid)
  loop
    r := public.create_reservation(v_prop, (select id from public.units where property_id = v_prop and number = u.unit_no),
           g[u.guest_n], d + u.from_d, d + greatest(u.to_d, 1), u.src::public.booking_source);
    if u.in_house then perform public.check_in(r); end if;
    -- leaving today: booked one night longer, then shortened (check-in refuses a stay that already ended)
    if u.to_d < 1 then
      perform public.change_reservation(r, (select unit_id from public.reservations where id = r), d + u.from_d, d + u.to_d);
    end if;
    if u.paid > 0 then
      select id into v_folio from public.folios where reservation_id = r;
      insert into public.payments(tenant_id, folio_id, method, amount, reference, received_at)
        values (v_tenant, v_folio, case when u.paid >= 100000 then 'transfer' else 'card' end::public.payment_method,
                u.paid, 'DEMO', now() - make_interval(days => greatest(-u.from_d, 0)));
    end if;
  end loop;

  update public.units set status = 'dirty' where property_id = v_prop and number in ('107', '205');
  insert into public.maintenance_tickets(tenant_id, property_id, unit_id, title, description, priority, blocks_availability)
    select v_tenant, v_prop, id, 'المكيف لا يبرّد', 'بلّغ عنه النزيل السابق — يحتاج فني', 1, true
      from public.units where property_id = v_prop and number = '108';
  insert into public.expenses(tenant_id, property_id, category, description, amount, expense_date, method) values
    (v_tenant, v_prop, 'utilities', 'فاتورة الكهرباء', 185000, d - 4, 'transfer'),
    (v_tenant, v_prop, 'laundry', 'غسيل المفارش والمناشف', 42500, d - 2, 'cash'),
    (v_tenant, v_prop, 'supplies', 'مستلزمات الضيافة', 31750, d - 1, 'card');

  perform set_config('request.jwt.claim.sub', '', true);
  return v_tenant;
end $$;
revoke execute on function private.seed_showcase() from public, anon, authenticated;
