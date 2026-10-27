"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => window.print()}>
      <Printer className="size-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}
