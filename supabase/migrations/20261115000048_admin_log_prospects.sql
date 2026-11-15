-- System owners' portal: its own activity log and a list of companies expected to sign up.
-- Additive only: two new tables, readable and writable by platform admins alone.

-- ---------------------------------------------------------------- portal log
create table public.admin_log (
  id bigint generated always as identity primary key,
  actor uuid not null default auth.uid() references auth.users(id),
  actor_email text default (auth.jwt() ->> 'email') check (char_length(actor_email) <= 200),
  action text not null check (char_length(action) between 1 and 60),
  tenant_id uuid references public.tenants(id) on delete set null,
  detail text check (char_length(detail) <= 500),
  at timestamptz not null default now()
);
create index admin_log_at_idx on public.admin_log(at desc);
create index admin_log_tenant_idx on public.admin_log(tenant_id);
create index admin_log_actor_idx on public.admin_log(actor);
alter table public.admin_log enable row level security;
-- written once, never changed: no update or delete policy
create policy admin_log_select on public.admin_log for select to authenticated
  using ((select private.is_platform_admin()));
create policy admin_log_insert on public.admin_log for insert to authenticated
  with check ((select private.is_platform_admin()) and actor = (select auth.uid())
              and actor_email is not distinct from ((select auth.jwt()) ->> 'email'));
revoke all on public.admin_log from anon;

-- ---------------------------------------------------------------- expected companies
-- The team notes a company before its owner signs up; once the owner registers with the same e-mail,
-- the portal offers to apply the agreed plan and trial in one press.
create table public.admin_prospects (
  id uuid primary key default gen_random_uuid(),
  company text not null check (char_length(company) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  phone text check (char_length(phone) <= 30),
  plan_code text not null references public.plans(code) on update cascade,
  trial_days int not null default 14 check (trial_days between 0 and 365),
  notes text check (char_length(notes) <= 500),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index admin_prospects_plan_idx on public.admin_prospects(plan_code);
create index admin_prospects_tenant_idx on public.admin_prospects(tenant_id);
create index admin_prospects_created_by_idx on public.admin_prospects(created_by);
alter table public.admin_prospects enable row level security;
create policy admin_prospects_all on public.admin_prospects for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.admin_prospects from anon;
