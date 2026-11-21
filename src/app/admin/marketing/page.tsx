import Link from "next/link";
import { headers } from "next/headers";
import { Mail, MessageCircle } from "lucide-react";
import { can, monthlyBaisa, paying, portalMe, requireAdmin, todayIso, type AdminRow } from "@/lib/admin";
import { amount, CUR, isCurrency } from "@/lib/currency";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Money } from "@/components/CurrencySign";
import { Badge, PageHeader } from "@/components/ui";
import { adminTrialDrop, adminTrialExtend } from "@/app/actions/admin";
import { leadStage } from "@/app/actions/portal";

type Lead = {
  id: string; name: string; company: string | null; phone: string; email: string; token: string; expires_at: string; opens: number;
  created_at: string; stage: string; source: string | null; lost_reason: string | null; stage_at: string | null;
};
type Exp = { amount: number; recurrence: string; started_on: string; ended_on: string | null };
const STEPS: [string, string][] = [["new", "طلب تجربة"], ["contacted", "تواصلنا"], ["demo", "عرض للنظام"], ["trial", "بدأ التجربة"], ["won", "اشترك"]];
const STAGE_AR: Record<string, string> = { ...Object.fromEntries(STEPS), lost: "خسرناه" };
const SOURCE_AR: Record<string, string> = { instagram: "إنستغرام", referral: "توصية", search: "بحث جوجل", direct: "زيارة مباشرة", other: "غير ذلك" };
const R = (b: number) => amount(b, "OMR");

