-- Owners' portal: a team with roles and per-section permissions, CEO board (goals, decisions, approvals),
-- security settings, operations (maintenance), marketing pipeline. Additive: the owner (platform_admins) keeps full access.

-- ---------- roles and what each role may do per section
create table public.platform_role_perms (
  role text not null check (role in ('ceo','finance','marketing','it','security','support')),
  section text not null check (section in ('ceo','companies','plans','finance','marketing','it','security','support','team','log')),
  level text not null check (level in ('view','edit')),
  primary key (role, section)
);
insert into public.platform_role_perms (role, section, level) values
 ('ceo','ceo','edit'),('ceo','companies','edit'),('ceo','plans','view'),('ceo','finance','view'),('ceo','marketing','view'),('ceo','it','view'),('ceo','security','view'),('ceo','support','view'),('ceo','team','view'),('ceo','log','view'),
 ('finance','ceo','view'),('finance','companies','view'),('finance','plans','edit'),('finance','finance','edit'),('finance','log','view'),
 ('marketing','companies','view'),('marketing','plans','view'),('marketing','marketing','edit'),
 ('it','it','edit'),('it','support','edit'),('it','security','view'),('it','log','view'),
 ('security','security','edit'),('security','it','view'),('security','companies','view'),('security','team','view'),('security','log','view'),
 ('support','companies','view'),('support','support','edit');

-- ---------- team members (the owner stays in platform_admins)
create table public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  roles text[] not null default '{}' check (roles <@ array['ceo','finance','marketing','it','security','support']::text[]),
  active boolean not null default true,
  require_mfa boolean not null default true,
  invited_by uuid,
  suspended_at timestamptz,
  suspended_by uuid,
  created_at timestamptz not null default now()
);
create table public.platform_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  roles text[] not null check (cardinality(roles) > 0 and roles <@ array['ceo','finance','marketing','it','security','support']::text[]),
  require_mfa boolean not null default true,
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
create table public.platform_security (
  id int primary key default 1 check (id = 1),
  session_hours int not null default 12 check (session_hours between 1 and 168),
  updated_at timestamptz not null default now()
);
insert into public.platform_security (id) values (1);
create table public.platform_ops (
  id int primary key default 1 check (id = 1),
  maintenance_on boolean not null default false,
  maintenance_msg text,
  maint_from timestamptz,
  maint_to timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.platform_ops (id) values (1);

-- ---------- CEO board
create table public.platform_goals (
  month date not null,
  metric text not null check (metric in ('new_paying','mrr','conversion','new_trials')),
  target numeric not null check (target > 0),
  primary key (month, metric)
);
create table public.platform_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 300),
  reason text,
  decided_on date not null default current_date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.platform_approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('discount','expense')),
  title text not null,
  detail text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null default auth.uid(),
  requested_by_email text,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  note text
);
alter table public.platform_settings add column if not exists discount_limit int not null default 20 check (discount_limit between 0 and 100),
  add column if not exists expense_limit bigint not null default 50000 check (expense_limit >= 0);

-- ---------- marketing
alter table public.trial_requests add column if not exists stage text not null default 'new' check (stage in ('new','contacted','demo','trial','won','lost')),
  add column if not exists source text check (source in ('instagram','referral','search','direct','other')),
  add column if not exists lost_reason text,
  add column if not exists stage_at timestamptz;
update public.trial_requests set stage = 'contacted', stage_at = handled_at where handled_at is not null and stage = 'new';
alter table public.platform_expenses add column if not exists category text not null default 'other' check (category in ('marketing','tech','salaries','other'));

-- ---------- who may do what
create or replace function private.is_platform_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
-- a team member counts only while active, with two-step verification when required, and within the session time limit
create or replace function private.staff_ok() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_staff s
    where s.user_id = auth.uid() and s.active and cardinality(s.roles) > 0
      and (not s.require_mfa or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
      and exists (
        select 1 from auth.sessions se
        where se.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and se.user_id = auth.uid()
          and se.created_at > now() - make_interval(hours => (select session_hours from public.platform_security where id = 1))))
