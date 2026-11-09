-- =====================================================================
-- 0036 — Public landing page + one-click demo.
-- * Visitors read the active plans without signing in.
-- * A shared demo visitor (visitor@nuzul.test, a hotel manager) opens a showcase hotel filled with
--   made-up data. Every night a fresh showcase hotel is built and the visitor moves to it, so what
--   visitors changed during the day disappears (old showcase companies stay, hidden; audit rows are
--   immutable, so companies are never deleted).
-- * The showcase cannot invite staff or open support requests, and the visitor's email and password
--   cannot be changed.
-- =====================================================================

create policy plans_public on public.plans for select to anon using (active);

alter table public.tenants add column is_showcase boolean not null default false;

-- ---------------------------------------------------------------- the showcase stays closed to the outside
create or replace function private.forbid_showcase()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants where id = new.tenant_id and is_showcase) then
    raise exception 'DEMO_ONLY: not available in the demo';
  end if;
  return new;
end $$;
create or replace trigger invitations_forbid_showcase before insert on public.invitations
  for each row execute function private.forbid_showcase();
create or replace trigger support_requests_forbid_showcase before insert on public.support_requests
  for each row execute function private.forbid_showcase();

-- The demo visitor's email and password stay as they are, whatever a visitor tries.
do $auth$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute $f$
      create or replace function private.freeze_demo_visitor()
      returns trigger language plpgsql security definer set search_path = ''
      as $b$
      begin
        if old.email = 'visitor@nuzul.test' then
          new.encrypted_password := old.encrypted_password;
          new.email := old.email;
        end if;
        return new;
      end $b$;
    $f$;
    execute 'create or replace trigger freeze_demo_visitor before update on auth.users
               for each row execute function private.freeze_demo_visitor()';
  end if;
end $auth$;

-- ---------------------------------------------------------------- build a fresh showcase hotel
create or replace function private.seed_showcase()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_visitor uuid; v_tenant uuid; v_prop uuid; d date := current_date;
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

-- Showcase companies are not customers: keep them out of the owners' portal.
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select t.id, t.name, t.created_at,
               (select string_agg(coalesce(nullif(m.full_name, ''), u.email), '، ')
                  from public.memberships m join auth.users u on u.id = m.user_id
                 where m.tenant_id = t.id and m.role = 'owner') as owner_name,
               (select string_agg(u.email, ', ')
                  from public.memberships m join auth.users u on u.id = m.user_id
                 where m.tenant_id = t.id and m.role = 'owner') as owner_email,
               (select count(*) from public.properties p where p.tenant_id = t.id) as properties,
               (select count(*) from public.units u where u.tenant_id = t.id and u.active) as units,
               (select count(*) from public.memberships m where m.tenant_id = t.id and m.active and m.support_until is null) as staff,
               (select count(*) from public.reservations r where r.tenant_id = t.id and r.created_at > now() - interval '30 days') as bookings_30d,
               (select max(a.at) from public.audit_log a where a.tenant_id = t.id) as last_activity,
               s.plan_code, p.name_ar as plan_name, s.status, s.trial_ends_at, s.current_period_end, s.notes,
               coalesce(s.price_override, p.monthly_price) as price, s.price_override,
               (select max(sp.paid_on) from public.subscription_payments sp where sp.tenant_id = t.id and sp.voided_at is null) as last_paid_on
          from public.tenants t
          left join public.subscriptions s on s.tenant_id = t.id
          left join public.plans p on p.code = s.plan_code
         where not t.is_showcase
      ) x), '[]'::jsonb);
end $$;

-- Every night (03:10 Muscat) a fresh showcase; skipped where pg_cron is unavailable (local tests).
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('showcase-reset', '10 23 * * *', 'select private.seed_showcase()');
  end if;
end $outer$;
