"use client";

import { useRouter } from "next/navigation";

export function LangToggle({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={() => {
        const next = document.documentElement.lang === "ar" ? "en" : "ar";
        document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
