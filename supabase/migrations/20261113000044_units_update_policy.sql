-- =====================================================================
-- 0044 — units: one UPDATE policy (the last "multiple permissive policies" warning).
-- Production still had units_status_ops (reception / housekeeping / maintenance) beside
-- units_write_update (owner / manager); migration 0011 had merged them in the repository.
-- Same people may update rooms as before.
-- =====================================================================
alter policy units_write_update on public.units
  using (private.has_role(tenant_id, '{owner,manager,reception,housekeeping,maintenance}'))
  with check (private.has_role(tenant_id, '{owner,manager,reception,housekeeping,maintenance}'));
drop policy if exists units_status_ops on public.units;
