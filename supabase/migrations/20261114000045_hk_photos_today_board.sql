-- Housekeeping proof photo + undo, a lighter "today" board, and a 7-day income line.
-- Additive only: one nullable column, one private bucket, four new functions.

-- ---------------------------------------------------------------------
-- Photo taken when a unit is marked ready (shown to the owner and managers)
-- ---------------------------------------------------------------------
alter table public.hk_tasks add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hk-photos', 'hk-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy hk_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'hk-photos'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager}'));
create policy hk_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hk-photos'
    and private.has_role(((storage.foldername(name))[1])::uuid, '{owner,manager,reception,housekeeping}'));

-- "Ready" with an optional photo: stores the photo, then runs the usual status change.
create or replace function public.finish_hk_task(p_task uuid, p_photo text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  select * into t from public.hk_tasks where id = p_task for update;
  if not found or not private.has_role(t.tenant_id, '{owner,manager,reception,housekeeping}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if p_photo is not null then
    -- photos live under <tenant>/…; never accept another tenant's file
    if split_part(p_photo, '/', 1) <> t.tenant_id::text then
      raise exception 'FORBIDDEN: not allowed';
    end if;
    update public.hk_tasks set photo_path = p_photo where id = p_task;
  end if;
  perform public.set_hk_task_status(p_task, 'done');
end $$;

-- Undo a "Ready" pressed by mistake, within 30 minutes: the task is being cleaned again
-- and the unit goes back to "needs cleaning" if nothing else changed it meanwhile.
create or replace function public.reopen_hk_task(p_task uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  select * into t from public.hk_tasks where id = p_task for update;
  if not found or not private.has_role(t.tenant_id, '{owner,manager,reception,housekeeping}') then
    raise exception 'FORBIDDEN: not allowed';
  end if;
  if t.status <> 'done' or t.finished_at is null or t.finished_at < now() - interval '30 minutes' then
    raise exception 'INVALID_STATUS: reopen';
  end if;
  update public.hk_tasks set status = 'in_progress', finished_at = null, finished_by = null where id = p_task;
  update public.units set status = 'dirty' where id = t.unit_id and status = 'available';
end $$;

-- ---------------------------------------------------------------------
-- Today board: only the reservations that start within 7 days or end within 30
-- (the page used to load every open reservation). Row level security applies.
-- ---------------------------------------------------------------------
create or replace function public.today_board_rows(p_property uuid, p_today date)
returns table (id uuid, code text, stay_from date, stay_to date, kind text, status text, unit text, guest text)
language sql stable set search_path = ''
as $$
  select r.id, r.code::text, lower(r.stay), upper(r.stay), r.kind::text, r.status::text, u.number::text, g.full_name::text
    from public.reservations r
    left join public.units u on u.id = r.unit_id
    left join public.guests g on g.id = r.guest_id
   where r.property_id = p_property
     and r.status in ('tentative', 'confirmed', 'checked_in')
     and (lower(r.stay) between p_today and p_today + 7 or upper(r.stay) between p_today and p_today + 30)
   limit 1000;
$$;

-- ---------------------------------------------------------------------
-- Income per day for the last days (payments minus refunds, as on the dashboard)
-- ---------------------------------------------------------------------
create or replace function public.income_last_days(p_property uuid, p_days int default 7)
returns table (day date, amount bigint)
language sql stable set search_path = ''
as $$
  with z as (select timezone as tz, private.property_today(p_property) as today from public.properties where id = p_property),
  d as (select (z.today - n)::date as day, z.tz from z, generate_series(0, least(greatest(p_days, 1), 31) - 1) n)
  select d.day,
         coalesce(sum(case when p.kind = 'payment' then p.amount when p.kind = 'refund' then -p.amount else 0 end), 0)::bigint
    from d
    left join (public.payments p join public.folios fo on fo.id = p.folio_id and fo.property_id = p_property)
      on p.voided_at is null and (p.received_at at time zone d.tz)::date = d.day
   group by d.day
   order by d.day;
$$;

revoke execute on function public.finish_hk_task(uuid, text) from public, anon;
revoke execute on function public.reopen_hk_task(uuid) from public, anon;
revoke execute on function public.today_board_rows(uuid, date) from public, anon;
revoke execute on function public.income_last_days(uuid, int) from public, anon;
grant execute on function public.finish_hk_task(uuid, text) to authenticated;
grant execute on function public.reopen_hk_task(uuid) to authenticated;
grant execute on function public.today_board_rows(uuid, date) to authenticated;
grant execute on function public.income_last_days(uuid, int) to authenticated;
