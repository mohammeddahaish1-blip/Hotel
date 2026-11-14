"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";

/** Type a word ("tax", "staff", "price") and jump to the tab that holds that setting. */
export function SettingsSearch({ items, label, none }: { items: { text: string; tab: string; href: string }[]; label: string; none: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const found = needle ? items.filter((x) => `${x.text} ${x.tab}`.toLowerCase().includes(needle)).slice(0, 8) : [];
  return (
    <div className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} className="input rounded-full ps-10" />
      {needle ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1 shadow-lg">
          {found.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{none}</li>
          ) : (
            found.map((x) => (
              <li key={`${x.href}-${x.text}`}>
                <Link href={x.href} onClick={() => setQ("")} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm hover:bg-surface-2">
                  <span className="min-w-0 truncate font-semibold">{x.text}</span>
                  <span className="shrink-0 text-xs text-muted">{x.tab}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
