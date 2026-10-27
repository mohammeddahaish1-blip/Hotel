-- =====================================================================
-- 0026 — Card reader at guest registration, and cancel for owner payouts.
--  * guests.doc_source: where the ID data came from (card reader / camera / typed),
--    shown in the ROP guest register so the hotel can tell scanned from typed records.
--  * owner payouts are cancelled (kept, with who/why), never deleted, and drop out of
--    the owner statement.
-- =====================================================================

alter table public.guests add column doc_source text check (doc_source in ('reader', 'camera', 'manual'));
alter table public.guests add column doc_scanned_at timestamptz;

alter table public.owner_payouts add column cancelled_at timestamptz;
alter table public.owner_payouts add column cancelled_by uuid references auth.users(id);
alter table public.owner_payouts add column cancel_reason text check (char_length(cancel_reason) <= 300);
create index owner_payouts_cancelled_by_idx on public.owner_payouts(cancelled_by);
create trigger owner_payouts_audit_update after update on public.owner_payouts
  for each row execute function private.audit_trigger();

create or replace function public.cancel_owner_payout(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.owner_payouts where id = p_id and cancelled_at is null for update;
  if not found then raise exception 'NOT_FOUND: payout'; end if;
  if not private.has_role(v_tenant, '{owner,manager}') then raise exception 'FORBIDDEN: not allowed'; end if;
  update public.owner_payouts
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(nullif(trim(p_reason), ''), 300)
   where id = p_id;
end $$;
revoke execute on function public.cancel_owner_payout(uuid, text) from public, anon;
grant execute on function public.cancel_owner_payout(uuid, text) to authenticated;

-- Owner statement without cancelled payouts
create or replace function public.owner_statement(p_owner uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  o record;
  v_rev_before bigint; v_exp_before bigint; v_pay_before bigint;
  v_rev bigint; v_exp bigint; v_pay bigint;
  v_opening bigint; v_comm bigint;
begin
  select * into o from public.unit_owners where id = p_owner;
  if not found then raise exception 'NOT_FOUND: owner'; end if;

  -- revenue = non-voided room/rent charges on reservations of the owner's units
  select coalesce(sum(ch.amount) filter (where ch.service_date < p_from), 0),
         coalesce(sum(ch.amount) filter (where ch.service_date between p_from and p_to), 0)
    into v_rev_before, v_rev
    from public.charges ch
    join public.folios f on f.id = ch.folio_id
    join public.reservations r on r.id = f.reservation_id
    join public.units u on u.id = r.unit_id
   where u.owner_id = p_owner and ch.voided_at is null and ch.kind in ('room', 'rent') and ch.service_date <= p_to;

  select coalesce(sum(e.amount) filter (where e.expense_date < p_from), 0),
         coalesce(sum(e.amount) filter (where e.expense_date between p_from and p_to), 0)
    into v_exp_before, v_exp
    from public.expenses e join public.units u on u.id = e.unit_id
   where u.owner_id = p_owner and e.archived_at is null and e.expense_date <= p_to;

  select coalesce(sum(amount) filter (where paid_on < p_from), 0),
         coalesce(sum(amount) filter (where paid_on between p_from and p_to), 0)
    into v_pay_before, v_pay
    from public.owner_payouts where owner_id = p_owner and paid_on <= p_to and cancelled_at is null;

  v_opening := v_rev_before - (v_rev_before * o.commission_bp / 10000) - v_exp_before - v_pay_before;
  v_comm := v_rev * o.commission_bp / 10000;

  return jsonb_build_object(
    'owner', jsonb_build_object('id', o.id, 'name', o.name, 'phone', o.phone, 'commission_bp', o.commission_bp, 'language', o.language),
    'from', p_from, 'to', p_to,
    'opening', v_opening,
    'revenue', v_rev,
    'commission', v_comm,
    'expenses', v_exp,
    'payouts', v_pay,
    'closing', v_opening + v_rev - v_comm - v_exp - v_pay,
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'number', u.number,
                'revenue', (select coalesce(sum(ch.amount), 0) from public.charges ch
                              join public.folios f on f.id = ch.folio_id join public.reservations r on r.id = f.reservation_id
                             where r.unit_id = u.id and ch.voided_at is null and ch.kind in ('room', 'rent')
                               and ch.service_date between p_from and p_to),
                'expenses', (select coalesce(sum(e.amount), 0) from public.expenses e
                              where e.unit_id = u.id and e.archived_at is null and e.expense_date between p_from and p_to))
              order by u.number), '[]'::jsonb) from public.units u where u.owner_id = p_owner),
    'expense_lines', (select coalesce(jsonb_agg(jsonb_build_object('date', e.expense_date, 'unit', u.number,
                'description', e.description, 'category', e.category, 'amount', e.amount) order by e.expense_date), '[]'::jsonb)
              from public.expenses e join public.units u on u.id = e.unit_id
             where u.owner_id = p_owner and e.archived_at is null and e.expense_date between p_from and p_to),
    'payout_lines', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'date', paid_on, 'amount', amount, 'method', method,
                'reference', reference) order by paid_on), '[]'::jsonb)
              from public.owner_payouts where owner_id = p_owner and paid_on between p_from and p_to and cancelled_at is null));
end $$;
