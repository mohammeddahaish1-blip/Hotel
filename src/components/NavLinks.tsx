"use client";

import Link from "next/link";
import {
  Activity, Building2, CalendarCheck, ChartColumn, FileText, FileUp, LayoutGrid,
  MessageSquareText, Settings, ShieldCheck, SprayCan, Wallet, type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";

export type NavTab = { href: string; label: string };
export type NavGroup = { key: string; label: string; tabs: NavTab[]; also?: string[] };

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid, units: Building2, reservations: CalendarCheck, ops: SprayCan, finance: Wallet,
  reports: FileText, analytics: ChartColumn, feedback: MessageSquareText, import: FileUp,
  settings: Settings, activity: Activity, audit: ShieldCheck,
};

function GroupIcon({ k, className }: { k: string; className: string }) {
  const Icon = ICONS[k];
  return Icon ? <Icon className={className} strokeWidth={1.75} aria-hidden /> : null;
}

const matches = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** The tab whose href is the most specific match for the path (/settings vs /settings/permissions) */
function bestTab(path: string, tabs: NavTab[]) {
  return tabs.filter((t) => matches(path, t.href)).sort((a, b) => b.href.length - a.href.length)[0];
}

function activeGroup(path: string, groups: NavGroup[]) {
  let best: { key: string; len: number } | null = null;
  for (const g of groups) {
    for (const href of [...g.tabs.map((t) => t.href), ...(g.also ?? [])]) {
      if (matches(path, href) && (!best || href.length > best.len)) best = { key: g.key, len: href.length };
    }
  }
  return best?.key;
}

/** Main menu: one entry per group, linking to the group's first allowed tab. */
export function NavLinks({ groups, variant }: { groups: NavGroup[]; variant: "side" | "top" }) {
  const path = usePathname();
  const current = activeGroup(path, groups);
  if (variant === "top") {
    return (
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {groups.map((g) => (
          <Link
            key={g.key}
            href={g.tabs[0].href}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${g.key === current ? "bg-brand text-brand-ink" : "text-muted"}`}
          >
            <GroupIcon k={g.key} className="size-4 shrink-0" />
            {g.label}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-0.5">
      {groups.map((g) => (
        <li key={g.key}>
          <Link
            href={g.tabs[0].href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${g.key === current ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-surface-2"}`}
          >
            <GroupIcon k={g.key} className={`size-[18px] shrink-0 ${g.key === current ? "" : "text-muted"}`} />
            {g.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Tabs at the top of a merged section (only when the user can see more than one of its parts). */
export function GroupTabs({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const key = activeGroup(path, groups);
  const group = groups.find((g) => g.key === key);
  if (!group || group.tabs.length < 2) return null;
  const active = bestTab(path, group.tabs)?.href;
  return (
    <div className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {group.tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
            t.href === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
