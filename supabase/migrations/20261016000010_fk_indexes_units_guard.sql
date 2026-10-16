-- =====================================================================
-- 0010 — Index every foreign key (Supabase advisor) and restrict
-- non-managers to changing a unit's status only.
-- =====================================================================
-- Non-managers may only change the status column
create or replace function private.units_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not private.has_role(new.tenant_id, '{owner,manager}')
     and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'FORBIDDEN: only managers can edit unit details';
  end if;
  return new;
end $$;
create trigger units_guard before update on public.units
  for each row execute function private.units_guard();


do $$
declare
  fk record;
begin
  for fk in
    select c.conrelid::regclass as tbl, c.conname, a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
  loop
    execute format('create index if not exists %I on %s (%I)', fk.conname || '_idx', fk.tbl, fk.attname);
  end loop;
end $$;
