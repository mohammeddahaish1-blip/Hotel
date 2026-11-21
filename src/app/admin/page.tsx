import Link from "next/link";
import { headers } from "next/headers";
import { Landmark, LifeBuoy, Mail, Megaphone, MessageCircle, MonitorCog, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { attention, can, monthlyBaisa, paying, portalMe, priceWords, reminderLinks, requireAdmin, SECTION_HREF, SECTIONS, todayIso, yearlyBaisa, type AdminRow } from "@/lib/admin";
import { toBaisaAt, isCurrency, amount, type Rates } from "@/lib/currency";
import { gregorian } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Money } from "@/components/CurrencySign";
import { PageHeader } from "@/components/ui";
import { ceoAddDecision, ceoDecide, ceoDropDecision, ceoSaveGoals, ceoSaveLimits } from "@/app/actions/portal";

type Trial = { id: string; created_at: string; stage: string; handled_at: string | null };
type Approval = { id: string; kind: string; title: string; detail: string | null; requested_by_email: string | null; created_at: string };
type Decision = { id: string; title: string; reason: string | null; decided_on: string };
type Goal = { metric: string; target: number };
type Pay = { amount: number; currency: string; paid_on: string; voided_at: string | null };

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const shift = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};
const R = (baisa: number) => amount(baisa, "OMR");

