-- =====================================================================
-- 0037 — Shops («المحلات»).
-- Two kinds, managed by the owner and managers:
-- * service shops inside the property (laundry, café, restaurant, mini-market…): items with prices,
--   sales paid on the spot or charged to an in-house guest's bill;
-- * rental shops let to a business: renter, monthly rent, contract dates, deposit and rent payments.
-- Each shop has its own people with their own access ('shops' section + a role in that shop):
--   seller (records sales) · manager (also items, all sales, voids) · renter (sees their contract and payments).
-- They see only the shops they belong to; owner and managers see all.
-- =====================================================================

-- 'shops' becomes a grantable section
alter table public.memberships drop constraint memberships_permissions_valid;
alter table public.memberships add constraint memberships_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback', 'import', 'shops']::text[]);
alter table public.invitations drop constraint invitations_permissions_valid;
alter table public.invitations add constraint invitations_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit', 'feedback', 'import', 'shops']::text[]);

-- ---------------------------------------------------------------- shops
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  kind text not null check (kind in ('service', 'rental')),
  category text not null default 'other'
    check (category in ('laundry', 'cafe', 'restaurant', 'minimarket', 'salon', 'office', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  number text check (char_length(number) <= 30),          -- shop number / location in the building
  active boolean not null default true,
  notes text check (char_length(notes) <= 1000),
  -- rental shops
  renter_name text check (char_length(renter_name) <= 120),
  renter_phone text check (char_length(renter_phone) <= 30),
  renter_cr text check (char_length(renter_cr) <= 40),     -- commercial registration
  renter_activity text check (char_length(renter_activity) <= 120),
  monthly_rent bigint not null default 0 check (monthly_rent >= 0),
  deposit bigint not null default 0 check (deposit >= 0),
  contract_start date,
  contract_end date,
  created_at timestamptz not null default now(),
  check (contract_end is null or contract_start is null or contract_end > contract_start)
);
create index shops_tenant_idx on public.shops(tenant_id);
create index shops_property_idx on public.shops(property_id);
alter table public.shops enable row level security;

create table public.shop_members (
  shop_id uuid not null references public.shops(id) on delete cascade,
  tenant_id uuid not null,
  user_id uuid not null,
  access text not null check (access in ('seller', 'manager', 'renter')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id),
  foreign key (tenant_id, user_id) references public.memberships(tenant_id, user_id) on delete cascade
);
create index shop_members_user_idx on public.shop_members(user_id);
create index shop_members_tenant_user_idx on public.shop_members(tenant_id, user_id);
alter table public.shop_members enable row level security;

-- The caller's access to one shop: 'admin' (owner / manager), or their role in that shop while they
-- still hold the 'shops' section; null = no access.
create or replace function private.shop_access(p_shop uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when private.has_role(s.tenant_id, '{owner,manager}') then 'admin'
    else (select sm.access from public.shop_members sm
            join public.memberships m on m.tenant_id = sm.tenant_id and m.user_id = sm.user_id
           where sm.shop_id = s.id and sm.user_id = (select auth.uid()) and m.active
             and (m.support_until is null or m.support_until > now())
             and m.permissions @> '{shops}')
  end
  from public.shops s where s.id = p_shop
$$;

create policy shops_select on public.shops for select to authenticated
  using (private.shop_access(id) is not null);
create policy shops_write on public.shops for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}')) with check (private.has_role(tenant_id, '{owner,manager}'));

create policy shop_members_select on public.shop_members for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(tenant_id, '{owner,manager}'));
create policy shop_members_write on public.shop_members for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}')) with check (private.has_role(tenant_id, '{owner,manager}'));

-- A member's role must suit the shop: renters for rental shops, sellers and managers for service shops.
create or replace function private.shop_member_check()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare s public.shops;
begin
  select * into s from public.shops where id = new.shop_id;
  if s.tenant_id <> new.tenant_id then raise exception 'FORBIDDEN: other company'; end if;
  if (s.kind = 'rental') <> (new.access = 'renter') then raise exception 'INVALID_VALUE: role does not suit this shop'; end if;
  return new;
end $$;
create trigger shop_members_check before insert or update on public.shop_members
  for each row execute function private.shop_member_check();

-- ---------------------------------------------------------------- service shops: items and sales
create table public.shop_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  price bigint not null check (price >= 0),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index shop_items_shop_idx on public.shop_items(shop_id);
alter table public.shop_items enable row level security;
create policy shop_items_select on public.shop_items for select to authenticated
  using (private.shop_access(shop_id) is not null);
create policy shop_items_write on public.shop_items for all to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager'))
  with check (private.shop_access(shop_id) in ('admin', 'manager'));

