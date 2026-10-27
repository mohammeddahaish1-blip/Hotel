#!/usr/bin/env bash
# Runs every database test against a throw-away Postgres database:
# Supabase stub -> all migrations -> supabase/tests/NN_*.sql.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres [PGPASSWORD=...] infra/scripts/test-sql.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-hotel_test}"
PSQL=(psql -q -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f supabase/tests/00_supabase_stub.sql
for m in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$m" > /dev/null
done
for t in supabase/tests/[0-9][0-9]_*.sql; do
  [ "$(basename "$t")" = "00_supabase_stub.sql" ] && continue
  out=$("${PSQL[@]}" -d "$DB" -At -f "$t" 2>&1) || { echo "FAILED: $t"; echo "$out"; exit 1; }
  echo "ok  $(basename "$t")  $(echo "$out" | grep -E 'OK|PASSED' | tail -1)"
done
"${PSQL[@]}" -d postgres -c "drop database $DB"
echo "ALL SQL TESTS PASSED"
