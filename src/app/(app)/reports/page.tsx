import Link from "next/link";
import { Download } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { getPlan, planHas } from "@/lib/plan";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { addDays, gregorian, omr, pct, todayIn } from "@/lib/format";
import { BarList, ColumnChart, type Datum } from "@/components/charts";
import { Field, PageHeader, Section } from "@/components/ui";

type Occ = { day: string; units: number; sold: number; room_revenue: number; occupancy_bp: number; adr: number; revpar: number };
const PERIODS = ["today", "week", "month", "last", "year"] as const;
type Period = (typeof PERIODS)[number] | "custom";

/** Round a maximum up to a "nice" number so axis ticks read cleanly. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

// FR-51 / FR-52: occupancy, ADR, RevPAR, revenue by source, net operating — asked as plain questions, with the charts on the same page.
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireArea("reports");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  // one period drives every figure and chart on the page: a ready-made one, or two dates
  const custom = typeof sp.from === "string" && sp.from && typeof sp.to === "string" && sp.to;
  const period: Period = custom ? "custom" : PERIODS.includes(sp.p as (typeof PERIODS)[number]) ? (sp.p as Period) : "month";
  const lastMonthEnd = addDays(monthStart, -1);
  const range: Record<Period, [string, string]> = {
    today: [today, today],
    week: [addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay()), today], // the week starts on Sunday
    month: [monthStart, today],
    last: [`${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
    year: [`${today.slice(0, 4)}-01-01`, today],
    custom: [String(sp.from), String(sp.to)],
  };
  const [from, to] = range[period];
  const toExcl = addDays(to, 1);
  const db = ctx.supabase;
  const charts = planHas(await getPlan(ctx), "analytics");

  const [{ data: occ }, { data: res }, { data: pays }, { data: exps }, { data: income }] = await Promise.all([
    db.rpc("occupancy_report", { p_property: ctx.property.id, p_from: from, p_to: toExcl }),
    db.from("reservations").select("source, room_total, discount_amount, stay").eq("property_id", ctx.property.id)
      .in("status", ["confirmed", "checked_in", "checked_out"]).overlaps("stay", `[${from},${toExcl})`),
    db.from("payments").select("kind, method, amount, folios!inner(property_id)").eq("folios.property_id", ctx.property.id)
      .is("voided_at", null).gte("received_at", `${from}T00:00:00+04:00`).lt("received_at", `${toExcl}T00:00:00+04:00`),
    db.from("expenses").select("category, amount").eq("property_id", ctx.property.id).is("archived_at", null).gte("expense_date", from).lte("expense_date", to),
    charts ? db.rpc("daily_income", { p_property: ctx.property.id, p_from: from, p_to: to }) : Promise.resolve({ data: null }),
  ]);
  const rows = (occ ?? []) as Occ[];
  const sold = rows.reduce((a, r) => a + r.sold, 0);
  const avail = rows.reduce((a, r) => a + r.units, 0);
  const rev = rows.reduce((a, r) => a + Number(r.room_revenue), 0);
  const bySource = new Map<string, number>();
  for (const r of res ?? []) bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.room_total - r.discount_amount);
  const collected = (pays ?? []).reduce((a, p) => a + (p.kind === "payment" ? p.amount : p.kind === "refund" ? -p.amount : 0), 0);
  const byMethod = new Map<string, number>();
  for (const p of pays ?? []) if (p.kind === "payment") byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  const expenses = (exps ?? []).reduce((a, e) => a + e.amount, 0);
  const net = collected - expenses;
  const maxRev = Math.max(1, ...rows.map((r) => Number(r.room_revenue)));

  // income chart: a column per day, or per month when the period is long
  const locale = intlLocale(lang);
  const dayLabel = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00`));
  const monthLabel = (m: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(`${m}-01T00:00:00`));
  const incomeRows = ((income ?? []) as { day: string; amount: number }[]).map((r) => ({ day: r.day, amount: Number(r.amount) }));
  const monthly = incomeRows.length > 62;
  const byMonth = new Map<string, number>();
  for (const r of incomeRows) byMonth.set(r.day.slice(0, 7), (byMonth.get(r.day.slice(0, 7)) ?? 0) + r.amount);
  const incomeData: Datum[] = monthly
    ? [...byMonth.entries()].map(([m, v]) => ({ key: m, label: monthLabel(m), value: v, display: omr(v, lang) }))
    : incomeRows.map((r) => ({ key: r.day, label: dayLabel(r.day), value: r.amount, display: omr(r.amount, lang) }));
  const incomeTop = niceMax(Math.max(...incomeData.map((d) => d.value), 0));
  const best = incomeData.reduce<Datum | null>((a, d) => (d.value > (a?.value ?? 0) ? d : a), null);
  const sourceData: Datum[] = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: t[`src_${k}` as DictKey], value: v, display: omr(v, lang) }));

  const chip = (p: (typeof PERIODS)[number]) => (
    <Link key={p} href={p === "month" ? "/reports" : `/reports?p=${p}`} aria-current={period === p ? "true" : undefined} className={`btn-sm shrink-0 ${period === p ? "btn-primary" : "btn-ghost"}`}>
      {t[`rep_p_${p}` as DictKey]}
    </Link>
  );
  const question = "text-sm font-semibold text-muted";
  const figure = "num mt-1 text-3xl font-bold leading-tight";

  return (
    <>
      <PageHeader
        title={t.rep_title}
        sub={`${gregorian(from, lang)} – ${gregorian(to, lang)}`}
        actions={
          <details className="relative">
            <summary className="btn-ghost btn-sm cursor-pointer list-none"><Download className="size-4 shrink-0" />{t.rep_download}</summary>
            <div className="absolute end-0 top-full z-20 mt-1 w-72 rounded-2xl border border-line bg-surface p-1 shadow-lg">
              <a className="block rounded-xl px-3 py-2 hover:bg-surface-2" href={`/api/export?kind=occupancy&from=${from}&to=${toExcl}`}>
                <span className="block text-sm font-semibold">{t.rep_file_occ}</span>
                <span className="block text-xs text-muted">{t.rep_file_occ_hint}</span>
              </a>
              <a className="block rounded-xl px-3 py-2 hover:bg-surface-2" href={`/api/export?kind=accounting&from=${from}&to=${to}`}>
                <span className="block text-sm font-semibold">{t.rep_file_inv}</span>
                <span className="block text-xs text-muted">{t.rep_file_inv_hint}</span>
              </a>
              <p className="px-3 py-1.5 text-xs text-muted">{t.rep_file_note}</p>
            </div>
          </details>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-start gap-2">
        <div className="flex max-w-full gap-1.5 overflow-x-auto" role="group" aria-label={t.rep_p_custom}>{PERIODS.map(chip)}</div>
        <details open={period === "custom"} className="min-w-0">
          <summary className={`btn-sm cursor-pointer list-none ${period === "custom" ? "btn-primary" : "btn-ghost"}`}>{t.rep_p_custom}</summary>
          <form className="card mt-2 grid gap-2 sm:grid-cols-3">
            <Field label={t.from}><input type="date" name="from" defaultValue={from} required className="input" /></Field>
            <Field label={t.to}><input type="date" name="to" defaultValue={to} required className="input" /></Field>
            <div className="flex items-end"><button className="btn-primary w-full">{t.run}</button></div>
          </form>
        </details>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <section className="card p-5">
          <div className={question}>{t.rep_q_occ}</div>
          <div className={figure}>{pct(avail ? (sold * 10000) / avail : 0)}</div>
          <p className="mt-1.5 text-sm text-muted">{t.rep_q_occ_hint.replace("{a}", String(sold)).replace("{b}", String(avail))}</p>
        </section>
        <section className="card p-5">
          <div className={question}>{t.fin_q_in}</div>
          <div className={figure}>{omr(collected, lang)}</div>
          <p className="mt-1.5 text-sm text-muted">{t.rep_q_in_hint}</p>
        </section>
        <section className="card p-5">
          <div className={question}>{t.rep_q_net}</div>
          <div className={`${figure} ${net < 0 ? "text-danger" : "text-ok"}`}>{omr(net, lang)}</div>
          <p className="mt-1.5 text-sm text-muted">{t.fin_net_hint} · {t.expenses}: <span className="num">{omr(expenses, lang)}</span></p>
        </section>
      </div>

      <div className="mt-4">
        <Section title={t.rep_details}>
          <dl className="divide-y divide-line">
            {([
              [t.rep_q_adr, t.rep_q_adr_hint, omr(sold ? rev / sold : 0, lang)],
              [t.rep_q_revpar, t.rep_q_revpar_hint, omr(avail ? rev / avail : 0, lang)],
              [t.rep_room_revenue, t.rep_room_rev_hint, omr(rev, lang)],
            ] as const).map(([q, hint, value]) => (
              <div key={q} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <dt><span className="font-semibold">{q}</span><span className="block text-xs text-muted">{hint}</span></dt>
                <dd className="num shrink-0 text-lg font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <div className={`mt-4 grid gap-4 ${charts && incomeData.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {charts && incomeData.length > 1 ? (
          <Section title={monthly ? t.rep_income_monthly : t.rep_income_daily}>
            {/* the takeaway in words, so nobody has to read the chart to get it */}
            {best ? <p className="mb-3 text-sm font-semibold text-brand">{t.rep_best.replace("{x}", `${best.label} (${best.display})`)}</p> : null}
            <ColumnChart
              data={incomeData}
              max={incomeTop}
              ticks={[0, incomeTop / 2, incomeTop].map((v) => ({
                value: v,
                label: `${(v / 1000).toLocaleString("en", { maximumFractionDigits: 0 })}${v === incomeTop ? (lang === "en" || lang === "bn" ? " OMR" : " ر.ع") : ""}`,
              }))}
              tableLabel={t.an_show_table}
              columns={[t.date, t.amount]}
            />
          </Section>
        ) : null}
        <Section title={t.rep_sources_q}>
          {sourceData.length ? (
            <>
              <p className="mb-3 text-sm font-semibold text-brand">{t.rep_top_source.replace("{x}", sourceData[0].label)}</p>
              <BarList data={sourceData} tableLabel={t.an_show_table} columns={[t.source, t.rep_room_revenue]} />
            </>
          ) : (
            <div className="text-sm text-muted">{t.none}</div>
          )}
        </Section>
      </div>

      <details className="card mt-4">
        <summary className="cursor-pointer text-sm font-semibold">{t.rep_day_by_day}</summary>
        <div className="mt-3 space-y-1">
          {rows.map((r) => (
            <div key={r.day} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted">{gregorian(r.day, lang)}</span>
              <div className="h-4 flex-1 rounded bg-surface-2">
                <div className="h-4 rounded bg-brand" style={{ width: `${(Number(r.room_revenue) / maxRev) * 100}%` }} />
              </div>
              <span className="num w-16 shrink-0 text-end">{pct(r.occupancy_bp)}</span>
              <span className="num w-24 shrink-0 text-end">{omr(r.room_revenue, lang)}</span>
            </div>
          ))}
        </div>
      </details>
      <details className="card mt-4">
        <summary className="cursor-pointer text-sm font-semibold">{t.method}</summary>
        <div className="mt-3 overflow-x-auto"><table className="table">
          <tbody>
            {[...byMethod.entries()].map(([k, v]) => (
              <tr key={k}><td>{t[`pm_${k}` as DictKey]}</td><td className="num text-end">{omr(v, lang)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </details>
    </>
  );
}
