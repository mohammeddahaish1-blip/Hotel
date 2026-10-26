import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { addDays, omr, pct, todayIn } from "@/lib/format";
import { BarList, ColumnChart, type Datum } from "@/components/charts";
import { PageHeader, Section, Stat } from "@/components/ui";

type Occ = { day: string; units: number; sold: number; room_revenue: number };

/** Round a maximum up to a "nice" number so axis ticks read cleanly. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

export default async function AnalyticsPage() {
  const ctx = await requireArea("reports");
  const { t, lang } = await getDict();
  const db = ctx.supabase;
  const today = todayIn(ctx.property.timezone);
  const from30 = addDays(today, -29);
  const from8w = addDays(today, -55);
  const locale = intlLocale(lang);
  const short = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00`));

  const [{ data: income }, { data: occ }, { data: res }] = await Promise.all([
    db.rpc("daily_income", { p_property: ctx.property.id, p_from: from30, p_to: today }),
    db.rpc("occupancy_report", { p_property: ctx.property.id, p_from: from8w, p_to: addDays(today, 1) }),
    db.from("reservations").select("source, room_total, discount_amount").eq("property_id", ctx.property.id)
      .in("status", ["confirmed", "checked_in", "checked_out"]).overlaps("stay", `[${from30},${addDays(today, 1)})`),
  ]);

  // 1) Income, last 30 days
  const incomeRows = ((income ?? []) as { day: string; amount: number }[]).map((r) => ({ ...r, amount: Number(r.amount) }));
  const incomeData: Datum[] = incomeRows.map((r) => ({ key: r.day, label: short(r.day), value: r.amount, display: omr(r.amount, lang) }));
  const incomeTotal = incomeRows.reduce((a, r) => a + r.amount, 0);
  const incomeTop = niceMax(Math.max(...incomeRows.map((r) => r.amount), 0));

  // 2) Occupancy per week, last 8 weeks
  const occRows = (occ ?? []) as Occ[];
  const weeks: Datum[] = [];
  for (let w = 0; w < 8; w++) {
    const slice = occRows.slice(w * 7, w * 7 + 7);
    if (!slice.length) continue;
    const units = slice.reduce((a, r) => a + r.units, 0);
    const sold = slice.reduce((a, r) => a + r.sold, 0);
    const bp = units ? Math.round((sold * 10000) / units) : 0;
    weeks.push({ key: slice[0].day, label: `${short(slice[0].day)}–${short(slice[slice.length - 1].day)}`, value: bp, display: pct(bp) });
  }
  const avgOcc = weeks.length ? Math.round(weeks.reduce((a, w) => a + w.value, 0) / weeks.length) : 0;

  // 3) Revenue by source, last 30 days
  const bySource = new Map<string, number>();
  for (const r of res ?? []) bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.room_total - r.discount_amount);
  const sourceData: Datum[] = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: t[`src_${k}` as DictKey], value: v, display: omr(v, lang) }));

  return (
    <>
      <PageHeader title={t.an_charts_title} sub={t.an_charts_sub} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t.an_income_30} value={omr(incomeTotal, lang)} tone="brand" />
        <Stat label={t.an_avg_occ} value={pct(avgOcc)} />
        <Stat label={t.an_top_source} value={sourceData[0]?.label ?? "—"} hint={sourceData[0]?.display} />
      </div>
      <div className="grid gap-4">
        <Section title={t.an_income_30}>
          <ColumnChart
            data={incomeData}
            max={incomeTop}
            ticks={[0, incomeTop / 2, incomeTop].map((v) => ({
              value: v,
              label: `${(v / 1000).toLocaleString("en", { maximumFractionDigits: 0 })}${v === incomeTop ? (lang === "en" ? " OMR" : " ر.ع") : ""}`,
            }))}
            tableLabel={t.an_show_table}
            columns={[t.date, t.amount]}
          />
        </Section>
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t.an_weekly_occ}>
            <ColumnChart
              data={weeks}
              max={10000}
              height={200}
              ticks={[0, 5000, 10000].map((v) => ({ value: v, label: `${v / 100}%` }))}
              tableLabel={t.an_show_table}
              columns={[t.an_week, t.rep_occupancy]}
            />
          </Section>
          <Section title={t.an_by_source}>
            {sourceData.length ? (
              <BarList data={sourceData} tableLabel={t.an_show_table} columns={[t.source, t.rep_room_revenue]} />
            ) : (
              <div className="text-sm text-muted">{t.none}</div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
