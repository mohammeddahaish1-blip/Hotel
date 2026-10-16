import { getDict } from "@/lib/i18n/server";
import { SignOut } from "@/components/SignOut";

export default async function NoAccessPage() {
  const { t } = await getDict();
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card max-w-sm space-y-3 p-6 text-center">
        <h1 className="h1">{t.no_access_title}</h1>
        <p className="text-sm text-muted">{t.no_access_body}</p>
        <SignOut label={t.signOut} />
      </div>
    </main>
  );
}
