"use client";

import { PanelLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/** Narrow (icons only) or full sidebar on wide screens; the choice is kept in a cookie. */
export function SideToggle({ mini, label }: { mini: boolean; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={mini}
      title={label}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-surface-2"
      onClick={() => {
        document.cookie = `side=${mini ? "full" : "mini"}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      <PanelLeft className="size-[18px] rtl:-scale-x-100" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
