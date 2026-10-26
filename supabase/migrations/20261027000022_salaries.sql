-- =====================================================================
-- 0022 — Paying staff salaries from the Finance page.
-- Who was paid what is private (owner/manager); the books get an expense
-- "Salaries — <month>" without the employee's name.
-- =====================================================================

create table public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount bigint not null check (amount > 0),
  method text not null check (method in ('cash', 'card', 'transfer')),
  expense_id uuid references public.expenses(id) on delete set null,
  paid_by uuid default auth.uid() references auth.users(id),
  paid_at timestamptz not null default now(),
  unique (tenant_id, user_id, month)
);
create index salary_payments_property_idx on public.salary_payments(property_id, month);
create index salary_payments_user_idx on public.salary_payments(user_id);
create index salary_payments_expense_idx on public.salary_payments(expense_id);
create index salary_payments_paid_by_idx on public.salary_payments(paid_by);
alter table public.salary_payments enable row level security;

create policy salary_payments_select on public.salary_payments for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(tenant_id, '{owner,manager}'));
-- writes only through pay_salary() / cancel_salary()
revoke insert, update, delete on public.salary_payments from authenticated;

create or replace function public.pay_salary(p_property uuid, p_user uuid, p_month date, p_amount bigint, p_method text default 'transfer')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_today date;
  v_expense uuid;
  v_id uuid;
  v_month date := date_trunc('month', p_month)::date;
begin
  select tenant_id, (now() at time zone timezone)::date into v_tenant, v_today from public.properties where id = p_property;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT: amount'; end if;
  if not exists (select 1 from public.memberships where tenant_id = v_tenant and user_id = p_user) then
    raise exception 'NOT_FOUND: employee';
  end if;
  insert into public.expenses(tenant_id, property_id, category, description, amount, expense_date, method)
  values (v_tenant, p_property, 'salaries', 'رواتب — Salaries ' || to_char(v_month, 'YYYY-MM'), p_amount, v_today, p_method::public.payment_method)
  returning id into v_expense;
  insert into public.salary_payments(tenant_id, property_id, user_id, month, amount, method, expense_id)
  values (v_tenant, p_property, p_user, v_month, p_amount, p_method, v_expense)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_salary(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare s record;
begin
  select * into s from public.salary_payments where id = p_id;
  if not found or not private.has_role(s.tenant_id, '{owner,manager}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  delete from public.salary_payments where id = p_id;
  if s.expense_id is not null then delete from public.expenses where id = s.expense_id; end if;
end $$;

revoke execute on function public.pay_salary(uuid, uuid, date, bigint, text) from public, anon;
revoke execute on function public.cancel_salary(uuid) from public, anon;
grant execute on function public.pay_salary(uuid, uuid, date, bigint, text) to authenticated;
grant execute on function public.cancel_salary(uuid) to authenticated;
