"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity, Building2, MessageSquareWarning, CircleUserRound, Sparkles, CalendarCheck, ChartColumn, FileText, FileUp, LayoutGrid,
  Ellipsis, MessageSquareText, Settings, ShieldCheck, SprayCan, Store, Wallet, type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";

export type NavTab = { href: string; label: string };
export type NavGroup = { key: string; label: string; tabs: NavTab[]; also?: string[] };

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid, units: Building2, reservations: CalendarCheck, ops: SprayCan, shops: Store, finance: Wallet,
  reports: FileText, analytics: ChartColumn, assistant: Sparkles, feedback: MessageSquareText, import: FileUp,
  settings: Settings, complaints: MessageSquareWarning, activity: Activity, profile: CircleUserRound, audit: ShieldCheck,
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
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${g.key === current ? "bg-brand text-brand-ink" : "text-muted"}`}
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
            className={`flex items-center gap-2.5 rounded-full px-3.5 py-2 text-sm ${g.key === current ? "bg-brand font-semibold text-brand-ink" : "text-ink hover:bg-surface-2"}`}
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

/** Phone and tablet menu: the four main sections stay under the thumb, the rest open in a sheet. */
export function BottomNav({ groups, moreLabel }: { groups: NavGroup[]; moreLabel: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = activeGroup(path, groups);
  const wanted = ["dashboard", "reservations", "units", "finance"];
  const main = [...groups.filter((g) => wanted.includes(g.key)).sort((a, b) => wanted.indexOf(a.key) - wanted.indexOf(b.key)), ...groups.filter((g) => !wanted.includes(g.key))].slice(0, 4);
  const rest = groups.filter((g) => !main.includes(g));
  const item = "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold";
  const pill = (on: boolean) => `grid h-7 w-14 place-items-center rounded-full ${on ? "bg-brand text-brand-ink" : "text-muted"}`;
  return (
    <>
      {open ? (
        <>
          <button type="button" aria-label={moreLabel} className="no-print fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
          <div className="sheet-up no-print fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-3xl bg-surface p-4 pb-8 shadow-[0_-10px_30px_rgba(0,0,0,0.15)] lg:hidden">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden />
            <ul className="mx-auto grid max-w-2xl grid-cols-3 gap-2 sm:grid-cols-4">
              {rest.map((g) => (
                <li key={g.key}>
                  <Link
                    href={g.tabs[0].href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl p-2 text-center text-xs font-semibold ${g.key === current ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink"}`}
                  >
                    <GroupIcon k={g.key} className="size-5 shrink-0" />
                    {g.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="mx-auto flex max-w-2xl">
          {main.map((g) => (
            <li key={g.key} className="min-w-0 flex-1">
              <Link href={g.tabs[0].href} className={`${item} ${g.key === current ? "text-brand" : "text-muted"}`}>
                <span className={pill(g.key === current)}><GroupIcon k={g.key} className="size-[18px] shrink-0" /></span>
                <span className="max-w-full truncate">{g.label}</span>
              </Link>
            </li>
          ))}
          {rest.length ? (
            <li className="min-w-0 flex-1">
              <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`${item} ${rest.some((g) => g.key === current) ? "text-brand" : "text-muted"}`}>
                <span className={pill(rest.some((g) => g.key === current))}><Ellipsis className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden /></span>
                <span className="max-w-full truncate">{moreLabel}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </>
  );
}