$$;
create or replace function private.platform_can(p_sections text[], p_need text) returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_owner() or (private.staff_ok() and exists (
    select 1 from public.platform_staff s join public.platform_role_perms p on p.role = any (s.roles)
    where s.user_id = auth.uid() and p.section = any (p_sections) and (p_need = 'view' or p.level = 'edit')))
$$;

-- every existing check that meant "the owner" now asks for the right section
do $$
declare f record; def text; rep text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname like 'admin\_%' and pg_get_functiondef(p.oid) like '%private.is_platform_admin()%'
  loop
    rep := case
      when f.proname = 'admin_overview' then $r$private.platform_can(array['companies','finance','ceo','marketing'],'view')$r$
      when f.proname = 'admin_tenant' then $r$private.platform_can(array['companies','finance','support'],'view')$r$
      when f.proname = 'admin_set_subscription' then $r$private.platform_can(array['companies'],'edit')$r$
      when f.proname in ('admin_record_payment','admin_void_payment') then $r$private.platform_can(array['finance'],'edit')$r$
      when f.proname in ('admin_save_plan','admin_save_plan_prices') then $r$private.platform_can(array['plans'],'edit')$r$
      when f.proname = 'admin_support_list' then $r$private.platform_can(array['support','it'],'view')$r$
      when f.proname in ('admin_start_session','admin_end_session','admin_complete_request','admin_request_access','admin_create_maintenance') then $r$private.platform_can(array['support','it'],'edit')$r$
      else null end;
    if rep is null then raise exception 'unmapped admin function %', f.proname; end if;
    def := replace(pg_get_functiondef(f.oid), 'private.is_platform_admin()', rep);
    execute def;
  end loop;
end $$;

do $$
declare p record; rep text; q text; c text;
begin
  for p in select * from pg_policies where schemaname = 'public' and (qual like '%is_platform_admin%' or with_check like '%is_platform_admin%')
  loop
    rep := case
      when p.tablename = 'admin_log' and p.cmd = 'INSERT' then null
      when p.tablename = 'admin_log' then $r$private.platform_can(array['log'],'view')$r$
      when p.tablename in ('admin_prospects','trial_requests') then $r$private.platform_can(array['companies','marketing'],'edit')$r$
      when p.tablename in ('plans','plan_prices') then $r$private.platform_can(array['plans'],'edit')$r$
      when p.tablename = 'platform_expenses' then $r$private.platform_can(array['finance'],'edit')$r$
      when p.tablename = 'platform_settings' and p.cmd = 'SELECT' then null
      when p.tablename = 'platform_settings' then $r$private.platform_can(array['finance'],'edit')$r$
      when p.tablename = 'subscription_payments' then $r$private.platform_can(array['finance','companies'],'view')$r$
      when p.tablename = 'subscriptions' and p.cmd = 'SELECT' then $r$private.platform_can(array['companies','finance','ceo','marketing'],'view')$r$
      when p.tablename = 'subscriptions' then $r$private.platform_can(array['companies'],'edit')$r$
      when p.tablename in ('support_requests','support_sessions') then $r$private.platform_can(array['support','it'],'view')$r$
      else 'UNMAPPED' end;
    if rep = 'UNMAPPED' then raise exception 'unmapped policy %.%', p.tablename, p.policyname; end if;
    if rep is null then continue; end if;
    q := replace(p.qual, 'private.is_platform_admin()', rep);
    c := replace(p.with_check, 'private.is_platform_admin()', rep);
    execute format('alter policy %I on public.%I', p.policyname, p.tablename)
      || coalesce(' using (' || q || ')', '') || coalesce(' with check (' || c || ')', '');
  end loop;
end $$;
create policy platform_expenses_view on public.platform_expenses for select to authenticated using (private.platform_can(array['finance','ceo'],'view'));
create policy trial_requests_view on public.trial_requests for select to authenticated using (private.platform_can(array['marketing','companies','ceo'],'view'));

