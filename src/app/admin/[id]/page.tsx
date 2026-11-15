import { notFound } from "next/navigation";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { attention, daysTo, reminderLinks, requireAdmin, STATUSES, STATUS_AR, STATUS_TONE, type AdminRow } from "@/lib/admin";
import { gregorian, omr, plainOmr } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Crumb, Field, PageHeader, Section, Stat } from "@/components/ui";
import { adminRecordPayment, adminResume, adminSetSubscription, adminSuspend, adminVoidPayment } from "@/app/actions/admin";
import { adminCreateMaintenance } from "@/app/actions/support";

type Row = AdminRow;
type Detail = {
  properties: { id: string; name: string; kind: string; units: number }[];
  staff: { name: string; email: string; role: string; active: boolean }[];
  payments: { id: string; amount: number; months: number; period_start: string; period_end: string; paid_on: string; method: string | null; reference: string | null; voided: boolean }[];
};
const ROLE_AR: Record<string, string> = { owner: "مالك", manager: "مدير", reception: "استقبال", accountant: "محاسب", housekeeping: "تنظيف", maintenance: "صيانة" };

/** One company: change its plan and status, record a monthly payment, see what it uses. */
export default async function AdminTenant({ params, searchParams }: PageProps<"/admin/[id]">) {
  const sb = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: all }, { data: detail }, { data: plans }] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.rpc("admin_tenant", { p_tenant: id }),
    sb.from("plans").select("code, name_ar, monthly_price, max_units, max_properties").order("sort"),
  ]);
  const r = ((all ?? []) as Row[]).find((x) => x.id === id);
  if (!r) notFound();
  const d = detail as Detail;

  const sp = await searchParams;
  const TABS: [string, string][] = [["sub", "الاشتراك"], ["pay", "الدفعات"], ["usage", "الاستخدام"], ["support", "الصيانة"]];
  const tab = typeof sp.tab === "string" && TABS.some(([k]) => k === sp.tab) ? sp.tab : "sub";
  const why = attention(r);
  const end = r.status === "trial" ? r.trial_ends_at : r.current_period_end;
  const links = reminderLinks(r, r.price != null ? omr(r.price, "ar") : "", gregorian(end, "ar"));
  const plan = (plans ?? []).find((p) => p.code === r.plan_code) as { max_units: number | null; max_properties: number | null } | undefined;
  const over = (n: number, max: number | null | undefined) => max != null && Number(n) > max;
  const quiet = daysTo(r.last_activity ? r.last_activity.slice(0, 10) : null);

  return (
    <>
      <Crumb href="/admin" label="الشركات" />
      <PageHeader title={r.name} sub={`${r.owner_name ?? ""} · ${r.owner_email ?? ""} · منذ ${gregorian(r.created_at.slice(0, 10), "ar")}`} />

      {/* where the company stands, and the one thing most likely needed next */}
      <section className={`card mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 ${why?.tone === "danger" ? "bg-danger-soft" : ""}`}>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{r.plan_name ?? "بدون باقة"}</Badge>
            {r.status ? <Badge tone={STATUS_TONE[r.status] ?? "gray"}>{STATUS_AR[r.status]}</Badge> : null}
            <span className="num font-bold">{r.price != null ? omr(r.price, "ar") : "—"}</span><span className="text-xs text-muted">شهرياً</span>
          </div>
          <div className="mt-1 text-sm">
            {r.status === "trial" ? "التجربة حتى" : "مدفوع حتى"} <b>{gregorian(end, "ar")}</b>
            {why ? <span className={`ms-2 font-semibold ${why.tone === "danger" ? "text-danger" : "text-warn"}`}>{why.text}</span> : null}
          </div>
          {r.status === "suspended" && r.notes ? <div className="mt-1 text-sm text-danger">{r.notes}</div> : null}
        </div>
        {why ? (
          <>
            <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><MessageCircle className="size-4 shrink-0" /> ذكّره واتساب</a>
            {links.mail ? <a href={links.mail} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Mail className="size-4 shrink-0" /> بريد</a> : null}
          </>
        ) : null}
        {r.status === "suspended" ? (
          <ActionForm action={adminResume}>
            <input type="hidden" name="tenant" value={r.id} />
            <SubmitButton className="btn-primary" confirm={`إعادة تفعيل اشتراك «${r.name}»؟`}>أعد التفعيل</SubmitButton>
          </ActionForm>
        ) : <Link href={`/admin/${r.id}?tab=pay`} className="btn-primary">سجّل دفعة</Link>}
      </section>

      <nav className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1" aria-label={r.name}>
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/admin/${r.id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${tab === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{label}</Link>
        ))}
      </nav>

      {tab === "sub" ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="الاشتراك">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="brand">{r.plan_name ?? "بدون باقة"}</Badge>
            {r.status ? <Badge tone={STATUS_TONE[r.status] ?? "gray"}>{STATUS_AR[r.status]}</Badge> : null}
            <span className="text-muted">{r.status === "trial" ? `التجربة حتى ${gregorian(r.trial_ends_at, "ar")}` : `مدفوع حتى ${gregorian(r.current_period_end, "ar")}`}</span>
          </div>
          <ActionForm action={adminSetSubscription} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenant" value={r.id} />
            <Field label="الباقة">
              <select name="plan" defaultValue={r.plan_code ?? "basic"} className="input">
                {(plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name_ar} — {omr(p.monthly_price, "ar")}</option>)}
              </select>
            </Field>
            <Field label="الحالة">
              <select name="status" defaultValue={r.status ?? "active"} className="input">
                {STATUSES.filter((s) => s !== "suspended" || r.status === "suspended").map((s) => <option key={s} value={s}>{STATUS_AR[s]}</option>)}
              </select>
            </Field>
            <Field label="مدفوع حتى"><input type="date" name="period_end" defaultValue={r.current_period_end ?? ""} className="input" /></Field>
            <Field label="التجربة حتى"><input type="date" name="trial_ends" defaultValue={r.trial_ends_at ?? ""} className="input" /></Field>
            <Field label="سعر خاص شهرياً (اختياري)"><input name="price_override" inputMode="decimal" dir="ltr" defaultValue={r.price_override != null ? plainOmr(r.price_override) : ""} placeholder="سعر الباقة" className="input" /></Field>
            <Field label="ملاحظات"><input name="notes" defaultValue={r.notes ?? ""} maxLength={500} className="input" /></Field>
            <SubmitButton className="btn-primary sm:col-span-2">حفظ الاشتراك</SubmitButton>
          </ActionForm>
        </Section>

          {r.status !== "suspended" && r.plan_code ? (
            <section className="card border border-danger/30">
              <h2 className="h2 text-danger">إيقاف الاشتراك</h2>
              <p className="my-2 text-sm text-muted">الإيقاف يمنع كل موظفي «{r.name}» من استخدام النظام حتى تعيد التفعيل. بياناتهم تبقى كما هي.</p>
              <ActionForm action={adminSuspend} className="space-y-3">
                <input type="hidden" name="tenant" value={r.id} />
                <Field label="سبب الإيقاف (يُحفظ في السجل)"><input name="reason" required minLength={3} maxLength={300} className="input" /></Field>
                <SubmitButton className="btn-danger" confirm={`إيقاف اشتراك «${r.name}»؟ سيُقفل النظام على كل موظفيهم.`}>أوقف الاشتراك</SubmitButton>
              </ActionForm>
            </section>
          ) : null}
        </div>
      ) : tab === "pay" ? (
        <div className="max-w-3xl">
        <Section title="تسجيل دفعة اشتراك">
          <p className="mb-3 text-xs text-muted">الدفعة تمدّد «مدفوع حتى» بعدد الأشهر وتجعل الاشتراك فعّالاً.</p>
          <ActionForm action={adminRecordPayment} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenant" value={r.id} />
            <Field label="المبلغ (ر.ع.)"><input name="amount" required inputMode="decimal" dir="ltr" defaultValue={r.price != null ? plainOmr(r.price) : ""} className="input" /></Field>
            <Field label="عدد الأشهر"><input name="months" type="number" min={1} max={24} defaultValue={1} className="input" /></Field>
            <Field label="طريقة الدفع">
              <select name="method" className="input">
                <option value="transfer">تحويل بنكي</option><option value="cash">نقد</option><option value="card">بطاقة</option><option value="cheque">شيك</option>
              </select>
            </Field>
            <Field label="المرجع"><input name="reference" className="input" /></Field>
            <Field label="تاريخ الدفع"><input type="date" name="paid_on" className="input" /></Field>
            <div className="flex items-end"><SubmitButton className="btn-primary w-full">تسجيل الدفعة</SubmitButton></div>
          </ActionForm>
          <h3 className="mb-2 mt-5 text-sm font-bold">سجل الدفعات</h3>
          {d.payments.length === 0 ? <p className="text-xs text-muted">لا توجد دفعات بعد.</p> : (
            <ul className="divide-y divide-line text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${p.voided ? "text-muted line-through" : ""}`}>
                  <span className="num font-semibold">{omr(p.amount, "ar")}</span>
                  <span className="text-xs text-muted">{gregorian(p.paid_on, "ar")} · {p.months} شهر · {gregorian(p.period_start, "ar")} ← {gregorian(p.period_end, "ar")}{p.reference ? ` · ${p.reference}` : ""}</span>
                  {!p.voided ? (
                    <ActionForm action={adminVoidPayment} className="ms-auto">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="tenant" value={r.id} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm="إلغاء هذه الدفعة؟ ستُخصم أشهرها من «مدفوع حتى».">إلغاء</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>

        </div>
      ) : tab === "usage" ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="الوحدات" value={<span className="num">{r.units}{plan?.max_units != null ? ` / ${plan.max_units}` : ""}</span>} tone={over(r.units, plan?.max_units) ? "danger" : undefined} hint={over(r.units, plan?.max_units) ? "تجاوز حد الباقة" : plan?.max_units != null ? "من حد الباقة" : "بدون حد"} />
            <Stat label="العقارات" value={<span className="num">{r.properties}{plan?.max_properties != null ? ` / ${plan.max_properties}` : ""}</span>} tone={over(r.properties, plan?.max_properties) ? "danger" : undefined} hint={over(r.properties, plan?.max_properties) ? "تجاوز حد الباقة" : undefined} />
            <Stat label="حجوزات آخر 30 يوماً" value={<span className="num">{r.bookings_30d}</span>} tone={Number(r.bookings_30d) === 0 ? "warn" : undefined} />
            <Stat label="آخر نشاط" value={r.last_activity ? gregorian(r.last_activity.slice(0, 10), "ar") : "—"} tone={quiet !== null && quiet < -14 ? "warn" : undefined} hint={quiet !== null && quiet < -14 ? `هادئ منذ ${-quiet} يوم` : undefined} />
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title={`العقارات (${d.properties.length})`}>
          <ul className="divide-y divide-line text-sm">
            {d.properties.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.name}</span><span className="num text-muted">{p.units} وحدة</span></li>)}
          </ul>
        </Section>

        <Section title={`الموظفون (${d.staff.length})`}>
          <ul className="divide-y divide-line text-sm">
            {d.staff.map((m) => (
              <li key={m.email} className={`flex flex-wrap justify-between gap-2 py-2 ${m.active ? "" : "text-muted"}`}>
                <span>{m.name || "—"} <span className="text-xs text-muted">· {ROLE_AR[m.role] ?? m.role}</span></span>
                <span dir="ltr" className="text-xs text-muted">{m.email}</span>
              </li>
            ))}
          </ul>
        </Section>
          </div>
        </>
      ) : (
        <div className="max-w-3xl">
        <Section title="جدولة صيانة دورية">
          <p className="mb-3 text-xs text-muted">تصل للفندق كطلب موافقة. بعد موافقته يُسمح بالدخول من موعد الزيارة للمدة المحددة فقط، ثم يُغلق تلقائياً.</p>
          <ActionForm action={adminCreateMaintenance} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="tenant" value={r.id} />
            <Field label="العنوان" className="sm:col-span-2"><input name="title" required minLength={2} maxLength={120} defaultValue="صيانة دورية شهرية" className="input" /></Field>
            <Field label="ما الذي سنفعله" className="sm:col-span-2"><textarea name="details" rows={3} maxLength={2000} className="input" placeholder="فحص النسخ الاحتياطية، تحديثات، مراجعة الإعدادات…" /></Field>
            <Field label="موعد الزيارة (بتوقيت مسقط)"><input type="datetime-local" name="scheduled_for" required className="input" /></Field>
            <Field label="مدة الدخول">
              <select name="hours" defaultValue="2" className="input">
                {[1, 2, 4, 8, 24].map((h) => <option key={h} value={h}>{h} ساعة</option>)}
              </select>
            </Field>
            <SubmitButton className="btn-primary sm:col-span-2">إرسال للفندق للموافقة</SubmitButton>
          </ActionForm>
        </Section>

        </div>
      )}
    </>
  );
}
