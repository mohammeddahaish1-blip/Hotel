import { requireAdmin, FEATURE_AR } from "@/lib/admin";
import { omr, plainOmr } from "@/lib/format";
import { FEATURES } from "@/lib/plan";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, PageHeader, Section } from "@/components/ui";
import { adminSavePlan } from "@/app/actions/admin";

type Plan = { code: string; name_ar: string; name_en: string | null; monthly_price: number; max_units: number | null; max_properties: number | null; features: string[]; active: boolean; sort: number };

function PlanForm({ p }: { p?: Plan }) {
  return (
    <ActionForm action={adminSavePlan} resetOnSuccess={!p} className="grid gap-3 sm:grid-cols-3">
      {p ? <input type="hidden" name="code" value={p.code} /> : <Field label="الرمز (إنجليزي)"><input name="code" required dir="ltr" placeholder="gold" className="input" /></Field>}
      <Field label="الاسم"><input name="name_ar" required defaultValue={p?.name_ar ?? ""} className="input" /></Field>
      <Field label="الاسم بالإنجليزي"><input name="name_en" dir="ltr" defaultValue={p?.name_en ?? ""} className="input" /></Field>
      <Field label="السعر الشهري (ر.ع.)"><input name="price" required inputMode="decimal" dir="ltr" defaultValue={p ? plainOmr(p.monthly_price) : ""} className="input" /></Field>
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
      <div className="flex items-end"><SubmitButton className="btn-primary w-full">{p ? "حفظ الباقة" : "إضافة الباقة"}</SubmitButton></div>
    </ActionForm>
  );
}

/** Plans: price, limits and included features. Changes apply to every company on the plan at once. */
export default async function AdminPlans() {
  const sb = await requireAdmin();
  const { data } = await sb.from("plans").select("code, name_ar, name_en, monthly_price, max_units, max_properties, features, active, sort").order("sort");
  const plans = (data ?? []) as Plan[];
  return (
    <>
      <PageHeader title="الباقات" sub="أي تعديل هنا يسري فوراً على كل الشركات المشتركة في الباقة." />
      <div className="space-y-4">
        {plans.map((p) => (
          <Section key={p.code} title={`${p.name_ar} — ${omr(p.monthly_price, "ar")} شهرياً${p.active ? "" : " (غير متاحة)"}`}>
            <PlanForm p={p} />
          </Section>
        ))}
        <Section title="باقة جديدة"><PlanForm /></Section>
      </div>
    </>
  );
}
