import { notFound } from "next/navigation";
import { requireAdmin, STATUSES, STATUS_AR, STATUS_TONE } from "@/lib/admin";
import { gregorian, omr, plainOmr } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Crumb, Field, PageHeader, Section } from "@/components/ui";
import { adminRecordPayment, adminSetSubscription, adminVoidPayment } from "@/app/actions/admin";
import { adminCreateMaintenance } from "@/app/actions/support";

type Row = {
  id: string; name: string; created_at: string; owner_name: string | null; owner_email: string | null;
  properties: number; units: number; staff: number; bookings_30d: number; last_activity: string | null;
  plan_code: string | null; plan_name: string | null; status: string | null; trial_ends_at: string | null;
  current_period_end: string | null; price: number | null; price_override: number | null; notes: string | null;
};
type Detail = {
  properties: { id: string; name: string; kind: string; units: number }[];
  staff: { name: string; email: string; role: string; active: boolean }[];
  payments: { id: string; amount: number; months: number; period_start: string; period_end: string; paid_on: string; method: string | null; reference: string | null; voided: boolean }[];
};
const ROLE_AR: Record<string, string> = { owner: "مالك", manager: "مدير", reception: "استقبال", accountant: "محاسب", housekeeping: "تنظيف", maintenance: "صيانة" };

/** One company: change its plan and status, record a monthly payment, see what it uses. */
export default async function AdminTenant({ params }: PageProps<"/admin/[id]">) {
  const sb = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [{ data: all }, { data: detail }, { data: plans }] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.rpc("admin_tenant", { p_tenant: id }),
    sb.from("plans").select("code, name_ar, monthly_price").order("sort"),
  ]);
  const r = ((all ?? []) as Row[]).find((x) => x.id === id);
  if (!r) notFound();
  const d = detail as Detail;

  return (
    <>
      <Crumb href="/admin" label="الشركات" />
      <PageHeader title={r.name} sub={`${r.owner_name ?? ""} · ${r.owner_email ?? ""} · منذ ${gregorian(r.created_at.slice(0, 10), "ar")}`} />
      <div className="grid gap-4 lg:grid-cols-2">
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
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_AR[s]}</option>)}
              </select>
            </Field>
            <Field label="مدفوع حتى"><input type="date" name="period_end" defaultValue={r.current_period_end ?? ""} className="input" /></Field>
            <Field label="التجربة حتى"><input type="date" name="trial_ends" defaultValue={r.trial_ends_at ?? ""} className="input" /></Field>
            <Field label="سعر خاص شهرياً (اختياري)"><input name="price_override" inputMode="decimal" dir="ltr" defaultValue={r.price_override != null ? plainOmr(r.price_override) : ""} placeholder="سعر الباقة" className="input" /></Field>
            <Field label="ملاحظات"><input name="notes" defaultValue={r.notes ?? ""} maxLength={500} className="input" /></Field>
            <SubmitButton className="btn-primary sm:col-span-2">حفظ الاشتراك</SubmitButton>
          </ActionForm>
        </Section>

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

        <Section title={`العقارات (${d.properties.length})`}>
          <ul className="divide-y divide-line text-sm">
            {d.properties.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.name}</span><span className="num text-muted">{p.units} وحدة</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">{r.bookings_30d} حجز في آخر 30 يوماً · آخر نشاط {r.last_activity ? gregorian(r.last_activity.slice(0, 10), "ar") : "—"}</p>
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
  );
}
