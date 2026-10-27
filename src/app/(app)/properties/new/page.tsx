import { redirect } from "next/navigation";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { createProperty } from "@/app/actions/properties";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ReceiptInput } from "@/components/FinanceInputs";
import { Crumb, Field, PageHeader } from "@/components/ui";

export default async function NewPropertyPage() {
  const ctx = await requireArea("board");
  if (ctx.role !== "owner") redirect("/properties");
  const { t } = await getDict();
  return (
    <>
      <Crumb href="/properties" label={t.nav_properties} />
      <PageHeader title={t.prop_new} sub={t.prop_new_hint} />
      <ActionForm action={createProperty} className="card grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label={t.set_name_ar}><input name="name_ar" required className="input" /></Field>
        <Field label={t.set_name_en}><input name="name_en" dir="ltr" className="input" /></Field>
        <Field label={t.prop_kind}>
          <select name="kind" className="input">
            <option value="hotel">{t.kind_hotel}</option>
            <option value="apartments">{t.kind_apartments}</option>
            <option value="mixed">{t.kind_mixed}</option>
          </select>
        </Field>
        <Field label={t.phone}><input name="phone" dir="ltr" inputMode="tel" className="input" /></Field>
        <Field label={t.set_address} className="sm:col-span-2"><input name="address" className="input" /></Field>
        <div className="sm:col-span-2"><ReceiptInput name="photo" label={t.prop_photo} ready="" accept="image/*" /></div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="make_current" defaultChecked /> {t.prop_make_current_now}
        </label>
        <div className="sm:col-span-2"><SubmitButton className="btn-primary">{t.prop_create}</SubmitButton></div>
      </ActionForm>
    </>
  );
}
