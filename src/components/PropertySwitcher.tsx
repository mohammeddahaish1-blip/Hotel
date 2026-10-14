"use client";

import { useRouter } from "next/navigation";

export function PropertySwitcher({ current, properties, fallback }: { current: string; properties: { id: string; name: string }[]; fallback: string }) {
  const router = useRouter();
  if (properties.length < 2) return <div className="text-sm text-muted">{fallback}</div>;
  return (
    <select
      className="input mt-1"
      defaultValue={current}
      onChange={(e) => {
        document.cookie = `property=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {properties.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}
