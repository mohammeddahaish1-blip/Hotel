import { Archive, Download, Paperclip, TrendingDown, TrendingUp, TriangleAlert, Undo2 } from "lucide-react";
import Link from "next/link";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { addDays, dateTime, gregorian, omr, todayIn, whatsappLink, zonedStart } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AmountInput, ReceiptInput, RemindAll } from "@/components/FinanceInputs";
import { ScrollToHash } from "@/components/ScrollToHash";
import { BarList } from "@/components/charts";
import { Badge, Empty, Field, PageHeader, Section, Stat } from "@/components/ui";
import { Salaries } from "./Salaries";
import { CloseShift } from "./CloseShift";
import { FinanceTabs, defaultFinanceView, type FinanceView } from "./FinanceTabs";
import { loadAlerts } from "@/lib/alerts";
import { addExpense, archiveExpense, closeShift, openShift, postDueRent, restoreExpense, updateExpense } from "@/app/actions/ops";
import { requestCorrection } from "@/app/actions/money";
import { signedUrls } from "@/lib/storage";

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
  receipt_no: number | null; proof_path: string | null;
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
  const showArchive = sp.archived === "1";
  // one task per view; roles that do not run the money never land on the views made for those who do
  const first = defaultFinanceView(ctx);
  const allowed: FinanceView[] = hasRole(ctx, ["manager", "accountant"]) ? ["overview", "cash", "received", "owed", "expenses"] : hasRole(ctx, ["reception"]) ? ["cash", "owed", "expenses"] : ["cash", "owed"];
  const v: FinanceView = allowed.includes(sp.v as FinanceView) ? (sp.v as FinanceView) : first;
  const noProofOnly = sp.noproof === "1";
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
      seesMoney ? db.from("expenses").select("amount").eq("property_id", ctx.property.id).is("archived_at", null).gte("expense_date", prevFrom).lte("expense_date", prevTo) : none,
      db.rpc("aging_report", { p_property: ctx.property.id }),
      seesMoney ? db.rpc("daily_income", { p_property: ctx.property.id, p_from: from, p_to: to }) : none,
      seesMoney ? db.rpc("daily_income", { p_property: ctx.property.id, p_from: prevFrom, p_to: prevTo }) : none,
      seesMoney
        ? db.from("payments")
            .select("id, amount, kind, method, received_at, received_by, cash_shift_id, receipt_no, proof_path, folios!inner(property_id, reservation_id, reservations(code, guests(full_name)))")
            .eq("folios.property_id", ctx.property.id)
            .is("voided_at", null)
            .gte("received_at", zonedStart(from, tz))
            .lt("received_at", zonedStart(addDays(monthEnd(month), 1), tz))
            .order("received_at", { ascending: false })
        : none,
      db.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
    ]);
  const staffName = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const [{ data: unitList }, { data: myExpenses }] = await Promise.all([
    db.from("units").select("id, number, owner_id").eq("property_id", ctx.property.id).eq("active", true).order("number"),
    !seesMoney
      ? db.from("expenses").select("id, amount, description, category, created_at").eq("property_id", ctx.property.id).eq("created_by", ctx.userId).is("archived_at", null).gte("created_at", zonedStart(today, tz)).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const unitNumber = new Map((unitList ?? []).map((u) => [u.id as string, u.number as string]));
  const { data: bd } = myShift ? await db.rpc("shift_breakdown", { p_shift: myShift.id }) : { data: null };
  const breakdown = ((bd ?? []) as Breakdown[])[0];

  // ---- summary
  const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const collected = sum(income as { amount: number }[] | null);
  const prevCollected = sum(prevIncome as { amount: number }[] | null);
  type Expense = { id: string; amount: number; category: string; description: string; method: string; expense_date: string; created_by: string | null; attachment_path: string | null; archived_at: string | null; archive_reason: string | null; archived_by: string | null; unit_id: string | null };
  const monthExpenses = (expenses ?? []) as Expense[];
  // archived expenses never count; they are listed apart and can be restored
  const allExpenses = monthExpenses.filter((e) => !e.archived_at);
  const archivedExpenses = monthExpenses.filter((e) => e.archived_at);
  const expTotal = sum(allExpenses);
  const prevExpTotal = sum(prevExpenses as { amount: number }[] | null);
  const net = collected - expTotal;
  const prevNet = prevCollected - prevExpTotal;
  const agingRows = (aging ?? []) as Aging[];
  // deposits still held: deposits taken minus returned or applied, per guest account
  const { data: depPays } = seesMoney
    ? await db.from("payments")
        .select("folio_id, kind, amount, folios!inner(property_id, reservation_id, reservations(code, status, units(number), guests(full_name)))")
        .eq("folios.property_id", ctx.property.id).is("voided_at", null).in("kind", ["deposit", "deposit_refund", "deposit_applied"])
    : { data: [] };
  type DepRow = { folio_id: string; kind: string; amount: number; folios: { reservation_id: string | null; reservations: { code: string; status: string; units: { number: string } | null; guests: { full_name: string } | null } | null } | null };
  const depBy = new Map<string, { folio: string; held: number; reservation: string | null; code: string | null; status: string | null; unit: string | null; guest: string | null }>();
  for (const p of (depPays ?? []) as unknown as DepRow[]) {
    const r = p.folios?.reservations;
    const row = depBy.get(p.folio_id) ?? { folio: p.folio_id, held: 0, reservation: p.folios?.reservation_id ?? null, code: r?.code ?? null, status: r?.status ?? null, unit: r?.units?.number ?? null, guest: r?.guests?.full_name ?? null };
    row.held += p.kind === "deposit" ? Number(p.amount) : -Number(p.amount);
    depBy.set(p.folio_id, row);
  }
  const depositRows = [...depBy.values()].filter((r) => r.held > 0).sort((a, b) => b.held - a.held);
  const outstanding = agingRows.reduce((a, r) => a + r.balance, 0);
  const trend = (now: number, prev: number, goodUp = true) => {
    const c = change(now, prev);
    if (c === null) return undefined;
    const up = c >= 0;
    return <span className={up === goodUp ? "text-ok" : "text-danger"}>{up ? <TrendingUp className="inline size-3.5" /> : <TrendingDown className="inline size-3.5" />} {Math.abs(c)}% {t.fin_vs_prev}</span>;
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
  const proofUrls = await signedUrls(ctx, "payment-proofs", payRows.map((p) => p.proof_path));
  const shownPayRows = noProofOnly ? payRows.filter((p) => !p.proof_path) : payRows;
  const withoutProof = payRows.filter((p) => !p.proof_path).length;
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
        db.from("expenses").select("id, amount, description, expense_date, cash_shift_id").in("cash_shift_id", shiftIds).is("archived_at", null),
      ])
    : [{ data: [] }, { data: [] }];

  const qs = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(v !== first ? { v } : {}), ...(month !== thisMonth ? { month } : {}), ...(cat ? { cat } : {}), ...extra });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `/finance?${s}` : "/finance";
  };
  // "remind everyone": every guest who owes money and has a phone number, oldest debt first
  const debtors = agingRows.filter((r) => r.phone).sort((a, b) => b.age_days - a.age_days);
  const reminder = (r: Aging) =>
    whatsappLink(
      r.phone,
      `${ctx.property.name_ar}\nتذكير ودّي: يوجد رصيد مستحق ${omr(r.balance, "ar")} على الحجز ${r.code ?? ""}.\nFriendly reminder: balance due ${omr(r.balance, "en")}.`,
    );
  const amountProps = { lang, preview: t.fin_amount_preview, bigConfirm: t.fin_big_amount };

  // ---- what the overview lists under "needs your action": today's money alerts, in plain words, each with one way out
  const todo = seesMoney
    ? (await loadAlerts(ctx, t, lang))
        .filter((a) => a.href.startsWith("/finance") || a.key.startsWith("rent_due-"))
        .map((a) => ({
          ...a,
          href: a.key.startsWith("rent_due-")
            ? `/reservations/${a.key.slice("rent_due-".length, "rent_due-".length + 36)}`
            : a.key.startsWith("shift_open_long-") || a.key.startsWith("cash_shortage-")
              ? "/finance?v=cash"
              : a.href,
        }))
    : [];
  if (withoutProof && month === thisMonth) {
    todo.push({ key: "no-proof", severity: 3, title: t.fin_todo_noproof.replace("{n}", String(withoutProof)), detail: t.fin_todo_noproof_hint, href: "/finance?v=received&noproof=1" });
  }
  const oldest = agingRows.reduce((a, r) => Math.max(a, r.age_days), 0);
  const monthNav = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Link href={qs({ month: addMonth(month, -1) })} className="btn-ghost btn-sm">‹ {t.fin_prev_month}</Link>
      <span className="px-2 font-semibold">{monthLabel}</span>
      {month < thisMonth ? <Link href={qs({ month: addMonth(month, 1) === thisMonth ? "" : addMonth(month, 1) })} className="btn-ghost btn-sm">{t.fin_next_month} ›</Link> : null}
      {month !== thisMonth ? <Link href={qs({ month: "" })} className="btn-ghost btn-sm">{t.fin_this_month}</Link> : null}
    </div>
  );

  return (
    <>
      <ScrollToHash />
      <FinanceTabs ctx={ctx} t={t} current={v} month={month !== thisMonth ? month : undefined} />
      <PageHeader
        title={v === "cash" ? t.fin_tab_cash : v === "owed" ? t.fin_tab_owed : v === "received" ? t.fin_tab_received : v === "expenses" ? t.expenses : t.fin_title}
        actions={
          v === "overview" || v === "owed" ? (
            <ActionForm action={postDueRent}>
              <SubmitButton className="btn-ghost btn-sm">{t.post_rent}</SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />

      {v === "overview" ? (
        <>
          {monthNav}
          <div className="grid gap-3 md:grid-cols-3">
            <Link href={qs({ v: "received" })} className="card block p-5">
              <div className="text-sm font-semibold text-muted">{t.fin_q_in}</div>
              <div className="num mt-1 text-3xl font-bold leading-tight">{omr(collected, lang)}</div>
              <p className="mt-1.5 text-sm text-muted">{t.fin_q_in_hint}</p>
              <div className="mt-2 text-xs font-semibold">{trend(collected, prevCollected)}</div>
            </Link>
            <Link href={qs({ v: "expenses" })} className="card block p-5">
              <div className="text-sm font-semibold text-muted">{t.fin_q_out}</div>
              <div className="num mt-1 text-3xl font-bold leading-tight">{omr(expTotal, lang)}</div>
              <p className="mt-1.5 text-sm text-muted">{t.fin_q_out_hint}</p>
              <div className="mt-2 text-xs font-semibold">{trend(expTotal, prevExpTotal, false)}</div>
            </Link>
            {/* the one red figure on the page: money guests still owe */}
            <div className={`card p-5 ${outstanding > 0 ? "bg-danger-soft" : ""}`}>
              <div className={`text-sm font-semibold ${outstanding > 0 ? "text-danger" : "text-muted"}`}>{t.fin_q_owed}</div>
              <div className={`num mt-1 text-3xl font-bold leading-tight ${outstanding > 0 ? "text-danger" : ""}`}>{omr(outstanding, lang)}</div>
              <p className="mt-1.5 text-sm text-muted">
                {agingRows.length ? t.fin_q_owed_hint.replace("{n}", String(agingRows.length)).replace("{d}", String(oldest)) : t.fin_q_owed_none}
              </p>
              {agingRows.length ? <Link href={qs({ v: "owed" })} className="btn-danger btn-sm mt-3">{t.remind_all}</Link> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand p-5 text-brand-ink">
            <div>
              <div className="font-semibold">{t.fin_net_month}</div>
              <div className="text-sm opacity-85">{t.fin_net_hint}</div>
            </div>
            <div className="num text-3xl font-bold">{omr(net, lang)}</div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title={`${t.fin_todo}${todo.length ? ` (${todo.length})` : ""}`}>
                {todo.length === 0 ? (
                  <p className="text-sm text-muted">{t.fin_todo_none}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {todo.map((a) => (
                      <li key={a.key} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <span className={`size-2.5 shrink-0 rounded-full ${a.severity === 1 ? "bg-danger" : a.severity === 2 ? "bg-warn" : "bg-info"}`} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{a.title}</div>
                          <div className="truncate text-sm text-muted">{a.detail}</div>
                        </div>
                        <Link href={a.href} className="btn-ghost btn-sm">{t.view}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            <div className="space-y-4">
              <Section title={t.fin_cash_now}>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={myShift ? "ok" : "gray"}>{myShift ? t.open : t.fin_cash_closed}</Badge>
                  {myShift ? <span className="text-xs text-muted">{dateTime(myShift.opened_at, tz, lang)}</span> : null}
                </div>
                {breakdown ? (
                  <>
                    <p className="mt-3 text-sm text-muted">{t.fin_cash_should}</p>
                    <div className="num text-2xl font-bold">{omr(breakdown.expected, lang)}</div>
                  </>
                ) : null}
                <Link href="/finance?v=cash" className="btn-ghost mt-3 w-full">{myShift ? t.fin_cash_go_close : t.fin_cash_go_open}</Link>
              </Section>
              <Link href="/finance?v=expenses#new" className="btn-primary w-full">{t.fin_new_expense}</Link>
            </div>
          </div>
        </>
      ) : null}

      {v === "cash" ? (
        <div className="space-y-4">
          {myShift && breakdown ? (
            <>
              <p className="text-sm text-muted">{dateTime(myShift.opened_at, tz, lang)}</p>
              <CloseShift
                action={closeShift}
                shiftId={myShift.id}
                expected={breakdown.expected}
                lang={lang}
                lines={[
                  { label: t.shift_float, value: omr(breakdown.opening_float, lang) },
                  { label: `${t.shift_cash_in} (${breakdown.payments_count})`, value: omr(breakdown.cash_in, lang), tone: "ok" },
                  { label: t.shift_refunds, value: omr(breakdown.cash_refunds, lang), tone: "danger" },
                  { label: `${t.shift_cash_expenses} (${breakdown.expenses_count})`, value: omr(breakdown.cash_expenses, lang), tone: "danger" },
                  { label: t.shift_expected, value: omr(breakdown.expected, lang), tone: "total" },
                ]}
                labels={{
                  step1: t.cash_step1, step2: t.cash_step2, step3: t.cash_step3, countQ: t.cash_count_q, countHint: t.cash_count_hint, counted: t.shift_counted,
                  how: t.cash_how, nonCash: t.cash_noncash, result: t.cash_result, expected: t.cash_expected_short, youCounted: t.cash_counted_short,
                  match: t.cash_match, short: t.cash_short, over: t.cash_over, recount: t.cash_recount, why: t.cash_why, next: t.cash_next, back: t.back,
                  confirmQ: t.cash_confirm_q, close: t.fin_cash_go_close,
                }}
              />
            </>
          ) : myShift ? (
            // no breakdown came back: fall back to the plain closing form
            <Section title={t.shift}>
              <ActionForm action={closeShift} className="space-y-2">
                <input type="hidden" name="shift" value={myShift.id} />
                <Field label={t.shift_counted}><AmountInput name="counted" {...amountProps} /></Field>
                <Field label={t.notes}><input name="notes" className="input" /></Field>
                <SubmitButton className="btn-primary w-full" confirm={t.shift_close}>{t.shift_close}</SubmitButton>
              </ActionForm>
            </Section>
          ) : (
            <div className="mx-auto max-w-md">
              <Section title={t.fin_cash_go_open}>
                <ActionForm action={openShift} className="space-y-3">
                  <p className="text-sm text-muted">{t.cash_open_hint}</p>
                  <Field label={t.shift_float}><input name="float" defaultValue="0" inputMode="decimal" className="input num py-3 text-xl font-bold" /></Field>
                  <SubmitButton className="btn-primary w-full">{t.fin_cash_go_open}</SubmitButton>
                </ActionForm>
              </Section>
            </div>
          )}
          {seesMoney ? (
            <>
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
                                  {sh.difference < 0 ? <TriangleAlert className="me-1 inline size-3.5" /> : null}{omr(sh.difference, lang)}
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
            </>
          ) : null}
        </div>
      ) : null}

      {v === "owed" ? (
        <div>
          <div id="aging" className="scroll-mt-28" />
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
              items={debtors.map((r) => ({ key: r.folio_id, name: `${r.guest_name ?? "—"}${r.unit ? ` · ${r.unit}` : ""}`, amount: omr(r.balance, lang), href: reminder(r) }))}
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
      ) : null}

      {v === "received" ? (
        <>
          {monthNav}
      {seesMoney ? (
        <div>
          <div id="payments" className="scroll-mt-28" />
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
            {withoutProof ? (
              <div className="mb-2">
                <Link href={qs({ noproof: noProofOnly ? "" : "1" })} className={`btn-sm inline-flex items-center gap-1 ${noProofOnly ? "btn-primary" : "btn-ghost"}`}>
                  <Paperclip className="size-3.5 shrink-0" /> {t.rc_only_no_proof} ({withoutProof})
                </Link>
              </div>
            ) : null}
            {shownPayRows.length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <details open={shownPayRows.length <= 15 || noProofOnly}>
                <summary className="cursor-pointer text-xs text-muted">{t.fin_count.replace("{n}", String(payRows.length))}</summary>
                <div className="mt-2 max-h-[28rem] overflow-auto">
                  <table className="table">
                    <thead><tr><th>{t.rc_no}</th><th>{t.date}</th><th>{t.guest}</th><th>{t.method}</th><th>{t.fin_received_by}</th><th>{t.rc_proof}</th><th>{t.amount}</th></tr></thead>
                    <tbody>
                      {shownPayRows.map((p) => {
                        const res = p.folios?.reservations;
                        return (
                          <tr key={p.id}>
                            <td className="num text-xs">#{p.receipt_no ?? "—"}</td>
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
                            <td className="text-xs">
                              {p.proof_path && proofUrls.get(p.proof_path) ? (
                                <a href={proofUrls.get(p.proof_path)} target="_blank" rel="noreferrer" className="inline-flex text-brand"><Paperclip className="size-4 shrink-0" /></a>
                              ) : <span className="text-warn">{t.rc_no_proof}</span>}
                            </td>
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


      {seesMoney ? (
        <div className="mt-4">
          <div id="deposits" className="scroll-mt-28" />
          <Section title={`${t.dash_deposits} · ${omr(depositRows.reduce((a, r) => a + r.held, 0), lang)}`}>
            {depositRows.length === 0 ? <Empty>{t.none}</Empty> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>{t.guest}</th><th>{t.unit}</th><th>{t.status}</th><th>{t.amount}</th></tr></thead>
                  <tbody>
                    {depositRows.map((r) => (
                      <tr key={r.folio}>
                        <td>{r.reservation ? <Link href={`/reservations/${r.reservation}`} className="text-brand">{r.guest ?? "—"}</Link> : r.guest ?? "—"}{r.code ? <span className="ms-1 text-xs text-muted">{r.code}</span> : null}</td>
                        <td>{r.unit ?? "—"}</td>
                        <td>{r.status ? <Badge tone={r.status === "checked_out" ? "warn" : "gray"}>{t[`rs_${r.status}` as DictKey]}</Badge> : null}</td>
                        <td className="num font-semibold">{omr(r.held, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      ) : null}

        </>
      ) : null}

      {v === "expenses" ? (
        <>
          {seesMoney ? monthNav : null}
      {hasRole(ctx, ["manager", "accountant", "reception"]) ? (
        <div className={seesMoney ? "grid gap-4 lg:grid-cols-3" : "mx-auto max-w-xl"}>
          <div>
          <div id="new" className="scroll-mt-28" />
          <Section title={t.fin_new_expense}>
            <ActionForm action={addExpense} resetOnSuccess className="space-y-2">
              <Field label={`${t.amount} (${lang === "en" || lang === "bn" ? "OMR" : "ر.ع"})`}><AmountInput {...amountProps} /></Field>
              <Field label={t.description}><input name="description" required className="input" /></Field>
              <ReceiptInput label={t.fin_receipt} ready={t.fin_receipt_ready} />
              <details className="rounded-2xl bg-surface-2 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-brand">{t.fin_more_details}</summary>
                <div className="mt-3 space-y-2">
              <Field label={t.category}>
                <select name="category" className="input">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t[`ec_${c}` as DictKey]}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.method}>
                  <select name="method" className="input">
                    {["cash", "card", "transfer"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                  </select>
                </Field>
                <Field label={t.date}><input type="date" name="date" defaultValue={today} className="input" /></Field>
              </div>
              {(unitList ?? []).length ? (
                <Field label={t.own_expense_unit}>
                  <select name="unit_id" className="input">
                    <option value="">{t.own_no_unit}</option>
                    {(unitList ?? []).map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
                  </select>
                </Field>
              ) : null}
                </div>
              </details>
              <SubmitButton className="btn-primary w-full">{t.add}</SubmitButton>
            </ActionForm>
            {!seesMoney && (myExpenses ?? []).length ? (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 text-xs font-semibold text-muted">{t.cr_my_expenses}</div>
                <ul className="space-y-2 text-sm">
                  {(myExpenses ?? []).map((e) => (
                    <li key={e.id}>
                      <div className="flex justify-between gap-2"><span>{e.description}</span><span className="num">{omr(e.amount, lang)}</span></div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-brand">{t.cr_request}</summary>
                        <ActionForm action={requestCorrection} resetOnSuccess className="mt-1 grid gap-1.5">
                          <input type="hidden" name="target" value="expense" />
                          <input type="hidden" name="id" value={e.id} />
                          <select name="action" className="input py-1.5">
                            <option value="edit">{t.cr_action_edit}</option>
                            <option value="void">{t.cr_action_void}</option>
                          </select>
                          <input name="amount" inputMode="decimal" placeholder={t.cr_new_amount} className="input py-1.5" />
                          <input name="reason" required minLength={3} placeholder={t.cr_reason} className="input py-1.5" />
                          <SubmitButton className="btn-ghost btn-sm">{t.cr_request}</SubmitButton>
                        </ActionForm>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
          </div>
          {seesMoney ? (
            <div className="space-y-4 lg:col-span-2">
              <div id="expenses" className="scroll-mt-28" />
              <Section
                title={`${t.expenses} · ${monthLabel} · ${omr(expTotal, lang)}`}
                actions={<a href={`/api/export?kind=expenses&from=${from}&to=${monthEnd(month)}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Download className="size-4 shrink-0" /> {t.fin_export}</a>}
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
                              {e.unit_id ? <Badge>{t.unit} {unitNumber.get(e.unit_id)}</Badge> : null}
                              {receipts.get(e.id) ? (
                                <a href={receipts.get(e.id)} target="_blank" rel="noreferrer" className="ms-2 inline-flex items-center gap-1 text-xs text-brand"><Paperclip className="size-3.5 shrink-0" />{t.fin_receipt_view}</a>
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
                                <ActionForm action={archiveExpense} className="mt-2 flex flex-wrap gap-2">
                                  <input type="hidden" name="id" value={e.id} />
                                  <input name="reason" required minLength={3} placeholder={t.arch_reason} className="input w-auto flex-1 py-1.5" />
                                  <SubmitButton className="btn-danger btn-sm" confirm={`${t.arch_archive}: ${e.description}?`}><Archive className="inline size-3.5" /> {t.arch_archive}</SubmitButton>
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
                <div className="mt-4 border-t border-line pt-3">
                  <Link href={qs({ archived: showArchive ? "" : "1" })} className="inline-flex items-center gap-1 text-xs text-brand">
                    <Archive className="size-3.5 shrink-0" /> {showArchive ? t.arch_hide : t.arch_show} ({archivedExpenses.length})
                  </Link>
                  <p className="mt-1 text-xs text-muted">{t.arch_hint}</p>
                  {showArchive && archivedExpenses.length ? (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {archivedExpenses.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-muted">
                          <span className="line-through">{gregorian(e.expense_date, lang)} · {e.description} · {omr(e.amount, lang)}</span>
                          <span className="text-xs">{t.arch_archived}: {e.archive_reason ?? "—"} · {(e.archived_by && staffName.get(e.archived_by)) || "—"}</span>
                          <ActionForm action={restoreExpense} className="ms-auto">
                            <input type="hidden" name="id" value={e.id} />
                            <SubmitButton className="btn-ghost btn-sm"><Undo2 className="inline size-3.5" /> {t.arch_restore}</SubmitButton>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Section>
            </div>
          ) : null}
        </div>
      ) : null}

      {hasRole(ctx, ["manager"]) ? (
        <div className="mt-4">
          <Salaries ctx={ctx} month={month} monthLabel={monthLabel} t={t} lang={lang} />
        </div>
      ) : null}

        </>
      ) : null}
    </>
  );
}
