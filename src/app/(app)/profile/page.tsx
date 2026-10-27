import { notFound } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";
import { ProfileView, type StaffProfile } from "./ProfileView";

/** Every employee's own account: name, job title, email, phone, salary and work card. */
export default async function MyProfilePage() {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const { data } = await ctx.supabase.rpc("staff_profile", { p_tenant: ctx.tenantId, p_user: ctx.userId }).maybeSingle();
  if (!data) notFound();
  return (
    <>
      <PageHeader title={t.nav_profile} />
      <ProfileView ctx={ctx} p={data as StaffProfile} t={t} lang={lang} />
    </>
  );
}
