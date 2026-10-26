-- =====================================================================
-- 0020 — Property photos for the Properties section.
-- Files live in a private bucket under <tenant>/<property>/<file>.
-- =====================================================================

alter table public.properties add column photo_path text check (char_length(photo_path) <= 300);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy property_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'property-photos'
    and ((storage.foldername(name))[1])::uuid in (select private.user_tenant_ids()));
create policy property_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager}'));
