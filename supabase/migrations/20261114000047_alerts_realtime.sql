-- Live alerts for every event-driven notice: the tables behind them join the realtime publication.
-- Row level security still decides who hears about which row.
do $$
declare t text;
begin
  foreach t in array array['maintenance_tickets', 'feedback', 'payment_links', 'correction_requests', 'cheques', 'channel_blocks', 'ical_feeds', 'staff_complaints', 'staff_notices'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
