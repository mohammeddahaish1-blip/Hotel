"use client";

import { useState, type ReactNode } from "react";
import type { Dict } from "@/lib/i18n/dict";
import { QuickBook } from "./QuickBook";

/** An available unit card on the status board: tap it to book straight away (same dialog as the calendar). */
export function BoardQuickBook({ unitId, unitNumber, today, t, lang, children }: {
  unitId: string; unitNumber: string; today: string; t: Dict; lang: "ar" | "en"; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${t.qb_title} · ${unitNumber}`}
        className="block h-full w-full cursor-pointer rounded-xl text-start transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand"
      >
        {children}
      </button>
      {open ? <QuickBook target={{ unitId, unitNumber, from: today }} today={today} t={t} lang={lang} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
