import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr, pct, gregorian, hijri } from "@/lib/format";
import { Badge, Empty, PageHeader, Section, Stat, UNIT_STATUS_TONE, RES_STATUS_TONE } from "@/components/ui";

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
  const { data, error } = await ctx.supabase.rpc("owner_dashboard", { p_property: ctx.property.id });
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.dash_occupancy} value={pct(d.occupancy_bp)} hint={`${d.in_house} / ${d.units}`} tone="brand" />
        <Stat label={t.dash_income_today} value={omr(d.income_today, lang)} />
        <Stat label={t.dash_income_month} value={omr(d.income_month, lang)} />
        <Stat label={t.dash_receivable} value={omr(d.receivable, lang)} tone={d.receivable > 0 ? "danger" : undefined} />
        <Stat label={t.dash_deposits} value={omr(d.deposits_held, lang)} />
        <Stat label={t.dash_expenses_month} value={omr(d.expenses_month, lang)} />
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
              <Badge tone={UNIT_STATUS_TONE[s]}>{t[`st_${s}` as DictKey]}</Badge>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title={`${t.dash_arrivals} (${d.arrivals.length})`}>
          <MovementList items={d.arrivals} t={t} empty={t.none} />
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

function MovementList({ items, t, empty }: { items: Dash["arrivals"]; t: Record<string, string>; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id}>
          <Link href={`/reservations/${a.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-semibold">{a.unit}</span> · {a.guest}
            </span>
            <Badge tone={RES_STATUS_TONE[a.status]}>{t[`rs_${a.status}`]}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
