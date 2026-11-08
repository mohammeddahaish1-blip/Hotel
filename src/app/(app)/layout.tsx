import { ShieldCheck, Sparkles } from "lucide-react";
import { initial } from "@/lib/profile-link";
import { getCtx, can, hasRole, AREAS } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { GroupTabs, NavLinks, type NavGroup } from "@/components/NavLinks";
import { LangToggle } from "@/components/LangToggle";
import { SignOut } from "@/components/SignOut";
import { IdleLogout } from "@/components/IdleLogout";
import { PropertySwitcher } from "@/components/PropertySwitcher";
import { GlobalSearch } from "@/components/GlobalSearch";
import { AlertsBell } from "@/components/AlertsBell";
import { BackButton } from "@/components/BackButton";
import { loadAlerts } from "@/lib/alerts";
import { getPlan, planHas } from "@/lib/plan";
import { todayIn } from "@/lib/format";
import Link from "next/link";


export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const plan = await getPlan(ctx);
  const has = (f: Parameters<typeof planHas>[1]) => planHas(plan, f);
  // Merged menu: each group shows only the parts this user may open (permissions stay per section)
  const tab = (area: (typeof AREAS)[number], label?: string) =>
    can(ctx, area) ? [{ href: `/${area}`, label: label ?? t[`nav_${area}` as DictKey] }] : [];
  const groups: NavGroup[] = [
    { key: "dashboard", label: t.nav_dashboard, tabs: tab("dashboard") },
    {
      key: "units",
      label: t.nav_grp_units,
      tabs: [
        ...(can(ctx, "board") ? [{ href: "/properties", label: t.nav_properties }] : []),
        ...tab("board"),
        ...tab("calendar"),
        ...(has("channels") && can(ctx, "board") && hasRole(ctx, ["manager", "reception"]) ? [{ href: "/channels", label: t.ch_title }] : []),
        ...(has("owners") && hasRole(ctx, ["manager", "accountant"]) ? [{ href: "/properties/owners", label: t.nav_owners }] : []),
      ],
    },
    {
      key: "reservations",
      label: t.nav_reservations,
      tabs: [
        ...tab("reservations"),
        ...tab("guests"),
        ...(has("messages") && can(ctx, "reservations") && hasRole(ctx, ["manager", "reception"]) ? [{ href: "/messages", label: t.msg_title }] : []),
        ...(can(ctx, "reservations") && hasRole(ctx, ["manager", "reception"]) ? [{ href: "/night-audit", label: t.na_title }] : []),
      ],
      also: ["/invoices"],
    },
    { key: "ops", label: t.nav_grp_ops, tabs: [...tab("housekeeping"), ...tab("maintenance")] },
    {
      key: "finance",
      label: t.nav_finance,
      tabs: can(ctx, "finance")
        ? [
            { href: "/finance", label: t.nav_finance },
            ...(hasRole(ctx, ["manager", "reception", "accountant"]) ? [{ href: "/finance/cheques", label: t.nav_cheques }] : []),
            ...(has("payment_links") && hasRole(ctx, ["manager", "reception", "accountant"]) ? [{ href: "/finance/links", label: t.pl_title }] : []),
            ...(hasRole(ctx, ["manager"]) ? [{ href: "/finance/corrections", label: t.cr_title }] : []),
          ]
        : [],
    },
    { key: "reports", label: t.nav_grp_reports, tabs: [...tab("reports"), ...tab("compliance")] },
    {
      key: "analytics",
      label: t.nav_grp_analytics,
      tabs: can(ctx, "reports") && has("analytics")
        ? [
            { href: "/analytics", label: t.an_charts },
            ...(hasRole(ctx, ["manager"]) ? [{ href: "/analytics/staff", label: t.an_staff }] : []),
          ]
        : [],
    },
    { key: "feedback", label: t.nav_feedback, tabs: tab("feedback") },
    { key: "import", label: t.nav_import, tabs: has("import") ? tab("import") : [] },
    {
      key: "settings",
      label: t.nav_settings,
      tabs: [
        ...tab("settings", t.nav_settings_general),
        ...(ctx.role === "owner" ? [{ href: "/settings/permissions", label: t.nav_permissions }] : []),
        ...(has("automation") && can(ctx, "settings") && hasRole(ctx, ["manager"]) ? [{ href: "/settings/automation", label: t.auto_title }] : []),
      ],
    },
    // one log: everyone's operations for owner/manager/accountant, your own for everyone else
    { key: "audit", label: t.nav_activity, tabs: [{ href: "/audit", label: t.nav_activity }], also: ["/activity"] },
  ].filter((g) => g.tabs.length > 0);
  const alerts = await loadAlerts(ctx, t, lang);
  const roleLabel = ctx.jobTitle || t[`role_${ctx.role}` as DictKey];
  // subscription notice for the owner and managers: trial ending, unpaid, suspended
  let banner: { tone: "warn" | "danger"; text: string } | null = null;
  if (hasRole(ctx, ["manager"])) {
    const today = todayIn(ctx.property.timezone);
    const daysTo = (d: string | null) => (d ? Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000) : null);
    const trialLeft = plan.status === "trial" ? daysTo(plan.trialEndsAt) : null;
    if (plan.status === "suspended") banner = { tone: "danger", text: t.sub_banner_suspended };
    else if (plan.status === "past_due") banner = { tone: "danger", text: t.sub_banner_past_due };
    else if (trialLeft !== null && trialLeft <= 7) banner = { tone: "warn", text: trialLeft < 0 ? t.sub_banner_trial_over : t.sub_banner_trial.replace("{n}", String(trialLeft)) };
  }
  const propertyName = lang === "en" && ctx.property.name_en ? ctx.property.name_en : ctx.property.name_ar;

  return (
    <div className="min-h-screen lg:flex">
      <IdleLogout minutes={ctx.role === "reception" || ctx.role === "housekeeping" ? 15 : 30} />
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-line bg-surface p-4 lg:flex">
        <div className="brand-word mb-1 text-4xl text-brand">{t.appName}</div>
        <PropertySwitcher current={ctx.property.id} properties={ctx.properties.map((p) => ({ id: p.id, name: p.name_ar }))} fallback={propertyName} />
        <nav className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <NavLinks groups={groups} variant="side" />
        </nav>
        <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
          {/* your name opens your account (the former "My account" menu item) */}
          <Link href="/profile" title={t.nav_profile} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-bold text-brand" aria-hidden>
              {initial(ctx.fullName || ctx.email)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-ink">{ctx.fullName || ctx.email}</span>
              <span className="block truncate">{roleLabel}</span>
            </span>
          </Link>
          {plan.isAdmin ? (
            <Link href="/admin" className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-surface-2">
              <ShieldCheck className="size-4 shrink-0" aria-hidden /> {t.adm_portal}
            </Link>
          ) : null}
          <div className="mt-3 flex gap-2">
            <LangToggle current={lang} />
            <SignOut label={t.signOut} />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="min-w-0">
              <div className="brand-word text-2xl text-brand">{t.appName}</div>
              <Link href="/profile" title={t.nav_profile} className="flex items-center gap-1.5 text-xs text-muted hover:text-brand">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[10px] font-bold text-brand" aria-hidden>
                  {initial(ctx.fullName || ctx.email)}
                </span>
                <span className="truncate">{ctx.fullName || ctx.email} · {roleLabel}</span>
              </Link>
            </div>
            <div className="flex gap-2">
              <LangToggle current={lang} />
              <SignOut label={t.signOut} />
            </div>
          </div>
          <NavLinks groups={groups} variant="top" />
        </header>
        <div className="no-print sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur max-lg:static">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 lg:px-8">
            <BackButton label={t.back} />
            <GlobalSearch
              labels={{ search: t.search, placeholder: t.search_ph, none: t.search_none, unit: t.sk_unit, reservation: t.sk_reservation, guest: t.sk_guest }}
            />
            <div className="ms-auto flex items-center gap-2">
              {/* the assistant sits in the top bar, next to the alerts, on every page (owner and managers) */}
              {has("assistant") && hasRole(ctx, ["manager"]) ? (
                <Link
                  href="/assistant"
                  title={t.ai_title}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-brand hover:bg-surface-2"
                >
                  <Sparkles className="size-4 shrink-0" aria-hidden />
                  <span className="hidden sm:inline">{t.ai_title}</span>
                  <span className="sr-only sm:hidden">{t.ai_title}</span>
                </Link>
              ) : null}
              <AlertsBell alerts={alerts} labels={{ title: t.alerts_title, none: t.alerts_none }} />
            </div>
          </div>
        </div>
        <main className="mx-auto max-w-6xl p-4 lg:p-8">
          {banner ? (
            <div role="status" className={`mb-4 rounded-xl px-4 py-2.5 text-sm font-semibold ${banner.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
              {banner.text}
            </div>
          ) : null}
          <GroupTabs groups={groups} />
          {children}
        </main>
      </div>
    </div>
  );
}
