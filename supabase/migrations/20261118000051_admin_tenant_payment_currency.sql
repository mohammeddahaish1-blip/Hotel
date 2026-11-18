-- A company's payment history in the owners' portal shows each payment in its own currency.
create or replace function public.admin_tenant(p_tenant uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then raise exception 'FORBIDDEN: platform admins only'; end if;
  return jsonb_build_object(
    'properties', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name_ar, 'kind', p.kind,
                    'units', (select count(*) from public.units u where u.property_id = p.id and u.active)) order by p.created_at)
                    from public.properties p where p.tenant_id = p_tenant), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', m.full_name, 'email', u.email, 'role', m.role, 'active', m.active) order by m.created_at)
               from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = p_tenant), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'amount', sp.amount, 'currency', sp.currency, 'months', sp.months,
                  'period_start', sp.period_start, 'period_end', sp.period_end, 'paid_on', sp.paid_on, 'method', sp.method,
                  'reference', sp.reference, 'voided', sp.voided_at is not null) order by sp.paid_on desc, sp.created_at desc)
                  from public.subscription_payments sp where sp.tenant_id = p_tenant), '[]'::jsonb));
end $$;
