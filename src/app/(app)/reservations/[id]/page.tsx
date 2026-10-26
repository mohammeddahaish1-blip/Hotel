import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime, gregorian, hijri, nights, omr, parseRange, todayIn, whatsappLink } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section, RES_STATUS_TONE, RES_STATUS_EMOJI, Crumb } from "@/components/ui";
import {
  addCharge, addPayment, cancelReservation, changeReservation, checkIn, checkOut, issueInvoice, voidCharge, voidPayment,
} from "@/app/actions/ops";

type TaxLine = { code: string; name_ar: string; name_en: string; rate_bp: number; amount: number };
type Summary = {
  invoiced_total: number; uninvoiced_subtotal: number; uninvoiced_taxes: TaxLine[]; uninvoiced_tax_total: number;
  total: number; paid: number; deposit_held: number; balance: number;
};

const CHARGE_KINDS = ["service", "food", "laundry", "damage", "utility", "room", "rent", "discount", "other"];
const PAY_KINDS = ["payment", "deposit", "deposit_applied", "deposit_refund", "refund"];
const METHODS = ["cash", "card", "transfer", "link"];

export default async function ReservationPage({ params }: PageProps<"/reservations/[id]">) {
  const ctx = await requireArea("reservations");
  const { t, lang } = await getDict();
  const { id } = await params;
  const db = ctx.supabase;

  const { data: r } = await db
    .from("reservations")
    .select("*, guests(id, full_name, phone, preferred_language, doc_number, nationality), units(id, number, unit_types(name_ar))")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();
  const guest = r.guests as unknown as { id: string; full_name: string; phone: string | null; preferred_language: string; doc_number: string | null; nationality: string | null };
  const unit = r.units as unknown as { id: string; number: string; unit_types: { name_ar: string } };
  const stay = parseRange(r.stay as string);
  const today = todayIn(ctx.property.timezone);
  const canOperate = hasRole(ctx, ["manager", "reception"]);

  const { data: folio } = await db.from("folios").select("id, status").eq("reservation_id", id).maybeSingle();
  const [{ data: summary }, { data: charges }, { data: payments }, { data: invoices }, { data: contract }, { data: units }] = await Promise.all([
    folio ? db.rpc("folio_summary", { p_folio: folio.id }) : Promise.resolve({ data: null }),
    folio ? db.from("charges").select("*").eq("folio_id", folio.id).order("created_at") : Promise.resolve({ data: [] }),
    folio ? db.from("payments").select("*").eq("folio_id", folio.id).order("received_at") : Promise.resolve({ data: [] }),
    folio ? db.from("invoices").select("id, series, number, total, issued_at").eq("folio_id", folio.id).order("number") : Promise.resolve({ data: [] }),
    r.kind === "contract" ? db.from("contracts").select("*, billing_schedules(*)").eq("reservation_id", id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("units").select("id, number").eq("property_id", ctx.property.id).eq("active", true).order("number"),
  ]);
  const sum = summary as Summary | null;

  const propName = ctx.property.name_ar;
  const confirmText =
    guest.preferred_language === "en"
      ? `Booking confirmed at ${ctx.property.name_en ?? propName}\nRef: ${r.code}\nUnit: ${unit.number}\nArrival: ${stay.from}\nDeparture: ${stay.to}\nTotal: ${omr(sum?.total ?? 0, "en")}\nBalance: ${omr(sum?.balance ?? 0, "en")}`
      : `تم تأكيد حجزكم في ${propName}\nرقم الحجز: ${r.code}\nالوحدة: ${unit.number}\nالوصول: ${stay.from}\nالمغادرة: ${stay.to}\nالإجمالي: ${omr(sum?.total ?? 0, "ar")}\nالمتبقي: ${omr(sum?.balance ?? 0, "ar")}`;

  const schedules = ((contract as { billing_schedules?: { id: string; period: string; due_date: string; amount: number; status: string }[] } | null)?.billing_schedules ?? [])
    .filter((b) => b.status !== "cancelled")
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <>
      <Crumb href="/reservations" label={t.nav_reservations} />
      <PageHeader
        title={`${t.res_details} ${r.code}`}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={RES_STATUS_TONE[r.status]}><span aria-hidden>{RES_STATUS_EMOJI[r.status]}</span> {t[`rs_${r.status}` as DictKey]}</Badge>
            <span>{t[`kind_${r.kind}` as DictKey]} · {t[`src_${r.source}` as DictKey]}</span>
          </span>
        }
        actions={
          guest.phone ? (
            <a href={whatsappLink(guest.phone, confirmText)} target="_blank" rel="noreferrer" className="btn-ghost">
              {t.res_share_confirmation}
            </a>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card grid gap-3 sm:grid-cols-3">
            <div>
              <div className="label">{t.guest}</div>
              <Link href={`/guests/${guest.id}`} className="font-semibold text-brand">{guest.full_name}</Link>
              <div dir="ltr" className="text-start text-xs text-muted">{guest.phone}</div>
            </div>
            <div>
              <div className="label">{t.unit}</div>
              <div className="font-semibold">{unit.number}</div>
              <div className="text-xs text-muted">{unit.unit_types?.name_ar}</div>
            </div>
            <div>
              <div className="label">{t.from} → {t.to}</div>
              <div className="font-semibold">{gregorian(stay.from, lang)} → {gregorian(stay.to, lang)}</div>
              <div className="text-xs text-muted">{hijri(stay.from, lang)} · {nights(stay.from, stay.to)} {t.nightsLabel}</div>
            </div>
            {r.checked_in_at ? <div className="text-xs text-muted">{t.res_check_in}: {dateTime(r.checked_in_at, ctx.property.timezone, lang)}</div> : null}
            {r.checked_out_at ? <div className="text-xs text-muted">{t.res_check_out}: {dateTime(r.checked_out_at, ctx.property.timezone, lang)}</div> : null}
            {r.notes ? <div className="text-sm sm:col-span-3">{r.notes}</div> : null}
          </div>

          {canOperate ? (
            <div className="card flex flex-wrap gap-2">
              {["tentative", "confirmed"].includes(r.status) && stay.from <= today ? (
                <ActionForm action={checkIn}>
                  <input type="hidden" name="id" value={id} />
                  <SubmitButton>{t.res_check_in}</SubmitButton>
                </ActionForm>
              ) : null}
              {r.status === "checked_in" ? (
                <ActionForm action={checkOut} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={id} />
                  {sum && sum.balance > 0 ? (
                    <>
                      <span className="text-sm text-danger">{t.res_balance_warning}: {omr(sum.balance, lang)}</span>
                      <input type="hidden" name="allow_balance" value="1" />
                      <SubmitButton className="btn-danger" confirm={t.res_balance_warning}>{t.res_force_checkout}</SubmitButton>
                    </>
                  ) : (
                    <SubmitButton>{t.res_check_out}</SubmitButton>
                  )}
                </ActionForm>
              ) : null}
              {["tentative", "confirmed"].includes(r.status) ? (
                <>
                  <ActionForm action={cancelReservation} className="flex gap-2">
                    <input type="hidden" name="id" value={id} />
                    <input name="reason" placeholder={t.res_cancel_reason} className="input w-44" />
                    <SubmitButton className="btn-ghost" confirm={t.res_cancel}>{t.res_cancel}</SubmitButton>
                  </ActionForm>
                  {stay.from <= today ? (
                    <ActionForm action={cancelReservation}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="no_show" value="1" />
                      <SubmitButton className="btn-ghost" confirm={t.res_no_show}>{t.res_no_show}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {canOperate && ["tentative", "confirmed", "checked_in"].includes(r.status) ? (
            <Section title={t.res_change}>
              <ActionForm action={changeReservation} className="grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="id" value={id} />
                <Field label={t.unit}>
                  <select name="unit" defaultValue={unit.id} className="input">
                    {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
                  </select>
                </Field>
                <Field label={t.from}><input type="date" name="from" defaultValue={stay.from} readOnly={r.status === "checked_in"} className="input" /></Field>
                <Field label={t.to}><input type="date" name="to" defaultValue={stay.to} className="input" /></Field>
                <div className="flex items-end"><SubmitButton className="btn-ghost w-full">{t.save}</SubmitButton></div>
              </ActionForm>
            </Section>
          ) : null}

          {folio ? (
            <Section title={t.charges}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>{t.date}</th><th>{t.charge_kind}</th><th>{t.description}</th><th>{t.amount}</th><th></th></tr></thead>
                  <tbody>
                    {(charges ?? []).map((c) => (
                      <tr key={c.id} className={c.voided_at ? "text-muted line-through" : ""}>
                        <td>{gregorian(c.service_date, lang)}</td>
                        <td>{t[`ck_${c.kind}` as DictKey]}</td>
                        <td>{c.description}{c.invoice_id ? <Badge tone="ok">{t.invoiced}</Badge> : null}</td>
                        <td className="num">{omr(c.amount, lang)}</td>
                        <td>
                          {!c.voided_at && !c.invoice_id && canOperate ? (
                            <ActionForm action={voidCharge}>
                              <input type="hidden" name="id" value={c.id} />
                              <input type="hidden" name="res" value={id} />
                              <SubmitButton className="btn-ghost btn-sm" confirm={t.void}>{t.void}</SubmitButton>
                            </ActionForm>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ActionForm action={addCharge} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="folio" value={folio.id} />
                <input type="hidden" name="res" value={id} />
                <select name="kind" className="input">
                  {CHARGE_KINDS.map((k) => <option key={k} value={k}>{t[`ck_${k}` as DictKey]}</option>)}
                </select>
                <input name="description" required placeholder={t.description} className="input sm:col-span-2" />
                <input name="amount" required inputMode="decimal" placeholder={t.amount} className="input" />
                <SubmitButton className="btn-ghost">{t.add_charge}</SubmitButton>
                <label className="flex items-center gap-2 text-xs text-muted sm:col-span-5">
                  <input type="checkbox" name="taxable" defaultChecked /> {t.taxable}
                </label>
              </ActionForm>
            </Section>
          ) : null}

          {folio ? (
            <Section title={t.payments}>
              {(payments ?? []).length === 0 ? (
                <Empty>{t.none}</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>{t.date}</th><th>{t.type}</th><th>{t.method}</th><th>{t.reference}</th><th>{t.amount}</th><th></th></tr></thead>
                    <tbody>
                      {(payments ?? []).map((p) => (
                        <tr key={p.id} className={p.voided_at ? "text-muted line-through" : ""}>
                          <td>{dateTime(p.received_at, ctx.property.timezone, lang)}</td>
                          <td>{t[`pk_${p.kind}` as DictKey]}</td>
                          <td>{t[`pm_${p.method}` as DictKey]}</td>
                          <td>{p.reference ?? ""}</td>
                          <td className="num">{omr(p.amount, lang)}</td>
                          <td>
                            {!p.voided_at && hasRole(ctx, ["manager", "accountant"]) ? (
                              <ActionForm action={voidPayment}>
                                <input type="hidden" name="id" value={p.id} />
                                <input type="hidden" name="res" value={id} />
                                <SubmitButton className="btn-ghost btn-sm" confirm={t.void}>{t.void}</SubmitButton>
                              </ActionForm>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <ActionForm action={addPayment} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="folio" value={folio.id} />
                <input type="hidden" name="res" value={id} />
                <select name="kind" className="input">
                  {PAY_KINDS.map((k) => <option key={k} value={k}>{t[`pk_${k}` as DictKey]}</option>)}
                </select>
                <select name="method" className="input">
                  {METHODS.map((k) => <option key={k} value={k}>{t[`pm_${k}` as DictKey]}</option>)}
                </select>
                <input name="amount" required inputMode="decimal" placeholder={t.amount} defaultValue={sum && sum.balance > 0 ? (sum.balance / 1000).toFixed(3) : ""} className="input" />
                <input name="reference" placeholder={t.reference} className="input" />
                <SubmitButton>{t.add_payment}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}

          {schedules.length ? (
            <Section title={t.res_schedule}>
              <table className="table">
                <thead><tr><th>{t.date}</th><th>{t.from} → {t.to}</th><th>{t.amount}</th><th>{t.status}</th></tr></thead>
                <tbody>
                  {schedules.map((b) => {
                    const p = parseRange(b.period);
                    return (
                      <tr key={b.id}>
                        <td>{gregorian(b.due_date, lang)}</td>
                        <td>{gregorian(p.from, lang)} → {gregorian(p.to, lang)}</td>
                        <td className="num">{omr(b.amount, lang)}</td>
                        <td><Badge tone={b.status === "posted" ? "ok" : "gray"}>{b.status === "posted" ? (lang === "ar" ? "مُرحّل" : "Posted") : lang === "ar" ? "مجدول" : "Scheduled"}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          ) : null}
        </div>

        <div className="space-y-4">
          {sum ? (
            <Section title={t.folio}>
              <dl className="space-y-1.5 text-sm">
                {sum.invoiced_total ? <Row k={t.invoiced} v={omr(sum.invoiced_total, lang)} /> : null}
                <Row k={t.subtotal} v={omr(sum.uninvoiced_subtotal, lang)} />
                {sum.uninvoiced_taxes.map((x) => (
                  <Row key={x.code} k={`${lang === "ar" ? x.name_ar : x.name_en} (${x.rate_bp / 100}%)`} v={omr(x.amount, lang)} muted />
                ))}
                <div className="my-2 border-t border-line" />
                <Row k={t.total} v={omr(sum.total, lang)} bold />
                <Row k={t.paid} v={omr(sum.paid, lang)} />
                <Row k={t.balance} v={omr(sum.balance, lang)} bold tone={sum.balance > 0 ? "text-danger" : "text-ok"} />
                {sum.deposit_held ? <Row k={t.deposit_held} v={omr(sum.deposit_held, lang)} muted /> : null}
              </dl>
            </Section>
          ) : null}

          {folio ? (
            <Section title={t.invoices}>
              {(invoices ?? []).length ? (
                <ul className="mb-3 divide-y divide-line">
                  {(invoices ?? []).map((i) => (
                    <li key={i.id}>
                      <Link href={`/invoices/${i.id}`} className="flex justify-between py-2 text-sm">
                        <span className="font-semibold text-brand">{i.series}-{i.number}</span>
                        <span className="num">{omr(i.total, lang)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {sum && sum.uninvoiced_subtotal > 0 ? (
                <ActionForm action={issueInvoice} className="flex gap-2">
                  <input type="hidden" name="folio" value={folio.id} />
                  <select name="language" defaultValue={guest.preferred_language === "en" ? "en" : "bilingual"} className="input">
                    <option value="bilingual">عربي / English</option>
                    <option value="ar">عربي</option>
                    <option value="en">English</option>
                  </select>
                  <SubmitButton>{t.issue_invoice}</SubmitButton>
                </ActionForm>
              ) : null}
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ k, v, bold, muted, tone }: { k: string; v: string; bold?: boolean; muted?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-2 ${muted ? "text-muted" : ""} ${bold ? "font-bold" : ""} ${tone ?? ""}`}>
      <dt>{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
