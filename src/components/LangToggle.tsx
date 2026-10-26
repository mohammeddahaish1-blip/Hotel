"use client";

import { useRouter } from "next/navigation";
import { LANGS } from "@/lib/i18n/dict";

/** Interface language: Arabic, English or Urdu (saved in a cookie). */
export function LangToggle({ current }: { current: string }) {
  const router = useRouter();
  return (
    <select
      aria-label="Language / اللغة / زبان"
      className="input w-auto py-1.5 text-sm"
      defaultValue={current}
      onChange={(e) => {
        document.cookie = `lang=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}
