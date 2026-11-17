import Link from "next/link";
import { headers } from "next/headers";
import { Mail, MessageCircle } from "lucide-react";
import { attention, monthlyBaisa, paying, priceWords, reminderLinks, requireAdmin, todayIso, yearlyBaisa, type AdminRow } from "@/lib/admin";
import { toBaisaAt, isCurrency, amount, type Rates } from "@/lib/currency";
import { dateTime, gregorian } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Money } from "@/components/CurrencySign";
import { Badge, PageHeader } from "@/components/ui";
import { adminTrialDrop, adminTrialExtend, adminTrialSent } from "@/app/actions/admin";

type Trial = { id: string; name: string; company: string | null; phone: string; email: string; token: string; expires_at: string; opened_at: string | null; opens: number; handled_at: string | null; created_at: string };
type Pay = { amount: number; currency: string; paid_on: string; voided_at: string | null };

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const shift = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};
const R = (baisa: number) => amount(baisa, "OMR");

/** The team's morning: the figures that matter, who needs action, income by month and new trial requests. */
export default async function AdminOverview() {
  const sb = await requireAdmin();
  const thisMonth = todayIso().slice(0, 7);
  const from = `${shift(thisMonth, -5)}-01`;
  const [{ data, error }, { data: support }, { data: tr }, { data: pays }, { data: fx }, h] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.rpc("admin_support_list"),
    sb.from("trial_requests").select("id, name, company, phone, email, token, expires_at, opened_at, opens, handled_at, created_at").order("created_at", { ascending: false }).limit(60),
    sb.from("subscription_payments").select("amount, currency, paid_on, voided_at").gte("paid_on", from).is("voided_at", null),
    sb.from("platform_settings").select("sar_per_omr, aed_per_omr").eq("id", 1).maybeSingle(),
    headers(),
  ]);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as AdminRow[];
  const rates = (fx ?? { sar_per_omr: 9.75, aed_per_omr: 9.55 }) as Rates;
  const trials = (tr ?? []) as Trial[];
  const waiting = trials.filter((x) => !x.handled_at);
  const origin = `https://${h.get("host") ?? "nuzul-hotel.vercel.app"}`;
  const end = (r: AdminRow) => (r.status === "trial" ? r.trial_ends_at : r.current_period_end);
  const payers = all.filter(paying);
  const mrr = payers.reduce((x, r) => x + monthlyBaisa(r), 0);
  const arr = payers.reduce((x, r) => x + yearlyBaisa(r), 0);
  const yearlyCount = payers.filter((r) => r.billing_period === "year").length;
  const trialsSoon = all.filter((r) => r.status === "trial" && r.trial_ends_at && r.trial_ends_at <= shiftDay(todayIso(), 7)).length;
  const todo = all.map((r) => ({ r, why: attention(r) })).filter((x) => x.why).sort((a, b) => (a.why!.tone === b.why!.tone ? 0 : a.why!.tone === "danger" ? -1 : 1));
  const openSupport = ((support ?? []) as { status: string }[]).filter((x) => x.status === "open").length;
  // income actually received, month by month, in baisa
  const months = Array.from({ length: 6 }, (_, i) => shift(thisMonth, i - 5));
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const p of (pays ?? []) as Pay[]) {
    const m = p.paid_on.slice(0, 7);
    if (byMonth.has(m) && isCurrency(p.currency)) byMonth.set(m, byMonth.get(m)! + toBaisaAt(Number(p.amount), p.currency, rates));
  }
  const top = Math.max(1, ...byMonth.values());
  const lastMonth = byMonth.get(shift(thisMonth, -1)) ?? 0;

  const kpis: [string, React.ReactNode, string, string][] = [
    ["الدخل الشهري المتوقع", <Money key="m" value={R(mrr)} cur="OMR" />, `من ${payers.length} شركة تدفع`, "text-ok"],
    ["الدخل السنوي المتوقع", <Money key="y" value={R(arr)} cur="OMR" />, "الشهري × 12 والسنوي كما هو", "text-ok"],
    ["الشركات الفعّالة", <span key="a" className="num">{payers.length}</span>, `${payers.length - yearlyCount} شهري · ${yearlyCount} سنوي`, ""],
    ["تجارب تنتهي هذا الأسبوع", <span key="t" className="num">{trialsSoon}</span>, "خلال 7 أيام", trialsSoon ? "text-warn" : ""],
    ["طلبات تجربة جديدة", <span key="r" className="num">{waiting.length}</span>, "بانتظار الرابط", waiting.length ? "text-info" : ""],
  ];

  return (
    <>
      <PageHeader title="نظرة عامة" sub={gregorian(todayIso(), "ar")} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map(([label, value, hint, tone], i) => (
          <div key={label} className={`card p-4 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`}>
            <div className="text-xs font-semibold text-muted">{label}</div>
            <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
            <div className="mt-0.5 text-xs text-muted">{hint}</div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.25fr_1fr]">
        {todo.length || openSupport ? (
        <section className="card">
          <h2 className="h2 mb-2">يحتاج تصرفاً منك <span className="num ms-1 rounded-full bg-warn-soft px-2.5 py-0.5 text-sm text-warn">{todo.length + (openSupport ? 1 : 0)}</span></h2>
          <ul className="divide-y divide-line">
            {openSupport ? (
              <li className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1"><b>طلبات دعم جديدة</b><span className="block text-sm text-muted">{openSupport} طلب بانتظار الرد</span></span>
                <Link href="/admin/support" className="btn-primary btn-sm">افتح الطلبات</Link>
              </li>
            ) : null}
            {todo.map(({ r, why }) => {
              const links = reminderLinks(r, priceWords(r), gregorian(end(r), "ar"));
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <span className="min-w-0 flex-1 basis-48">
                    <Link href={`/admin/${r.id}`} className="font-bold hover:text-brand">{r.name}</Link>
                    <span className={`block text-sm font-semibold ${why!.tone === "danger" ? "text-danger" : "text-warn"}`}>{why!.text}</span>
                  </span>
                  <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><MessageCircle className="size-4 shrink-0" /> ذكّره واتساب</a>
                  {links.mail ? <a href={links.mail} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Mail className="size-4 shrink-0" /> بريد</a> : null}
                  <Link href={`/admin/${r.id}?tab=pay`} className="btn-primary btn-sm">سجّل دفعة</Link>
                </li>
              );
            })}
          </ul>
        </section>
        ) : (
          <section className="card"><h2 className="h2">يحتاج تصرفاً منك</h2><p className="mt-2 text-sm text-muted">لا شيء الآن.</p></section>
        )}
        <section className="card">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="h2">دخل الاشتراكات المستلم</h2>
            <Link href="/admin/finance" className="text-sm font-semibold text-brand hover:underline">المالية ›</Link>
          </div>
          <p className="mt-1 text-xs text-muted">آخر 6 أشهر، محوّل إلى الريال العُماني بأسعار الصرف المعتمدة. الشهر الماضي: <Money value={R(lastMonth)} cur="OMR" /></p>
          <div className="mt-4 flex h-44 items-end gap-2" role="img" aria-label="دخل الاشتراكات آخر 6 أشهر">
            {months.map((m) => {
              const v = byMonth.get(m)!;
              return (
                <div key={m} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="num text-[11px] font-bold">{v ? R(v) : ""}</span>
                  <div className={`w-full max-w-12 rounded-t-xl ${m === thisMonth ? "bg-brand" : "bg-brand-soft"}`} style={{ height: `${Math.max(v ? 4 : 0, Math.round((v / top) * 100))}%` }} />
                  <span className="text-[11px] text-muted">{MONTHS[Number(m.slice(5, 7)) - 1]}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {trials.length ? (
        <section className="card mt-4">
          <details open={waiting.length > 0}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
              <h2 className="h2">طلبات تجربة النظام</h2>
              {waiting.length ? <span className="num rounded-full bg-warn-soft px-2.5 py-0.5 text-sm font-bold text-warn">{waiting.length} بانتظار الرابط</span> : <span className="text-sm text-muted">كلها أُرسلت ({trials.length})</span>}
            </summary>
            <ul className="mt-3 divide-y divide-line">
              {trials.map((x) => {
                const link = `${origin}/t/${x.token}`;
                const live = x.expires_at > new Date().toISOString();
                const text = `السلام عليكم ${x.name}،\nهذا رابط تجربة نظام نُزُل الخاص بكم:\n${link}\nيفتح فندقاً تجريبياً ببيانات وهمية، وصالح حتى ${dateTime(x.expires_at, "Asia/Muscat", "ar")}.\nنسعد بأي سؤال.`;
                return (
                  <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className="min-w-0 flex-1 basis-52">
                      <b>{x.name}</b>{x.company ? <span className="text-muted"> · {x.company}</span> : null}
                      <span className="block text-sm text-muted"><span dir="ltr">+{x.phone}</span> · <span dir="ltr">{x.email}</span></span>
                      <span className="block text-xs text-muted">
                        طلب {dateTime(x.created_at, "Asia/Muscat", "ar")} · {x.opens ? `فتح الرابط ${x.opens} مرة` : "لم يفتح الرابط بعد"} · {live ? "الرابط صالح" : <span className="font-semibold text-danger">انتهى الرابط</span>}
                      </span>
                    </span>
                    {x.handled_at ? <Badge tone="ok">أُرسل</Badge> : <Badge tone="warn">جديد</Badge>}
                    <a href={`https://wa.me/${x.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm inline-flex items-center gap-1.5"><MessageCircle className="size-4 shrink-0" /> واتساب</a>
                    <a href={`mailto:${x.email}?subject=${encodeURIComponent("رابط تجربة نظام نُزُل")}&body=${encodeURIComponent(text)}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Mail className="size-4 shrink-0" /> بريد</a>
                    {!x.handled_at ? (
                      <ActionForm action={adminTrialSent}>
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} />
                        <SubmitButton className="btn-ghost btn-sm">تم الإرسال</SubmitButton>
                      </ActionForm>
                    ) : null}
                    <ActionForm action={adminTrialExtend}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} />
                      <SubmitButton className="btn-ghost btn-sm">مدّد 7 أيام</SubmitButton>
                    </ActionForm>
                    <ActionForm action={adminTrialDrop}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={`حذف طلب «${x.name}»؟ رابطه سيتوقف.`}>حذف</SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </details>
        </section>
      ) : null}

    </>
  );
}

function shiftDay(d: string, by: number) {
  return new Date(Date.parse(d) + by * 86_400_000).toISOString().slice(0, 10);
}
