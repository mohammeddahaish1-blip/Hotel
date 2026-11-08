-- =====================================================================
-- 0034 — System owners' portal (for the Nuzul team, not for hotels).
-- Plans with a monthly price, unit/property limits and the features they include; one subscription
-- per hotel company (tenant) with its status and paid-until date; subscription payments.
-- Only platform admins read and change everything, through the admin_* functions below.
-- A hotel's owner and managers can read their own subscription. New companies start with a free month.
-- =====================================================================

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;   -- no policies: read only through functions

create or replace function private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
revoke execute on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------- plans
create table public.plans (
  code text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  name_ar text not null check (char_length(name_ar) between 1 and 60),
  name_en text check (char_length(name_en) <= 60),
  monthly_price bigint not null default 0 check (monthly_price >= 0),
  max_units int check (max_units > 0),             -- null = no limit
  max_properties int check (max_properties > 0),   -- null = no limit
  features text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (true);
create policy plans_admin on public.plans for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

insert into public.plans(code, name_ar, name_en, monthly_price, max_units, max_properties, features, sort) values
  ('basic', 'الأساسية', 'Basic', 15000, 20, 1, '{}', 1),
  ('pro', 'المتقدمة', 'Pro', 30000, 60, 2,
   '{messages,automation,payment_links,contracts,channels,analytics,import,owners}', 2),
  ('enterprise', 'الشاملة', 'Enterprise', 60000, null, null,
   '{messages,automation,payment_links,contracts,channels,analytics,import,owners,assistant,multi_property}', 3);

-- ---------------------------------------------------------------- subscriptions
create table public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_code text not null references public.plans(code) on update cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  price_override bigint check (price_override >= 0),
  trial_ends_at date,
  current_period_end date,
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_plan_idx on public.subscriptions(plan_code);
alter table public.subscriptions enable row level security;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.is_platform_admin() or private.has_role(tenant_id, '{owner,manager}'));
create policy subscriptions_admin on public.subscriptions for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());
create trigger subscriptions_audit after insert or update on public.subscriptions
  for each row execute function private.audit_trigger();

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount bigint not null check (amount > 0),
  months int not null default 1 check (months between 1 and 24),
  period_start date not null,
  period_end date not null,
  paid_on date not null default current_date,
  method text check (char_length(method) <= 30),
  reference text check (char_length(reference) <= 120),
  recorded_by uuid default auth.uid() references auth.users(id),
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscription_payments_tenant_idx on public.subscription_payments(tenant_id, paid_on desc);
create index subscription_payments_recorded_by_idx on public.subscription_payments(recorded_by);
alter table public.subscription_payments enable row level security;
create policy subscription_payments_select on public.subscription_payments for select to authenticated
  using (private.is_platform_admin() or private.has_role(tenant_id, '{owner}'));
create trigger subscription_payments_audit after insert or update on public.subscription_payments
  for each row execute function private.audit_trigger();

-- every existing company keeps everything it has today; new companies get a free month on the full plan
insert into public.subscriptions(tenant_id, plan_code, status, current_period_end)
  select id, 'enterprise', 'active', current_date + 30 from public.tenants
  on conflict (tenant_id) do nothing;

create or replace function private.start_trial()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.subscriptions(tenant_id, plan_code, status, trial_ends_at)
  values (new.id, 'enterprise', 'trial', current_date + 30)
  on conflict (tenant_id) do nothing;
  return new;
end $$;
create trigger tenants_start_trial after insert on public.tenants
  for each row execute function private.start_trial();

-- ---------------------------------------------------------------- plan limits (units, properties)
create or replace function private.plan_limit(p_tenant uuid, p_kind text)
returns int
language sql stable security definer set search_path = ''
as $$
  select case p_kind when 'units' then p.max_units else p.max_properties end
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.tenant_id = p_tenant
$$;

