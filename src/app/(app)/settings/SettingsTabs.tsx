import Link from "next/link";
import { can, hasRole, type Ctx } from "@/lib/auth";
import type { Dict } from "@/lib/i18n/dict";
import { getPlan, planHas } from "@/lib/plan";

export type SettingsView = "property" | "units" | "prices" | "staff" | "money" | "plan";
export const settingsHref = (s: SettingsView) => (s === "property" ? "/settings" : `/settings?s=${s}`);

/** One bar for everything under Settings, one subject per tab. A tab only shows to the roles that may open it. */
export async function SettingsTabs({ ctx, t, current }: { ctx: Ctx; t: Dict; current: SettingsView | "permissions" | "automation" | "support" }) {
  if (!can(ctx, "settings")) return null;
  const plan = await getPlan(ctx);
  const tabs: { key: string; href: string; label: string }[] = [
    { key: "property", href: settingsHref("property"), label: t.set_tab_property },
    { key: "units", href: settingsHref("units"), label: t.set_tab_units },
    { key: "prices", href: settingsHref("prices"), label: t.set_tab_prices },
    { key: "staff", href: settingsHref("staff"), label: t.set_staff },
    { key: "money", href: settingsHref("money"), label: t.set_tab_money },
    ...(hasRole(ctx, ["manager"]) ? [{ key: "plan", href: settingsHref("plan"), label: t.set_tab_plan }] : []),
    ...(ctx.role === "owner" ? [{ key: "permissions", href: "/settings/permissions", label: t.nav_permissions }] : []),
    ...(planHas(plan, "automation") && hasRole(ctx, ["manager"]) ? [{ key: "automation", href: "/settings/automation", label: t.auto_title }] : []),
    ...(hasRole(ctx, ["manager"]) ? [{ key: "support", href: "/support", label: t.sup_title }] : []),
  ];
  return (
    <nav aria-label={t.set_title} className="no-print mb-5 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1">
      {tabs.map((x) => (
        <Link
          key={x.key}
          href={x.href}
          aria-current={x.key === current ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${x.key === current ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {x.label}
        </Link>
      ))}
    </nav>
  );
}
