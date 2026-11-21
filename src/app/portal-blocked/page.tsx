import { SignOut } from "@/components/SignOut";

/** A team member who can't enter the portal right now: stopped by the owner/security, or the session is too old. */
export default async function PortalBlocked({ searchParams }: PageProps<"/portal-blocked">) {
  const sp = await searchParams;
  const stopped = sp.why === "stopped";
  return (
    <main className="flex min-h-screen items-center justify-center p-6" dir="rtl">
      <div className="card max-w-sm space-y-3 p-6 text-center">
        <h1 className="h1">{stopped ? "حسابك موقوف في البوابة" : "انتهت جلستك"}</h1>
        <p className="text-sm text-muted">
          {stopped ? "أوقف المالك أو مسؤول الأمن دخولك لبوابة ملاك النظام. تواصل معهم لو تتوقع أنه خطأ." : "للأمان، جلسات الفريق لها مدة محددة. سجّل خروجك وادخل من جديد."}
        </p>
        <SignOut label={stopped ? "تسجيل الخروج" : "تسجيل الخروج والدخول من جديد"} to="/login?next=/admin" />
      </div>
    </main>
  );
}