/** The decision board: the figures that matter, each department at a glance, goals, approvals and decisions. */
export default async function AdminOverview() {
  const sb = await requireAdmin();
  const { me } = await portalMe();
  if (!can(me, "ceo")) {
    const first = SECTIONS.find((x) => x !== "ceo" && can(me, x));
    redirect(first ? SECTION_HREF[first] : "/portal-blocked?why=stopped");
  }
  const ceoEdit = can(me, "ceo", "edit");
  const thisMonth = todayIso().slice(0, 7);
  const from = `${shift(thisMonth, -5)}-01`;
  const [{ data, error }, { data: support }, { data: tr }, { data: pays }, { data: fx }, h] = await Promise.all([
    sb.rpc("admin_overview"),
    can(me, "support") ? sb.rpc("admin_support_list") : Promise.resolve({ data: [] }),
    sb.from("trial_requests").select("id, created_at, stage, handled_at").order("created_at", { ascending: false }).limit(500),
    sb.from("subscription_payments").select("amount, currency, paid_on, voided_at").gte("paid_on", from).is("voided_at", null),
    sb.from("platform_settings").select("sar_per_omr, aed_per_omr").eq("id", 1).maybeSingle(),
    headers(),
  ]);
  if (error) throw new Error(error.message);
  const [{ data: asks }, { data: decs }, { data: gl }, { data: lim }, { data: team }, { data: ops }] = await Promise.all([
    sb.from("platform_approvals").select("id, kind, title, detail, requested_by_email, created_at").eq("status", "pending").order("created_at"),
    sb.from("platform_decisions").select("id, title, reason, decided_on").order("decided_on", { ascending: false }).limit(8),
    sb.from("platform_goals").select("metric, target").eq("month", `${thisMonth}-01`),
    sb.from("platform_settings").select("discount_limit, expense_limit").eq("id", 1).maybeSingle(),
    can(me, "team") || can(me, "security") ? sb.rpc("admin_team") : Promise.resolve({ data: null }),
    sb.from("platform_ops").select("maintenance_on").eq("id", 1).maybeSingle(),
  ]);
  const all = (data ?? []) as AdminRow[];
  const rates = (fx ?? { sar_per_omr: 9.75, aed_per_omr: 9.55 }) as Rates;
  const trials = (tr ?? []) as Trial[];
  const waiting = trials.filter((x) => x.stage === "new");
  void h;
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

  // this month's goals and where we stand
  const monthLeads = trials.filter((x) => x.created_at.slice(0, 7) === thisMonth);
  const actual: Record<string, number> = {
    new_paying: payers.filter((r) => r.created_at.slice(0, 7) === thisMonth).length,
    new_trials: monthLeads.length,
    conversion: monthLeads.length ? Math.round((monthLeads.filter((x) => x.stage === "won").length * 100) / monthLeads.length) : 0,
    mrr,
  };
  const goals = new Map(((gl ?? []) as Goal[]).map((g) => [g.metric, Number(g.target)]));
  const GOALS: [string, string, (v: number) => React.ReactNode][] = [
    ["new_paying", "شركات جديدة تدفع", (v) => <span className="num">{v}</span>],
    ["new_trials", "عملاء جدد", (v) => <span className="num">{v}</span>],
    ["conversion", "نسبة التحويل لاشتراك", (v) => <span className="num">{v}%</span>],
    ["mrr", "الدخل الشهري", (v) => <Money value={R(v)} cur="OMR" />],
  ];
  const approvals = (asks ?? []) as Approval[];
  const decisions = (decs ?? []) as Decision[];
  const limits = (lim ?? { discount_limit: 20, expense_limit: 50000 }) as { discount_limit: number; expense_limit: number };
  const members = ((team as { members?: { owner: boolean; mfa: boolean; active: boolean }[] } | null)?.members ?? []);
  const depts: [boolean, React.ReactNode, string, string, string, string][] = [
    [can(me, "marketing"), <Megaphone key="m" className="size-4" />, "التسويق", `${monthLeads.length} عملاء جدد هذا الشهر`, `تحويل ${actual.conversion}%`, "/admin/marketing"],
    [can(me, "it"), <MonitorCog key="i" className="size-4" />, "التقنية", (ops as { maintenance_on?: boolean } | null)?.maintenance_on ? "وضع الصيانة مشغّل" : "المنصة تعمل", "صحة المنصة والصيانة", "/admin/it"],
    [can(me, "security"), <ShieldCheck key="s" className="size-4" />, "الأمن السيبراني", `${members.filter((m) => !m.owner && m.active && !m.mfa).length} عضو بدون تحقق بخطوتين`, `${members.length} في الفريق`, "/admin/security"],
    [can(me, "support"), <LifeBuoy key="d" className="size-4" />, "الدعم", `${openSupport} طلب جديد`, "طلبات الفنادق", "/admin/support"],
  ];
  const BOARD = (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {depts.filter((d) => d[0]).map(([, icon, name, a, b, href]) => (
          <Link key={name} href={href} className="card block p-4 transition hover:shadow-md">
            <span className="flex items-center gap-2 text-sm font-bold text-brand">{icon}{name}</span>
            <span className="mt-1.5 block font-semibold">{a}</span><span className="block text-xs text-muted">{b}</span>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="h2">أهداف {MONTHS[Number(thisMonth.slice(5, 7)) - 1]}</h2></div>
          {goals.size ? (
            <div className="space-y-3">
              {GOALS.filter(([k]) => goals.has(k)).map(([k, label, fmt]) => {
                const t = goals.get(k)!, v = actual[k], pct = Math.min(100, Math.round((v * 100) / t));
                return (
                  <div key={k}>
                    <div className="flex justify-between gap-2 text-sm"><b>{label}</b><span>{fmt(v)} من {fmt(t)}</span></div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${pct >= 100 ? "bg-ok" : pct >= 60 ? "bg-brand" : "bg-[#d9a531]"}`} style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-muted">ما حددت أهداف لهذا الشهر.</p>}
          {ceoEdit ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand">{goals.size ? "تعديل الأهداف" : "حدد أهداف الشهر"}</summary>
              <ActionForm action={ceoSaveGoals} className="mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-3">
                <input type="hidden" name="month" value={thisMonth} />
                <label className="text-xs font-semibold text-muted">شركات جديدة تدفع<input name="new_paying" inputMode="numeric" defaultValue={goals.get("new_paying") ?? ""} className="input mt-1" /></label>
                <label className="text-xs font-semibold text-muted">عملاء جدد<input name="new_trials" inputMode="numeric" defaultValue={goals.get("new_trials") ?? ""} className="input mt-1" /></label>
                <label className="text-xs font-semibold text-muted">نسبة التحويل %<input name="conversion" inputMode="numeric" defaultValue={goals.get("conversion") ?? ""} className="input mt-1" /></label>
                <label className="text-xs font-semibold text-muted">الدخل الشهري (ر.ع)<input name="mrr" inputMode="decimal" dir="ltr" defaultValue={goals.has("mrr") ? R(goals.get("mrr")!) : ""} className="input mt-1" /></label>
                <SubmitButton className="btn-primary btn-sm col-span-2">حفظ الأهداف</SubmitButton>
              </ActionForm>
            </details>
          ) : null}
        </section>

        <section className="card">
          <h2 className="h2 mb-1">تنتظر موافقتك {approvals.length ? <span className="num ms-1 rounded-full bg-[#d9a531] px-2 text-sm text-[#2e2100]">{approvals.length}</span> : null}</h2>
          {approvals.length ? (
            <ul className="divide-y divide-line">
              {approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 basis-48"><b>{a.title}</b><span className="block text-xs text-muted">{a.detail} · طلبه <span dir="ltr">{a.requested_by_email ?? "—"}</span></span></span>
                  {ceoEdit ? (
                    <>
                      <ActionForm action={ceoDecide}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="ok" value="0" /><SubmitButton className="btn-ghost btn-sm text-danger">رفض</SubmitButton></ActionForm>
                      <ActionForm action={ceoDecide}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="ok" value="1" /><SubmitButton className="btn-primary btn-sm">موافقة</SubmitButton></ActionForm>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">لا طلبات.</p>}
          <p className="mt-2 text-xs text-muted">يحتاج موافقة: خصم أكبر من {limits.discount_limit}% أو مصروف شهري أكبر من {R(limits.expense_limit)} ر.ع، إذا طلبه عضو غير المدير التنفيذي.</p>
          {ceoEdit ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-brand">تعديل الحدود</summary>
              <ActionForm action={ceoSaveLimits} className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl bg-surface-2 p-3">
                <label className="text-xs font-semibold text-muted">حد الخصم %<input name="discount" inputMode="numeric" defaultValue={limits.discount_limit} className="input mt-1 w-24" /></label>
                <label className="text-xs font-semibold text-muted">حد المصروف الشهري (ر.ع)<input name="expense" inputMode="decimal" dir="ltr" defaultValue={R(limits.expense_limit)} className="input mt-1 w-32" /></label>
                <SubmitButton className="btn-primary btn-sm">حفظ</SubmitButton>
              </ActionForm>
            </details>
          ) : null}
        </section>
      </div>

      <section className="card mt-4">
        <div className="mb-1 flex items-center gap-2"><Landmark className="size-5 text-brand" aria-hidden /><h2 className="h2">سجل القرارات</h2></div>
        {decisions.length ? (
          <ul className="divide-y divide-line">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1"><b>{d.title}</b>{d.reason ? <span className="block text-xs text-muted">السبب: {d.reason}</span> : null}</span>
                <span className="text-xs text-muted">{gregorian(d.decided_on, "ar")}</span>
                {ceoEdit ? <ActionForm action={ceoDropDecision}><input type="hidden" name="id" value={d.id} /><SubmitButton className="btn-ghost btn-sm text-danger" confirm="حذف هذا القرار من السجل؟">حذف</SubmitButton></ActionForm> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">ما فيه قرارات مسجلة.</p>}
        {ceoEdit ? (
          <ActionForm action={ceoAddDecision} resetOnSuccess className="mt-3 grid gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <label className="text-xs font-semibold text-muted">القرار<input name="title" required className="input mt-1" /></label>
            <label className="text-xs font-semibold text-muted">السبب<input name="reason" className="input mt-1" /></label>
            <label className="text-xs font-semibold text-muted">التاريخ<input name="on" type="date" defaultValue={todayIso()} className="input mt-1" /></label>
            <SubmitButton className="btn-primary btn-sm">+ تسجيل</SubmitButton>
          </ActionForm>
        ) : null}
      </section>
    </>
  );

  const kpis: [string, React.ReactNode, string, string][] = [
    ["الدخل الشهري المتوقع", <Money key="m" value={R(mrr)} cur="OMR" />, `من ${payers.length} شركة تدفع`, "text-ok"],
    ["الدخل السنوي المتوقع", <Money key="y" value={R(arr)} cur="OMR" />, "الشهري × 12 والسنوي كما هو", "text-ok"],
    ["الشركات الفعّالة", <span key="a" className="num">{payers.length}</span>, `${payers.length - yearlyCount} شهري · ${yearlyCount} سنوي`, ""],
    ["تجارب تنتهي هذا الأسبوع", <span key="t" className="num">{trialsSoon}</span>, "خلال 7 أيام", trialsSoon ? "text-warn" : ""],
    ["عملاء جدد بانتظار تواصل", <span key="r" className="num">{waiting.length}</span>, "في التسويق", waiting.length ? "text-info" : ""],
  ];

  return (
    <>
      <PageHeader title="لوحة القرار" sub={gregorian(todayIso(), "ar")} />
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

      {BOARD}

    </>
  );
}

function shiftDay(d: string, by: number) {
  return new Date(Date.parse(d) + by * 86_400_000).toISOString().slice(0, 10);
}
