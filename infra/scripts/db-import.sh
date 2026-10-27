#!/usr/bin/env bash
# Load an export made by db-export.sh into a NEW, EMPTY Supabase database
# (a new cloud project, another region, or self-hosted Supabase).
#   1. refuses to run if the target already has hotels or users
#   2. creates the schema from supabase/migrations (skipping files listed in infra/migrations-skip.txt)
#   3. loads the data with triggers off (keeps original receipt numbers, audit log, timestamps)
#   4. compares row counts with the source
#
# Usage: TARGET_DB_URL="postgresql://postgres:...@host:5432/postgres" \
#        [BACKUP_PASSPHRASE=...] infra/scripts/db-import.sh backups/20261027-120000
set -euo pipefail
: "${TARGET_DB_URL:?set TARGET_DB_URL to the new database connection string}"
DIR="${1:?pass the export folder}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql "$TARGET_DB_URL" -X -q -v ON_ERROR_STOP=1)

for f in app.sql auth.sql; do
  if [ ! -f "$DIR/$f" ] && [ -f "$DIR/$f.gpg" ]; then
    : "${BACKUP_PASSPHRASE:?the export is encrypted: set BACKUP_PASSPHRASE}"
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 -o "$DIR/$f" -d "$DIR/$f.gpg" <<< "$BACKUP_PASSPHRASE"
  fi
  [ -f "$DIR/$f" ] || { echo "missing $DIR/$f"; exit 1; }
done

echo "-> checking the target is empty"
users=$("${PSQL[@]}" -At -c "select count(*) from auth.users")
has_schema=$("${PSQL[@]}" -At -c "select to_regclass('public.tenants') is not null")
tenants=0
if [ "$has_schema" = "t" ]; then tenants=$("${PSQL[@]}" -At -c "select count(*) from public.tenants"); fi
if [ "$users" != "0" ] || [ "$tenants" != "0" ]; then
  echo "Target is not empty ($users users, $tenants companies). Use a fresh project; nothing was changed."
  exit 1
fi

if [ "$has_schema" != "t" ]; then
  echo "-> creating the schema from supabase/migrations"
  for m in "$ROOT"/supabase/migrations/*.sql; do
    name="$(basename "$m")"
    if grep -qxF "$name" "$ROOT/infra/migrations-skip.txt" 2>/dev/null; then echo "   skip $name"; continue; fi
    echo "   $name"
    "${PSQL[@]}" -f "$m" > /dev/null
  done
fi

echo "-> loading data"
# Seed rows written by migrations are replaced by the source's rows; triggers stay off while loading.
"${PSQL[@]}" --single-transaction \
  -c "set session_replication_role = replica" \
  -c "do \$\$ declare t text; begin
        select string_agg(format('%I.%I', schemaname, tablename), ', ') into t
          from pg_tables where schemaname in ('public', 'private');
        if t is not null then execute 'truncate ' || t || ' cascade'; end if;
      end \$\$" \
  -f "$DIR/auth.sql" \
  -f "$DIR/app.sql" > /dev/null

echo "-> verifying row counts"
"${PSQL[@]}" -At -f "$ROOT/infra/sql/row-counts.sql" > "$DIR/counts-target.txt"
if diff <(sort "$DIR/counts.txt") <(sort "$DIR/counts-target.txt") > "$DIR/counts-diff.txt"; then
  echo "All row counts match."
else
  echo "Row counts differ (see $DIR/counts-diff.txt):"; cat "$DIR/counts-diff.txt"; exit 1
fi
cat <<MSG

Database copied. Next:
  - copy files:        SOURCE_URL=... SOURCE_SERVICE_KEY=... TARGET_URL=... TARGET_SERVICE_KEY=... node infra/scripts/storage-copy.mjs
  - scheduled jobs:    psql "\$TARGET_DB_URL" -v project_url=https://<new-project> -v anon_key=<anon JWT> -f infra/sql/reschedule-jobs.sql
  - edge function:     supabase functions deploy purge-guest-documents --project-ref <new-ref>
  - app settings:      update NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY where the app runs
MSG
