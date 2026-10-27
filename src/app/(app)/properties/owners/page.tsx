import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { createOwner } from "@/app/actions/owners";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Crumb, Empty, Field, PageHeader, Section } from "@/components/ui";

export default async function OwnersPage() {
  const ctx = await requireArea("board");
  if (!hasRole(ctx, ["manager", "accountant"])) redirect("/properties");
  const { t } = await getDict();
  const [{ data: owners }, { data: units }] = await Promise.all([
    ctx.supabase.from("unit_owners").select("id, name, phone, commission_bp").eq("tenant_id", ctx.tenantId).order("name"),
    ctx.supabase.from("units").select("number, owner_id").eq("property_id", ctx.property.id).not("owner_id", "is", null).order("number"),
  ]);
  const unitsOf = (id: string) => (units ?? []).filter((u) => u.owner_id === id).map((u) => u.number);

  return (
    <>
      <Crumb href="/properties" label={t.nav_properties} />
      <PageHeader title={t.nav_owners} sub={t.own_hint} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {!owners?.length ? (
            <Empty>{t.own_none}</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {owners.map((o) => (
                <Link key={o.id} href={`/properties/owners/${o.id}`} className="card transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="text-lg font-bold">{o.name}</div>
                  <div className="text-sm text-muted" dir="ltr">{o.phone ?? ""}</div>
                  <div className="mt-2 text-sm">{t.own_units}: <span className="num">{unitsOf(o.id).join("، ") || "—"}</span></div>
                  <div className="text-xs text-muted">{t.own_commission}: {o.commission_bp / 100}%</div>
                </Link>
              ))}
            </div>
          )}
        </div>
        {hasRole(ctx, ["manager"]) ? (
          <Section title={t.own_add}>
            <ActionForm action={createOwner} className="space-y-2">
              <Field label={t.own_name}><input name="name" required className="input" /></Field>
              <Field label={t.phone}><input name="phone" dir="ltr" inputMode="tel" className="input" /></Field>
              <Field label={t.email}><input name="email" type="email" dir="ltr" className="input" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.own_commission}><input name="commission" defaultValue="10" inputMode="decimal" className="input" /></Field>
                <Field label={t.own_lang}>
                  <select name="language" className="input"><option value="ar">العربية</option><option value="en">English</option></select>
                </Field>
              </div>
              <SubmitButton className="btn-primary w-full">{t.own_add}</SubmitButton>
            </ActionForm>
          </Section>
        ) : null}
      </div>
    </>
  );
}