-- "is a portal member" (owner, or a team member in good standing)
create or replace function private.is_platform_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_platform_owner() or private.staff_ok()
$$;

-- ---------- row security for the new tables
alter table public.platform_role_perms enable row level security;
alter table public.platform_staff enable row level security;
alter table public.platform_invites enable row level security;
alter table public.platform_security enable row level security;
alter table public.platform_ops enable row level security;
alter table public.platform_goals enable row level security;
alter table public.platform_decisions enable row level security;
alter table public.platform_approvals enable row level security;
create policy role_perms_read on public.platform_role_perms for select to authenticated using (private.is_platform_admin());
create policy role_perms_owner on public.platform_role_perms for all to authenticated using (private.is_platform_owner()) with check (private.is_platform_owner());
create policy staff_read on public.platform_staff for select to authenticated using (user_id = auth.uid() or private.platform_can(array['team','security'],'view'));
create policy invites_read on public.platform_invites for select to authenticated using (private.platform_can(array['team'],'view'));
create policy security_read on public.platform_security for select to authenticated using (private.is_platform_admin());
create policy ops_read on public.platform_ops for select to authenticated using (true);
create policy goals_read on public.platform_goals for select to authenticated using (private.platform_can(array['ceo'],'view'));
create policy goals_write on public.platform_goals for all to authenticated using (private.platform_can(array['ceo'],'edit')) with check (private.platform_can(array['ceo'],'edit'));
create policy decisions_read on public.platform_decisions for select to authenticated using (private.platform_can(array['ceo'],'view'));
create policy decisions_insert on public.platform_decisions for insert to authenticated with check (private.platform_can(array['ceo'],'edit') and created_by = auth.uid());
create policy decisions_delete on public.platform_decisions for delete to authenticated using (private.platform_can(array['ceo'],'edit'));
create policy approvals_read on public.platform_approvals for select to authenticated using (requested_by = auth.uid() or private.platform_can(array['ceo'],'view'));
create policy approvals_insert on public.platform_approvals for insert to authenticated with check (private.is_platform_admin() and requested_by = auth.uid() and status = 'pending');
grant select on public.platform_ops to anon;
create policy ops_read_anon on public.platform_ops for select to anon using (true);

-- ---------- approvals: big discounts and big expenses need the CEO (or the owner)
create or replace function private.approval_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare lim int; elim bigint; list bigint; monthly bigint;
begin
  if not private.is_platform_admin() or private.is_platform_owner() or private.platform_can(array['ceo'],'edit')
     or coalesce(current_setting('nuzul.approved', true), '') = '1' then return new; end if;
  select discount_limit, expense_limit into lim, elim from public.platform_settings where id = 1;
  if tg_table_name = 'subscriptions' then
    if new.price_override is null or new.price_override is not distinct from (case when tg_op = 'UPDATE' then old.price_override end) then return new; end if;
    select case when new.billing_period = 'year' then pp.yearly else pp.monthly end into list
      from public.plan_prices pp where pp.plan_code = new.plan_code and pp.currency = new.currency;
    if list is not null and list > 0 and (list - new.price_override) * 100 > list * lim then raise exception 'needs_approval'; end if;
  else
    monthly := case new.recurrence when 'year' then new.amount / 12 else new.amount end;
    if monthly > elim then raise exception 'needs_approval'; end if;
  end if;
  return new;
end $$;
create trigger subscriptions_approval before insert or update on public.subscriptions for each row execute function private.approval_check();
create trigger platform_expenses_approval before insert on public.platform_expenses for each row execute function private.approval_check();

