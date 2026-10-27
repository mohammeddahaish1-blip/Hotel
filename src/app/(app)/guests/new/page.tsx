import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { PageHeader, Crumb } from "@/components/ui";
import { GuestForm } from "@/components/GuestForm";

export default async function NewGuestPage({ searchParams }: PageProps<"/guests/new">) {
  const ctx = await requireArea("guests");
  const { t } = await getDict();
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : undefined;
  const { data: prop } = await ctx.supabase.from("properties").select("doc_retention_days").eq("id", ctx.property.id).single();
  return (
    <>
      <Crumb href="/guests" label={t.nav_guests} />
      <PageHeader title={t.guest_new} />
      <div className="card max-w-3xl">
        <GuestForm t={t} tenantId={ctx.tenantId} retentionDays={prop?.doc_retention_days ?? 365} next={next} demo={hasRole(ctx, ["manager"])} autoRead={sp.read === "1"} />
      </div>
    </>
  );
}
