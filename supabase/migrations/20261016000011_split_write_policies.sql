-- =====================================================================
-- 0011 — "FOR ALL" write policies were also evaluated on every SELECT
-- next to the dedicated *_select policy (Supabase advisor). Split them
-- into INSERT / UPDATE / DELETE policies with identical conditions.
-- =====================================================================
do $$
declare
  p record;
  op text;
begin
  for p in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public' and pg_policies.cmd = 'ALL' and policyname like '%\_write'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format(
        'create policy %I on public.%I for %s to authenticated %s %s',
        p.policyname || '_' || op, p.tablename, op,
        case when op = 'insert' then '' else format('using (%s)', p.qual) end,
        case when op = 'delete' then '' else format('with check (%s)', coalesce(p.with_check, p.qual)) end);
    end loop;
  end loop;
end $$;

-- units: housekeeping/maintenance status updates merged into the update policy
drop policy if exists units_status_ops on public.units;
drop policy if exists units_write_update on public.units;
create policy units_write_update on public.units for update to authenticated
  using (private.has_role(tenant_id, '{owner,manager,reception,housekeeping,maintenance}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,housekeeping,maintenance}'));
