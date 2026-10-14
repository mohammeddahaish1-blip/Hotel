import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "./MfaForm";

export default async function MfaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const { t } = await getDict();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <MfaForm t={{ mfa_title: t.mfa_title, mfa_required: t.mfa_required, mfa_code: t.mfa_code, mfa_verify: t.mfa_verify, mfa_enter: t.mfa_enter, signOut: t.signOut }} />
    </main>
  );
}
