"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Read-only link with a copy button (calendar links to paste into Airbnb / Booking). */
export function CopyField({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <input readOnly value={value} aria-label={label} dir="ltr" onFocus={(e) => e.currentTarget.select()} className="input min-w-0 flex-1 py-1.5 font-mono text-xs" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="btn-ghost btn-sm inline-flex shrink-0 items-center gap-1"
        aria-label={label}
      >
        {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}{done ? copied : label}
      </button>
    </div>
  );
}
