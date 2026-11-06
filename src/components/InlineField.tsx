"use client";

import { Check, Pencil, X } from "lucide-react";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { FormAction } from "@/components/ActionForm";
import { PhoneInput } from "@/components/PhoneInput";

type Kind = "text" | "numeric" | "money" | "date" | "phone";

/**
 * One profile line that is edited where it is shown: the value, and a small pencil.
 * Pencil → the line becomes its own input with Save / Cancel; saving closes it again.
 */
export function InlineField({
  icon, label, display, field, kind = "text", value, userId, action, canEdit, labels,
}: {
  icon: ReactNode;
  label: string;
  display: ReactNode;
  field: string;
  kind?: Kind;
  value: string;
  userId: string;
  action: FormAction;
  canEdit: boolean;
  labels: { edit: string; save: string; cancel: string; country: string; search: string; none: string };
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: { error?: string; ok?: string; n?: number } | null, fd: FormData) => {
    const r = await action(prev, fd);
    return r ? { ...r, n: (prev?.n ?? 0) + 1 } : r;
  }, null);

  // a successful save closes the editor (the page re-renders with the new value)
  useEffect(() => {
    if (state?.ok) setEditing(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [state]);

  const input = (() => {
    const common = { name: "value", defaultValue: value, "aria-label": label, autoFocus: true, className: "input py-2" };
    if (kind === "phone") return <PhoneInput name="value" defaultValue={value} label={label} labels={labels} />;
    if (kind === "date") return <input type="date" {...common} />;
    if (kind === "money") return <input inputMode="decimal" dir="ltr" placeholder="0.000" {...common} />;
    if (kind === "numeric") return <input inputMode="numeric" dir="ltr" {...common} />;
    return <input {...common} />;
  })();

  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{label}</div>
        {editing ? (
          <form action={formAction} className="mt-1.5 space-y-2" onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}>
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="field" value={field} />
            {input}
            <div className="flex gap-2">
              <button className="btn-primary btn-sm inline-flex items-center gap-1" disabled={pending} aria-busy={pending}>
                <Check className="size-3.5 shrink-0" /> {labels.save}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost btn-sm inline-flex items-center gap-1">
                <X className="size-3.5 shrink-0" /> {labels.cancel}
              </button>
            </div>
            {state?.error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</div> : null}
          </form>
        ) : (
          <div className="mt-0.5 font-semibold">{display}</div>
        )}
        {!editing && state?.ok ? <div key={state.n} role="status" className="flash mt-1 text-xs text-ok">{state.ok}</div> : null}
      </div>
      {canEdit && !editing ? (
        <button type="button" onClick={() => setEditing(true)} className="btn-ghost btn-sm shrink-0 px-2" aria-label={`${labels.edit}: ${label}`} title={labels.edit}>
          <Pencil className="size-3.5 shrink-0" />
        </button>
      ) : null}
    </div>
  );
}
