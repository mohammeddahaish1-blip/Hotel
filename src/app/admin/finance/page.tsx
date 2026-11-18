import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthlyBaisa, paying, requireAdmin, todayIso, yearlyBaisa, type AdminRow } from "@/lib/admin";
import { amount, CUR, CURRENCIES, isCurrency, toBaisaAt, type Currency, type Rates } from "@/lib/currency";
import { gregorian } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CurrencySign, Money } from "@/components/CurrencySign";
import { Badge, Empty, Field, PageHeader } from "@/components/ui";
import { adminAddExpense, adminEndExpense, adminSaveRates } from "@/app/actions/admin";
import { FinanceTabs } from "../FinanceTabs";

type Pay = { tenant_id: string; amount: number; currency: string; months: number; paid_on: string };
type Expense = { id: string; name: string; vendor: string | null; amount: number; recurrence: "month" | "year" | "once"; started_on: string; ended_on: string | null; notes: string | null };

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const REC: Record<Expense["recurrence"], [string, "info" | "violet" | "gray"]> = { month: ["شهري", "info"], year: ["سنوي", "violet"], once: ["مرة واحدة", "gray"] };
const shift = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const R = (baisa: number) => amount(baisa, "OMR");

/** What a cost adds to one month: monthly in full, yearly spread over twelve months, a one-off in its own month. */
function costIn(e: Expense, m: string) {
  if (e.started_on > lastDay(m) || (e.ended_on && e.ended_on < `${m}-01`)) return 0;
  if (e.recurrence === "month") return Number(e.amount);
  if (e.recurrence === "year") return Math.round(Number(e.amount) / 12);
  return e.started_on.slice(0, 7) === m ? Number(e.amount) : 0;
}

