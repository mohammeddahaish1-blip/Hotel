import Link from "next/link";
import { requireAdmin, FEATURE_AR, todayIso, type AdminRow } from "@/lib/admin";
import { amount, CUR, CURRENCIES, isCurrency, plainAmount, type Currency } from "@/lib/currency";
import { gregorian, plainOmr } from "@/lib/format";
import { FEATURES } from "@/lib/plan";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CurrencySign, Money } from "@/components/CurrencySign";
import { Field, PageHeader, Section } from "@/components/ui";
import { adminSavePlan, adminSavePlanPrices } from "@/app/actions/admin";

type Plan = {
  code: string; name_ar: string; name_en: string | null; monthly_price: number; max_units: number | null; max_properties: number | null;
  features: string[]; active: boolean; sort: number; offer_active: boolean; offer_ends_on: string | null; offer_label: string | null; updated_at: string | null;
};
type Price = { plan_code: string; currency: Currency; monthly: number; yearly: number; offer_monthly: number | null; offer_yearly: number | null };

/** Name, limits and features of a plan (prices are set in the price editor above). */
function PlanForm({ p }: { p?: Plan }) {
  return (
    <ActionForm action={adminSavePlan} resetOnSuccess={!p} className="grid gap-3 sm:grid-cols-3">
      {p ? <input type="hidden" name="code" value={p.code} /> : <Field label="الرمز (إنجليزي)"><input name="code" required dir="ltr" placeholder="gold" className="input" /></Field>}
      {p ? <input type="hidden" name="price" value={plainOmr(p.monthly_price)} /> : <input type="hidden" name="new" value="1" />}
      <Field label="الاسم"><input name="name_ar" required defaultValue={p?.name_ar ?? ""} className="input" /></Field>
      <Field label="الاسم بالإنجليزي"><input name="name_en" dir="ltr" defaultValue={p?.name_en ?? ""} className="input" /></Field>
      {p ? null : <Field label="السعر الشهري بالريال العُماني"><input name="price" required inputMode="decimal" dir="ltr" className="input" /></Field>}
      <Field label="حد الوحدات (فارغ = بلا حد)"><input name="max_units" type="number" min={1} defaultValue={p?.max_units ?? ""} className="input" /></Field>
      <Field label="حد العقارات (فارغ = بلا حد)"><input name="max_properties" type="number" min={1} defaultValue={p?.max_properties ?? ""} className="input" /></Field>
      <fieldset className="sm:col-span-3">
        <legend className="label">المزايا المشمولة (الحجوزات والنزلاء والتنظيف والمالية والتقارير في كل الباقات)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {FEATURES.map((f) => (
            <label key={f} className="inline-flex items-center gap-1.5">
              <input type="checkbox" name="features" value={f} defaultChecked={p?.features.includes(f) ?? false} /> {FEATURE_AR[f]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> متاحة للاشتراك</label>
      <Field label="الترتيب"><input name="sort" type="number" defaultValue={p?.sort ?? 0} className="input" /></Field>
      <div className="flex items-end"><SubmitButton className="btn-primary w-full">{p ? "حفظ" : "إضافة الباقة"}</SubmitButton></div>
      {p ? null : <p className="text-xs text-muted sm:col-span-3">تبدأ بأسعار السعودية والإمارات = السعر × 10، والسنوي = 10 أشهر. عدّلها بعدها من «تعديل الأسعار والعرض».</p>}
    </ActionForm>
  );
}

/** Plans and their prices in every country, monthly and yearly, with limited-time offers that show on the public page. */
export default async function AdminPlans({ searchParams }: PageProps<"/admin/plans">) {
  const sb = await requireAdmin("plans");
  const sp = await searchParams;
  const cur: Currency = isCurrency(sp.cur) ? sp.cur : "OMR";
  const [{ data }, { data: pr }, { data: ov }] = await Promise.all([
    sb.from("plans").select("code, name_ar, name_en, monthly_price, max_units, max_properties, features, active, sort, offer_active, offer_ends_on, offer_label, updated_at").order("sort"),
    sb.from("plan_prices").select("plan_code, currency, monthly, yearly, offer_monthly, offer_yearly"),
    sb.rpc("admin_overview"),
  ]);
  const plans = (data ?? []) as Plan[];
  const prices = (pr ?? []) as Price[];
  const companies = (ov ?? []) as AdminRow[];
  const edit = plans.find((p) => p.code === sp.edit) ?? null;
  const today = todayIso();
  const price = (code: string, c: Currency) => prices.find((x) => x.plan_code === code && x.currency === c);
  const live = (p: Plan) => p.offer_active && (!p.offer_ends_on || p.offer_ends_on >= today);
  const href = (o: Record<string, string>) => `/admin/plans?${new URLSearchParams({ cur, ...(edit ? { edit: edit.code } : {}), ...o })}`;

  return (
    <>
      <PageHeader
        title="الباقات والعروض"
        sub="الأسعار لكل بلد، شهري وسنوي. أي تعديل يظهر في صفحة التعريف فوراً."
        actions={
          <nav className="flex gap-1 rounded-full bg-gray-soft p-1" aria-label="البلد">
            {CURRENCIES.map((c) => (
              <Link key={c} href={href({ cur: c })} aria-current={cur === c ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${cur === c ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                {CUR[c].country} <CurrencySign cur={c} />
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p, i) => {
          const r = price(p.code, cur);
          const offer = live(p) && r ? r.offer_monthly : null;
          const top = i === plans.length - 1;
          const count = companies.filter((x) => x.plan_code === p.code && (x.status === "active" || x.status === "past_due" || x.status === "trial")).length;
          return (
            <section key={p.code} className={`flex flex-col gap-2.5 rounded-3xl p-5 shadow-sm ${top ? "bg-[#083f39] text-white" : "bg-surface"} ${offer != null ? "ring-2 ring-[#e7b9b4]" : ""} ${p.active ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-bold">{p.name_ar}</h2>
                <span className={`num rounded-full px-2.5 py-0.5 text-xs font-bold ${top ? "bg-[#d9a531] text-[#2e2100]" : "bg-brand-soft text-brand"}`}>{count} شركة</span>
              </div>
              {offer != null ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-xl border border-[#e7b9b4] bg-[#fdf3f2] px-2.5 py-0.5 text-xs font-bold text-[#8c1d18]">
                    {p.offer_label || "عرض لفترة محدودة"}{p.offer_ends_on ? ` حتى ${gregorian(p.offer_ends_on, "ar")}` : ""}
                  </span>
                  <s className={top ? "text-white/70" : "text-muted"}><Money value={amount(r!.monthly, cur)} cur={cur} /></s>
                </div>
              ) : p.offer_active ? <span className="text-xs font-semibold text-warn">العرض انتهى في {gregorian(p.offer_ends_on, "ar")}</span> : null}
              <div className="flex items-baseline gap-2">
                <Money value={r ? amount(offer ?? r.monthly, cur) : "—"} cur={cur} className="text-4xl font-bold" />
                <span className={`text-sm ${top ? "text-white/75" : "text-muted"}`}>شهرياً</span>
              </div>
              <div className={`text-sm ${top ? "text-white/80" : "text-muted"}`}>
                سنوي: {r ? <Money value={amount(live(p) && r.offer_yearly != null ? r.offer_yearly : r.yearly, cur)} cur={cur} /> : "—"}
                {" · "}{p.max_units ? `حتى ${p.max_units} وحدة` : "وحدات بلا حد"} · {p.max_properties == null ? "عقارات بلا حد" : p.max_properties === 1 ? "عقار واحد" : `حتى ${p.max_properties} عقار`}
              </div>
              {p.active ? null : <span className="text-xs font-semibold">غير متاحة للاشتراك</span>}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                <Link href={`/admin/plans?cur=${cur}&edit=${p.code}#edit`} className={top ? "btn btn-sm bg-white text-[#083f39] hover:bg-white/90" : "btn-ghost btn-sm"}>تعديل الأسعار والعرض</Link>
                {p.updated_at ? <span className={`text-xs ${top ? "text-white/65" : "text-muted"}`}>آخر تعديل {gregorian(p.updated_at.slice(0, 10), "ar")}</span> : null}
              </div>
            </section>
          );
        })}
      </div>

      {edit ? (
        <section id="edit" className="card mt-5 scroll-mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2">تعديل: {edit.name_ar}</h2>
            <Link href={`/admin/plans?cur=${cur}`} className="text-sm font-semibold text-muted hover:text-ink">إغلاق</Link>
          </div>
          <ActionForm action={adminSavePlanPrices} className="mt-3 space-y-4">
            <input type="hidden" name="code" value={edit.code} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="px-2 py-2 text-start font-semibold">البلد</th>
                    <th className="px-2 py-2 text-start font-semibold">شهري</th>
                    <th className="px-2 py-2 text-start font-semibold">سنوي</th>
                    <th className="px-2 py-2 text-start font-semibold text-danger">سعر العرض شهري</th>
                    <th className="px-2 py-2 text-start font-semibold text-danger">سعر العرض سنوي</th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENCIES.map((c) => {
                    const r = price(edit.code, c);
                    const box = (k: string, v: number | null | undefined, offer = false, required = !offer) => (
                      <td className="px-2 py-1.5">
                        <span className={`flex items-center gap-1.5 rounded-xl border px-2.5 ${offer ? "border-[#e7b9b4] bg-[#fdf3f2] dark:bg-transparent" : "border-line bg-surface-2"}`}>
                          <input name={`${c}_${k}`} required={required} inputMode="decimal" dir="ltr" defaultValue={plainAmount(v, c)} placeholder={offer ? "بدون" : ""}
                            aria-label={`${CUR[c].country}: ${k}`} className="w-full min-w-0 bg-transparent py-2 text-sm font-semibold outline-none" />
                          <CurrencySign cur={c} className="text-muted" />
                        </span>
                      </td>
                    );
                    return (
                      <tr key={c} className="border-t border-line">
                        <td className="px-2 py-1.5 font-bold">{CUR[c].country}</td>
                        {box("monthly", r?.monthly ?? (c === "OMR" ? edit.monthly_price : null))}
                        {box("yearly", r?.yearly)}
                        {box("offer_monthly", r?.offer_monthly, true)}
                        {box("offer_yearly", r?.offer_yearly, true)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" name="offer_active" defaultChecked={edit.offer_active} className="size-5 accent-[var(--brand)]" /> العرض مفعّل</label>
              <Field label="ينتهي في (فارغ = بدون موعد)"><input type="date" name="offer_ends" min={today} defaultValue={edit.offer_ends_on ?? ""} className="input" /></Field>
              <Field label="نص الشارة"><input name="offer_label" maxLength={60} defaultValue={edit.offer_label ?? ""} placeholder="عرض لفترة محدودة" className="input" /></Field>
            </div>
            <p className="text-xs text-muted">سعر العرض اختياري لكل بلد ولكل فترة، ولازم يكون أقل من السعر الأصلي. بعد تاريخ الانتهاء يرجع السعر الأصلي في صفحة التعريف تلقائياً. أسعار الشركات المشتركة حالياً ما تتغير.</p>
            <SubmitButton className="btn-primary">حفظ الأسعار والعرض</SubmitButton>
          </ActionForm>
          <details className="mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand">الاسم والحدود والمزايا</summary>
            <div className="mt-3"><PlanForm p={edit} /></div>
          </details>
        </section>
      ) : null}

      <div className="mt-5">
        <Section title="باقة جديدة"><PlanForm /></Section>
      </div>
    </>
  );
}
