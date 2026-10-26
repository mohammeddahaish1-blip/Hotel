import Link from "next/link";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { addDays, dateTime, gregorian, omr, todayIn, whatsappLink, zonedStart } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AmountInput, ReceiptInput, RemindAll } from "@/components/FinanceInputs";
import { BarList } from "@/components/charts";
import { Badge, Empty, Field, PageHeader, Section, Stat } from "@/components/ui";
import { Salaries } from "./Salaries";
import { addExpense, closeShift, deleteExpense, openShift, postDueRent, updateExpense } from "@/app/actions/ops";

const CATEGORIES = ["utilities", "salaries", "maintenance", "supplies", "laundry", "marketing", "rent", "commission", "government", "other"];
const METHODS = ["cash", "card", "transfer", "link"];
const BUCKETS = [
  { b: "0-30", key: "aging_b_0_30" },
  { b: "31-60", key: "aging_b_31_60" },
  { b: "61-90", key: "aging_b_61_90" },
  { b: "90+", key: "aging_b_90" },
] as const;

type Aging = { folio_id: string; reservation_id: string | null; code: string | null; guest_name: string | null; phone: string | null; unit: string | null; balance: number; since: string; age_days: number; bucket: string };
type Breakdown = { opening_float: number; cash_in: number; cash_refunds: number; cash_expenses: number; expected: number; payments_count: number; expenses_count: number };
type PaymentRow = {
  id: string; amount: number; kind: string; method: string; received_at: string; received_by: string | null; cash_shift_id: string | null;
  folios: { reservation_id: string | null; reservations: { code: string; guests: { full_name: string } | null } | null } | null;
};

