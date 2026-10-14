import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { createTenant } from "../actions/onboarding";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const { t } = await getDict();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6">
      <div className="mb-2 text-xl font-bold text-brand">{t.appName}</div>
      <p className="mb-6 text-sm text-muted">{t.no_access}</p>
      <ActionForm action={createTenant} className="card space-y-4 p-6">
        <h1 className="h1">{t.onb_title}</h1>
        <Field label={t.onb_owner}><input name="owner" required className="input" /></Field>
        <Field label={t.onb_company}><input name="company" required className="input" /></Field>
        <Field label={t.onb_property}><input name="property" required className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.onb_kind}>
            <select name="kind" className="input">
              <option value="hotel">{t.kind_hotel}</option>
              <option value="apartments">{t.kind_apartments}</option>
              <option value="mixed">{t.kind_mixed}</option>
            </select>
          </Field>
          <Field label={t.onb_municipality}>
            <select name="municipality" className="input">
              <option value="muscat">مسقط / Muscat</option>
              <option value="dhofar">ظفار / Dhofar</option>
              <option value="sohar">صحار / Sohar</option>
              <option value="other">أخرى / Other</option>
            </select>
          </Field>
        </div>
        <SubmitButton className="btn-primary w-full">{t.onb_submit}</SubmitButton>
      </ActionForm>
    </main>
  );
}
