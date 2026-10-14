-- =====================================================================
-- 0005 — Housekeeping, maintenance, compliance submissions, outbox
-- (FR-40, FR-43, CR-01, CR-02, integration outbox)
-- =====================================================================

create table public.hk_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  kind text not null default 'checkout' check (kind in ('checkout', 'stayover', 'weekly', 'deep', 'inspection')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  priority int not null default 2 check (priority between 1 and 3),   -- 1 = urgent
  due_date date not null default current_date,
  assigned_to uuid,
  started_at timestamptz,
  finished_at timestamptz,
  finished_by uuid,
  notes text,
  created_at timestamptz not null default now()
);
create index hk_tasks_open_idx on public.hk_tasks(property_id, status, due_date);

create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  title text not null,
  description text,
  priority int not null default 2 check (priority between 1 and 3),
  blocks_availability boolean not null default false,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  photo_path text,
  reported_by uuid default auth.uid(),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index maintenance_open_idx on public.maintenance_tickets(unit_id) where status <> 'closed';

create table public.compliance_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  authority text not null check (authority in ('rop', 'mht', 'fawtara')),
  kind text not null default 'guest_register' check (kind in ('guest_register', 'statistics', 'tourism_fee', 'einvoice')),
  period daterange not null,
  status text not null default 'generated'
    check (status in ('generated', 'submitted', 'accepted', 'rejected')),
  record_count int not null default 0,
  payload jsonb,
  response text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index compliance_property_idx on public.compliance_submissions(property_id, created_at desc);

-- Integration outbox: external systems are never called inline.
create table public.outbox_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index outbox_pending_idx on public.outbox_events(status, next_attempt_at) where status in ('pending', 'failed');

alter table public.hk_tasks enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.compliance_submissions enable row level security;
alter table public.outbox_events enable row level security;

create policy hk_select on public.hk_tasks for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy hk_write on public.hk_tasks for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,housekeeping}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,housekeeping}'));

create policy mt_select on public.maintenance_tickets for select to authenticated
  using (tenant_id in (select private.user_tenant_ids()));
create policy mt_write on public.maintenance_tickets for all to authenticated
  using (tenant_id in (select private.user_tenant_ids()))
  with check (tenant_id in (select private.user_tenant_ids()));

create policy compliance_select on public.compliance_submissions for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,accountant}'));
create policy compliance_write on public.compliance_submissions for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception}'));

create policy outbox_select on public.outbox_events for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'));
revoke insert, update, delete on public.outbox_events from authenticated;

create trigger maintenance_audit after insert or update on public.maintenance_tickets
  for each row execute function private.audit_trigger();
create trigger compliance_audit after insert or update on public.compliance_submissions
  for each row execute function private.audit_trigger();