create sequence public.shop_sale_code_seq;
create table public.shop_sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null default ('S' || lpad(nextval('public.shop_sale_code_seq')::text, 6, '0')),
  total bigint not null check (total > 0),
  method text not null check (method in ('cash', 'card', 'transfer', 'room')),
  reservation_id uuid references public.reservations(id),
  charge_id uuid references public.charges(id),
  note text check (char_length(note) <= 300),
  sold_by uuid default auth.uid() references auth.users(id) on delete set null,
  sold_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text check (char_length(void_reason) <= 300),
  check ((method = 'room') = (reservation_id is not null))
);
create index shop_sales_shop_idx on public.shop_sales(shop_id, sold_at desc);
create index shop_sales_tenant_idx on public.shop_sales(tenant_id, sold_at desc);
create index shop_sales_property_idx on public.shop_sales(property_id);
create index shop_sales_reservation_idx on public.shop_sales(reservation_id);
create index shop_sales_charge_idx on public.shop_sales(charge_id);
create index shop_sales_sold_by_idx on public.shop_sales(sold_by);
create index shop_sales_voided_by_idx on public.shop_sales(voided_by);
alter table public.shop_sales enable row level security;
create policy shop_sales_select on public.shop_sales for select to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager', 'seller'));

create table public.shop_sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null references public.shop_sales(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  item_id uuid references public.shop_items(id) on delete set null,
  name text not null,
  qty int not null check (qty between 1 and 999),
  unit_price bigint not null check (unit_price >= 0),
  amount bigint not null check (amount >= 0)
);
create index shop_sale_lines_sale_idx on public.shop_sale_lines(sale_id);
create index shop_sale_lines_shop_idx on public.shop_sale_lines(shop_id);
create index shop_sale_lines_item_idx on public.shop_sale_lines(item_id);
alter table public.shop_sale_lines enable row level security;
create policy shop_sale_lines_select on public.shop_sale_lines for select to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager', 'seller'));

-- Guests in the hotel now, for "charge to room" (sellers cannot read reservations themselves).
create or replace function public.shop_in_house(p_shop uuid)
returns table (reservation_id uuid, unit text, guest text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(private.shop_access(p_shop), '') not in ('admin', 'manager', 'seller') then
    raise exception 'FORBIDDEN: no access to this shop';
  end if;
  return query
    select r.id, u.number, g.full_name
      from public.shops s
      join public.reservations r on r.property_id = s.property_id and r.status = 'checked_in'
      join public.units u on u.id = r.unit_id
      join public.guests g on g.id = r.guest_id
     where s.id = p_shop
     order by u.number;
end $$;

-- One sale: lines are [{item_id, qty}]; prices come from the shop's items, never from the caller.
create or replace function public.record_shop_sale(p_shop uuid, p_lines jsonb, p_method text,
  p_reservation uuid default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shops; v_sale uuid; v_total bigint := 0; v_folio uuid; v_charge uuid; v_desc text;
  l record;
begin
  select * into s from public.shops where id = p_shop;
  if not found or coalesce(private.shop_access(p_shop), '') not in ('admin', 'manager', 'seller') then
    raise exception 'FORBIDDEN: no access to this shop';
  end if;
  if s.kind <> 'service' or not s.active then raise exception 'SHOP_CLOSED: this shop does not sell'; end if;
  if p_method not in ('cash', 'card', 'transfer', 'room') then raise exception 'INVALID_VALUE: method'; end if;

  create temp table if not exists pg_temp.sale_lines (item_id uuid, name text, qty int, price bigint) on commit drop;
  truncate pg_temp.sale_lines;
  insert into pg_temp.sale_lines
    select i.id, i.name, (x->>'qty')::int, i.price
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
      join public.shop_items i on i.id = (x->>'item_id')::uuid and i.shop_id = p_shop and i.active
     where (x->>'qty')::int between 1 and 999;
  if not exists (select 1 from pg_temp.sale_lines) then raise exception 'NO_ITEMS: pick at least one item'; end if;
  select sum(qty * price) into v_total from pg_temp.sale_lines;
  if v_total <= 0 then raise exception 'INVALID_AMOUNT: total must be positive'; end if;

  if p_method = 'room' then
    select f.id into v_folio from public.reservations r join public.folios f on f.reservation_id = r.id
     where r.id = p_reservation and r.property_id = s.property_id and r.status = 'checked_in';
    if v_folio is null then raise exception 'NOT_IN_HOUSE: the guest is not staying now'; end if;
    select s.name || ': ' || string_agg(qty || '× ' || name, '، ') into v_desc from pg_temp.sale_lines;
    insert into public.charges(tenant_id, folio_id, kind, description, amount, taxable)
    values (s.tenant_id, v_folio,
            case s.category when 'laundry' then 'laundry' when 'cafe' then 'food' when 'restaurant' then 'food' else 'service' end,
            left(v_desc, 300), v_total, false)
    returning id into v_charge;
  end if;

  insert into public.shop_sales(tenant_id, property_id, shop_id, total, method, reservation_id, charge_id, note)
  values (s.tenant_id, s.property_id, p_shop, v_total, p_method,
          case when p_method = 'room' then p_reservation end, v_charge, nullif(btrim(left(p_note, 300)), ''))
  returning id into v_sale;
  insert into public.shop_sale_lines(tenant_id, sale_id, shop_id, item_id, name, qty, unit_price, amount)
    select s.tenant_id, v_sale, p_shop, item_id, name, qty, price, qty * price from pg_temp.sale_lines;
  return v_sale;
end $$;

-- Void a sale (shop manager, owner or manager); a room charge is voided with it while it is not invoiced.
create or replace function public.void_shop_sale(p_sale uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v public.shop_sales;
begin
  select * into v from public.shop_sales where id = p_sale for update;
  if not found or coalesce(private.shop_access(v.shop_id), '') not in ('admin', 'manager') then
    raise exception 'FORBIDDEN: shop managers only';
  end if;
  if v.voided_at is not null then raise exception 'ALREADY_VOIDED: sale already voided'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 2 then raise exception 'REASON_REQUIRED: give a reason'; end if;
  if v.charge_id is not null then
    update public.charges set voided_at = now(), void_reason = left('إلغاء بيع ' || v.code || ': ' || btrim(p_reason), 300)
     where id = v.charge_id and voided_at is null;
  end if;
  update public.shop_sales set voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 300)
   where id = p_sale;
end $$;

-- ---------------------------------------------------------------- rental shops: rent payments
create table public.shop_rent_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount bigint not null check (amount > 0),
  method public.payment_method not null default 'transfer',
  paid_on date not null default current_date,
  period text check (char_length(period) <= 40),          -- e.g. "نوفمبر 2026"
  reference text check (char_length(reference) <= 80),    -- transfer / cheque number
  received_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300)
);
create index shop_rent_payments_shop_idx on public.shop_rent_payments(shop_id, paid_on desc);
create index shop_rent_payments_tenant_idx on public.shop_rent_payments(tenant_id);
create index shop_rent_payments_received_by_idx on public.shop_rent_payments(received_by);
alter table public.shop_rent_payments enable row level security;
create policy shop_rent_payments_select on public.shop_rent_payments for select to authenticated
  using (private.shop_access(shop_id) in ('admin', 'renter'));
