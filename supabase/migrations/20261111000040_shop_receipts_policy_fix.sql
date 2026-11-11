-- 0040 — The upload rule for shop invoice photos compared the shop's own name column instead of the
-- file path (both are called "name"), so cashiers' uploads were refused. Refer to the file path explicitly.
-- (Fresh databases get the corrected rule from 0039 already; this brings existing ones in line.)
alter policy shop_receipts_files_insert on storage.objects
  with check (bucket_id = 'shop-receipts'
    and private.shop_access(((storage.foldername(objects.name))[2])::uuid) in ('admin', 'manager')
    and exists (select 1 from public.shops s
                 where s.id = ((storage.foldername(objects.name))[2])::uuid
                   and s.tenant_id = ((storage.foldername(objects.name))[1])::uuid));