create or replace function public.admin_decide_approval(p_id uuid, p_ok boolean, p_note text default null) returns void language plpgsql security definer set search_path = '' as $$
declare a public.platform_approvals; j jsonb;
begin
  if not private.platform_can(array['ceo'],'edit') then raise exception 'not allowed'; end if;
  select * into a from public.platform_approvals where id = p_id and status = 'pending' for update;
  if not found then raise exception 'not found'; end if;
  if p_ok then
    perform set_config('nuzul.approved', '1', true);
    j := a.payload;
    if a.kind = 'discount' then
      perform public.admin_set_subscription((j->>'p_tenant')::uuid, j->>'p_plan', j->>'p_status', nullif(j->>'p_period_end','')::date,
        nullif(j->>'p_trial_ends','')::date, nullif(j->>'p_price_override','')::bigint, j->>'p_notes', j->>'p_billing', j->>'p_currency');
    else
      insert into public.platform_expenses (name, vendor, amount, recurrence, started_on, notes, category, created_by)
      values (j->>'name', nullif(j->>'vendor',''), (j->>'amount')::bigint, j->>'recurrence', coalesce(nullif(j->>'started_on','')::date, current_date),
              nullif(j->>'notes',''), coalesce(nullif(j->>'category',''),'other'), a.requested_by);
    end if;
    perform set_config('nuzul.approved', '', true);
  end if;
  update public.platform_approvals set status = case when p_ok then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), note = nullif(p_note,'') where id = p_id;
  insert into public.admin_log (actor, actor_email, action, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), case when p_ok then 'approval_ok' else 'approval_no' end, a.title);
end $$;

-- ---------- what the signed-in person may see (drives the menu)
create or replace function public.portal_me() returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.platform_staff where user_id = auth.uid()),
  perms as (
    select p.section, max(case p.level when 'edit' then 2 else 1 end) lv
    from s join public.platform_role_perms p on p.role = any (s.roles) group by p.section)
  select jsonb_build_object(
    'owner', private.is_platform_owner(),
    'staff', exists (select 1 from s),
    'active', coalesce((select active from s), false),
    'ok', private.is_platform_admin(),
    'roles', coalesce((select to_jsonb(roles) from s), '[]'::jsonb),
    'mfa_needed', coalesce((select require_mfa from s), false) and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2',
    'perms', case when private.is_platform_owner()
      then (select jsonb_object_agg(x, 'edit') from unnest(array['ceo','companies','plans','finance','marketing','it','security','support','team','log']) x)
      else coalesce((select jsonb_object_agg(section, case lv when 2 then 'edit' else 'view' end) from perms), '{}'::jsonb) end)
$$;

-- ---------- team management
create or replace function public.admin_team() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.platform_can(array['team','security'],'view') then null else jsonb_build_object(
    'members', coalesce((select jsonb_agg(m order by m->>'owner' desc, m->>'since') from (
      select jsonb_build_object('user_id', u.id, 'email', u.email, 'name', coalesce(st.display_name, u.raw_user_meta_data ->> 'full_name'),
        'owner', pa.user_id is not null, 'roles', coalesce(to_jsonb(st.roles), '[]'::jsonb), 'active', coalesce(st.active, true),
        'require_mfa', coalesce(st.require_mfa, false), 'last_sign_in', u.last_sign_in_at, 'since', coalesce(st.created_at, pa.created_at),
        'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
        'sessions', (select count(*) from auth.sessions se where se.user_id = u.id)) m
      from auth.users u left join public.platform_admins pa on pa.user_id = u.id left join public.platform_staff st on st.user_id = u.id
      where pa.user_id is not null or st.user_id is not null) t), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'roles', roles, 'expires_at', expires_at) order by created_at desc)
      from public.platform_invites where accepted_at is null and revoked_at is null and expires_at > now()), '[]'::jsonb)) end
$$;

create or replace function public.admin_invite_staff(p_email text, p_roles text[], p_require_mfa boolean default true) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); e text := lower(trim(p_email));
begin
  if not private.is_platform_owner() then raise exception 'not allowed'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad email'; end if;
  if exists (select 1 from public.platform_admins pa join auth.users u on u.id = pa.user_id where lower(u.email) = e) then raise exception 'already owner'; end if;
  update public.platform_invites set revoked_at = now() where lower(email) = e and accepted_at is null and revoked_at is null;
  insert into public.platform_invites (email, roles, require_mfa, token_hash, created_by)
  values (e, p_roles, coalesce(p_require_mfa, true), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), auth.uid());
  insert into public.admin_log (actor, actor_email, action, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'staff_invite', e || ' · ' || array_to_string(p_roles, '، '));
  return tok;
