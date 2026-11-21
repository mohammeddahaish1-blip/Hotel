-- The CEO (or owner) sets the limits above which discounts and expenses need approval.
create or replace function public.admin_save_limits(p_discount int, p_expense bigint) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.platform_can(array['ceo'],'edit') then raise exception 'not allowed'; end if;
  update public.platform_settings set discount_limit = p_discount, expense_limit = p_expense, updated_at = now() where id = 1;
end $$;
revoke all on function public.admin_save_limits(int, bigint) from public, anon;
grant execute on function public.admin_save_limits(int, bigint) to authenticated;
