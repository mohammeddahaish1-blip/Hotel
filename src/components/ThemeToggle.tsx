"use client";

import { Moon } from "lucide-react";

/** Light / dark switch. The choice is saved in a cookie and applied on <html> at once. */
export function ThemeToggle() {
  return (
    <button
      type="button"
      aria-label="Theme / المظهر"
      title="Theme / المظهر"
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-surface-2"
      onClick={() => {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
        const next = dark ? "light" : "dark";
        // colours cross-fade for a moment instead of snapping (see .theme-fade in globals.css)
        root.classList.add("theme-fade");
        window.setTimeout(() => root.classList.remove("theme-fade"), 450);
        root.dataset.theme = next;
        document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      <Moon className="size-[18px]" strokeWidth={1.75} aria-hidden />
    </button>
  );
}
