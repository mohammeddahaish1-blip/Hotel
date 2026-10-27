-- =====================================================================
-- 0024 — Private bucket for full data exports (Excel + documents ZIP).
-- Files are built on the server, stored under <tenant>/ and handed out
-- through a short-lived link (responses are too large to stream directly).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 524288000, array['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
create policy exports_read on storage.objects for select to authenticated
  using (bucket_id = 'exports' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager}'));
create policy exports_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'exports' and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager}'));
