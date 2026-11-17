"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, History, LayoutGrid, Layers3, LifeBuoy, MoreHorizontal, Wallet } from "lucide-react";

const ITEMS = [
  { href: "/admin", label: "نظرة عامة", short: "نظرة عامة", Icon: LayoutGrid },
  { href: "/admin/companies", label: "الشركات", short: "الشركات", Icon: Building2 },
  { href: "/admin/plans", label: "الباقات والعروض", short: "الباقات", Icon: Layers3 },
  { href: "/admin/finance", label: "المالية", short: "المالية", Icon: Wallet },
  { href: "/admin/support", label: "الدعم والصيانة", short: "الدعم", Icon: LifeBuoy },
  { href: "/admin/log", label: "السجل", short: "السجل", Icon: History },
];

/** Which menu item a page belongs to: a company's own page counts as "companies", payments as "finance". */
function useActive() {
  const path = usePathname();
  useSearchParams();
  if (path === "/admin") return "/admin";
  if (path.startsWith("/admin/payments")) return "/admin/finance";
  const hit = ITEMS.find((i) => i.href !== "/admin" && path.startsWith(i.href));
  return hit ? hit.href : "/admin/companies";
}

/** The portal's side menu (computers and tablets). */
export function PortalSide({ supportCount }: { supportCount: number }) {
  const active = useActive();
  return (
    <ul className="space-y-1">
      {ITEMS.map(({ href, label, Icon }) => (
        <li key={href}>
          <Link
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${active === href ? "bg-white text-[#083f39]" : "text-[#cfe5e0] hover:bg-white/10 hover:text-white"}`}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {label}
            {href === "/admin/support" && supportCount ? <span className="num ms-auto rounded-full bg-[#d9a531] px-2 text-[11px] font-bold text-[#2e2100]">{supportCount}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The portal's bottom bar on phones: four sections and "more" for the rest. */
export function PortalBottom() {
  const active = useActive();
  const main = ITEMS.filter((i) => ["/admin", "/admin/companies", "/admin/finance", "/admin/support"].includes(i.href));
  const rest = ITEMS.filter((i) => !main.includes(i));
  const restOn = rest.some((i) => i.href === active);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur lg:hidden" aria-label="بوابة ملاك النظام">
      {main.map(({ href, short, Icon }) => (
        <Link key={href} href={href} aria-current={active === href ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold ${active === href ? "text-brand" : "text-muted"}`}>
          <Icon className="size-[22px]" aria-hidden />{short}
        </Link>
      ))}
      <details className="group relative">
        <summary className={`flex cursor-pointer list-none flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold [&::-webkit-details-marker]:hidden ${restOn ? "text-brand" : "text-muted"}`}>
          <MoreHorizontal className="size-[22px]" aria-hidden />المزيد
        </summary>
        <div className="absolute bottom-full end-0 mb-2 w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-lg">
          {rest.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${active === href ? "bg-brand-soft text-brand" : "hover:bg-surface-2"}`}>
              <Icon className="size-4" aria-hidden />{label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
