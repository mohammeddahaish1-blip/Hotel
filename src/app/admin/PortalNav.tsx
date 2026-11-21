"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, History, Landmark, Layers3, LifeBuoy, Megaphone, MonitorCog, MoreHorizontal, ShieldCheck, Users, Wallet } from "lucide-react";

type Item = { key: string; href: string; label: string; short: string; Icon: typeof Users; group: string };
const ITEMS: Item[] = [
  { key: "ceo", href: "/admin", label: "لوحة القرار", short: "القرار", Icon: Landmark, group: "" },
  { key: "companies", href: "/admin/companies", label: "الشركات", short: "الشركات", Icon: Building2, group: "" },
  { key: "marketing", href: "/admin/marketing", label: "التسويق", short: "التسويق", Icon: Megaphone, group: "الأقسام" },
  { key: "finance", href: "/admin/finance", label: "المالية", short: "المالية", Icon: Wallet, group: "الأقسام" },
  { key: "plans", href: "/admin/plans", label: "الباقات والعروض", short: "الباقات", Icon: Layers3, group: "الأقسام" },
  { key: "it", href: "/admin/it", label: "التقنية", short: "التقنية", Icon: MonitorCog, group: "الأقسام" },
  { key: "security", href: "/admin/security", label: "الأمن السيبراني", short: "الأمن", Icon: ShieldCheck, group: "الأقسام" },
  { key: "support", href: "/admin/support", label: "الدعم والصيانة", short: "الدعم", Icon: LifeBuoy, group: "الأقسام" },
  { key: "team", href: "/admin/team", label: "الفريق والصلاحيات", short: "الفريق", Icon: Users, group: "الإدارة" },
  { key: "log", href: "/admin/log", label: "السجل", short: "السجل", Icon: History, group: "الإدارة" },
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

/** The portal's side menu (computers and tablets): only the sections this member may see. */
export function PortalSide({ allowed, counts }: { allowed: string[]; counts: Record<string, number> }) {
  const active = useActive();
  const items = ITEMS.filter((i) => allowed.includes(i.key));
  return (
    <ul className="space-y-1">
      {items.map(({ key, href, label, Icon, group }, n) => (
        <li key={href}>
          {group && items[n - 1]?.group !== group ? <div className="px-3 pb-1 pt-3 text-[11px] font-bold text-[#8fb8ae]">{group}</div> : null}
          <Link
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${active === href ? "bg-white text-[#083f39]" : "text-[#cfe5e0] hover:bg-white/10 hover:text-white"}`}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden />
            {label}
            {counts[key] ? <span className="num ms-auto rounded-full bg-[#d9a531] px-2 text-[11px] font-bold text-[#2e2100]">{counts[key]}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The portal's bottom bar on phones: the first four allowed sections, and "more" for the rest. */
export function PortalBottom({ allowed }: { allowed: string[] }) {
  const active = useActive();
  const items = ITEMS.filter((i) => allowed.includes(i.key));
  const main = items.slice(0, items.length > 5 ? 4 : 5);
  const rest = items.filter((i) => !main.includes(i));
  const restOn = rest.some((i) => i.href === active);
  return (
    <nav className={`fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur lg:hidden ${rest.length ? "grid-cols-5" : ""}`}
      style={rest.length ? undefined : { gridTemplateColumns: `repeat(${Math.max(1, main.length)}, minmax(0, 1fr))` }} aria-label="بوابة ملاك النظام">
      {main.map(({ href, short, Icon }) => (
        <Link key={href} href={href} aria-current={active === href ? "page" : undefined}
          className={`flex flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold ${active === href ? "text-brand" : "text-muted"}`}>
          <Icon className="size-[22px]" aria-hidden />{short}
        </Link>
      ))}
      {rest.length ? (
        <details className="group relative">
          <summary className={`flex cursor-pointer list-none flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-semibold [&::-webkit-details-marker]:hidden ${restOn ? "text-brand" : "text-muted"}`}>
            <MoreHorizontal className="size-[22px]" aria-hidden />المزيد
          </summary>
          <div className="absolute bottom-full end-0 mb-2 w-52 rounded-2xl border border-line bg-surface p-1.5 shadow-lg">
            {rest.map(({ href, label, Icon }) => (
              <Link key={href} href={href} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${active === href ? "bg-brand-soft text-brand" : "hover:bg-surface-2"}`}>
                <Icon className="size-4" aria-hidden />{label}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
