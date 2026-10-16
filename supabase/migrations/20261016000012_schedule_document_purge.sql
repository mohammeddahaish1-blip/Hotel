-- =====================================================================
-- 0012 — Daily purge of expired ID/passport images (NFR-04, CR-08).
-- Calls the purge-guest-documents Edge Function at 01:15 Asia/Muscat.
-- The bearer is the project's public anon JWT (needed only to pass the
-- function's JWT check); the function itself uses the service role.
-- Skipped where pg_cron / pg_net are unavailable (local tests).
-- =====================================================================
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_net;
    perform cron.schedule(
      'purge-guest-documents',
      '15 21 * * *',
      $job$
        select net.http_post(
          url := 'https://isijnklsskwbdbmmertk.supabase.co/functions/v1/purge-guest-documents',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzaWpua2xzc2t3YmRibW1lcnRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5OTI5MTcsImV4cCI6MjEwNzU2ODkxN30.FagwuFNrbAizDb-izx0IaUg9mMY4b0thtSSJvMIlRaM'),
          body := '{}'::jsonb)
      $job$);
  end if;
end $outer$;
