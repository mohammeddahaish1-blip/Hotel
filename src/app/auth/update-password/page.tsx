import { redirect } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./UpdatePasswordForm";

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const { t } = await getDict();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <UpdatePasswordForm t={{ title: t.new_password_title, label: t.new_password, save: t.save }} />
    </main>
  );
}
