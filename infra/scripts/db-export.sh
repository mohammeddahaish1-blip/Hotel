#!/usr/bin/env bash
# Export all hotel data from a Supabase database (cloud or self-hosted).
# What it saves:
#   app.sql   - every row in the public and private schemas (hotels, bookings, money, audit log...)
#   auth.sql  - sign-in accounts (auth.users / auth.identities), so staff keep their passwords
#   counts.txt - row count per table, used by db-import.sh to verify the copy
# The schema itself is NOT exported: supabase/migrations is the source of truth.
# Files in Storage (ID photos, receipts...) are copied separately by storage-copy.mjs.
#
# Usage: SOURCE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
#        [BACKUP_PASSPHRASE=...] infra/scripts/db-export.sh [out_dir]
# pg_dump must be the same major version as the server or newer (Supabase cloud: 17).
set -euo pipefail
: "${SOURCE_DB_URL:?set SOURCE_DB_URL to the source database connection string}"
OUT="${1:-backups/$(date -u +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
chmod 700 "$OUT"

echo "-> app data (public, private)"
pg_dump "$SOURCE_DB_URL" --data-only --no-owner --no-privileges \
  --schema=public --schema=private -f "$OUT/app.sql"

echo "-> sign-in accounts (auth)"
pg_dump "$SOURCE_DB_URL" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities --table=auth.mfa_factors -f "$OUT/auth.sql"

echo "-> row counts"
psql "$SOURCE_DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../sql/row-counts.sql" > "$OUT/counts.txt"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  echo "-> encrypting"
  for f in app.sql auth.sql; do
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 \
      -o "$OUT/$f.gpg" "$OUT/$f" <<< "$BACKUP_PASSPHRASE"
    rm "$OUT/$f"
  done
fi
echo "Saved to $OUT ($(du -sh "$OUT" | cut -f1)). It contains guest personal data: keep it private."
