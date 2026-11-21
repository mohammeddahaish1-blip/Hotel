import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOut } from "@/components/SignOut";
import { JoinForm } from "./JoinForm";

/** An invitation to the Nuzul team: sign in with the invited email, then accept. */
export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) redirect(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
  const email = (data.claims as { email?: string }).email ?? "";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#083f39] p-6" dir="rtl">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2"><span className="brand-word text-4xl text-brand">نُزُل</span><span className="rounded-full bg-[#d9a531] px-2.5 py-0.5 text-xs font-bold text-[#2e2100]">بوابة ملاك النظام</span></div>
        <h1 className="h1">دعوة للانضمام للفريق</h1>
        <p className="text-sm text-muted">أنت داخل بـ <b dir="ltr">{email}</b>. لازم يكون نفس البريد اللي وصلته الدعوة.</p>
        {token ? <JoinForm token={token} /> : <p className="text-sm font-semibold text-danger">الرابط ناقص.</p>}
        <div className="border-t border-line pt-3 text-center"><SignOut label="مو هذا حسابي؟ تسجيل الخروج" to={`/login?next=${encodeURIComponent(`/join?token=${token}`)}`} /></div>
      </div>
    </main>
  );
}
