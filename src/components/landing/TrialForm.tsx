"use client";

import { useActionState, useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";
import { requestTrial, type TrialField, type TrialState } from "@/app/actions/trial";

export type TrialLabels = {
  name: string; company: string; phone: string; email: string; send: string; sending: string;
  doneTitle: string; doneBody: string; errInput: string; errBusy: string; errFailed: string; privacy: string;
  errName: string; errPhone: string; errEmail: string;
};

/** Name, phone and e-mail; the team answers with a personal link to the sample hotel. */
export function TrialForm({ t }: { t: TrialLabels }) {
  const [state, action, pending] = useActionState<TrialState, FormData>(requestTrial, null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // after a failed send, take the visitor to what needs fixing
  useEffect(() => {
    if (!state?.error) return;
    const bad = state.field ? formRef.current?.elements.namedItem(state.field) : null;
    if (bad instanceof HTMLInputElement) bad.focus();
    else alertRef.current?.focus();
  }, [state]);
  if (state?.ok) {
    return (
      <div role="status" className="lp-done rounded-3xl bg-[#e2f3e8] p-6 text-[#14552e]">
        <CircleCheck className="size-9" aria-hidden />
        <p className="mt-3 text-lg font-bold">{t.doneTitle}</p>
        <p className="mt-1 text-sm leading-relaxed">{t.doneBody}</p>
      </div>
    );
  }
  const field = "mt-1 w-full rounded-2xl border border-[#cfd6d2] bg-white px-4 py-3 text-base text-[#1c2321] outline-none transition focus:border-[#0d6b5f] focus:ring-2 focus:ring-[#0d6b5f]/25 aria-invalid:border-[#b42318] aria-invalid:ring-2 aria-invalid:ring-[#b42318]/20";
  const fieldErr: Record<TrialField, string> = { name: t.errName, phone: t.errPhone, email: t.errEmail };
  // a wrong field gets its own message under it; anything else is said once above the button
  const err = state?.error === "input" ? (state.field ? null : t.errInput) : state?.error === "busy" ? t.errBusy : state?.error ? t.errFailed : null;
  const val = (k: string) => state?.values?.[k] ?? "";
  const bad = (k: TrialField) => state?.field === k;
  const hint = (k: TrialField) => bad(k) ? <span id={`trial-${k}-err`} className="mt-1 block text-[13px] font-semibold text-[#8c1d18]">{fieldErr[k]}</span> : null;
  const inv = (k: TrialField) => bad(k) ? { "aria-invalid": true, "aria-describedby": `trial-${k}-err` } : {};
  return (
    // key: a new answer from the server refills the fields with what was typed
    <form ref={formRef} key={JSON.stringify(state?.values ?? null)} action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-[#4d5753]">{t.name}<input name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={val("name")} {...inv("name")} className={field} />{hint("name")}</label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.company}<input name="company" maxLength={120} autoComplete="organization" defaultValue={val("company")} className={field} /></label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.phone}<input name="phone" required type="tel" inputMode="tel" dir="ltr" maxLength={20} autoComplete="tel" placeholder="9xxxxxxx" defaultValue={val("phone")} {...inv("phone")} className={field} />{hint("phone")}</label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.email}<input name="email" required type="email" dir="ltr" maxLength={200} autoComplete="email" spellCheck={false} autoCapitalize="none" placeholder="name@example.com" defaultValue={val("email")} {...inv("email")} className={field} />{hint("email")}</label>
      {/* not for people */}
      <div aria-hidden className="absolute -start-[9999px] size-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {err ? <p ref={alertRef} tabIndex={-1} role="alert" className="rounded-2xl bg-[#fbe9e7] px-4 py-2.5 text-sm font-semibold text-[#8c1d18] outline-none sm:col-span-2">{err}</p> : null}
      <button disabled={pending} aria-busy={pending} className="btn-primary min-h-12 text-base sm:col-span-2">{pending ? t.sending : t.send}</button>
      <p className="text-xs leading-relaxed text-[#66706c] sm:col-span-2">{t.privacy}</p>
    </form>
  );
}
