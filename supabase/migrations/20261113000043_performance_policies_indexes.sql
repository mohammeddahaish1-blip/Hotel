-- =====================================================================
-- 0043 — Database performance warnings (Supabase advisor), following the Supabase
-- Postgres best-practices skill (schema-foreign-key-indexes, security-rls-performance).
-- * Index the foreign keys that had no index.
-- * A "FOR ALL" write policy is also checked on every SELECT next to the table's
--   *_select policy ("multiple permissive policies"). Split each into INSERT /
--   UPDATE / DELETE policies with exactly the same conditions and roles.
-- * audit_log had two SELECT policies; they become one with the same meaning.
-- Written against pg_policies so it gives the same result whatever shape the
-- policies have on a given database. Access rules do not change.
-- =====================================================================

create index if not exists invitations_shop_idx on public.invitations(shop_id);
create index if not exists shop_items_tenant_idx on public.shop_items(tenant_id);
create index if not exists shop_sale_lines_tenant_idx on public.shop_sale_lines(tenant_id);

do $$
declare
  p record;
  op text;
  who text;
begin
  for p in
    select tablename, policyname, roles, qual, with_check
      from pg_policies
     where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE'
  loop
    who := (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('create policy %I on public.%I for %s to %s %s %s',
        p.policyname || '_' || op, p.tablename, op, who,
        case when op = 'insert' or p.qual is null then '' else format('using (%s)', p.qual) end,
        case when op = 'delete' or coalesce(p.with_check, p.qual) is null then ''
             else format('with check (%s)', coalesce(p.with_check, p.qual)) end);
    end loop;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- audit_log: managers' read rule OR "my own actions", in one policy
do $$
declare a text; b text;
begin
  select qual into a from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_select';
  select qual into b from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_select_own';
  if a is not null and b is not null then
    execute format('alter policy audit_select on public.audit_log using ((%s) or (%s))', a, b);
    drop policy audit_select_own on public.audit_log;
  end if;
end $$;
