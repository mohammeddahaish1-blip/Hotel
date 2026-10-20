"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type AlertItem = { key: string; severity: number; title: string; detail: string; href: string };

const DOT = ["", "bg-danger", "bg-warn", "bg-info"];

export function AlertsBell({ alerts, labels }: { alerts: AlertItem[]; labels: { title: string; none: string } }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);
  const urgent = alerts.some((a) => a.severity === 1);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${labels.title} (${alerts.length})`}
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface hover:bg-surface-2"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {alerts.length ? (
          <span className={`num absolute -end-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white ${urgent ? "bg-danger" : "bg-warn"}`}>
            {alerts.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="border-b border-line px-3 py-2 text-sm font-bold">{labels.title}</div>
          {alerts.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted">{labels.none}</div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} onClick={() => setOpen(false)} className="flex gap-2.5 px-3 py-2.5 text-sm hover:bg-surface-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[a.severity] ?? "bg-info"}`} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{a.title}</span>
                      <span dir="auto" className="block truncate text-xs text-muted">{a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
