import Link from "next/link";
import { KeyRound } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { checkInFromDashboard } from "@/app/actions/ops";
import { Suspense } from "react";
import { can, hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr, pct, gregorian, hijri } from "@/lib/format";
import { Badge, Empty, PageHeader, Section, Skeleton, Stat, UNIT_STATUS_TONE, UNIT_STATUS_EMOJI, RES_STATUS_TONE, RES_STATUS_EMOJI } from "@/components/ui";
import { loadAlerts } from "@/lib/alerts";
import { TodayBoard } from "./TodayBoard";

type Dash = {
  date: string;
  units: number;
  by_status: Record<string, number>;
  in_house: number;
  occupancy_bp: number;
  income_today: number;
  income_month: number;
  expenses_month: number;
  receivable: number;
  deposits_held: number;
  arrivals: { id: string; code: string; guest: string; unit: string; status: string }[];
  departures: { id: string; code: string; guest: string; unit: string; status: string }[];
  freeing_soon: { unit: string; date: string }[];
};

// FR-50: the owner sees everything that matters in one mobile screen.
export default async function DashboardPage() {
  const ctx = await requireArea("dashboard");
  const { t, lang } = await getDict();
  // the finance page shows payments, deposits and expenses to owner, managers and accountants
  const money = can(ctx, "finance") && hasRole(ctx, ["manager", "accountant"]);
  const [{ data, error }, alerts, { data: days }] = await Promise.all([
    ctx.supabase.rpc("owner_dashboard", { p_property: ctx.property.id }),
    loadAlerts(ctx, t, lang),
    // income per day for the last week, drawn as a small line under "income today"
    money ? ctx.supabase.rpc("income_last_days", { p_property: ctx.property.id, p_days: 7 }) : Promise.resolve({ data: null }),
  ]);
  const week = ((days ?? []) as { day: string; amount: number }[]).map((x) => Number(x.amount));
  if (error) throw new Error(error.message);
  const d = data as Dash;
  const statuses = ["available", "reserved", "occupied", "dirty", "maintenance", "out_of_service"];

  return (
    <>
      <PageHeader
        title={t.dash_title}
        sub={<>{gregorian(d.date, lang)} · {hijri(d.date, lang)}</>}
        actions={<Link href="/reservations/new" className="btn-primary">{t.res_new}</Link>}
      />
      <Suspense fallback={<Skeleton className="mb-4 h-56" />}>
        <TodayBoard ctx={ctx} t={t} lang={lang} />
      </Suspense>
      {alerts.length ? (
        <div className="mb-4 rounded-2xl border border-warn/30 bg-warn-soft/60 p-4">
          <div className="mb-2 text-sm font-bold text-warn">{t.alerts_title} ({alerts.length})</div>
          <ul className="grid gap-2 md:grid-cols-2">
            {alerts.slice(0, 6).map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex gap-2.5 rounded-xl bg-surface px-3 py-2 text-sm hover:shadow">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === 1 ? "bg-danger" : a.severity === 2 ? "bg-warn" : "bg-info"}`} />
                  <span className="min-w-0">
                    <span className="block font-semibold">{a.title}</span>
                    <span dir="auto" className="block truncate text-xs text-muted">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* the two figures an owner looks for first, then the rest; each opens what is behind it */}
      <div className="grid gap-3 md:grid-cols-2">
        <OccupancyTile href={can(ctx, "board") ? "/board" : undefined} label={t.dash_occupancy} value={pct(d.occupancy_bp)} share={d.occupancy_bp / 10000} hint={`${d.in_house} / ${d.units}`} />
        <ReceivableTile href={can(ctx, "finance") ? "/finance#aging" : undefined} label={t.dash_receivable} value={omr(d.receivable, lang)} due={d.receivable > 0} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t.dash_income_today} value={omr(d.income_today, lang)} hint={week.length > 1 ? <Spark values={week} label={t.last7} /> : undefined} href={money ? "/finance#payments" : undefined} />
        <Stat label={t.dash_income_month} value={omr(d.income_month, lang)} href={money ? "/finance#payments" : undefined} />
        <Stat label={t.dash_deposits} value={omr(d.deposits_held, lang)} href={money ? "/finance#deposits" : undefined} />
        <Stat label={t.dash_expenses_month} value={omr(d.expenses_month, lang)} href={money ? "/finance#expenses" : undefined} />
      </div>

      <div className="mt-4 card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h2">{t.dash_units_by_status}</h2>
          <Link href="/board" className="text-sm text-brand">{t.view}</Link>
        </div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {statuses.map((s) => (
            <Link key={s} href={`/board?status=${s}`} className="rounded-xl bg-surface-2 p-3 text-center">
              <div className="num text-2xl font-bold">{d.by_status[s] ?? 0}</div>
              <Badge tone={UNIT_STATUS_TONE[s]}><span aria-hidden>{UNIT_STATUS_EMOJI[s]}</span> {t[`st_${s}` as DictKey]}</Badge>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title={`${t.dash_arrivals} (${d.arrivals.length})`}>
          <MovementList items={d.arrivals} t={t} empty={t.none} checkInLabel={can(ctx, "reservations") && hasRole(ctx, ["manager", "reception"]) ? t.res_check_in : undefined} />
        </Section>
        <Section title={`${t.dash_departures} (${d.departures.length})`}>
          <MovementList items={d.departures} t={t} empty={t.none} />
        </Section>
        <Section title={t.dash_freeing}>
          {d.freeing_soon.length === 0 ? (
            <Empty>{t.none}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.freeing_soon.map((f) => (
                <li key={f.unit + f.date} className="flex justify-between py-2 text-sm">
                  <span className="font-semibold">{t.unit} {f.unit}</span>
                  <span className="text-muted">{gregorian(f.date, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function MovementList({ items, t, empty, checkInLabel }: { items: Dash["arrivals"]; t: Record<string, string>; empty: string; checkInLabel?: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
          <Link href={`/reservations/${a.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{a.unit}</span> · {a.guest}
            </span>
            <Badge tone={RES_STATUS_TONE[a.status]}><span aria-hidden>{RES_STATUS_EMOJI[a.status]}</span> {t[`rs_${a.status}`]}</Badge>
          </Link>
          {/* one press from the dashboard; the confirmation names the unit and the guest */}
          {checkInLabel && (a.status === "confirmed" || a.status === "tentative") ? (
            <ActionForm action={checkInFromDashboard}>
              <input type="hidden" name="id" value={a.id} />
              <SubmitButton className="btn-primary btn-sm" confirm={`${checkInLabel}: ${a.unit} · ${a.guest}`}><KeyRound className="size-3.5 shrink-0" />{checkInLabel}</SubmitButton>
            </ActionForm>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Occupancy as a ring on the brand colour: the first thing read on the page. */
function OccupancyTile({ href, label, value, share, hint }: { href?: string; label: string; value: string; share: number; hint: string }) {
  const c = 2 * Math.PI * 34;
  const filled = Math.max(0, Math.min(1, share)) * c;
  const cls = "flex items-center gap-4 rounded-3xl bg-brand p-5 text-brand-ink shadow-[0_10px_26px_rgba(20,40,35,0.15)]";
  const body = (
    <>
      <svg viewBox="0 0 80 80" className="size-20 shrink-0 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="8" />
        <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${filled} ${c}`} />
      </svg>
      <span className="min-w-0">
        <span className="block text-sm font-semibold opacity-85">{label}</span>
        <span className="num block text-4xl font-bold leading-tight">{value}</span>
        <span className="num block text-sm opacity-85">{hint}</span>
      </span>
    </>
  );
  return href ? <Link href={href} className={`${cls} transition hover:brightness-110`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** What guests still owe, large and red while anything is due. */
function ReceivableTile({ href, label, value, due }: { href?: string; label: string; value: string; due: boolean }) {
  const cls = `card flex flex-col justify-center p-5 ${due ? "bg-danger-soft" : ""}`;
  const body = (
    <>
      <span className={`text-sm font-semibold ${due ? "text-danger" : "text-muted"}`}>{label}</span>
      <span className={`num mt-1 text-3xl font-bold leading-tight ${due ? "text-danger" : ""}`}>{value}</span>
    </>
  );
  return href ? <Link href={href} className={`${cls} transition hover:shadow-sm`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A week of daily figures as one small line (oldest first). */
function Spark({ values, label }: { values: number[]; label: string }) {
  const min = Math.min(...values, 0);
  const span = Math.max(...values) - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${26 - ((v - min) / span) * 24}`).join(" ");
  return (
    <span className="block">
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full text-chart" role="img" aria-label={label}>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="block">{label}</span>
    </span>
  );
}
