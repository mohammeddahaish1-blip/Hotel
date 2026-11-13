-- Live alerts: the browser hears about housekeeping changes (row level security still applies),
-- so "unit ready" reaches reception without reloading the page.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hk_tasks') then
    alter publication supabase_realtime add table public.hk_tasks;
  end if;
end $$;
