import Link from "next/link";
import { ArrowRight, Building2, Layers3 } from "lucide-react";
import { requireAdmin } from "@/lib/admin";

/** System owners' portal (the Nuzul team): separate from any hotel, only for platform admins. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="brand-word text-2xl text-brand">نُزُل</span>
            <span className="text-sm font-bold">بوابة ملاك النظام</span>
          </div>
          <nav className="flex flex-1 gap-1.5 text-sm">
            <Link href="/admin" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Building2 className="size-4 shrink-0" /> الشركات</Link>
            <Link href="/admin/plans" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Layers3 className="size-4 shrink-0" /> الباقات</Link>
          </nav>
          <Link href="/" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><ArrowRight className="size-4 shrink-0" /> العودة للنظام</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 lg:p-8">{children}</main>
    </div>
  );
}
