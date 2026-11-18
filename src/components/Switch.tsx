"use client";

import { useState, useTransition } from "react";
import type { FormAction } from "@/components/ActionForm";

/**
 * On/off switch that flips the moment it is tapped and saves in the background:
 * no spinner, no waiting. If saving fails it flips back and shows why.
 */
export function Switch({ action, on, fields, label }: { action: FormAction; on: boolean; fields: Record<string, string>; label: [string, string] }) {
  const [value, setValue] = useState(on);
  const [seen, setSeen] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  // the page sent a newer value (after saving, or another device changed it)
  if (on !== seen) { setSeen(on); setValue(on); }
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={value ? label[0] : label[1]}
        className={`switch ${value ? "switch-on" : ""}`}
        onClick={() => {
          const next = !value;
          setValue(next);
          setError(null);
          start(async () => {
            const fd = new FormData();
            Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
            fd.set("active", next ? "1" : "0");
            const r = await action(null, fd).catch(() => ({ error: "تعذّر الحفظ" }));
            if (r?.error) { setValue(!next); setError(r.error); }
          });
        }}
      />
      {error ? <span role="alert" className="mt-1 max-w-48 text-xs text-danger">{error}</span> : null}
    </span>
  );
}
