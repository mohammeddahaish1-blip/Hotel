-- =====================================================================
-- 0013 — Per-employee permissions controlled by the owner.
--
-- memberships.permissions = NULL  → the role's default areas (as before)
-- memberships.permissions = {...} → exactly these areas, set by the owner
--
-- Each area implies the database rights of the role that natively owns it
-- (private.area_role). When an owner customises a member, has_role() uses
-- ONLY the implied roles of the granted areas, so revoking an area is
-- enforced by RLS and RPCs, not just hidden in the UI. Owners are never
-- customised.
-- =====================================================================

alter table public.memberships add column permissions text[];

alter table public.memberships add constraint memberships_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit']::text[]);

create or replace function private.area_role(p_area text)
returns public.app_role
language sql immutable set search_path = ''
as $$
  select case p_area
    when 'dashboard'    then 'accountant'
    when 'calendar'     then 'reception'
    when 'reservations' then 'reception'
    when 'guests'       then 'reception'
    when 'compliance'   then 'reception'
    when 'housekeeping' then 'housekeeping'
    when 'maintenance'  then 'maintenance'
    when 'finance'      then 'accountant'
    when 'reports'      then 'accountant'
    when 'audit'        then 'accountant'
    when 'settings'     then 'manager'
    else null           -- 'board' needs no extra rights
  end::public.app_role
$$;

create or replace function private.has_role(p_tenant uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
     where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant and m.active
       and (
         ((m.permissions is null or m.role = 'owner') and m.role = any (p_roles))
         or (m.permissions is not null and m.role <> 'owner'
             and exists (select 1 from unnest(m.permissions) a where private.area_role(a) = any (p_roles)))
       )
  )
$$;

-- Only the owner may customise permissions, and never on an owner row.
create or replace function private.memberships_permissions_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.permissions is distinct from (case when tg_op = 'UPDATE' then old.permissions end) then
    if new.role = 'owner' and new.permissions is not null then
      raise exception 'FORBIDDEN: owner permissions cannot be restricted';
    end if;
    if auth.uid() is not null and not exists (
         select 1 from public.memberships
          where user_id = auth.uid() and tenant_id = new.tenant_id and role = 'owner' and active) then
      raise exception 'FORBIDDEN: only the owner can change permissions';
    end if;
  end if;
  return new;
end $$;

create trigger memberships_permissions_guard before insert or update on public.memberships
  for each row execute function private.memberships_permissions_guard();
