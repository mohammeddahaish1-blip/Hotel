"use client";

import { usePathname, useRouter } from "next/navigation";

/** "‹ Back": returns to the previous screen; opened directly, it goes up one level instead. */
export function BackButton({ label }: { label: string }) {
  const router = useRouter();
  const path = usePathname();
  if (path === "/dashboard" || path === "/") return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back();
        else router.push(path.split("/").slice(0, -1).join("/") || "/dashboard");
      }}
      className="btn-ghost btn-sm shrink-0"
      title={label}
    >
      <span aria-hidden>‹</span> {label}
    </button>
  );
}
