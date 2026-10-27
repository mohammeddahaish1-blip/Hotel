-- Point the nightly jobs at the new Supabase project after a move.
-- Migration 0012 hard-codes the old project's address for the ID-photo purge.
-- Usage: psql "$TARGET_DB_URL" -v project_url=https://<new-project-url> -v anon_key=<anon JWT> -f infra/sql/reschedule-jobs.sql
\set ON_ERROR_STOP 1
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 21:05 UTC = 01:05 Asia/Muscat: post due rent for monthly contracts
select cron.schedule('post-due-billing', '5 21 * * *', 'select public.post_due_billing()');

-- 21:15 UTC = 01:15 Asia/Muscat: delete ID/passport images past their retention period
select cron.schedule('purge-guest-documents', '15 21 * * *', format($job$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', %L),
    body := '{}'::jsonb)
$job$, :'project_url' || '/functions/v1/purge-guest-documents', 'Bearer ' || :'anon_key'));

select jobname, schedule from cron.job order by jobname;
