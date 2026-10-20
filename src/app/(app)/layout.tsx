import { getCtx, can, hasRole, AREAS } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { GroupTabs, NavLinks, type NavGroup } from "@/components/NavLinks";
import { LangToggle } from "@/components/LangToggle";
import { SignOut } from "@/components/SignOut";
import { IdleLogout } from "@/components/IdleLogout";
import { PropertySwitcher } from "@/components/PropertySwitcher";


export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  // Merged menu: each group shows only the parts this user may open (permissions stay per section)
  const tab = (area: (typeof AREAS)[number], label?: string) =>
    can(ctx, area) ? [{ href: `/${area}`, label: label ?? t[`nav_${area}` as DictKey] }] : [];
  const groups: NavGroup[] = [
    { key: "dashboard", label: t.nav_dashboard, tabs: tab("dashboard") },
    { key: "units", label: t.nav_grp_units, tabs: [...tab("board"), ...tab("calendar")] },
    { key: "reservations", label: t.nav_reservations, tabs: [...tab("reservations"), ...tab("guests")], also: ["/invoices"] },
    { key: "ops", label: t.nav_grp_ops, tabs: [...tab("housekeeping"), ...tab("maintenance")] },
    { key: "finance", label: t.nav_finance, tabs: tab("finance") },
    { key: "reports", label: t.nav_grp_reports, tabs: [...tab("reports"), ...tab("compliance")] },
    {
      key: "analytics",
      label: t.nav_grp_analytics,
      tabs: can(ctx, "reports")
        ? [
            { href: "/analytics", label: t.an_charts },
            ...(hasRole(ctx, ["manager"]) ? [{ href: "/analytics/staff", label: t.an_staff }] : []),
          ]
        : [],
    },
    {
      key: "settings",
      label: t.nav_settings,
      tabs: [
        ...tab("settings", t.nav_settings_general),
        ...(ctx.role === "owner" ? [{ href: "/settings/permissions", label: t.nav_permissions }] : []),
      ],
    },
    { key: "audit", label: t.nav_audit, tabs: tab("audit") },
  ].filter((g) => g.tabs.length > 0);
  const roleLabel = ctx.jobTitle || t[`role_${ctx.role}` as DictKey];
  const propertyName = lang === "en" && ctx.property.name_en ? ctx.property.name_en : ctx.property.name_ar;

  return (
    <div className="min-h-screen lg:flex">
      <IdleLogout minutes={ctx.role === "reception" || ctx.role === "housekeeping" ? 15 : 30} />
      <aside className="no-print hidden w-60 shrink-0 flex-col border-e border-line bg-surface p-4 lg:flex">
        <div className="brand-word mb-1 text-4xl text-brand">{t.appName}</div>
        <PropertySwitcher current={ctx.property.id} properties={ctx.properties.map((p) => ({ id: p.id, name: p.name_ar }))} fallback={propertyName} />
        <nav className="mt-4 flex-1">
          <NavLinks groups={groups} variant="side" />
        </nav>
        <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
          <div className="font-semibold text-ink">{ctx.fullName || ctx.email}</div>
          <div>{roleLabel}</div>
          <div className="mt-3 flex gap-2">
            <LangToggle label={t.language} />
            <SignOut label={t.signOut} />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-2">
            <div>
              <div className="brand-word text-2xl text-brand">{t.appName}</div>
              <div className="text-xs text-muted">{propertyName} · {roleLabel}</div>
            </div>
            <div className="flex gap-2">
              <LangToggle label={t.language} />
              <SignOut label={t.signOut} />
            </div>
          </div>
          <NavLinks groups={groups} variant="top" />
        </header>
        <main className="mx-auto max-w-6xl p-4 lg:p-8">
          <GroupTabs groups={groups} />
          {children}
        </main>
      </div>
    </div>
  );
}
