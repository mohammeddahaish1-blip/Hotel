-- =====================================================================
-- 0014 — Free-text job titles, and invitations that carry the owner's
-- chosen sections, so the owner never has to pick from a fixed role list.
-- =====================================================================

alter table public.memberships add column job_title text;

alter table public.invitations add column job_title text;
alter table public.invitations add column permissions text[];
alter table public.invitations add constraint invitations_permissions_valid check (
  permissions is null or permissions <@ array[
    'dashboard', 'board', 'calendar', 'reservations', 'guests', 'housekeeping',
    'maintenance', 'finance', 'reports', 'compliance', 'settings', 'audit']::text[]);

-- Only the owner may pre-set sections on an invitation (same rule as memberships)
create or replace function private.invitations_permissions_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.permissions is not null
     and new.permissions is distinct from (case when tg_op = 'UPDATE' then old.permissions end)
     and auth.uid() is not null and not exists (
       select 1 from public.memberships
        where user_id = auth.uid() and tenant_id = new.tenant_id and role = 'owner' and active) then
    raise exception 'FORBIDDEN: only the owner can set permissions';
  end if;
  return new;
end $$;
create trigger invitations_permissions_guard before insert or update on public.invitations
  for each row execute function private.invitations_permissions_guard();

-- The membership guard lets accept_invitations() copy owner-approved sections.
create or replace function private.memberships_permissions_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.permissions is distinct from (case when tg_op = 'UPDATE' then old.permissions end) then
    if new.role = 'owner' and new.permissions is not null then
      raise exception 'FORBIDDEN: owner permissions cannot be restricted';
    end if;
    if coalesce(current_setting('app.accepting_invite', true), '') <> 'on'
       and auth.uid() is not null and not exists (
         select 1 from public.memberships
          where user_id = auth.uid() and tenant_id = new.tenant_id and role = 'owner' and active) then
      raise exception 'FORBIDDEN: only the owner can change permissions';
    end if;
  end if;
  return new;
end $$;

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
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    return 0;
  end if;
  -- sections on an invitation were set by the owner (enforced by invitations_permissions_guard)
  perform set_config('app.accepting_invite', 'on', true);
  insert into public.memberships(tenant_id, user_id, role, full_name, job_title, permissions)
  select i.tenant_id, v_uid, i.role, i.full_name, i.job_title, i.permissions
    from public.invitations i
   where lower(i.email) = v_email and i.accepted_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  perform set_config('app.accepting_invite', 'off', true);
  update public.invitations set accepted_at = now()
   where lower(email) = v_email and accepted_at is null;
  return v_count;
end $$;

revoke execute on function public.accept_invitations() from public, anon;
grant execute on function public.accept_invitations() to authenticated;