/** Bringing in hotels and growing subscriptions: the pipeline, where customers come from, cost and profitability. */
export default async function MarketingPage({ searchParams }: PageProps<"/admin/marketing">) {
  const sb = await requireAdmin("marketing");
  const { me } = await portalMe();
  const edit = can(me, "marketing", "edit");
  const sp = await searchParams;
  const period = sp.p === "all" ? "all" : sp.p === "90" ? "90" : "month";
  const since = period === "month" ? `${todayIso().slice(0, 7)}-01` : period === "90" ? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10) : "2000-01-01";
  const [{ data: tr }, { data: ov }, { data: ex }, h] = await Promise.all([
    sb.from("trial_requests").select("id, name, company, phone, email, token, expires_at, opens, created_at, stage, source, lost_reason, stage_at").order("created_at", { ascending: false }).limit(300),
    sb.rpc("admin_overview"),
    can(me, "finance") || can(me, "ceo") ? sb.from("platform_expenses").select("amount, recurrence, started_on, ended_on").eq("category", "marketing") : Promise.resolve({ data: null }),
    headers(),
  ]);
  const all = (tr ?? []) as Lead[];
  const leads = all.filter((l) => l.created_at.slice(0, 10) >= since);
  const rows = (ov ?? []) as AdminRow[];
  const origin = `https://${h.get("host") ?? "nuzul-hotel.vercel.app"}`;

  const idx = (st: string) => STEPS.findIndex(([k]) => k === st);
  const reached = STEPS.map(([k, label], i) => ({ k, label, n: leads.filter((l) => l.stage !== "lost" && idx(l.stage) >= i).length }));
  const lost = leads.filter((l) => l.stage === "lost").length;
  const won = reached[4].n;
  const conv = leads.length ? Math.round((won * 100) / leads.length) : 0;
  let worst = 1;
  for (let i = 1; i < reached.length; i++) {
    const drop = reached[i - 1].n ? reached[i].n / reached[i - 1].n : 1;
    const prev = reached[worst - 1].n ? reached[worst].n / reached[worst - 1].n : 1;
    if (drop < prev) worst = i;
  }

  // paying companies that joined in the period, and marketing spend over the same months (monthly equivalents, baisa)
  const payers = rows.filter(paying);
  const newPaying = payers.filter((r) => r.created_at.slice(0, 10) >= since).length;
  const months = period === "month" ? 1 : period === "90" ? 3 : 12;
  const spend = ex ? ((ex ?? []) as Exp[]).filter((e) => !e.ended_on || e.ended_on >= since).reduce((x, e) => x + (e.recurrence === "year" ? e.amount / 12 : e.recurrence === "month" ? e.amount : 0) * months
    + (e.recurrence === "once" && e.started_on >= since ? e.amount : 0), 0) : null;
  const cac = spend != null && newPaying ? Math.round(spend / newPaying) : null;
  const mrr = payers.reduce((x, r) => x + monthlyBaisa(r), 0);
  const avg = payers.length ? Math.round(mrr / payers.length) : 0;

  const bySource = Object.keys(SOURCE_AR).map((k) => {
    const ls = leads.filter((l) => (l.source ?? "other") === k);
    const w = ls.filter((l) => l.stage === "won").length;
    return { k, n: ls.length, w };
  }).filter((x) => x.n);
  const byPlan = new Map<string, { n: number; m: number }>();
  for (const r of payers) {
    const k = r.plan_name ?? r.plan_code ?? "—";
    const v = byPlan.get(k) ?? { n: 0, m: 0 };
    byPlan.set(k, { n: v.n + 1, m: v.m + monthlyBaisa(r) });
  }
  const byCountry = (["OMR", "SAR", "AED"] as const).map((c) => [CUR[c].country, payers.filter((r) => (isCurrency(r.currency) ? r.currency : "OMR") === c).length] as const).filter(([, n]) => n);

  const kpis: [string, React.ReactNode, string, string][] = [
    ["عملاء جدد", <span key="a" className="num">{leads.length}</span>, `${lost} خسرناهم`, ""],
    ["التحويل لاشتراك", <span key="b" className="num">{conv}%</span>, `${won} اشتركوا`, conv >= 30 ? "text-ok" : "text-warn"],
    ["تكلفة جلب الفندق", cac != null ? <Money key="c" value={R(cac)} cur="OMR" /> : <span key="c" className="text-base text-muted">—</span>, spend == null ? "تحتاج صلاحية المالية" : newPaying ? "مصروفات التسويق ÷ الفنادق الجديدة" : "لا فنادق جديدة في الفترة", ""],
    ["متوسط دخل الشركة شهرياً", <Money key="d" value={R(avg)} cur="OMR" />, `من ${payers.length} شركة تدفع`, ""],
  ];
  const tabs: [string, string][] = [["month", "هذا الشهر"], ["90", "آخر 3 أشهر"], ["all", "الكل"]];

  return (
    <>
      <PageHeader title="التسويق" sub="جلب الفنادق وزيادة الاشتراكات وقياس النمو" actions={
        <div className="inline-flex gap-1 rounded-full bg-surface-2 p-1">
          {tabs.map(([k, l]) => <Link key={k} href={k === "month" ? "/admin/marketing" : `/admin/marketing?p=${k}`} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${period === k ? "bg-surface shadow-sm" : "text-muted"}`}>{l}</Link>)}
        </div>
      } />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([l, v, hint, tone]) => (
          <div key={l} className="card p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`mt-1 text-2xl font-bold ${tone}`}>{v}</div><div className="mt-0.5 text-xs text-muted">{hint}</div></div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="card">
          <h2 className="h2 mb-3">مسار العملاء</h2>
          <div className="space-y-2.5">
            {reached.map((x, i) => {
              const w = reached[0].n ? Math.max(x.n ? 8 : 0, Math.round((x.n * 100) / reached[0].n)) : 0;
              return (
                <div key={x.k} className="grid grid-cols-[6.5rem_1fr_5rem] items-center gap-2">
                  <b className="text-sm">{x.label}</b>
                  <div className="h-8 rounded-xl bg-surface-2"><div className={`flex h-full items-center justify-end rounded-xl px-2.5 text-sm font-bold text-white ${i === 4 ? "bg-[#d9a531]" : "bg-brand"}`} style={{ width: `${w}%` }}><span className="num">{x.n || ""}</span></div></div>
                  <span className="num text-xs text-muted">{i && reached[i - 1].n ? `${Math.round((x.n * 100) / reached[i - 1].n)}% من قبلها` : ""}</span>
                </div>
              );
            })}
          </div>
          {reached[0].n > 1 ? <p className="mt-3 text-xs text-muted">أكبر خسارة بين «{reached[worst - 1].label}» و«{reached[worst].label}».</p> : null}
        </section>

        <section className="card">
          <h2 className="h2 mb-1">الربحية حسب الباقة · شهرياً</h2>
          <ul className="divide-y divide-line">
            {[...byPlan.entries()].sort((a, b) => b[1].m - a[1].m).map(([k, v]) => (
              <li key={k} className="flex items-center gap-3 py-2.5"><b className="flex-1">{k}</b><span className="text-xs text-muted">{v.n} شركة</span><b><Money value={R(v.m)} cur="OMR" /></b></li>
            ))}
            <li className="flex items-center gap-3 py-2.5"><b className="flex-1">الإجمالي</b><b className="text-lg"><Money value={R(mrr)} cur="OMR" /></b></li>
          </ul>
          {byCountry.length ? <p className="text-xs text-muted">{byCountry.map(([c, n]) => `${c} ${n}`).join(" · ")}</p> : null}
        </section>
      </div>

      <section className="card mt-4 overflow-x-auto">
        <h2 className="h2 mb-2">مصادر العملاء</h2>
        {bySource.length ? (
          <table className="w-full min-w-[28rem] text-sm">
            <thead><tr className="text-xs text-muted"><th className="py-2 text-start font-semibold">المصدر</th><th className="font-semibold">عملاء</th><th className="font-semibold">اشتركوا</th><th className="font-semibold">التحويل</th></tr></thead>
            <tbody className="divide-y divide-line">
              {bySource.map((x) => <tr key={x.k}><td className="py-2 font-semibold">{SOURCE_AR[x.k]}</td><td className="num text-center">{x.n}</td><td className="num text-center">{x.w}</td><td className="num text-center">{Math.round((x.w * 100) / x.n)}%</td></tr>)}
            </tbody>
          </table>
        ) : <p className="text-sm text-muted">حدد مصدر كل عميل من القائمة تحت، وتطلع الأرقام هنا.</p>}
      </section>

      <section className="card mt-4">
        <h2 className="h2 mb-1">العملاء ({leads.length})</h2>
        <ul className="divide-y divide-line">
          {leads.map((x) => {
            const link = `${origin}/t/${x.token}`;
            const live = x.expires_at > new Date().toISOString();
            const text = `السلام عليكم ${x.name}،\nهذا رابط تجربة نظام نُزُل الخاص بكم:\n${link}\nيفتح فندقاً تجريبياً ببيانات وهمية.`;
            return (
              <li key={x.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="min-w-0 flex-1 basis-52">
                    <b>{x.name}</b>{x.company ? <span className="text-muted"> · {x.company}</span> : null}
                    <span className="block text-sm text-muted"><span dir="ltr">+{x.phone}</span> · <span dir="ltr">{x.email}</span></span>
                    <span className="block text-xs text-muted">طلب {dateTime(x.created_at, "Asia/Muscat", "ar")} · {x.opens ? `فتح رابط التجربة ${x.opens} مرة` : "لم يفتح الرابط"} · {live ? "الرابط صالح" : "الرابط منتهي"}</span>
                  </span>
                  <Badge tone={x.stage === "won" ? "ok" : x.stage === "lost" ? "gray" : x.stage === "new" ? "warn" : "info"}>{STAGE_AR[x.stage] ?? x.stage}</Badge>
                  {x.source ? <Badge tone="gray">{SOURCE_AR[x.source]}</Badge> : null}
                  <a href={`https://wa.me/${x.phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm inline-flex items-center gap-1.5"><MessageCircle className="size-4" /> واتساب</a>
                  <a href={`mailto:${x.email}?subject=${encodeURIComponent("رابط تجربة نظام نُزُل")}&body=${encodeURIComponent(text)}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Mail className="size-4" /> بريد</a>
                </div>
                {edit ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-semibold text-brand">تحديث المرحلة</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl bg-surface-2 p-3">
                      <ActionForm action={leadStage} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} />
                        <label className="text-xs font-semibold text-muted">المرحلة<select name="stage" defaultValue={x.stage} className="input mt-1">{Object.entries(STAGE_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                        <label className="text-xs font-semibold text-muted">المصدر<select name="source" defaultValue={x.source ?? ""} className="input mt-1"><option value="">—</option>{Object.entries(SOURCE_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                        <label className="text-xs font-semibold text-muted">سبب الخسارة (إن وجد)<input name="lost_reason" defaultValue={x.lost_reason ?? ""} className="input mt-1" /></label>
                        <SubmitButton className="btn-primary btn-sm">حفظ</SubmitButton>
                      </ActionForm>
                      <ActionForm action={adminTrialExtend}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} /><SubmitButton className="btn-ghost btn-sm">مدّد الرابط 7 أيام</SubmitButton></ActionForm>
                      <ActionForm action={adminTrialDrop}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="name" value={x.name} /><SubmitButton className="btn-ghost btn-sm text-danger" confirm={`حذف «${x.name}»؟ رابطه سيتوقف.`}>حذف</SubmitButton></ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
          {!leads.length ? <li className="py-3 text-sm text-muted">لا عملاء في هذه الفترة.</li> : null}
        </ul>
        <p className="mt-2 text-xs text-muted">العملاء يجون من نموذج «جرّب النظام» في صفحة التعريف. أكواد الخصم تنضاف في مرحلة قادمة.</p>
      </section>
    </>
  );
}
