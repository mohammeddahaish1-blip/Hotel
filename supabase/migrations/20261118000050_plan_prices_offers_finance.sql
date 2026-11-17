-- Platform side, additive only:
--  * plan prices per currency (OMR / SAR / AED), monthly and yearly, with an optional limited-time offer
--  * subscriptions and their payments carry a billing period and a currency
--  * the Nuzul team's own expenses and the exchange rates used to total everything in Omani rials
-- Amounts are whole minor units of their currency: OMR 1/1000 (baisa), SAR and AED 1/100.

-- ------------------------------------------------------------------ prices per currency
create table public.plan_prices (
  plan_code text not null references public.plans(code) on update cascade on delete cascade,
  currency text not null check (currency in ('OMR', 'SAR', 'AED')),
  monthly bigint not null check (monthly >= 0),
  yearly bigint not null check (yearly >= 0),
  offer_monthly bigint check (offer_monthly >= 0),
  offer_yearly bigint check (offer_yearly >= 0),
  primary key (plan_code, currency)
);
alter table public.plan_prices enable row level security;
-- prices are public, like the plans themselves
create policy plan_prices_public on public.plan_prices for select to anon, authenticated using (true);
create policy plan_prices_admin_insert on public.plan_prices for insert to authenticated with check ((select private.is_platform_admin()));
create policy plan_prices_admin_update on public.plan_prices for update to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy plan_prices_admin_delete on public.plan_prices for delete to authenticated using ((select private.is_platform_admin()));

alter table public.plans
  add column offer_active boolean not null default false,
  add column offer_ends_on date,
  add column offer_label text check (char_length(offer_label) <= 60),
  add column updated_at timestamptz not null default now();

-- start every plan with its current Omani price; yearly = ten months; Saudi and UAE prices = ten times the rial
-- figure as a starting point for the team to review
-- (SAR/AED in halalas/fils: rials x 10 x 100 = baisa)
insert into public.plan_prices(plan_code, currency, monthly, yearly)
select code, 'OMR', monthly_price, monthly_price * 10 from public.plans
union all
select code, c, monthly_price, monthly_price * 10 from public.plans, unnest(array['SAR', 'AED']) c
on conflict do nothing;

-- ------------------------------------------------------------------ subscriptions: period and currency
alter table public.subscriptions
  add column billing_period text not null default 'month' check (billing_period in ('month', 'year')),
  add column currency text not null default 'OMR' check (currency in ('OMR', 'SAR', 'AED'));
alter table public.subscription_payments
  add column currency text not null default 'OMR' check (currency in ('OMR', 'SAR', 'AED'));

-- ------------------------------------------------------------------ the team's own expenses
create table public.platform_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  vendor text check (char_length(vendor) <= 120),
  amount bigint not null check (amount > 0),            -- baisa
  recurrence text not null check (recurrence in ('month', 'year', 'once')),
  started_on date not null default current_date,
  ended_on date,
  notes text check (char_length(notes) <= 300),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);
create index platform_expenses_created_by_idx on public.platform_expenses(created_by);
alter table public.platform_expenses enable row level security;
create policy platform_expenses_admin on public.platform_expenses for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.platform_expenses from anon;

