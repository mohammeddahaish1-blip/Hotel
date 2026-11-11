-- =====================================================================
-- 0039 — Shop books: the owner's own shops (supermarket, laundry, café…).
-- * Shop workers: name, job, salary, residence card (iqama) number and expiry — kept by the shop's
--   cashier (shop role 'manager', shown as «كاشير») or the owner/managers.
-- * Daily invoice photos: the cashier photographs the day's sales report, purchase invoices and expense
--   receipts; the amount is read from the photo (or typed) and the owner sees income, costs and net
--   profit per day and per month.
-- * A shop can be set to require photos every day; a past day without any photo is flagged to the
--   owner, the managers and the shop's cashier until it is uploaded.
-- =====================================================================

alter table public.shops add column daily_photos boolean not null default false;
alter table public.shops add column photos_since date;
comment on column public.shops.daily_photos is 'The cashier must photograph the day''s invoices every day (missing days are flagged).';

-- ---------------------------------------------------------------- workers of a shop
create table public.shop_workers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  job_title text check (char_length(job_title) <= 60),
  phone text check (char_length(phone) <= 30),
  nationality text check (char_length(nationality) <= 40),
  salary bigint not null default 0 check (salary >= 0),
  iqama_no text check (char_length(iqama_no) <= 40),
  iqama_expiry date,
  joined_on date,
  active boolean not null default true,
  notes text check (char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index shop_workers_shop_idx on public.shop_workers(shop_id);
create index shop_workers_tenant_idx on public.shop_workers(tenant_id, iqama_expiry);
create index shop_workers_created_by_idx on public.shop_workers(created_by);
alter table public.shop_workers enable row level security;
create policy shop_workers_select on public.shop_workers for select to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager'));
create policy shop_workers_write on public.shop_workers for all to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager'))
  with check (private.shop_access(shop_id) in ('admin', 'manager')
              and exists (select 1 from public.shops s where s.id = shop_id and s.tenant_id = shop_workers.tenant_id));

-- ---------------------------------------------------------------- photographed invoices
create table public.shop_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shop_id uuid not null references public.shops(id) on delete cascade,
  business_date date not null,
  kind text not null check (kind in ('sales', 'purchase', 'expense')),
  amount bigint check (amount >= 0),                 -- null until read or typed
  vendor text check (char_length(vendor) <= 120),
  photo_path text not null,
  read_status text not null default 'pending' check (read_status in ('pending', 'read', 'manual', 'failed')),
  note text check (char_length(note) <= 300),
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 300)
);
create index shop_receipts_shop_day_idx on public.shop_receipts(shop_id, business_date);
create index shop_receipts_tenant_idx on public.shop_receipts(tenant_id, business_date);
create index shop_receipts_uploaded_by_idx on public.shop_receipts(uploaded_by);
alter table public.shop_receipts enable row level security;
create policy shop_receipts_select on public.shop_receipts for select to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager'));
create policy shop_receipts_insert on public.shop_receipts for insert to authenticated
  with check (private.shop_access(shop_id) in ('admin', 'manager')
              and exists (select 1 from public.shops s where s.id = shop_id and s.tenant_id = shop_receipts.tenant_id));
create policy shop_receipts_update on public.shop_receipts for update to authenticated
  using (private.shop_access(shop_id) in ('admin', 'manager')) with check (private.shop_access(shop_id) in ('admin', 'manager'));
create trigger shop_receipts_no_delete before delete on public.shop_receipts
  for each row execute function private.forbid_mutation();

create trigger shop_workers_audit after insert or update on public.shop_workers
  for each row execute function private.audit_trigger();
create trigger shop_receipts_audit after insert or update on public.shop_receipts
  for each row execute function private.audit_trigger();

-- ---------------------------------------------------------------- the photos: <tenant>/<shop>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-receipts', 'shop-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy shop_receipts_files_read on storage.objects for select to authenticated
  using (bucket_id = 'shop-receipts'
    and private.shop_access(((storage.foldername(name))[2])::uuid) in ('admin', 'manager'));
create policy shop_receipts_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-receipts'
    and private.shop_access(((storage.foldername(name))[2])::uuid) in ('admin', 'manager')
    and exists (select 1 from public.shops s
                 where s.id = ((storage.foldername(objects.name))[2])::uuid
                   and s.tenant_id = ((storage.foldername(objects.name))[1])::uuid));