end $$;

create or replace function public.accept_platform_invite(p_token text) returns text language plpgsql security definer set search_path = '' as $$
declare i public.platform_invites; me text;
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  select * into i from public.platform_invites where token_hash = encode(sha256(convert_to(coalesce(p_token,''), 'UTF8')), 'hex') for update;
  if not found or i.revoked_at is not null then return 'invalid'; end if;
  if i.accepted_at is not null then return case when i.accepted_by = auth.uid() then 'ok' else 'used' end; end if;
  if i.expires_at < now() then return 'expired'; end if;
  select lower(email) into me from auth.users where id = auth.uid();
  if me is distinct from lower(i.email) then return 'wrong_email'; end if;
  insert into public.platform_staff (user_id, roles, require_mfa, invited_by) values (auth.uid(), i.roles, i.require_mfa, i.created_by)
  on conflict (user_id) do update set roles = excluded.roles, require_mfa = excluded.require_mfa, active = true, suspended_at = null, suspended_by = null;
  update public.platform_invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  insert into public.admin_log (actor, actor_email, action, detail) values (auth.uid(), me, 'staff_join', array_to_string(i.roles, '، '));
  return 'ok';
end $$;

create or replace function public.admin_set_staff(p_user uuid, p_roles text[], p_require_mfa boolean, p_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_owner() then raise exception 'not allowed'; end if;
  update public.platform_staff set roles = p_roles, require_mfa = coalesce(p_require_mfa, require_mfa), display_name = coalesce(nullif(trim(p_name), ''), display_name) where user_id = p_user;
  if not found then raise exception 'not found'; end if;
  insert into public.admin_log (actor, actor_email, action, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'staff_roles', (select email from auth.users where id = p_user) || ' · ' || array_to_string(p_roles, '، '));
end $$;

-- the owner, or security, can stop a member at once (never the owner); their sessions end too
create or replace function public.admin_suspend_staff(p_user uuid, p_active boolean) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_platform_owner() or private.platform_can(array['security'],'edit')) then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'not yourself'; end if;
  update public.platform_staff set active = p_active, suspended_at = case when p_active then null else now() end, suspended_by = case when p_active then null else auth.uid() end where user_id = p_user;
  if not found then raise exception 'not found'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;
  insert into public.admin_log (actor, actor_email, action, detail)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), case when p_active then 'staff_resume' else 'staff_suspend' end, (select email from auth.users where id = p_user));
end $$;

