import { BarChart3, CreditCard, Download, Receipt, ShieldCheck } from "lucide-react";
import { DownloadLink } from "@/components/DownloadLink";
import { can, requireArea } from "@/lib/auth";
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
  // the ministry's statistics are monthly: last month by default, or the chosen period
  const picked = typeof sp.from === "string" && !!sp.from;
  const prevEnd = addDays(`${today.slice(0, 8)}01`, -1);
  const mFrom = picked ? from : `${prevEnd.slice(0, 8)}01`;
  const mTo = picked ? to : prevEnd;
  const db = ctx.supabase;

  const [{ data: police }, { data: stats }, { data: taxes }, { data: history }] = await Promise.all([
    db.rpc("police_register", { p_property: ctx.property.id, p_from: from, p_to: to }),
    db.rpc("ministry_statistics", { p_property: ctx.property.id, p_from: mFrom, p_to: mTo }),
    db.rpc("tax_liability", { p_property: ctx.property.id, p_from: q.start, p_to: q.end }),
    db.from("compliance_submissions").select("*").eq("property_id", ctx.property.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const rows = (police ?? []) as Police[];
  const st = stats as Stats | null;
  const missing = rows.filter((r) => !r.doc_number || !r.nationality).length;

  // Where each guest's ID data came from (card reader / photo / typed) and the latest card copy
  const codes = rows.map((r) => r.reservation_code);
  const { data: resGuests } = codes.length
    ? await db.from("reservations").select("code, guest_id, guests(doc_source)").eq("property_id", ctx.property.id).in("code", codes)
    : { data: [] };
  const guestOf = new Map((resGuests ?? []).map((x) => [x.code as string, x as unknown as { guest_id: string; guests: { doc_source: string | null } | null }]));
  const seesCopy = can(ctx, "guests");
  const guestIds = [...new Set((resGuests ?? []).map((x) => x.guest_id as string))];
  const { data: docs } = seesCopy && guestIds.length
    ? await db.from("guest_documents").select("id, guest_id, created_at").in("guest_id", guestIds).order("created_at", { ascending: false })
    : { data: [] };
  const copyOf = new Map<string, string>();
  for (const d of docs ?? []) if (!copyOf.has(d.guest_id as string)) copyOf.set(d.guest_id as string, d.id as string);
  const fromReader = rows.filter((r) => guestOf.get(r.reservation_code)?.guests?.doc_source === "reader").length;

  // ---- each authority as one task: what is due, and the last file made for it
  type Sub = { id: string; authority: string; status: string; period: string; created_at: string };
  const subs = (history ?? []) as unknown as Sub[];
  const covers = (h: Sub, a: string, b: string) => { const p = parseRange(h.period); return p.from <= a && b <= p.to; };
  // police: reported once a file covering the period was marked as uploaded; otherwise the newest file still waits for step 2
  const ropDone = subs.some((h) => h.authority === "rop" && h.status === "submitted" && covers(h, from, to));
  const ropWaiting = subs.find((h) => h.authority === "rop" && h.status === "generated" && covers(h, from, to));
  const mhtDone = subs.some((h) => h.authority === "mht" && h.status === "submitted" && covers(h, mFrom, mTo));
  const mhtWaiting = subs.find((h) => h.authority === "mht" && h.status === "generated" && covers(h, mFrom, mTo));
  const guestsCount = (st?.by_nationality ?? []).reduce((a, n) => a + n.guests, 0);
  const taxDue = ((taxes ?? []) as Tax[]).reduce((a, x) => a + Number(x.net), 0);
  // estimated dates until the official ones are confirmed: statistics by the 10th of the following month, fees 30 days after the quarter
  const mhtDue = `${addDays(mTo, 1).slice(0, 8)}10`;
  const taxDueDate = addDays(q.end, 30);
  const estimated = (d: string) => t.cmp_due_est.replace("{d}", gregorian(d, lang));
  const stepNo = "num grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold";
  const steps = (kind: "police" | "ministry", a: string, b: string, waiting: Sub | undefined, done: boolean) => (
    <ol className="mt-4 space-y-2">
      <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <span className={`${stepNo} bg-brand text-brand-ink`}>1</span>
        <span className="min-w-40 flex-1 font-semibold">{t.cmp_step1}</span>
        <DownloadLink href={`/api/export?kind=${kind}&from=${a}&to=${b}`} className={done ? "btn-ghost btn-sm" : "btn-primary btn-sm"}><Download className="size-4 shrink-0" />{t.cmp_step1}</DownloadLink>
      </li>
      <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <span className={`${stepNo} ${waiting ? "bg-brand text-brand-ink" : "bg-gray-soft text-muted"}`}>2</span>
        <span className="min-w-40 flex-1">
          <span className="font-semibold">{t.cmp_step2}</span>
          <span className="block text-xs text-muted">{waiting ? t.cmp_step2_hint : done ? t.cmp_mark_submitted : t.cmp_step2_wait}</span>
        </span>
        {waiting ? (
          <ActionForm action={logSubmission}>
            <input type="hidden" name="id" value={waiting.id} />
            <SubmitButton className="btn-primary btn-sm">{t.cmp_mark_submitted}</SubmitButton>
          </ActionForm>
        ) : null}
      </li>
    </ol>
  );
  const more = "mt-3 text-sm";
  const moreSummary = "cursor-pointer font-semibold text-brand";

  return (
    <>
      <PageHeader title={t.cmp_title} sub={t.cmp_intro} />

      <div className="space-y-4">
        <section className="card">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><ShieldCheck className="size-6" aria-hidden /></span>
            <div className="min-w-56 flex-1">
              <h2 className="h2">{t.cmp_rop_name}</h2>
              <p className="mt-1 text-sm">{rows.length ? t.cmp_rop_text.replace("{n}", String(rows.length)) : t.cmp_rop_none}</p>
              <p className="text-xs text-muted">{t.cmp_daily} · {from === to ? gregorian(from, lang) : `${gregorian(from, lang)} – ${gregorian(to, lang)}`}</p>
            </div>
            <Badge tone={ropDone ? "ok" : rows.length ? "danger" : "gray"}>{ropDone ? t.cmp_mark_submitted : rows.length ? t.cmp_today_due : t.cmp_nothing}</Badge>
          </div>
          {missing ? <div className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{t.err_GUEST_DATA_INCOMPLETE} ({missing})</div> : null}
          {rows.length ? steps("police", from, to, ropWaiting, ropDone) : null}
          {rows.length ? (
            <details className={more}>
              <summary className={moreSummary}>{t.cmp_show_names} ({rows.length})</summary>
              <p className="my-2 text-xs text-muted">{t.cmp_from_reader}: <b className="num">{fromReader} / {rows.length}</b></p>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t.code}</th><th>{t.name}</th><th>{t.nationality}</th><th>{t.doc_number}</th><th>{t.cmp_source}</th><th>{t.unit}</th><th>{t.res_check_in}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.reservation_code}>
                      <td>{r.reservation_code}</td>
                      <td>{r.guest_name}</td>
                      <td>{r.nationality}</td>
                      <td>{r.doc_type ? `${t[`dt_${r.doc_type}` as DictKey]} · ` : ""}{r.doc_number}</td>
                      <td>
                        {(() => {
                          const g = guestOf.get(r.reservation_code);
                          const src = g?.guests?.doc_source;
                          const copy = g ? copyOf.get(g.guest_id) : undefined;
                          return (
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              {src ? <Badge tone={src === "manual" ? "gray" : "ok"}>{t[`ds_${src}` as DictKey]}</Badge> : <span className="text-muted">—</span>}
                              {copy ? (
                                <a href={`/api/guest-doc/${copy}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand">
                                  <CreditCard className="size-3.5 shrink-0" />{t.cmp_copy}
                                </a>
                              ) : null}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="num">{r.unit}</td>
                      <td>{dateTime(r.check_in, ctx.property.timezone, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </details>
          ) : null}
        </section>

        <section className="card">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><BarChart3 className="size-6" aria-hidden /></span>
            <div className="min-w-56 flex-1">
              <h2 className="h2">{t.cmp_mht_name}</h2>
              <p className="mt-1 text-sm">{t.cmp_mht_text.replace("{n}", String(st?.occupancy.room_nights_sold ?? 0)).replace("{g}", String(guestsCount))}</p>
              <p className="text-xs text-muted">{gregorian(mFrom, lang)} – {gregorian(mTo, lang)}</p>
            </div>
            <Badge tone={mhtDone ? "ok" : "warn"}>{mhtDone ? t.cmp_mark_submitted : estimated(mhtDue)}</Badge>
          </div>
          {steps("ministry", mFrom, mTo, mhtWaiting, mhtDone)}
          <details className={more}>
            <summary className={moreSummary}>{t.cmp_show_details}</summary>
            <div className="mt-2">
            {st ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-surface-2 p-2">{t.rep_sold}: <b className="num">{st.occupancy.room_nights_sold} / {st.occupancy.room_nights_available}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.rep_room_revenue}: <b className="num">{omr(st.occupancy.room_revenue, lang)}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.invoiced}: <b className="num">{omr(st.invoiced_revenue, lang)}</b></div>
                  <div className="rounded-xl bg-surface-2 p-2">{t.set_staff}: <b className="num">{st.employees}</b></div>
                </div>
                <div className="overflow-x-auto"><table className="table">
                  <thead><tr><th>{t.nationality}</th><th>{t.guest}</th><th>{t.nightsLabel}</th></tr></thead>
                  <tbody>
                    {st.by_nationality.map((n) => (
                      <tr key={n.nationality}><td>{n.nationality}</td><td className="num">{n.guests}</td><td className="num">{n.nights}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            ) : null}
            </div>
          </details>
        </section>

        <section className="card">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><Receipt className="size-6" aria-hidden /></span>
            <div className="min-w-56 flex-1">
              <h2 className="h2">{t.cmp_tax_name}</h2>
              <p className="mt-1 text-sm">{t.cmp_tax_text.replace("{x}", omr(taxDue, lang))}</p>
              <p className="text-xs text-muted">{gregorian(q.start, lang)} – {gregorian(q.end, lang)}</p>
            </div>
            <Badge tone="gray">{estimated(taxDueDate)}</Badge>
          </div>
          <details className={more}>
            <summary className={moreSummary}>{t.cmp_show_details}</summary>
            <p className="my-2 text-xs text-muted">{t.cmp_tax_hint}</p>
            {(taxes ?? []).length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <div className="overflow-x-auto"><table className="table">
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
              </table></div>
            )}
          </details>
        </section>

        <p className="text-xs text-muted">{t.cmp_est_note}</p>

        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">{t.cmp_other_period}</summary>
          <form className="mt-3 grid gap-2 sm:grid-cols-4">
            <Field label={t.from}><input type="date" name="from" defaultValue={from} className="input" /></Field>
            <Field label={t.to}><input type="date" name="to" defaultValue={to} className="input" /></Field>
            <div className="flex items-end"><button className="btn-primary w-full">{t.run}</button></div>
          </form>
        </details>

        <details className="card">
          <summary className="cursor-pointer text-sm font-semibold">{t.cmp_sent_before} ({subs.length})</summary>
          <div className="mt-3">
          {subs.length === 0 ? (
            <Empty>{t.none}</Empty>
          ) : (
            <div className="overflow-x-auto"><table className="table">
              <tbody>
                {(history ?? []).map((h) => {
                  const p = parseRange(h.period as string);
                  return (
                    <tr key={h.id}>
                      <td>{dateTime(h.created_at, ctx.property.timezone, lang)}</td>
                      <td>{h.authority === "rop" ? t.cmp_rop_name : h.authority === "mht" ? t.cmp_mht_name : h.authority}</td>
                      <td>{gregorian(p.from, lang)} → {gregorian(p.to, lang)}</td>
                      <td className="num">{h.record_count}</td>
                      <td><Badge tone={h.status === "submitted" ? "ok" : "warn"}>{h.status === "submitted" ? t.cmp_mark_submitted : t.cmp_not_uploaded}</Badge></td>
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
            </table></div>
          )}
          </div>
        </details>
      </div>
    </>
  );
}
