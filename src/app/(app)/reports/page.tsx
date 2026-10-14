import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { addDays, gregorian, omr, pct, todayIn } from "@/lib/format";
import { Field, PageHeader, Section, Stat } from "@/components/ui";

type Occ = { day: string; units: number; sold: number; room_revenue: number; occupancy_bp: number; adr: number; revpar: number };

// FR-51 / FR-52: occupancy, ADR, RevPAR, revenue by source, net operating.
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const ctx = await requireArea("reports");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const from = typeof sp.from === "string" && sp.from ? sp.from : `${today.slice(0, 8)}01`;
  const to = typeof sp.to === "string" && sp.to ? sp.to : today;
  const toExcl = addDays(to, 1);
  const db = ctx.supabase;

  const [{ data: occ }, { data: res }, { data: pays }, { data: exps }] = await Promise.all([
    db.rpc("occupancy_report", { p_property: ctx.property.id, p_from: from, p_to: toExcl }),
    db.from("reservations").select("source, room_total, discount_amount, stay").eq("property_id", ctx.property.id)
      .in("status", ["confirmed", "checked_in", "checked_out"]).overlaps("stay", `[${from},${toExcl})`),
    db.from("payments").select("kind, method, amount, folios!inner(property_id)").eq("folios.property_id", ctx.property.id)
      .is("voided_at", null).gte("received_at", `${from}T00:00:00+04:00`).lt("received_at", `${toExcl}T00:00:00+04:00`),
    db.from("expenses").select("category, amount").eq("property_id", ctx.property.id).gte("expense_date", from).lte("expense_date", to),
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
  const maxRev = Math.max(1, ...rows.map((r) => Number(r.room_revenue)));

  return (
    <>
      <PageHeader
        title={t.rep_title}
        actions={
          <>
            <a className="btn-ghost btn-sm" href={`/api/export?kind=occupancy&from=${from}&to=${toExcl}`}>{t.exportCsv} · {t.rep_occupancy}</a>
            <a className="btn-ghost btn-sm" href={`/api/export?kind=accounting&from=${from}&to=${to}`}>{t.exportCsv} · {t.invoices}</a>
          </>
        }
      />
      <form className="card mb-4 grid gap-2 sm:grid-cols-4">
        <Field label={t.from}><input type="date" name="from" defaultValue={from} className="input" /></Field>
        <Field label={t.to}><input type="date" name="to" defaultValue={to} className="input" /></Field>
        <div className="flex items-end"><button className="btn-primary w-full">{t.run}</button></div>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.rep_occupancy} value={pct(avail ? (sold * 10000) / avail : 0)} hint={`${sold} / ${avail}`} tone="brand" />
        <Stat label={t.rep_adr} value={omr(sold ? rev / sold : 0, lang)} />
        <Stat label={t.rep_revpar} value={omr(avail ? rev / avail : 0, lang)} />
        <Stat label={t.rep_room_revenue} value={omr(rev, lang)} />
        <Stat label={t.rep_collected} value={omr(collected, lang)} />
        <Stat label={t.rep_net} value={omr(collected - expenses, lang)} hint={`${t.expenses}: ${omr(expenses, lang)}`} tone={collected - expenses < 0 ? "danger" : "ok"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title={t.rep_room_revenue}>
            <div className="space-y-1">
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
          </Section>
        </div>
        <div className="space-y-4">
          <Section title={t.rep_by_source}>
            <table className="table">
              <tbody>
                {[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <tr key={k}><td>{t[`src_${k}` as DictKey]}</td><td className="num text-end">{omr(v, lang)}</td></tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title={t.method}>
            <table className="table">
              <tbody>
                {[...byMethod.entries()].map(([k, v]) => (
                  <tr key={k}><td>{t[`pm_${k}` as DictKey]}</td><td className="num text-end">{omr(v, lang)}</td></tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>
    </>
  );
}
