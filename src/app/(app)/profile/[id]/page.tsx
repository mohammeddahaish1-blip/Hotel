import { notFound, redirect } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { Crumb, PageHeader } from "@/components/ui";
import { ProfileView, type StaffProfile } from "../ProfileView";

/** Owner and managers: one employee's profile, reached from the staff list or a work card alert. */
export default async function StaffProfilePage({ params }: PageProps<"/profile/[id]">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const { id } = await params;
  if (id === ctx.userId) redirect("/profile");
  if (!hasRole(ctx, ["manager"]) || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data } = await ctx.supabase.rpc("staff_profile", { p_tenant: ctx.tenantId, p_user: id }).maybeSingle();
  if (!data) notFound();
  const p = data as StaffProfile;
  return (
    <>
      <Crumb href="/settings" label={t.set_staff} />
      <PageHeader title={p.full_name || p.email} />
      <ProfileView ctx={ctx} p={p} t={t} lang={lang} />
    </>
  );
}
