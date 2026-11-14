import Link from "next/link";
import { hasRole, type Ctx } from "@/lib/auth";
import type { Dict } from "@/lib/i18n/dict";
import { getPlan, planHas } from "@/lib/plan";

export type FinanceView = "overview" | "cash" | "received" | "owed" | "expenses";

/** The view a role lands on: the people who run the money see the overview, everyone else the cash drawer. */
export const defaultFinanceView = (ctx: Ctx): FinanceView => (hasRole(ctx, ["manager", "accountant"]) ? "overview" : "cash");

/** One bar for everything under Finance, each tab a task in plain words. A tab only shows to the roles that may open it. */
export async function FinanceTabs({ ctx, t, current, month }: { ctx: Ctx; t: Dict; current: FinanceView | "cheques" | "links" | "corrections"; month?: string }) {
  const plan = await getPlan(ctx);
  const seesMoney = hasRole(ctx, ["manager", "accountant"]);
  const first = defaultFinanceView(ctx);
  const view = (v: FinanceView) => {
    const q = new URLSearchParams({ ...(v !== first ? { v } : {}), ...(month ? { month } : {}) }).toString();
    return q ? `/finance?${q}` : "/finance";
  };
  const tabs: { key: string; href: string; label: string }[] = [
    ...(seesMoney ? [{ key: "overview", href: view("overview"), label: t.fin_tab_overview }] : []),
    { key: "cash", href: view("cash"), label: t.fin_tab_cash },
    ...(seesMoney ? [{ key: "received", href: view("received"), label: t.fin_tab_received }] : []),
    { key: "owed", href: view("owed"), label: t.fin_tab_owed },
    ...(hasRole(ctx, ["manager", "accountant", "reception"]) ? [{ key: "expenses", href: view("expenses"), label: t.expenses }] : []),
    ...(hasRole(ctx, ["manager", "reception", "accountant"]) ? [{ key: "cheques", href: "/finance/cheques", label: t.nav_cheques }] : []),
    ...(planHas(plan, "payment_links") && hasRole(ctx, ["manager", "reception", "accountant"]) ? [{ key: "links", href: "/finance/links", label: t.pl_title }] : []),
    ...(hasRole(ctx, ["manager"]) ? [{ key: "corrections", href: "/finance/corrections", label: t.cr_title }] : []),
  ];
  return (
    <nav aria-label={t.fin_title} className="no-print mb-5 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1">
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
