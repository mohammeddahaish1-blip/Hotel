-- "Request a trial" on the public page: a visitor leaves a name, phone and e-mail; the team sends back a
-- personal link that opens the showcase hotel for a week. Additive: one table, two small functions.

create table public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company text check (char_length(company) <= 120),
  phone text not null check (phone ~ '^[0-9]{7,15}$'),
  email text not null check (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days',
  opened_at timestamptz,
  opens int not null default 0,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index trial_requests_created_idx on public.trial_requests(created_at desc);
alter table public.trial_requests enable row level security;
-- only the Nuzul team reads or changes the list; visitors go through the functions below
create policy trial_requests_admin on public.trial_requests for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.trial_requests from anon;

-- A visitor's request. Never says whether the e-mail or phone was seen before; capped per hour.
create or replace function public.request_trial(p_name text, p_phone text, p_email text, p_company text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
        v_email text := lower(btrim(coalesce(p_email, '')));
        v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'INVALID_INPUT: name'; end if;
  if v_phone !~ '^[0-9]{7,15}$' then raise exception 'INVALID_INPUT: phone'; end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'INVALID_INPUT: email'; end if;
  if (select count(*) from public.trial_requests where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'RATE_LIMIT: too many requests';
  end if;
  -- the same person asking again within a day: keep the first request
  if exists (select 1 from public.trial_requests
              where created_at > now() - interval '1 day' and (email = v_email or phone = v_phone)) then
    return;
  end if;
  insert into public.trial_requests(name, company, phone, email)
  values (v_name, nullif(left(btrim(coalesce(p_company, '')), 120), ''), v_phone, v_email);
end $$;
revoke execute on function public.request_trial(text, text, text, text) from public;
grant execute on function public.request_trial(text, text, text, text) to anon, authenticated;

-- The personal link: true while it is valid, and notes that it was opened.
create or replace function public.open_trial_link(p_token uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.trial_requests
     set opened_at = coalesce(opened_at, now()), opens = opens + 1
   where token = p_token and expires_at > now();
  return found;
end $$;
revoke execute on function public.open_trial_link(uuid) from public;
grant execute on function public.open_trial_link(uuid) to anon, authenticated;
