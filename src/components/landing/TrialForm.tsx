"use client";

import { useActionState } from "react";
import { CircleCheck } from "lucide-react";
import { requestTrial, type TrialState } from "@/app/actions/trial";

export type TrialLabels = {
  name: string; company: string; phone: string; email: string; send: string; sending: string;
  doneTitle: string; doneBody: string; errInput: string; errBusy: string; errFailed: string; privacy: string;
};

/** Name, phone and e-mail; the team answers with a personal link to the sample hotel. */
export function TrialForm({ t }: { t: TrialLabels }) {
  const [state, action, pending] = useActionState<TrialState, FormData>(requestTrial, null);
  if (state?.ok) {
    return (
      <div role="status" className="lp-done rounded-3xl bg-[#e2f3e8] p-6 text-[#14552e]">
        <CircleCheck className="size-9" aria-hidden />
        <p className="mt-3 text-lg font-bold">{t.doneTitle}</p>
        <p className="mt-1 text-sm leading-relaxed">{t.doneBody}</p>
      </div>
    );
  }
  const field = "mt-1 w-full rounded-2xl border border-[#cfd6d2] bg-white px-4 py-3 text-base text-[#1c2321] outline-none transition focus:border-[#0d6b5f] focus:ring-2 focus:ring-[#0d6b5f]/25";
  const err = state?.error === "input" ? t.errInput : state?.error === "busy" ? t.errBusy : state?.error ? t.errFailed : null;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-[#4d5753]">{t.name}<input name="name" required minLength={2} maxLength={120} autoComplete="name" className={field} /></label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.company}<input name="company" maxLength={120} autoComplete="organization" className={field} /></label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.phone}<input name="phone" required type="tel" inputMode="tel" dir="ltr" maxLength={20} autoComplete="tel" placeholder="9xxxxxxx" className={field} /></label>
      <label className="text-sm font-semibold text-[#4d5753]">{t.email}<input name="email" required type="email" dir="ltr" maxLength={200} autoComplete="email" placeholder="name@example.com" className={field} /></label>
      {/* not for people */}
      <div aria-hidden className="absolute -start-[9999px] size-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {err ? <p role="alert" className="rounded-2xl bg-[#fbe9e7] px-4 py-2.5 text-sm font-semibold text-[#8c1d18] sm:col-span-2">{err}</p> : null}
      <button disabled={pending} aria-busy={pending} className="btn-primary min-h-12 text-base sm:col-span-2">{pending ? t.sending : t.send}</button>
      <p className="text-xs leading-relaxed text-[#66706c] sm:col-span-2">{t.privacy}</p>
    </form>
  );
}