create or replace function public.admin_remove_staff(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_owner() then raise exception 'not allowed'; end if;
  insert into public.admin_log (actor, actor_email, action, detail) values (auth.uid(), (select email from auth.users where id = auth.uid()), 'staff_remove', (select email from auth.users where id = p_user));
  delete from public.platform_staff where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
end $$;

create or replace function public.admin_revoke_invite(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_owner() then raise exception 'not allowed'; end if;
  update public.platform_invites set revoked_at = now() where id = p_id and accepted_at is null;
end $$;

-- ---------- security
create or replace function public.admin_sessions() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.platform_can(array['security'],'view') then null else coalesce((
    select jsonb_agg(jsonb_build_object('id', se.id, 'user_id', se.user_id, 'email', u.email, 'name', coalesce(st.display_name, u.raw_user_meta_data ->> 'full_name'),
      'owner', pa.user_id is not null, 'user_agent', se.user_agent, 'ip', host(se.ip), 'created_at', se.created_at, 'last', coalesce(se.refreshed_at::timestamptz, se.updated_at),
      'aal', se.aal::text, 'current', se.id = nullif(auth.jwt() ->> 'session_id', '')::uuid) order by coalesce(se.refreshed_at::timestamptz, se.updated_at) desc)
    from auth.sessions se join auth.users u on u.id = se.user_id
    left join public.platform_admins pa on pa.user_id = se.user_id left join public.platform_staff st on st.user_id = se.user_id
    where pa.user_id is not null or st.user_id is not null), '[]'::jsonb) end
$$;

create or replace function public.admin_kill_session(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not private.platform_can(array['security'],'edit') then raise exception 'not allowed'; end if;
  select user_id into uid from auth.sessions where id = p_id;
  if uid is null then return; end if;
  if not exists (select 1 from public.platform_staff where user_id = uid) and not exists (select 1 from public.platform_admins where user_id = uid) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.platform_admins where user_id = uid) and uid <> auth.uid() then raise exception 'owner'; end if;
  delete from auth.sessions where id = p_id;
  insert into public.admin_log (actor, actor_email, action, detail) values (auth.uid(), (select email from auth.users where id = auth.uid()), 'session_end', (select email from auth.users where id = uid));
end $$;

create or replace function public.admin_save_security(p_session_hours int) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.platform_can(array['security'],'edit') then raise exception 'not allowed'; end if;
  update public.platform_security set session_hours = p_session_hours, updated_at = now() where id = 1;
  insert into public.admin_log (actor, actor_email, action, detail) values (auth.uid(), (select email from auth.users where id = auth.uid()), 'security', 'مدة الجلسة ' || p_session_hours || ' ساعة');
end $$;

-- ---------- operations
create or replace function public.admin_save_ops(p_on boolean, p_msg text, p_from timestamptz, p_to timestamptz) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.platform_can(array['it'],'edit') then raise exception 'not allowed'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'bad times'; end if;
  update public.platform_ops set maintenance_on = coalesce(p_on, false), maintenance_msg = nullif(trim(p_msg), ''), maint_from = p_from, maint_to = p_to, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.admin_log (actor, actor_email, action, detail) values (auth.uid(), (select email from auth.users where id = auth.uid()), 'maintenance', case when p_on then 'تشغيل' else 'جدولة/إيقاف' end);
end $$;

create or replace function public.admin_platform_stats() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.platform_can(array['it'],'view') then null else jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'files_bytes', coalesce((select sum(coalesce((metadata ->> 'size')::bigint, 0)) from storage.objects), 0),
    'files', (select count(*) from storage.objects),
    'tenants', (select count(*) from public.tenants),
    'active_today', (select count(distinct tenant_id) from public.audit_log where at > now() - interval '24 hours'),
    'active_week', (select count(distinct tenant_id) from public.audit_log where at > now() - interval '7 days')) end
$$;

-- ---------- grants
revoke all on function public.admin_decide_approval(uuid, boolean, text), public.portal_me(), public.admin_team(), public.admin_invite_staff(text, text[], boolean),
  public.accept_platform_invite(text), public.admin_set_staff(uuid, text[], boolean, text), public.admin_suspend_staff(uuid, boolean), public.admin_remove_staff(uuid),
  public.admin_revoke_invite(uuid), public.admin_sessions(), public.admin_kill_session(uuid), public.admin_save_security(int),
  public.admin_save_ops(boolean, text, timestamptz, timestamptz), public.admin_platform_stats() from public, anon;
grant execute on function public.admin_decide_approval(uuid, boolean, text), public.portal_me(), public.admin_team(), public.admin_invite_staff(text, text[], boolean),
  public.accept_platform_invite(text), public.admin_set_staff(uuid, text[], boolean, text), public.admin_suspend_staff(uuid, boolean), public.admin_remove_staff(uuid),
  public.admin_revoke_invite(uuid), public.admin_sessions(), public.admin_kill_session(uuid), public.admin_save_security(int),
  public.admin_save_ops(boolean, text, timestamptz, timestamptz), public.admin_platform_stats() to authenticated;
grant select on public.platform_role_perms, public.platform_staff, public.platform_invites, public.platform_security, public.platform_ops,
  public.platform_goals, public.platform_decisions, public.platform_approvals to authenticated;
grant insert, update, delete on public.platform_goals, public.platform_decisions to authenticated;
grant insert on public.platform_approvals to authenticated;
grant insert, update, delete on public.platform_role_perms to authenticated;
