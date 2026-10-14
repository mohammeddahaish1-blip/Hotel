-- rls_auto_enable() is a platform helper that pre-existed in this project; keep it off the API.
do $$ begin if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from authenticated, anon, public;
end if; end $$;