-- ------------------------------------------------------------------ exchange rates (one row)
create table public.platform_settings (
  id int primary key default 1 check (id = 1),
  sar_per_omr numeric(10, 4) not null default 9.75 check (sar_per_omr > 0),
  aed_per_omr numeric(10, 4) not null default 9.55 check (aed_per_omr > 0),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values (1) on conflict do nothing;
alter table public.platform_settings enable row level security;
create policy platform_settings_admin_select on public.platform_settings for select to authenticated using ((select private.is_platform_admin()));
create policy platform_settings_admin_update on public.platform_settings for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.platform_settings from anon;

-- ------------------------------------------------------------------ save a plan's prices and offer in one go
create or replace function public.admin_save_plan_prices(p_code text, p_prices jsonb, p_offer_active boolean, p_offer_ends date, p_offer_label text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r jsonb;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if not exists (select 1 from public.plans where code = p_code) then raise exception 'NOT_FOUND: plan'; end if;
  if jsonb_typeof(p_prices) <> 'array' then raise exception 'INVALID_INPUT: prices'; end if;
  for r in select * from jsonb_array_elements(p_prices) loop
    if (r->>'currency') not in ('OMR', 'SAR', 'AED') then raise exception 'INVALID_INPUT: currency'; end if;
    if coalesce((r->>'monthly')::bigint, -1) < 0 or coalesce((r->>'yearly')::bigint, -1) < 0 then raise exception 'INVALID_AMOUNT: price'; end if;
    if (r->>'offer_monthly')::bigint < 0 or (r->>'offer_yearly')::bigint < 0 then raise exception 'INVALID_AMOUNT: offer'; end if;
    insert into public.plan_prices(plan_code, currency, monthly, yearly, offer_monthly, offer_yearly)
    values (p_code, r->>'currency', (r->>'monthly')::bigint, (r->>'yearly')::bigint, (r->>'offer_monthly')::bigint, (r->>'offer_yearly')::bigint)
    on conflict (plan_code, currency) do update
      set monthly = excluded.monthly, yearly = excluded.yearly, offer_monthly = excluded.offer_monthly, offer_yearly = excluded.offer_yearly;
  end loop;
  if coalesce(p_offer_active, false) and not exists (
       select 1 from public.plan_prices where plan_code = p_code and (offer_monthly is not null or offer_yearly is not null)) then
    raise exception 'INVALID_INPUT: an offer needs at least one offer price';
  end if;
  update public.plans
     set offer_active = coalesce(p_offer_active, false), offer_ends_on = p_offer_ends,
         offer_label = nullif(left(btrim(coalesce(p_offer_label, '')), 60), ''), updated_at = now(),
         -- keep the old single price in step with the Omani monthly price
         monthly_price = coalesce((select monthly from public.plan_prices where plan_code = p_code and currency = 'OMR'), monthly_price)
   where code = p_code;
end $$;
revoke execute on function public.admin_save_plan_prices(text, jsonb, boolean, date, text) from public, anon;
grant execute on function public.admin_save_plan_prices(text, jsonb, boolean, date, text) to authenticated;

-- ------------------------------------------------------------------ payments and subscriptions with currency and period
drop function public.admin_record_payment(uuid, bigint, integer, text, text, date);
create function public.admin_record_payment(p_tenant uuid, p_amount bigint, p_months integer default 1, p_method text default null,
                                            p_reference text default null, p_paid_on date default null, p_currency text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_start date; v_end date; v_id uuid; v_cur text;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT: must be positive'; end if;
  if p_months is null or p_months < 1 or p_months > 24 then raise exception 'INVALID_AMOUNT: months 1-24'; end if;
  select greatest(coalesce(current_period_end, current_date), current_date), currency into v_start, v_cur
    from public.subscriptions where tenant_id = p_tenant for update;
  if not found then raise exception 'NOT_FOUND: subscription'; end if;
  v_cur := coalesce(p_currency, v_cur, 'OMR');
  if v_cur not in ('OMR', 'SAR', 'AED') then raise exception 'INVALID_INPUT: currency'; end if;
  v_end := (v_start + make_interval(months => p_months))::date;
  insert into public.subscription_payments(tenant_id, amount, months, period_start, period_end, paid_on, method, reference, currency)
  values (p_tenant, p_amount, p_months, v_start, v_end, coalesce(p_paid_on, current_date), left(p_method, 30), left(p_reference, 120), v_cur)
  returning id into v_id;
  update public.subscriptions set status = 'active', current_period_end = v_end, trial_ends_at = null, updated_at = now()
   where tenant_id = p_tenant;
  return v_id;
end $$;
revoke execute on function public.admin_record_payment(uuid, bigint, integer, text, text, date, text) from public, anon;
grant execute on function public.admin_record_payment(uuid, bigint, integer, text, text, date, text) to authenticated;

drop function public.admin_set_subscription(uuid, text, text, date, date, bigint, text);
create function public.admin_set_subscription(p_tenant uuid, p_plan text, p_status text, p_period_end date default null, p_trial_ends date default null,
                                              p_price_override bigint default null, p_notes text default null,
                                              p_billing text default null, p_currency text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  if p_status not in ('trial', 'active', 'past_due', 'suspended', 'cancelled') then raise exception 'INVALID_STATUS: %', p_status; end if;
  if not exists (select 1 from public.plans where code = p_plan) then raise exception 'NOT_FOUND: plan'; end if;
  if p_billing is not null and p_billing not in ('month', 'year') then raise exception 'INVALID_INPUT: billing'; end if;
  if p_currency is not null and p_currency not in ('OMR', 'SAR', 'AED') then raise exception 'INVALID_INPUT: currency'; end if;
  insert into public.subscriptions(tenant_id, plan_code, status, current_period_end, trial_ends_at, price_override, notes, billing_period, currency)
  values (p_tenant, p_plan, p_status, p_period_end, p_trial_ends, p_price_override, left(p_notes, 500), coalesce(p_billing, 'month'), coalesce(p_currency, 'OMR'))
  on conflict (tenant_id) do update
     set plan_code = excluded.plan_code, status = excluded.status, current_period_end = excluded.current_period_end,
         trial_ends_at = excluded.trial_ends_at, price_override = excluded.price_override, notes = excluded.notes,
         billing_period = coalesce(p_billing, public.subscriptions.billing_period),
         currency = coalesce(p_currency, public.subscriptions.currency),
         updated_at = now();
end $$;
revoke execute on function public.admin_set_subscription(uuid, text, text, date, date, bigint, text, text, text) from public, anon;
grant execute on function public.admin_set_subscription(uuid, text, text, date, date, bigint, text, text, text) to authenticated;

-- ------------------------------------------------------------------ overview: period, currency and the plan's list price for them
-- price = what this company pays per billing period, in its currency (an override wins); price_omr = the same in baisa
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_sar numeric; v_aed numeric;
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  select sar_per_omr, aed_per_omr into v_sar, v_aed from public.platform_settings where id = 1;
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
               s.billing_period, s.currency,
               pr.price, s.price_override,
               round(pr.price * case s.currency when 'SAR' then 10 / v_sar when 'AED' then 10 / v_aed else 1 end)::bigint as price_omr,
               (select max(sp.paid_on) from public.subscription_payments sp where sp.tenant_id = t.id and sp.voided_at is null) as last_paid_on
          from public.tenants t
          left join public.subscriptions s on s.tenant_id = t.id
          left join public.plans p on p.code = s.plan_code
          left join lateral (
            select coalesce(s.price_override,
                            case when s.billing_period = 'year' then pp.yearly else pp.monthly end,
                            p.monthly_price) as price
              from (select 1) one
              left join public.plan_prices pp on pp.plan_code = s.plan_code and pp.currency = s.currency
          ) pr on true
         where not t.is_showcase
      ) x), '[]'::jsonb);
end $$;