create policy shop_rent_payments_insert on public.shop_rent_payments for insert to authenticated
  with check (private.has_role(tenant_id, '{owner,manager}')
              and exists (select 1 from public.shops s where s.id = shop_id and s.tenant_id = shop_rent_payments.tenant_id and s.kind = 'rental'));
create policy shop_rent_payments_update on public.shop_rent_payments for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager}')) with check (private.has_role(tenant_id, '{owner,manager}'));
create trigger shop_rent_payments_no_delete before delete on public.shop_rent_payments
  for each row execute function private.forbid_mutation();

-- Rent due so far (one month's rent at the start of every month of the contract up to today), paid, balance.
create or replace function public.shop_rent_status(p_shop uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'months', m.n, 'due', m.n * s.monthly_rent,
    'paid', coalesce(p.paid, 0), 'balance', m.n * s.monthly_rent - coalesce(p.paid, 0),
    'next_due', case when s.contract_start is null then null
                     else (s.contract_start + make_interval(months => m.n))::date end,
    'ended', s.contract_end is not null and s.contract_end <= current_date)
  from public.shops s
  cross join lateral (
    select case when s.contract_start is null or s.contract_start > current_date then 0
                else (select count(*) from generate_series(s.contract_start,
                        least(current_date, coalesce(s.contract_end - 1, current_date)), interval '1 month'))::int end as n) m
  left join lateral (select sum(amount) as paid from public.shop_rent_payments
                      where shop_id = s.id and voided_at is null) p on true
  where s.id = p_shop
$$;

-- ---------------------------------------------------------------- audit
create trigger shops_audit after insert or update or delete on public.shops
  for each row execute function private.audit_trigger();
create trigger shop_members_audit after insert or update or delete on public.shop_members
  for each row execute function private.audit_trigger();
create trigger shop_items_audit after insert or update or delete on public.shop_items
  for each row execute function private.audit_trigger();
create trigger shop_sales_audit after insert or update on public.shop_sales
  for each row execute function private.audit_trigger();
create trigger shop_rent_payments_audit after insert or update on public.shop_rent_payments
  for each row execute function private.audit_trigger();

revoke execute on function public.shop_in_house(uuid) from public, anon;
revoke execute on function public.record_shop_sale(uuid, jsonb, text, uuid, text) from public, anon;
revoke execute on function public.void_shop_sale(uuid, text) from public, anon;
revoke execute on function public.shop_rent_status(uuid) from public, anon;
grant execute on function public.shop_in_house(uuid) to authenticated;
grant execute on function public.record_shop_sale(uuid, jsonb, text, uuid, text) to authenticated;
grant execute on function public.void_shop_sale(uuid, text) to authenticated;
grant execute on function public.shop_rent_status(uuid) to authenticated;