create or replace function private.enforce_plan_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_max int; v_now int;
begin
  if tg_table_name = 'units' then
    v_max := private.plan_limit(new.tenant_id, 'units');
    if v_max is not null then
      select count(*) into v_now from public.units where tenant_id = new.tenant_id;
      if v_now >= v_max then raise exception 'PLAN_LIMIT: your plan allows % units', v_max; end if;
    end if;
  else
    v_max := private.plan_limit(new.tenant_id, 'properties');
    if v_max is not null then
      select count(*) into v_now from public.properties where tenant_id = new.tenant_id;
      if v_now >= v_max then raise exception 'PLAN_LIMIT: your plan allows % properties', v_max; end if;
    end if;
  end if;
  return new;
end $$;
create trigger units_plan_limit before insert on public.units
  for each row execute function private.enforce_plan_limits();
create trigger properties_plan_limit before insert on public.properties
  for each row execute function private.enforce_plan_limits();

-- ---------------------------------------------------------------- for the hotel app
-- The caller's company: plan, features and status (any member), and whether the caller is a platform admin.
create or replace function public.my_subscription(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'is_admin', private.is_platform_admin(),
    'plan_code', s.plan_code, 'plan_name', p.name_ar, 'plan_name_en', p.name_en,
    'features', coalesce(to_jsonb(p.features), '[]'::jsonb),
    'status', s.status, 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
    'max_units', p.max_units, 'max_properties', p.max_properties,
    'price', coalesce(s.price_override, p.monthly_price))
  from (select 1) one
  left join public.subscriptions s on s.tenant_id = p_tenant and p_tenant in (select private.user_tenant_ids())
  left join public.plans p on p.code = s.plan_code
$$;
revoke execute on function public.my_subscription(uuid) from public, anon;
grant execute on function public.my_subscription(uuid) to authenticated;

-- ---------------------------------------------------------------- admin functions
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
               (select count(*) from public.memberships m where m.tenant_id = t.id and m.active) as staff,
               (select count(*) from public.reservations r where r.tenant_id = t.id and r.created_at > now() - interval '30 days') as bookings_30d,
               (select max(a.at) from public.audit_log a where a.tenant_id = t.id) as last_activity,
               s.plan_code, p.name_ar as plan_name, s.status, s.trial_ends_at, s.current_period_end, s.notes,
               coalesce(s.price_override, p.monthly_price) as price, s.price_override,
               (select max(sp.paid_on) from public.subscription_payments sp where sp.tenant_id = t.id and sp.voided_at is null) as last_paid_on
          from public.tenants t
          left join public.subscriptions s on s.tenant_id = t.id
          left join public.plans p on p.code = s.plan_code
      ) x), '[]'::jsonb);
end $$;

create or replace function public.admin_tenant(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  return jsonb_build_object(
    'properties', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name_ar, 'kind', p.kind,
                    'units', (select count(*) from public.units u where u.property_id = p.id and u.active)) order by p.created_at)
                    from public.properties p where p.tenant_id = p_tenant), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'email', u.email, 'role', m.role, 'active', m.active) order by m.created_at)
               from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'amount', sp.amount, 'months', sp.months,
                  'period_start', sp.period_start, 'period_end', sp.period_end, 'paid_on', sp.paid_on, 'method', sp.method,
                  'reference', sp.reference, 'voided', sp.voided_at is not null) order by sp.paid_on desc, sp.created_at desc)
                  from public.subscription_payments sp where sp.tenant_id = p_tenant), '[]'::jsonb));
end $$;

