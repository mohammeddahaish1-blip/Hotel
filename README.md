# نُزُل · Nuzul — Arabic-first PMS for hotels & serviced apartments (Oman / GCC)

MVP implementation of the PRD (v1.0, 14 Oct 2026): reservations, availability, guests, check-in/out,
folios, invoices with Omani taxes & fees, cash shifts, housekeeping, maintenance, owner dashboard,
reports, ROP / Ministry compliance exports, roles and an append-only audit log.

**Stack:** Next.js 16 (App Router, server actions) · TypeScript · Tailwind 4 · Supabase (Postgres 17, Auth, Storage, pg_cron).

## Binding technical decisions (PRD §9) and where they live

| Decision | Implementation |
|---|---|
| Multi-tenancy from the first table | `tenant_id` on every table + RLS via `private.user_tenant_ids()` / `private.has_role()` (`supabase/migrations/0001…0005`) |
| No double bookings | `EXCLUDE USING gist (unit_id WITH =, stay WITH &&)` on active reservations (`reservations_no_overlap`) |
| Money in baisa | every amount is `bigint` (1 OMR = 1000 baisa); UI converts with `src/lib/format.ts` |
| Immutable audit log | `audit_log` filled by `SECURITY DEFINER` triggers; updates/deletes raise `IMMUTABLE` |
| Immutable invoices | sequential gap-free numbering per tenant (`document_sequences`), frozen JSON snapshot, corrections by credit note only |
| Async integrations | `outbox_events` (reservation.created, guest.checked_in, invoice.issued) for future ROP/Fawtara/channel workers |

## PRD coverage (P0)

| ID | Status | Notes |
|---|---|---|
| FR-01 | ✅ | company → property → floor → unit; bulk unit creation (`101-120, 201-220`) |
| FR-02 | ✅ | nightly/monthly rates + seasonal `rate_plans` (Ramadan, Eid, Khareef) auto-applied |
| FR-03 | ✅ | six statuses; transitions driven by check-in/out, housekeeping and maintenance |
| FR-04 | ✅ | `available_units()` (GiST-indexed) |
| FR-05 | ✅ | DB exclusion constraint → friendly `CONFLICT` error |
| FR-06 | ✅ | 14-day tape chart with drag & drop + Hijri dates, conflict-checked on save |
| FR-10–14 | ✅ | create / change / extend / move / cancel / no-show; sources; discount limit needs manager; monthly contracts with billing schedules (posted daily by pg_cron); refundable deposits kept as liability |
| FR-20 | ✅ | in-browser OCR (tesseract.js) of the MRZ on Omani/GCC IDs & passports; staff review before save |
| FR-21 | ✅ | `consent_at NOT NULL` — no consent, no profile; separate consent for transfer abroad |
| FR-22–24 | ✅ | guest search/history; check-in validates documents, unit readiness; check-out warns on balance and creates a cleaning task |
| FR-30–35 | ✅ | bilingual invoice + credit notes, configurable tax engine, multi-method/partial payments, expenses, cash shift with variance per employee, aging 0-30/31-60/61-90/90+ with WhatsApp reminders |
| FR-40 | ✅ | mobile cleaning list, arrivals first; "Ready" makes the unit available |
| FR-43 | ✅ (early P1) | blocking maintenance tickets remove a unit from availability |
| FR-50–55 | ✅ | owner dashboard, occupancy/ADR/RevPAR, CSV exports, six roles, audit log, wa.me sharing |
| CR-01/02 | ✅ structured export | ROP guest register CSV + ministry statistics; every export logged in `compliance_submissions` |
| CR-03–06 | ✅ | tourism 4%, municipality 5%, VAT 5%, service charge (0–8%, off by default) — all editable per tenant |
| CR-07 | 🟡 | invoice snapshot is UBL-mappable; Fawtara provider integration is P1 |
| CR-08 | 🟡 | consent, private encrypted bucket, 5-minute signed URLs, retention date per document; automatic purge job still to add |
| NFR-02 | ✅ | TOTP 2FA enforced for owner/manager; idle sign-out (15 min reception/housekeeping, 30 min others) |

## Run locally

```bash
cp .env.example .env.local   # Supabase URL + publishable key
npm install
npm run dev
```

## Database tests

`supabase/tests/` runs the full schema on plain Postgres (with a tiny stub of Supabase's `auth`/`storage`):

```bash
createdb hotel
psql -d hotel -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d hotel -f "$f"; done
psql -d hotel -f supabase/tests/01_core_flows.sql   # → ALL TESTS PASSED
psql -d hotel -f supabase/tests/02_invitations.sql
```

`01_core_flows.sql` proves tenant isolation (NFR-01), the conflict constraint, discount approval,
check-in/out rules, taxes, invoices/credit notes immutability, contracts, cash-shift variance,
role restrictions and audit-log immutability.

## Staff accounts

Owner/manager invites an email + role in **Settings**. The employee signs up with that email; on first
sign-in the invitation is attached automatically (`accept_invitations()`).
