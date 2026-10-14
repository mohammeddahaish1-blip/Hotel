import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime, gregorian, omr, todayIn, whatsappLink } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import { addExpense, closeShift, openShift, postDueRent } from "@/app/actions/ops";

const CATEGORIES = ["utilities", "salaries", "maintenance", "supplies", "laundry", "marketing", "rent", "commission", "government", "other"];

type Aging = { folio_id: string; reservation_id: string | null; code: string | null; guest_name: string | null; phone: string | null; unit: string | null; balance: number; since: string; age_days: number; bucket: string };

export default async function FinancePage() {
  const ctx = await requireArea("finance");
  const { t, lang } = await getDict();
  const db = ctx.supabase;
  const today = todayIn(ctx.property.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  const seesMoney = ["owner", "manager", "accountant"].includes(ctx.role);

  const [{ data: myShift }, { data: shifts }, { data: expenses }, { data: aging }] = await Promise.all([
    db.from("cash_shifts").select("*").eq("property_id", ctx.property.id).eq("opened_by", ctx.userId).is("closed_at", null).maybeSingle(),
    seesMoney
      ? db.from("cash_shifts").select("*").eq("property_id", ctx.property.id).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] }),
    seesMoney
      ? db.from("expenses").select("*").eq("property_id", ctx.property.id).gte("expense_date", monthStart).order("expense_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    db.rpc("aging_report", { p_property: ctx.property.id }),
  ]);
  const { data: staff } = await db.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId);
  const staffName = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const { data: expected } = myShift ? await db.rpc("shift_expected_cash", { p_shift: myShift.id }) : { data: null };
  const agingRows = (aging ?? []) as Aging[];
  const buckets = ["0-30", "31-60", "61-90", "90+"].map((b) => ({
    b,
    total: agingRows.filter((r) => r.bucket === b).reduce((a, r) => a + r.balance, 0),
  }));
  const expTotal = (expenses ?? []).reduce((a, e) => a + e.amount, 0);

  return (
    <>
      <PageHeader
        title={t.fin_title}
        actions={
          <ActionForm action={postDueRent}>
            <SubmitButton className="btn-ghost btn-sm">{t.post_rent}</SubmitButton>
          </ActionForm>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t.shift}>
          {myShift ? (
            <div className="space-y-3">
              <div className="text-sm text-muted">{dateTime(myShift.opened_at, ctx.property.timezone, lang)}</div>
              <div className="flex justify-between text-sm"><span>{t.shift_float}</span><span className="num">{omr(myShift.opening_float, lang)}</span></div>
              <div className="flex justify-between font-bold"><span>{t.shift_expected}</span><span className="num">{omr(Number(expected ?? 0), lang)}</span></div>
              <ActionForm action={closeShift} className="space-y-2">
                <input type="hidden" name="shift" value={myShift.id} />
                <Field label={t.shift_counted}><input name="counted" required inputMode="decimal" className="input" /></Field>
                <Field label={t.notes}><input name="notes" className="input" /></Field>
                <SubmitButton className="btn-primary w-full" confirm={t.shift_close}>{t.shift_close}</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ActionForm action={openShift} className="space-y-2">
              <p className="text-sm text-muted">{t.shift_none}</p>
              <Field label={t.shift_float}><input name="float" defaultValue="0" inputMode="decimal" className="input" /></Field>
              <SubmitButton className="btn-primary w-full">{t.shift_open}</SubmitButton>
            </ActionForm>
          )}
        </Section>

        <div className="lg:col-span-2">
          <Section title={t.aging}>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {buckets.map((x) => (
                <div key={x.b} className="rounded-xl bg-surface-2 p-2 text-center">
                  <div className="text-xs text-muted">{x.b} {t.aging_days}</div>
                  <div className={`num text-sm font-bold ${x.total > 0 && x.b !== "0-30" ? "text-danger" : ""}`}>{omr(x.total, lang)}</div>
                </div>
              ))}
            </div>
            {agingRows.length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>{t.guest}</th><th>{t.unit}</th><th>{t.aging_since}</th><th>{t.balance}</th><th></th></tr></thead>
                  <tbody>
                    {agingRows.map((r) => (
                      <tr key={r.folio_id}>
                        <td>{r.reservation_id ? <Link href={`/reservations/${r.reservation_id}`} className="text-brand">{r.guest_name}</Link> : r.guest_name}</td>
                        <td className="num">{r.unit}</td>
                        <td>{gregorian(r.since, lang)} <Badge tone={r.age_days > 60 ? "danger" : r.age_days > 30 ? "warn" : "gray"}>{r.age_days} {t.aging_days}</Badge></td>
                        <td className="num font-semibold">{omr(r.balance, lang)}</td>
                        <td>
                          {r.phone ? (
                            <a
                              className="btn-ghost btn-sm"
                              target="_blank"
                              rel="noreferrer"
                              href={whatsappLink(
                                r.phone,
                                `${ctx.property.name_ar}\nتذكير ودّي: يوجد رصيد مستحق ${omr(r.balance, "ar")} على الحجز ${r.code ?? ""}.\nFriendly reminder: balance due ${omr(r.balance, "en")}.`,
                              )}
                            >
                              {t.remind_whatsapp}
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>

      {seesMoney || ctx.role === "reception" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Section title={t.expense_add}>
            <ActionForm action={addExpense} resetOnSuccess className="space-y-2">
              <Field label={t.category}>
                <select name="category" className="input">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t[`ec_${c}` as DictKey]}</option>)}
                </select>
              </Field>
              <Field label={t.description}><input name="description" required className="input" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.amount}><input name="amount" required inputMode="decimal" className="input" /></Field>
                <Field label={t.method}>
                  <select name="method" className="input">
                    {["cash", "card", "transfer"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                  </select>
                </Field>
              </div>
              <Field label={t.date}><input type="date" name="date" defaultValue={today} className="input" /></Field>
              <SubmitButton className="btn-primary w-full">{t.add}</SubmitButton>
            </ActionForm>
          </Section>
          {seesMoney ? (
            <div className="space-y-4 lg:col-span-2">
              <Section title={`${t.expenses} · ${omr(expTotal, lang)}`}>
                {(expenses ?? []).length === 0 ? (
                  <Empty>{t.none}</Empty>
                ) : (
                  <table className="table">
                    <tbody>
                      {(expenses ?? []).map((e) => (
                        <tr key={e.id}>
                          <td>{gregorian(e.expense_date, lang)}</td>
                          <td>{t[`ec_${e.category}` as DictKey]}</td>
                          <td>{e.description}</td>
                          <td className="num">{omr(e.amount, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
              <Section title={t.shift_history}>
                {(shifts ?? []).length === 0 ? (
                  <Empty>{t.none}</Empty>
                ) : (
                  <table className="table">
                    <thead><tr><th>{t.date}</th><th>{t.audit_actor}</th><th>{t.shift_expected}</th><th>{t.shift_counted}</th><th>{t.shift_difference}</th></tr></thead>
                    <tbody>
                      {(shifts ?? []).map((sh) => (
                        <tr key={sh.id}>
                          <td>{dateTime(sh.closed_at, ctx.property.timezone, lang)}</td>
                          <td>{staffName.get(sh.opened_by) || "—"}</td>
                          <td className="num">{omr(sh.expected_cash, lang)}</td>
                          <td className="num">{omr(sh.counted_cash, lang)}</td>
                          <td className={`num font-semibold ${sh.difference < 0 ? "text-danger" : sh.difference > 0 ? "text-warn" : "text-ok"}`}>{omr(sh.difference, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