create or replace function public.admin_set_subscription(
  p_tenant uuid, p_plan text, p_status text, p_period_end date default null, p_trial_ends date default null,
  p_price_override bigint default null, p_notes text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_status not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then raise exception 'INVALID_STATUS: %', p_status; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'NOT_FOUND: plan'; end if;
  insert into public.subscriptions(tenant_id, plan_code, status, current_period_end, trial_ends_at, price_override, notes)
  values (p_tenant, p_plan, p_status, p_period_end, p_trial_ends, p_price_override, left(p_notes, 500))
  on conflict (tenant_id) do update
     set plan_code = excluded.plan_code, status = excluded.status, current_period_end = excluded.current_period_end,
         trial_ends_at = excluded.trial_ends_at, price_override = excluded.price_override, notes = excluded.notes,
         updated_at = now();
end $$;

-- A payment extends "paid until" by the months paid and makes the subscription active.
create or replace function public.admin_record_payment(p_tenant uuid, p_amount bigint, p_months int default 1,
  p_method text default null, p_reference text default null, p_paid_on date default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_start date; v_end date; v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT: must be positive'; end if;
  if p_months is null or p_months < 1 or p_months > 24 then raise exception 'INVALID_AMOUNT: months 1-24'; end if;
  select greatest(coalesce(current_period_end, current_date), current_date) into v_start
    from public.subscriptions where tenant_id = p_tenant for update;
  if not found then raise exception 'NOT_FOUND: subscription'; end if;
  v_end := (v_start + make_interval(months => p_months))::date;
  insert into public.subscription_payments(tenant_id, amount, months, period_start, period_end, paid_on, method, reference)
  values (p_tenant, p_amount, p_months, v_start, v_end, coalesce(p_paid_on, current_date), left(p_method, 30), left(p_reference, 120))
  returning id into v_id;
  update public.subscriptions set status = 'active', current_period_end = v_end, trial_ends_at = null, updated_at = now()
   where tenant_id = p_tenant;
  return v_id;
end $$;

create or replace function public.admin_void_payment(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare sp record;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  select * into sp from public.subscription_payments where id = p_id and voided_at is null for update;
  if not found then raise exception 'NOT_FOUND: payment'; end if;
  update public.subscription_payments set voided_at = now() where id = p_id;
  -- take the paid months back off "paid until"
  update public.subscriptions
     set current_period_end = (current_period_end - make_interval(months => sp.months))::date, updated_at = now()
   where tenant_id = sp.tenant_id and current_period_end is not null;
end $$;

create or replace function public.admin_save_plan(p_code text, p_name_ar text, p_name_en text, p_price bigint,
  p_max_units int, p_max_properties int, p_features text[], p_active boolean default true, p_sort int default 0)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_AMOUNT: price'; end if;
  insert into public.plans(code, name_ar, name_en, monthly_price, max_units, max_properties, features, active, sort)
  values (p_code, p_name_ar, nullif(p_name_en, ''), p_price, p_max_units, p_max_properties, coalesce(p_features, '{}'), coalesce(p_active, true), coalesce(p_sort, 0))
  on conflict (code) do update
     set name_ar = excluded.name_ar, name_en = excluded.name_en, monthly_price = excluded.monthly_price,
         max_units = excluded.max_units, max_properties = excluded.max_properties, features = excluded.features,
         active = excluded.active, sort = excluded.sort;
end $$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_tenant(uuid) from public, anon;
revoke execute on function public.admin_set_subscription(uuid, text, text, date, date, bigint, text) from public, anon;
revoke execute on function public.admin_record_payment(uuid, bigint, int, text, text, date) from public, anon;
revoke execute on function public.admin_void_payment(uuid) from public, anon;
revoke execute on function public.admin_save_plan(text, text, text, bigint, int, int, text[], boolean, int) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_tenant(uuid) to authenticated;
grant execute on function public.admin_set_subscription(uuid, text, text, date, date, bigint, text) to authenticated;
grant execute on function public.admin_record_payment(uuid, bigint, int, text, text, date) to authenticated;
grant execute on function public.admin_void_payment(uuid) to authenticated;
grant execute on function public.admin_save_plan(text, text, text, bigint, int, int, text[], boolean, int) to authenticated;

-- The owner chose the demo owner account as the first system owner (no-op where it does not exist).
insert into public.platform_admins(user_id)
  select id from auth.users where email = 'demo@nuzul.test'
  on conflict (user_id) do nothing;
