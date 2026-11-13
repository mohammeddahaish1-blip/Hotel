"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useFormStatus } from "react-dom";

export type ActionResult = { error?: string; ok?: string } | null;
export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Counts the successful saves of the surrounding form, so its button can flash a check. */
const SavedCount = createContext(0);

export function SubmitButton({ children, className = "btn-primary", confirm }: { children: ReactNode; className?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  const saved = useContext(SavedCount);
  return (
    <button
      type="submit"
      className={`relative ${className}`}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {/* keep the label (and the button's width) while saving; a spinner sits on top */}
      <span className={`inline-flex items-center gap-1.5 ${pending ? "opacity-0" : ""}`}>{children}</span>
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" />
        </span>
      ) : null}
      {saved > 0 && !pending ? (
        <span key={saved} className="btn-done" aria-hidden><Check className="size-4" strokeWidth={3} /></span>
      ) : null}
    </button>
  );
}

/** Form bound to a server action; shows the translated error or success message inline. */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  // n counts results so the success note replays its fade on every save
  const [state, formAction] = useActionState(async (prev: (ActionResult & { n?: number }) | null, fd: FormData) => {
    const r = await action(prev, fd);
    return r ? { ...r, n: (prev?.n ?? 0) + 1 } : r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      <SavedCount.Provider value={state?.ok ? (state.n ?? 0) : 0}>{children}</SavedCount.Provider>
      {state?.error ? (
        <div role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</div>
      ) : null}
      {state?.ok ? <div key={state.n} role="status" className="flash mt-3 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{state.ok}</div> : null}
    </form>
  );
}
