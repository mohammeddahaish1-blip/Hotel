"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links, variant }: { links: { href: string; label: string }[]; variant: "side" | "top" }) {
  const path = usePathname();
  // Highlight only the most specific matching link (/settings vs /settings/permissions)
  const matches = links.filter((l) => path === l.href || path.startsWith(`${l.href}/`));
  const best = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = (href: string) => href === best;
  if (variant === "top") {
    return (
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active(l.href) ? "bg-brand text-brand-ink" : "text-muted"}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <ul className="space-y-0.5">
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            className={`block rounded-lg px-3 py-2 text-sm ${active(l.href) ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-surface-2"}`}
          >
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
