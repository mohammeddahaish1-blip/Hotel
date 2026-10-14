-- =====================================================================
-- 0008 — Daily job: post due rent for long-stay contracts (FR-13)
-- Skipped automatically where pg_cron is unavailable (local tests).
-- =====================================================================
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- 21:05 UTC = 01:05 Asia/Muscat
    perform cron.schedule('post-due-billing', '5 21 * * *', 'select public.post_due_billing()');
  end if;
end $outer$;
