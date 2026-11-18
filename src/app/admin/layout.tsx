import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin";
import { SignOut } from "@/components/SignOut";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TabGlide } from "@/components/TabGlide";
import { PortalBottom, PortalSide } from "./PortalNav";

/** System owners' portal (the Nuzul team): its own look, separate from any hotel, only for platform admins. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sb = await requireAdmin();
  const [{ data: claims }, { data: support }] = await Promise.all([sb.auth.getClaims(), sb.rpc("admin_support_list")]);
  const c = (claims?.claims ?? {}) as { email?: string; user_metadata?: { full_name?: string } };
  const name = c.user_metadata?.full_name || c.email || "";
  const openSupport = ((support ?? []) as { status: string }[]).filter((x) => x.status === "open").length;
  const me = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand" aria-hidden>{name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 leading-tight">
        <span className="block max-w-44 truncate text-sm font-bold">{name}</span>
        <span className="block text-xs text-muted">مدير المنصة</span>
      </span>
    </span>
  );
  return (
    <div className="flex min-h-screen" dir="rtl">
      <TabGlide />
      {/* computers and tablets: a dark side menu, so the portal never looks like a hotel's system */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-1 overflow-y-auto bg-[#083f39] p-4 text-[#e6f2ef] lg:flex">
        <div className="brand-word px-2 text-4xl text-white">نُزُل</div>
        <span className="mx-2 mb-4 mt-1 self-start rounded-full bg-[#d9a531] px-3 py-1 text-xs font-bold text-[#2e2100]">بوابة ملاك النظام</span>
        <Suspense fallback={null}><PortalSide supportCount={openSupport} /></Suspense>
        <p className="mt-auto border-t border-white/15 px-2 pt-3 text-xs text-[#9fc4bc]">أي تغيير هنا يؤثر على كل الشركات المشتركة.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* phones: a dark strip at the top with the same badge */}
        <header className="flex items-center gap-2 bg-[#083f39] px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] text-white lg:hidden">
          <span className="brand-word text-3xl">نُزُل</span>
          <span className="rounded-full bg-[#d9a531] px-2.5 py-0.5 text-xs font-bold text-[#2e2100]">بوابة الملاك</span>
          <span className="ms-auto"><ThemeToggle /></span>
        </header>
        <div className="hidden items-center justify-end gap-3 px-8 pt-5 lg:flex">
          <ThemeToggle />
          {me}
          <SignOut label="تسجيل الخروج" />
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-28 lg:p-8 lg:pb-10">
          {children}
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 lg:hidden">
            {me}
            <SignOut label="تسجيل الخروج" />
          </div>
        </main>
      </div>
      <Suspense fallback={null}><PortalBottom /></Suspense>
    </div>
  );
}
