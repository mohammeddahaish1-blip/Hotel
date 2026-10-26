import { hasRole, requireArea, type Role } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr, toBaisa, todayIn } from "@/lib/format";
import { BarList, type Datum } from "@/components/charts";
import { Badge, Empty, Field, PageHeader, Section, Crumb } from "@/components/ui";

type Row = {
  user_id: string; full_name: string; job_title: string | null; role: Role;
  reservations_created: number; check_ins: number; check_outs: number;
  payments_count: number; payments_amount: number; invoices_issued: number;
  hk_tasks_done: number; hk_avg_minutes: number; tickets_closed: number;
  shifts_closed: number; cash_shortage: number;
};

// Transparent points so every bonus can be explained to the employee.
const WEIGHTS = {
  reservations_created: 2,
  check_ins: 1,
  check_outs: 1,
  payments_count: 1,
  invoices_issued: 1,
  hk_tasks_done: 2,
  tickets_closed: 3,
} as const;

const points = (r: Row) =>
  (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((a, k) => a + Number(r[k]) * WEIGHTS[k], 0);

export default async function StaffPerformancePage({ searchParams }: PageProps<"/analytics/staff">) {
  const ctx = await requireArea("reports");
  const { t, lang } = await getDict();
  if (!hasRole(ctx, ["manager"])) {
    return (
      <>
        <Crumb href="/analytics" label={t.nav_grp_analytics} />
        <PageHeader title={t.an_staff_title} />
        <Empty>{t.err_FORBIDDEN}</Empty>
      </>
    );
  }
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const from = typeof sp.from === "string" && sp.from ? sp.from : `${today.slice(0, 8)}01`;
  const to = typeof sp.to === "string" && sp.to ? sp.to : today;
  const pool = typeof sp.pool === "string" ? toBaisa(sp.pool) : 0;

  const { data, error } = await ctx.supabase.rpc("staff_performance", { p_property: ctx.property.id, p_from: from, p_to: to });
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, payments_amount: Number(r.payments_amount), cash_shortage: Number(r.cash_shortage), pts: points(r) }));
  rows.sort((a, b) => b.pts - a.pts);
  const totalPts = rows.reduce((a, r) => a + r.pts, 0);
  const share = (p: number) => (totalPts ? p / totalPts : 0);
  const bonus = (p: number) => Math.round(pool * share(p));
  const name = (r: Row) => r.full_name || r.user_id.slice(0, 8);
  const title = (r: Row) => r.job_title || t[`role_${r.role}` as DictKey];

  const chart: Datum[] = rows.map((r) => ({ key: r.user_id, label: name(r), value: r.pts, display: `${r.pts} ${t.an_points_unit}` }));

  return (
    <>
      <Crumb href="/analytics" label={t.nav_grp_analytics} />
      <PageHeader title={t.an_staff_title} sub={t.an_staff_sub} />
      <form className="card mb-4 grid gap-2 sm:grid-cols-4">
        <Field label={t.from}><input type="date" name="from" defaultValue={from} className="input" /></Field>
        <Field label={t.to}><input type="date" name="to" defaultValue={to} className="input" /></Field>
        <Field label={t.an_bonus_pool}>
          <input name="pool" inputMode="decimal" defaultValue={pool ? (pool / 1000).toFixed(3) : ""} placeholder="0.000" className="input" />
        </Field>
        <div className="flex items-end"><button className="btn-primary w-full">{t.run}</button></div>
      </form>

      {error ? <div className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error.message}</div> : null}
      {!rows.length ? (
        <Empty>{t.perm_none_staff}</Empty>
      ) : (
        <div className="grid gap-4">
          <Section title={t.an_points_title}>
            <BarList data={chart} tableLabel={t.an_show_table} columns={[t.name, t.an_points]} />
            <p className="mt-3 text-xs text-muted">{t.an_points_formula}</p>
          </Section>

          <Section title={t.an_staff_details}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.an_m_reservations}</th>
                    <th>{t.an_m_checkins}</th>
                    <th>{t.an_m_payments}</th>
                    <th>{t.an_m_invoices}</th>
                    <th>{t.an_m_hk}</th>
                    <th>{t.an_m_tickets}</th>
                    <th>{t.an_m_cash}</th>
                    <th>{t.an_points}</th>
                    <th>{t.an_share}</th>
                    {pool ? <th>{t.an_bonus}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.user_id}>
                      <td>
                        <div className="flex items-center gap-2">
                          {i === 0 && r.pts > 0 ? <Badge tone="warn">★</Badge> : null}
                          <div>
                            <div className="font-semibold">{name(r)}</div>
                            <div className="text-xs text-muted">{title(r)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{r.reservations_created}</td>
                      <td className="num">{r.check_ins} / {r.check_outs}</td>
                      <td className="num">{r.payments_count}<div className="text-xs text-muted">{omr(r.payments_amount, lang)}</div></td>
                      <td className="num">{r.invoices_issued}</td>
                      <td className="num">
                        {r.hk_tasks_done}
                        {r.hk_avg_minutes ? <div className="text-xs text-muted">{r.hk_avg_minutes} {t.an_minutes_avg}</div> : null}
                      </td>
                      <td className="num">{r.tickets_closed}</td>
                      <td className="num">
                        {r.shifts_closed}
                        {r.cash_shortage > 0 ? <div className="text-xs font-semibold text-danger">−{omr(r.cash_shortage, lang)}</div> : null}
                      </td>
                      <td className="num font-bold">{r.pts}</td>
                      <td className="num">{(share(r.pts) * 100).toFixed(1)}%</td>
                      {pool ? <td className="num font-bold text-brand">{omr(bonus(r.pts), lang)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">{t.an_cash_note}</p>
          </Section>
        </div>
      )}
    </>
  );
}
