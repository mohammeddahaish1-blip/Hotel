import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { addDays, dateTime, omr, parseRange, todayIn, gregorian } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import { logSubmission } from "@/app/actions/ops";

type Police = { reservation_code: string; guest_name: string; nationality: string | null; doc_type: string | null; doc_number: string | null; unit: string; check_in: string; check_out: string | null };
type Stats = { by_nationality: { nationality: string; guests: number; nights: number }[]; occupancy: { room_nights_sold: number; room_nights_available: number; room_revenue: number }; invoiced_revenue: number; employees: number };
type Tax = { code: string; name_ar: string; invoiced: number; credited: number; net: number };

function quarterOf(d: string) {
  const y = Number(d.slice(0, 4));
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const endMonth = q * 3 + 4;
  const end = endMonth > 12 ? `${y + 1}-01-01` : `${y}-${String(endMonth).padStart(2, "0")}-01`;
  return { start, end: addDays(end, -1) };
}

// Section 7: CR-01 (ROP guest register), CR-02 (ministry stats), CR-03..06 (fees payable)
export default async function CompliancePage({ searchParams }: PageProps<"/compliance">) {
  const ctx = await requireArea("compliance");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const from = typeof sp.from === "string" && sp.from ? sp.from : today;
  const to = typeof sp.to === "string" && sp.to ? sp.to : today;
  const q = quarterOf(today);
  const db = ctx.supabase;

  const [{ data: police }, { data: stats }, { data: taxes }, { data: history }] = await Promise.all([
    db.rpc("police_register", { p_property: ctx.property.id, p_from: from, p_to: to }),
    db.rpc("ministry_statistics", { p_property: ctx.property.id, p_from: from, p_to: to }),
    db.rpc("tax_liability", { p_property: ctx.property.id, p_from: q.start, p_to: q.end }),
    db.from("compliance_submissions").select("*").eq("property_id", ctx.property.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const rows = (police ?? []) as Police[];
  const st = stats as Stats | null;
  const missing = rows.filter((r) => !r.doc_number || !r.nationality).length;

  return (
    <>
      <PageHeader title={t.cmp_title} />
      <form className="card mb-4 grid gap-2 sm:grid-cols-4">
        <Field label={t.from}><input type="date" name="from" defaultValue={from} className="input" /></Field>
        <Field label={t.to}><input type="date" name="to" defaultValue={to} className="input" /></Field>
        <div className="flex items-end"><button className="btn-primary w-full">{t.run}</button></div>
      </form>

      <div className="space-y-4">
        <Section
          title={`${t.cmp_police} (${rows.length})`}
          actions={<a href={`/api/export?kind=police&from=${from}&to=${to}`} className="btn-primary btn-sm">{t.cmp_generate}</a>}
        >
          <p className="mb-3 text-xs text-muted">{t.cmp_police_hint}</p>
          {missing ? <div className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{t.err_GUEST_DATA_INCOMPLETE} ({missing})</div> : null}
          {rows.length === 0 ? (
            <Empty>{t.none}</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t.code}</th><th>{t.name}</th><th>{t.nationality}</th><th>{t.doc_number}</th><th>{t.unit}</th><th>{t.res_check_in}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.reservation_code}>
                      <td>{r.reservation_code}</td>
                      <td>{r.guest_name}</td>
                      <td>{r.nationality}</td>
                      <td>{r.doc_type ? `${t[`dt_${r.doc_type}` as DictKey]} · ` : ""}{r.doc_number}</td>
                      <td className="num">{r.unit}</td>
                      <td>{dateTime(r.check_in, ctx.property.timezone, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title={t.cmp_ministry}
            actions={<a href={`/api/export?kind=ministry&from=${from}&to=${to}`} className="btn-ghost btn-sm">{t.cmp_generate}</a>}
          >
            {st ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-surface-2 p-2">{t.rep_sold}: <b className="num">{st.occupancy.room_nights_sold} / {st.occupancy.room_nights_available}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.rep_room_revenue}: <b className="num">{omr(st.occupancy.room_revenue, lang)}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.invoiced}: <b className="num">{omr(st.invoiced_revenue, lang)}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.set_staff}: <b className="num">{st.employees}</b></div>
                </div>
                <table className="table">
                  <thead><tr><th>{t.nationality}</th><th>{t.guest}</th><th>{t.nightsLabel}</th></tr></thead>
                  <tbody>
                    {st.by_nationality.map((n) => (
                      <tr key={n.nationality}><td>{n.nationality}</td><td className="num">{n.guests}</td><td className="num">{n.nights}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Section>

          <Section title={`${t.cmp_tax} · ${gregorian(q.start, lang)} → ${gregorian(q.end, lang)}`}>
            <p className="mb-3 text-xs text-muted">{t.cmp_tax_hint}</p>
            {(taxes ?? []).length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>{t.taxes}</th><th>{t.invoiced}</th><th>{t.credited}</th><th>{t.net}</th></tr></thead>
                <tbody>
                  {((taxes ?? []) as Tax[]).map((x) => (
                    <tr key={x.code}>
                      <td>{x.name_ar}</td>
                      <td className="num">{omr(x.invoiced, lang)}</td>
                      <td className="num">{omr(x.credited, lang)}</td>
                      <td className="num font-bold">{omr(x.net, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>

        <Section title={t.cmp_history}>
          {(history ?? []).length === 0 ? (
            <Empty>{t.none}</Empty>
          ) : (
            <table className="table">
              <tbody>
                {(history ?? []).map((h) => {
                  const p = parseRange(h.period as string);
                  return (
                    <tr key={h.id}>
                      <td>{dateTime(h.created_at, ctx.property.timezone, lang)}</td>
                      <td>{h.authority === "rop" ? "ROP" : h.authority === "mht" ? "MHT" : h.authority}</td>
                      <td>{gregorian(p.from, lang)} → {gregorian(p.to, lang)}</td>
                      <td className="num">{h.record_count}</td>
                      <td><Badge tone={h.status === "submitted" ? "ok" : "warn"}>{h.status}</Badge></td>
                      <td>
                        {h.status === "generated" ? (
                          <ActionForm action={logSubmission}>
                            <input type="hidden" name="id" value={h.id} />
                            <SubmitButton className="btn-ghost btn-sm">{t.cmp_mark_submitted}</SubmitButton>
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
