"use client";

import { Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * "Edit" button that opens its form in a panel above the page: a sheet at the bottom on phones,
 * a centred box on tablets and computers. It is never cut off by a narrow column, a table or the
 * screen edge. Escape, the backdrop or the × close it; a successful save (the page re-renders
 * with fresh data) leaves it open so the confirmation stays visible.
 */
export function EditDetails({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") ref.current?.removeAttribute("open"); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => ref.current?.removeAttribute("open");

  return (
    <details ref={ref} className={`group ${className}`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="btn-ghost btn-sm inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <Pencil className="size-3.5 shrink-0" aria-hidden />{label}
      </summary>
      {open ? <div aria-hidden onClick={close} className="fixed inset-0 z-40 bg-black/25" /> : null}
      <div
        role="dialog"
        aria-label={label}
        className="fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-xl sm:inset-x-0 sm:bottom-auto sm:top-24 sm:mx-auto sm:w-[24rem] sm:max-w-[calc(100vw-2rem)]"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <button type="button" onClick={close} aria-label="×" className="rounded-lg p-1 text-muted hover:bg-surface-2">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="[&_form]:min-w-0 [&_form]:w-full">{children}</div>
      </div>
    </details>
  );
}
