-- =====================================================================
-- 0007 — Staff invitations, bulk unit creation, scheduled jobs
-- =====================================================================

-- Owner/manager invites an email with a role; the employee signs up with
-- that email and is attached on first sign-in (no service key needed).
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  role public.app_role not null,
  full_name text not null default '',
  invited_by uuid default auth.uid(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'));
create policy invitations_write on public.invitations for all to authenticated
  using (private.has_role(tenant_id, '{owner,manager}'))
  with check (
    private.has_role(tenant_id, '{owner}')
    or (private.has_role(tenant_id, '{manager}') and role not in ('owner', 'manager')));
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function private.audit_trigger();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_trigger();

create or replace function public.accept_invitations()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  v_count int;
begin
  if v_uid is null or v_email = '' then return 0; end if;
  -- Only confirmed emails may claim an invitation
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return 0;
  end if;
  insert into public.memberships(tenant_id, user_id, role, full_name)
  select i.tenant_id, v_uid, i.role, i.full_name
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  update public.invitations set accepted_at = now()
   where lower(email) = v_email and accepted_at is null;
  return v_count;
end $$;

-- FR-01: create many units at once ("101-120, 201-220")
create or replace function public.bulk_create_units(
  p_property uuid, p_unit_type uuid, p_floor uuid, p_spec text
) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  part text;
  a int;
  b int;
  n int;
  v_count int := 0;
begin
  select tenant_id into v_tenant from public.properties where id = p_property;
  if v_tenant is null or not private.has_role(v_tenant, '{owner,manager}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if not exists (select 1 from public.unit_types where id = p_unit_type and property_id = p_property) then
    raise exception 'NOT_FOUND: unit type';
  end if;
  foreach part in array string_to_array(replace(p_spec, ' ', ''), ',') loop
    continue when part = '';
    if part ~ '^\d+-\d+$' then
      a := split_part(part, '-', 1)::int;
      b := split_part(part, '-', 2)::int;
      if b < a or b - a > 500 then raise exception 'INVALID_RANGE: %', part; end if;
      for n in a..b loop
        insert into public.units(tenant_id, property_id, floor_id, unit_type_id, number)
          values (v_tenant, p_property, p_floor, p_unit_type, n::text)
          on conflict (property_id, number) do nothing;
        if found then v_count := v_count + 1; end if;
      end loop;
    else
      insert into public.units(tenant_id, property_id, floor_id, unit_type_id, number)
        values (v_tenant, p_property, p_floor, p_unit_type, part)
        on conflict (property_id, number) do nothing;
      if found then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end $$;

revoke execute on function public.accept_invitations() from public, anon;
revoke execute on function public.bulk_create_units(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.accept_invitations() to authenticated;
grant execute on function public.bulk_create_units(uuid, uuid, uuid, text) to authenticated;
