-- Exact row count of every table in the exported schemas: "schema.table|count", sorted.
select format('%I.%I', n.nspname, c.relname) || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and not c.relispartition
   and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname in ('users', 'identities', 'mfa_factors')))
 order by 1;