/** The team's money: subscription income (monthly and yearly, every currency in rials), expenses, and the net. */
export default async function AdminFinance({ searchParams }: PageProps<"/admin/finance">) {
  const sb = await requireAdmin();
  const sp = await searchParams;
  const view = sp.v === "expenses" ? "expenses" : sp.v === "rates" ? "rates" : "overview";
  const thisMonth = todayIso().slice(0, 7);
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const months = Array.from({ length: 6 }, (_, i) => shift(month, i - 5));
  const [{ data: ov }, { data: pays }, { data: ex }, { data: fx }] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.from("subscription_payments").select("tenant_id, amount, currency, months, paid_on").gte("paid_on", `${months[0]}-01`).lte("paid_on", lastDay(month)).is("voided_at", null),
    sb.from("platform_expenses").select("id, name, vendor, amount, recurrence, started_on, ended_on, notes").order("started_on", { ascending: false }),
    sb.from("platform_settings").select("sar_per_omr, aed_per_omr, updated_at").eq("id", 1).maybeSingle(),
  ]);
  const rows = (ov ?? []) as AdminRow[];
  const payments = ((pays ?? []) as Pay[]).filter((p) => isCurrency(p.currency));
  const expenses = (ex ?? []) as Expense[];
  const rates = (fx ?? { sar_per_omr: 9.75, aed_per_omr: 9.55 }) as Rates & { updated_at?: string };
  const payers = rows.filter(paying);
  const mrr = payers.reduce((x, r) => x + monthlyBaisa(r), 0);
  const arr = payers.reduce((x, r) => x + yearlyBaisa(r), 0);
  const inMonth = (m: string) => payments.filter((p) => p.paid_on.slice(0, 7) === m);
  const sum = (list: Pay[]) => list.reduce((x, p) => x + toBaisaAt(Number(p.amount), p.currency as Currency, rates), 0);
  const now = inMonth(month);
  const monthlyPays = now.filter((p) => p.months < 12);
  const yearlyPays = now.filter((p) => p.months >= 12);
  const received = sum(now);
  const spent = expenses.reduce((x, e) => x + costIn(e, month), 0);
  const running = expenses.filter((e) => e.recurrence !== "once" && !e.ended_on);
  const perMonth = running.filter((e) => e.recurrence === "month").reduce((x, e) => x + Number(e.amount), 0);
  const perYear = running.reduce((x, e) => x + (e.recurrence === "month" ? Number(e.amount) * 12 : Number(e.amount)), 0);
  const byCur = CURRENCIES.map((c) => [c, now.filter((p) => p.currency === c).reduce((x, p) => x + Number(p.amount), 0)] as const).filter(([, v]) => v > 0);
  const chart = months.map((m) => ({ m, inc: sum(inMonth(m)), out: expenses.reduce((x, e) => x + costIn(e, m), 0) }));
  const top = Math.max(1, ...chart.flatMap((c) => [c.inc, c.out]));
  const title = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const monthNav = (
    <div className="flex items-center gap-1.5">
      <Link href={`/admin/finance?m=${shift(month, -1)}`} className="btn-ghost btn-sm" aria-label="الشهر السابق"><ChevronRight className="size-4" /></Link>
      <span className="px-2 font-bold">{title}</span>
      {month < thisMonth ? <Link href={`/admin/finance?m=${shift(month, 1)}`} className="btn-ghost btn-sm" aria-label="الشهر التالي"><ChevronLeft className="size-4" /></Link> : null}
    </div>
  );

  return (
    <>
      <PageHeader title="المالية" sub="دخل الاشتراكات ومصروفاتنا، وكل العملات محوّلة إلى الريال العُماني." actions={view === "overview" ? monthNav : undefined} />
      <FinanceTabs on={view} />

      {view === "overview" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              ["الدخل الشهري المتوقع", mrr, `${payers.length} شركة تدفع`, ""],
              ["الدخل السنوي المتوقع", arr, "الشهري × 12 والسنوي كما هو", "text-ok"],
              [`مصروفات ${title}`, spent, "السنوية موزعة على 12 شهر", "text-danger"],
              [`صافي ${title}`, received - spent, "المستلم − المصروفات", received - spent < 0 ? "text-danger" : "text-ok"],
            ] as const).map(([label, v, hint, tone]) => (
              <div key={label} className="card p-4">
                <div className="text-xs font-semibold text-muted">{label}</div>
                <div className={`mt-1 text-2xl font-bold ${tone}`}><Money value={R(v)} cur="OMR" /></div>
                <div className="mt-0.5 text-xs text-muted">{hint}</div>
              </div>
            ))}
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
            <section className="card">
              <h2 className="h2">دخل الاشتراكات في {title}</h2>
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-xs text-muted"><th className="py-2 text-start font-semibold"></th><th className="py-2 text-start font-semibold">الدفعات</th><th className="py-2 text-end font-semibold">المستلم</th></tr></thead>
                <tbody>
                  <tr className="border-t border-line"><td className="py-2.5 font-bold">اشتراكات شهرية</td><td className="num">{monthlyPays.length}</td><td className="text-end font-bold"><Money value={R(sum(monthlyPays))} cur="OMR" /></td></tr>
                  <tr className="border-t border-line"><td className="py-2.5"><b>اشتراكات سنوية</b><span className="block text-xs text-muted">دفعة 12 شهراً أو أكثر</span></td><td className="num">{yearlyPays.length}</td><td className="text-end font-bold"><Money value={R(sum(yearlyPays))} cur="OMR" /></td></tr>
                  <tr className="border-t border-line"><td className="py-2.5 font-bold">المجموع</td><td></td><td className="text-end text-lg font-bold text-ok"><Money value={R(received)} cur="OMR" /></td></tr>
                </tbody>
              </table>
              {byCur.length > 1 || (byCur.length === 1 && byCur[0][0] !== "OMR") ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  حسب العملة:
                  {byCur.map(([c, v]) => <span key={c}><Money value={amount(v, c)} cur={c} />{c === "OMR" ? "" : <> (≈ <Money value={R(toBaisaAt(v, c, rates))} cur="OMR" />)</>}</span>)}
                </p>
              ) : null}
              <Link href="/admin/payments" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">كل الدفعات ›</Link>
            </section>
            <section className="card">
              <h2 className="h2">الدخل والمصروفات</h2>
              <div className="mt-4 flex h-44 items-end gap-3" role="img" aria-label="الدخل والمصروفات آخر 6 أشهر">
                {chart.map(({ m, inc, out }) => (
                  <div key={m} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <div className="flex h-full w-full items-end justify-center gap-1">
                      <div className="w-1/2 max-w-7 rounded-t-lg bg-brand" style={{ height: `${Math.max(inc ? 3 : 0, Math.round((inc / top) * 100))}%` }} title={`الدخل ${R(inc)}`} />
                      <div className="w-1/3 max-w-5 rounded-t-lg bg-[#e7b9b4]" style={{ height: `${Math.max(out ? 3 : 0, Math.round((out / top) * 100))}%` }} title={`المصروفات ${R(out)}`} />
                    </div>
                    <span className={`text-[11px] ${m === month ? "font-bold text-ink" : "text-muted"}`}>{MONTHS[Number(m.slice(5, 7)) - 1]}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 flex gap-4 text-xs text-muted"><span><i className="me-1 inline-block size-2.5 rounded-sm bg-brand" />الدخل المستلم</span><span><i className="me-1 inline-block size-2.5 rounded-sm bg-[#e7b9b4]" />المصروفات</span></p>
            </section>
          </div>
          <section className="card mt-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="h2">مصروفاتنا المستمرة</h2>
              <Link href="/admin/finance?v=expenses" className="text-sm font-semibold text-brand hover:underline">إدارة المصروفات ›</Link>
            </div>
            <p className="mt-1 text-sm">شهرياً <b><Money value={R(perMonth)} cur="OMR" /></b> · سنوياً <b><Money value={R(perYear)} cur="OMR" /></b> <span className="text-xs text-muted">(الشهري × 12 والسنوي)</span></p>
          </section>
        </>
      ) : view === "expenses" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="card">
            <h2 className="h2">مصروفاتنا</h2>
            <p className="mt-1 text-sm">المستمرة: شهرياً <b><Money value={R(perMonth)} cur="OMR" /></b> · سنوياً <b><Money value={R(perYear)} cur="OMR" /></b></p>
            {expenses.length === 0 ? <div className="mt-3"><Empty>لا توجد مصروفات بعد. أضف أول مصروف من النموذج.</Empty></div> : (
              <ul className="mt-2 divide-y divide-line">
                {expenses.map((e) => (
                  <li key={e.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm ${e.ended_on ? "opacity-60" : ""}`}>
                    <span className="min-w-0 flex-1 basis-44">
                      <b>{e.name}</b>{e.vendor ? <span className="text-muted"> · {e.vendor}</span> : null}
                      <span className="block text-xs text-muted">من {gregorian(e.started_on, "ar")}{e.ended_on ? ` · توقف ${gregorian(e.ended_on, "ar")}` : ""}{e.notes ? ` · ${e.notes}` : ""}</span>
                    </span>
                    <Badge tone={REC[e.recurrence][1]}>{REC[e.recurrence][0]}</Badge>
                    <span className="font-bold"><Money value={R(Number(e.amount))} cur="OMR" /></span>
                    {!e.ended_on ? (
                      <ActionForm action={adminEndExpense}>
                        <input type="hidden" name="id" value={e.id} /><input type="hidden" name="name" value={e.name} />
                        <SubmitButton className="btn-ghost btn-sm text-danger" confirm={e.recurrence === "once" ? `حذف «${e.name}»؟` : `إيقاف «${e.name}» من اليوم؟ يبقى محسوباً في الأشهر الماضية.`}>
                          {e.recurrence === "once" ? "حذف" : "إيقاف"}
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2 className="h2">مصروف جديد</h2>
            <ActionForm action={adminAddExpense} resetOnSuccess className="mt-3 grid gap-3">
              <Field label="البند"><input name="name" required maxLength={120} placeholder="استضافة الموقع" className="input" /></Field>
              <Field label="الجهة (اختياري)"><input name="vendor" maxLength={120} placeholder="Vercel" className="input" /></Field>
              <Field label="المبلغ بالريال العُماني"><input name="amount" required inputMode="decimal" dir="ltr" className="input" /></Field>
              <fieldset>
                <legend className="label">يتكرر</legend>
                <div className="flex gap-1 rounded-full bg-gray-soft p-1">
                  {(["month", "year", "once"] as const).map((k, i) => (
                    <label key={k} className="flex-1 cursor-pointer">
                      <input type="radio" name="recurrence" value={k} defaultChecked={i === 0} className="peer sr-only" />
                      <span className="block rounded-full py-2 text-center text-sm font-semibold text-muted peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand">{REC[k][0]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="يبدأ من"><input type="date" name="started_on" defaultValue={todayIso()} className="input" /></Field>
              <Field label="ملاحظات"><input name="notes" maxLength={300} className="input" /></Field>
              <SubmitButton className="btn-primary">إضافة</SubmitButton>
            </ActionForm>
          </section>
        </div>
      ) : (
        <section className="card max-w-xl">
          <h2 className="h2">أسعار الصرف المعتمدة</h2>
          <p className="mt-1 text-sm text-muted">تحددها أنت، وتُستخدم فقط لجمع الدخل من عدة عملات بالريال العُماني. كل دفعة تبقى محفوظة بعملتها.{rates.updated_at ? ` آخر تعديل ${gregorian(rates.updated_at.slice(0, 10), "ar")}.` : ""}</p>
          <ActionForm action={adminSaveRates} className="mt-4 grid gap-3">
            {(["SAR", "AED"] as const).map((c) => (
              <label key={c} className="flex items-center gap-3 text-sm">
                <span className="flex w-24 shrink-0 items-center gap-1 font-semibold">1 <CurrencySign cur="OMR" /> =</span>
                <span className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3">
                  <input name={c === "SAR" ? "sar" : "aed"} required inputMode="decimal" dir="ltr" defaultValue={String(c === "SAR" ? rates.sar_per_omr : rates.aed_per_omr)} aria-label={`${CUR[c].ar} مقابل الريال العُماني`} className="w-full bg-transparent py-2.5 font-semibold outline-none" />
                  <CurrencySign cur={c} />
                </span>
              </label>
            ))}
            <SubmitButton className="btn-primary">حفظ</SubmitButton>
          </ActionForm>
        </section>
      )}
    </>
  );
}