const monthEnd = (m: string) => addDays(`${addMonth(m, 1)}-01`, -1);
function addMonth(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const change = (now: number, prev: number) => (prev === 0 ? null : Math.round(((now - prev) / Math.abs(prev)) * 100));

export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const ctx = await requireArea("finance");
  const { t, lang } = await getDict();
  const db = ctx.supabase;
  const tz = ctx.property.timezone;
  const sp = await searchParams;
  const today = todayIn(tz);
  const thisMonth = today.slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) && sp.month <= thisMonth ? sp.month : thisMonth;
  const cat = typeof sp.cat === "string" && CATEGORIES.includes(sp.cat) ? sp.cat : "";
  const shiftLimit = Math.min(Math.max(Number(sp.shifts) || 10, 10), 200);
  const from = `${month}-01`;
  const to = month === thisMonth ? today : monthEnd(month);
  const prevFrom = `${addMonth(month, -1)}-01`;
  const prevTo = month === thisMonth ? addDays(prevFrom, Number(today.slice(8)) - 1) : monthEnd(addMonth(month, -1));
  const seesMoney = hasRole(ctx, ["manager", "accountant"]);
  const monthLabel = new Intl.DateTimeFormat(intlLocale(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));

  const none = Promise.resolve({ data: null });
  const [{ data: myShift }, { data: shifts }, { data: expenses }, { data: prevExpenses }, { data: aging }, { data: income }, { data: prevIncome }, { data: payments }, { data: staff }] =
    await Promise.all([
      db.from("cash_shifts").select("*").eq("property_id", ctx.property.id).eq("opened_by", ctx.userId).is("closed_at", null).maybeSingle(),
      seesMoney
        ? db.from("cash_shifts").select("*").eq("property_id", ctx.property.id).not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(shiftLimit + 1)
        : none,
      seesMoney
        ? db.from("expenses").select("*").eq("property_id", ctx.property.id).gte("expense_date", from).lte("expense_date", monthEnd(month)).order("expense_date", { ascending: false })
        : none,
      seesMoney ? db.from("expenses").select("amount").eq("property_id", ctx.property.id).gte("expense_date", prevFrom).lte("expense_date", prevTo) : none,
      db.rpc("aging_report", { p_property: ctx.property.id }),
      seesMoney ? db.rpc("daily_income", { p_property: ctx.property.id, p_from: from, p_to: to }) : none,
      seesMoney ? db.rpc("daily_income", { p_property: ctx.property.id, p_from: prevFrom, p_to: prevTo }) : none,
      seesMoney
        ? db.from("payments")
            .select("id, amount, kind, method, received_at, received_by, cash_shift_id, folios!inner(property_id, reservation_id, reservations(code, guests(full_name)))")
            .eq("folios.property_id", ctx.property.id)
            .is("voided_at", null)
            .gte("received_at", zonedStart(from, tz))
            .lt("received_at", zonedStart(addDays(monthEnd(month), 1), tz))
            .order("received_at", { ascending: false })
        : none,
      db.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
    ]);
  const staffName = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const { data: bd } = myShift ? await db.rpc("shift_breakdown", { p_shift: myShift.id }) : { data: null };
  const breakdown = ((bd ?? []) as Breakdown[])[0];

  // ---- summary
  const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const collected = sum(income as { amount: number }[] | null);
  const prevCollected = sum(prevIncome as { amount: number }[] | null);
  const allExpenses = (expenses ?? []) as { id: string; amount: number; category: string; description: string; method: string; expense_date: string; created_by: string | null; attachment_path: string | null }[];
  const expTotal = sum(allExpenses);
  const prevExpTotal = sum(prevExpenses as { amount: number }[] | null);
  const net = collected - expTotal;
  const prevNet = prevCollected - prevExpTotal;
  const agingRows = (aging ?? []) as Aging[];
  const outstanding = agingRows.reduce((a, r) => a + r.balance, 0);
  const trend = (now: number, prev: number, goodUp = true) => {
    const c = change(now, prev);
    if (c === null) return undefined;
    const up = c >= 0;
    return <span className={up === goodUp ? "text-ok" : "text-danger"}>{up ? "↑" : "↓"} {Math.abs(c)}% {t.fin_vs_prev}</span>;
  };

  // ---- expenses
  const shownExpenses = cat ? allExpenses.filter((e) => e.category === cat) : allExpenses;
  const byCat = CATEGORIES.map((c) => ({ c, v: allExpenses.filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const receipts = new Map<string, string>();
  const withReceipt = shownExpenses.filter((e) => e.attachment_path);
  if (withReceipt.length) {
    const { data: urls } = await db.storage.from("expense-receipts").createSignedUrls(withReceipt.map((e) => e.attachment_path!), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && receipts.set(withReceipt[i].id, u.signedUrl));
  }

  // ---- payments
  const payRows = (payments ?? []) as unknown as PaymentRow[];
  const signed = (p: PaymentRow) => (p.kind === "refund" || p.kind === "deposit_refund" ? -p.amount : p.amount);
  const byMethod = METHODS.map((m) => ({ m, v: payRows.filter((p) => p.method === m).reduce((a, p) => a + signed(p), 0) })).filter((x) => x.v !== 0);
  const todayStart = zonedStart(today, tz);
  const todayTotal = payRows.filter((p) => p.received_at >= todayStart).reduce((a, p) => a + signed(p), 0);

  // ---- shifts
  const shiftRows = (shifts ?? []).slice(0, shiftLimit);
  const shiftIds = shiftRows.map((s) => s.id);
  const [{ data: shiftPays }, { data: shiftExps }] = shiftIds.length
    ? await Promise.all([
        db.from("payments").select("id, amount, kind, received_at, cash_shift_id, folios(reservations(code))").in("cash_shift_id", shiftIds).is("voided_at", null),
        db.from("expenses").select("id, amount, description, expense_date, cash_shift_id").in("cash_shift_id", shiftIds),
      ])
    : [{ data: [] }, { data: [] }];

  const qs = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(month !== thisMonth ? { month } : {}), ...(cat ? { cat } : {}), ...extra });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `/finance?${s}` : "/finance";
  };
  const overdue = agingRows.filter((r) => r.age_days > 30 && r.phone);
  const reminder = (r: Aging) =>
    whatsappLink(
      r.phone,
      `${ctx.property.name_ar}\nتذكير ودّي: يوجد رصيد مستحق ${omr(r.balance, "ar")} على الحجز ${r.code ?? ""}.\nFriendly reminder: balance due ${omr(r.balance, "en")}.`,
    );
  const amountProps = { lang, preview: t.fin_amount_preview, bigConfirm: t.fin_big_amount };

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

      {seesMoney ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Link href={`/finance?month=${addMonth(month, -1)}`} className="btn-ghost btn-sm">‹ {t.fin_prev_month}</Link>
            <span className="px-2 font-semibold">{monthLabel}</span>
            {month < thisMonth ? <Link href={addMonth(month, 1) === thisMonth ? "/finance" : `/finance?month=${addMonth(month, 1)}`} className="btn-ghost btn-sm">{t.fin_next_month} ›</Link> : null}
            {month !== thisMonth ? <Link href="/finance" className="btn-ghost btn-sm">{t.fin_this_month}</Link> : null}
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t.fin_collected} value={omr(collected, lang)} hint={trend(collected, prevCollected)} />
            <Stat label={t.expenses} value={omr(expTotal, lang)} hint={trend(expTotal, prevExpTotal, false)} />
            <Stat label={t.fin_net} value={omr(net, lang)} tone={net < 0 ? "danger" : "ok"} hint={trend(net, prevNet)} />
            <Stat label={t.fin_outstanding} value={omr(outstanding, lang)} tone={outstanding > 0 ? "warn" : undefined} />
          </div>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t.shift}>
          {myShift ? (
            <div className="space-y-3">
              <div className="text-sm text-muted">{dateTime(myShift.opened_at, tz, lang)}</div>
              {breakdown ? (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span>{t.shift_float}</span><span className="num">{omr(breakdown.opening_float, lang)}</span></div>
                  <div className="flex justify-between text-ok"><span>{t.shift_cash_in} ({breakdown.payments_count})</span><span className="num">{omr(breakdown.cash_in, lang)}</span></div>
                  <div className="flex justify-between text-danger"><span>{t.shift_refunds}</span><span className="num">{omr(breakdown.cash_refunds, lang)}</span></div>
                  <div className="flex justify-between text-danger"><span>{t.shift_cash_expenses} ({breakdown.expenses_count})</span><span className="num">{omr(breakdown.cash_expenses, lang)}</span></div>
                  <div className="flex justify-between border-t border-line pt-1 font-bold"><span>{t.shift_expected}</span><span className="num">{omr(breakdown.expected, lang)}</span></div>
                </div>
              ) : null}
              <ActionForm action={closeShift} className="space-y-2">
                <input type="hidden" name="shift" value={myShift.id} />
                <Field label={t.shift_counted}><AmountInput name="counted" {...amountProps} /></Field>
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
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BUCKETS.map((x) => {
                const total = agingRows.filter((r) => r.bucket === x.b).reduce((a, r) => a + r.balance, 0);
                return (
                  <div key={x.b} className="rounded-xl bg-surface-2 p-2 text-center">
                    <div className="text-xs text-muted">{t[x.key]}</div>
                    <div className={`num text-sm font-bold ${total > 0 && x.b !== "0-30" ? "text-danger" : ""}`}>{omr(total, lang)}</div>
                  </div>
                );
              })}
            </div>
            <RemindAll
              label={t.remind_all}
              hint={t.remind_all_hint}
              items={overdue.map((r) => ({ key: r.folio_id, name: `${r.guest_name ?? "—"}${r.unit ? ` · ${r.unit}` : ""}`, amount: omr(r.balance, lang), href: reminder(r) }))}
            />
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
                            <a className="btn-ghost btn-sm" target="_blank" rel="noreferrer" href={reminder(r)}>{t.remind_whatsapp}</a>
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

      {seesMoney ? (
        <div className="mt-4">
          <Section title={`${t.fin_payments} · ${monthLabel}`}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {month === thisMonth ? (
                <div className="rounded-xl bg-brand-soft p-2 text-center">
                  <div className="text-xs text-brand">{t.fin_today}</div>
                  <div className="num text-sm font-bold">{omr(todayTotal, lang)}</div>
                </div>
              ) : null}
              {byMethod.map((x) => (
                <div key={x.m} className="rounded-xl bg-surface-2 p-2 text-center">
                  <div className="text-xs text-muted">{t[`pm_${x.m}` as DictKey]}</div>
                  <div className="num text-sm font-bold">{omr(x.v, lang)}</div>
                </div>
              ))}
            </div>
            {payRows.length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <details open={payRows.length <= 15}>
                <summary className="cursor-pointer text-xs text-muted">{t.fin_count.replace("{n}", String(payRows.length))}</summary>
                <div className="mt-2 max-h-[28rem] overflow-auto">
                  <table className="table">
                    <thead><tr><th>{t.date}</th><th>{t.guest}</th><th>{t.method}</th><th>{t.fin_received_by}</th><th>{t.amount}</th></tr></thead>
                    <tbody>
                      {payRows.map((p) => {
                        const res = p.folios?.reservations;
                        return (
                          <tr key={p.id}>
                            <td className="whitespace-nowrap text-xs">{dateTime(p.received_at, tz, lang)}</td>
                            <td>
                              {p.folios?.reservation_id ? (
                                <Link href={`/reservations/${p.folios.reservation_id}`} className="text-brand">
                                  {res?.guests?.full_name ?? "—"} <span className="text-xs text-muted">{res?.code}</span>
                                </Link>
                              ) : t.fin_no_reservation}
                            </td>
                            <td className="text-xs">{t[`pm_${p.method}` as DictKey]} {p.kind !== "payment" ? <Badge>{t[`pk_${p.kind}` as DictKey]}</Badge> : null}</td>
                            <td className="text-xs">{(p.received_by && staffName.get(p.received_by)) || "—"}</td>
                            <td className={`num font-semibold ${signed(p) < 0 ? "text-danger" : ""}`}>{omr(signed(p), lang)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </Section>
        </div>
      ) : null}

      {hasRole(ctx, ["manager"]) ? (
        <div className="mt-4">
          <Salaries ctx={ctx} month={month} monthLabel={monthLabel} t={t} lang={lang} />
        </div>
      ) : null}

      {hasRole(ctx, ["manager", "accountant", "reception"]) ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Section title={t.expense_add}>
            <ActionForm action={addExpense} resetOnSuccess className="space-y-2">
              <Field label={t.category}>
                <select name="category" className="input">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t[`ec_${c}` as DictKey]}</option>)}
                </select>
              </Field>
              <Field label={t.description}><input name="description" required className="input" /></Field>
              <Field label={`${t.amount} (${lang === "en" ? "OMR" : "ر.ع"})`}><AmountInput {...amountProps} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.method}>
                  <select name="method" className="input">
                    {["cash", "card", "transfer"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                  </select>
                </Field>
                <Field label={t.date}><input type="date" name="date" defaultValue={today} className="input" /></Field>
              </div>
              <ReceiptInput label={t.fin_receipt} ready={t.fin_receipt_ready} />
              <SubmitButton className="btn-primary w-full">{t.add}</SubmitButton>
            </ActionForm>
          </Section>
          {seesMoney ? (
            <div className="space-y-4 lg:col-span-2">
              <Section
                title={`${t.expenses} · ${monthLabel} · ${omr(expTotal, lang)}`}
                actions={<a href={`/api/export?kind=expenses&from=${from}&to=${monthEnd(month)}`} className="btn-ghost btn-sm">⬇️ {t.fin_export}</a>}
              >
                {byCat.length ? (
                  <div className="mb-4">
                    <div className="mb-2 text-xs font-semibold text-muted">{t.fin_by_category}</div>
                    <BarList
                      data={byCat.map((x) => ({
                        key: x.c,
                        label: t[`ec_${x.c}` as DictKey],
                        value: x.v,
                        display: `${omr(x.v, lang)} · ${expTotal ? Math.round((x.v / expTotal) * 100) : 0}%`,
                      }))}
                      tableLabel={t.fin_by_category}
                      columns={[t.category, t.amount]}
                    />
                  </div>
                ) : null}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <Link href={qs({ cat: "" })} className={`btn-sm ${!cat ? "btn-primary" : "btn-ghost"}`}>{t.fin_all_categories}</Link>
                  {byCat.map((x) => (
                    <Link key={x.c} href={qs({ cat: x.c })} className={`btn-sm ${cat === x.c ? "btn-primary" : "btn-ghost"}`}>{t[`ec_${x.c}` as DictKey]}</Link>
                  ))}
                </div>
                {shownExpenses.length === 0 ? (
                  <Empty>{t.none}</Empty>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>{t.date}</th><th>{t.category}</th><th>{t.description}</th><th>{t.method}</th><th>{t.fin_added_by}</th><th>{t.amount}</th></tr></thead>
                      <tbody>
                        {shownExpenses.map((e) => (
                          <tr key={e.id}>
                            <td className="whitespace-nowrap align-top text-xs">{gregorian(e.expense_date, lang)}</td>
                            <td className="align-top text-xs">{t[`ec_${e.category}` as DictKey]}</td>
                            <td className="align-top">
                              {e.description}
                              {receipts.get(e.id) ? (
                                <a href={receipts.get(e.id)} target="_blank" rel="noreferrer" className="ms-2 text-xs text-brand">{t.fin_receipt_view}</a>
                              ) : null}
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-brand">{t.edit}</summary>
                                <ActionForm action={updateExpense} className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <input type="hidden" name="id" value={e.id} />
                                  <select name="category" defaultValue={e.category} className="input">
                                    {CATEGORIES.map((c) => <option key={c} value={c}>{t[`ec_${c}` as DictKey]}</option>)}
                                  </select>
                                  <input name="description" defaultValue={e.description} required className="input" />
                                  <AmountInput defaultValue={(e.amount / 1000).toFixed(3)} {...amountProps} />
                                  <input type="date" name="date" defaultValue={e.expense_date} className="input" />
                                  <select name="method" defaultValue={e.method} className="input">
                                    {["cash", "card", "transfer"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                                  </select>
                                  <ReceiptInput label={t.fin_receipt} ready={t.fin_receipt_ready} />
                                  <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                                </ActionForm>
                                <ActionForm action={deleteExpense} className="mt-2">
                                  <input type="hidden" name="id" value={e.id} />
                                  <SubmitButton className="btn-danger btn-sm" confirm={`${t.delete}: ${e.description}?`}>{t.delete}</SubmitButton>
                                </ActionForm>
                              </details>
                            </td>
                            <td className="align-top text-xs">{t[`pm_${e.method}` as DictKey]}</td>
                            <td className="align-top text-xs">{(e.created_by && staffName.get(e.created_by)) || "—"}</td>
                            <td className="num whitespace-nowrap align-top font-semibold">{omr(e.amount, lang)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
              <Section title={t.shift_history}>
                {shiftRows.length === 0 ? (
                  <Empty>{t.none}</Empty>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead><tr><th>{t.date}</th><th>{t.audit_actor}</th><th>{t.shift_expected}</th><th>{t.shift_counted}</th><th>{t.shift_difference}</th></tr></thead>
                        <tbody>
                          {shiftRows.map((sh) => {
                            const pays = ((shiftPays ?? []) as unknown as { id: string; amount: number; kind: string; received_at: string; cash_shift_id: string; folios: { reservations: { code: string } | null } | null }[])
                              .filter((p) => p.cash_shift_id === sh.id);
                            const exps = ((shiftExps ?? []) as { id: string; amount: number; description: string; cash_shift_id: string }[]).filter((x) => x.cash_shift_id === sh.id);
                            return (
                              <tr key={sh.id} className={sh.difference < 0 ? "bg-danger-soft/40" : undefined}>
                                <td className="align-top text-xs">
                                  {dateTime(sh.closed_at, tz, lang)}
                                  {pays.length || exps.length ? (
                                    <details className="mt-1">
                                      <summary className="cursor-pointer text-brand">{t.shift_ops} ({pays.length + exps.length})</summary>
                                      <ul className="mt-1 space-y-0.5">
                                        {pays.map((p) => (
                                          <li key={p.id} className="text-ok">+ {omr(p.kind === "refund" || p.kind === "deposit_refund" ? -p.amount : p.amount, lang)} · {p.folios?.reservations?.code ?? t[`pk_${p.kind}` as DictKey]}</li>
                                        ))}
                                        {exps.map((x) => (
                                          <li key={x.id} className="text-danger">− {omr(x.amount, lang)} · {x.description}</li>
                                        ))}
                                      </ul>
                                    </details>
                                  ) : null}
                                </td>
                                <td className="align-top">{staffName.get(sh.opened_by) || "—"}</td>
                                <td className="num align-top">{omr(sh.expected_cash, lang)}</td>
                                <td className="num align-top">{omr(sh.counted_cash, lang)}</td>
                                <td className={`num align-top font-semibold ${sh.difference < 0 ? "text-danger" : sh.difference > 0 ? "text-warn" : "text-ok"}`}>
                                  {sh.difference < 0 ? "⚠️ " : ""}{omr(sh.difference, lang)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {(shifts ?? []).length > shiftLimit ? (
                      <div className="mt-3 text-center">
                        <Link href={qs({ shifts: String(shiftLimit + 20) })} scroll={false} className="btn-ghost btn-sm">{t.audit_more}</Link>
                      </div>
                    ) : null}
                  </>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
