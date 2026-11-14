"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { omr, parseBaisa } from "@/lib/format";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/ActionForm";

type Labels = {
  step1: string; step2: string; step3: string; countQ: string; countHint: string; counted: string; how: string; nonCash: string;
  result: string; expected: string; youCounted: string; match: string; short: string; over: string; recount: string; why: string;
  next: string; back: string; confirmQ: string; close: string;
};

/**
 * Closing the cash drawer in three small steps: count, compare, confirm.
 * The form is one and the same throughout, so the counted amount and the note are sent on the last step.
 */
export function CloseShift({ action, shiftId, expected, lines, lang, labels: l }: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  shiftId: string;
  expected: number;
  lines: { label: string; value: string; tone?: "ok" | "danger" | "total" }[];
  lang: "ar" | "en" | "ur" | "bn";
  labels: Labels;
}) {
  const [step, setStep] = useState(1);
  const [counted, setCounted] = useState("");
  const baisa = counted.trim() ? parseBaisa(counted) : null;
  const valid = baisa !== null && baisa >= 0;
  const diff = (baisa ?? 0) - expected;
  const tone = diff === 0 ? "bg-ok-soft text-ok" : diff < 0 ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn";
  const steps = [l.step1, l.step2, l.step3];
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="shift" value={shiftId} />
      <ol className="card flex flex-wrap items-center gap-x-3 gap-y-2">
        {steps.map((name, i) => {
          const n = i + 1;
          return (
            <li key={name} aria-current={n === step ? "step" : undefined} className={`flex items-center gap-2 text-sm font-semibold ${n === step ? "text-ink" : "text-muted"}`}>
              <span className={`num grid size-8 place-items-center rounded-full ${n < step ? "bg-ok-soft text-ok" : n === step ? "bg-brand text-brand-ink" : "bg-gray-soft"}`}>
                {n < step ? <Check className="size-4" strokeWidth={3} aria-hidden /> : n}
              </span>
              {name}
              {n < 3 ? <span className="mx-1 hidden h-0.5 w-8 bg-line sm:block" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={`card ${step === 1 ? "" : "max-md:hidden"}`}>
          <h2 className="h2">{l.countQ}</h2>
          <p className="mt-1 text-sm text-muted">{l.countHint}</p>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">{l.counted}</span>
            <input
              name="counted"
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              value={counted}
              readOnly={step !== 1}
              onChange={(e) => setCounted(e.target.value)}
              className="input num py-3 text-start text-2xl font-bold"
            />
          </label>
          <h3 className="mt-5 text-sm font-bold">{l.how}</h3>
          <dl className="mt-1 text-sm">
            {lines.map((x) => (
              <div key={x.label} className={`flex justify-between gap-3 py-1.5 ${x.tone === "total" ? "border-t border-line font-bold" : ""}`}>
                <dt>{x.label}</dt>
                <dd className={`num ${x.tone === "ok" ? "text-ok" : x.tone === "danger" ? "text-danger" : ""}`}>{x.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">{l.nonCash}</p>
          {step === 1 ? (
            <button type="button" disabled={!valid} className="btn-primary mt-4 w-full" onClick={() => setStep(2)}>{l.next}: {l.step2}</button>
          ) : null}
        </div>

        <div className={`card flex flex-col ${step === 1 ? "hidden" : ""}`}>
          <h2 className="h2">{step === 3 ? l.confirmQ : l.result}</h2>
          <dl className="mt-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-line py-2"><dt>{l.expected}</dt><dd className="num font-semibold">{omr(expected, lang)}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt>{l.youCounted}</dt><dd className="num font-semibold">{omr(baisa ?? 0, lang)}</dd></div>
          </dl>
          <div className={`my-3 rounded-3xl p-5 text-center ${tone}`}>
            <div className="font-semibold">{diff === 0 ? l.match : diff < 0 ? l.short : l.over}</div>
            {diff !== 0 ? <div className="num text-3xl font-bold leading-tight">{omr(Math.abs(diff), lang)}</div> : null}
            {diff !== 0 && step === 2 ? <p className="mt-1.5 text-xs">{l.recount}</p> : null}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-muted">{l.why}</span>
            <input name="notes" className="input" readOnly={step === 3} />
          </label>
          <div className="mt-auto flex gap-2 pt-4">
            <button type="button" className="btn-ghost" onClick={() => setStep(step - 1)}>{l.back}</button>
            {step === 2 ? (
              <button type="button" className="btn-primary flex-1" onClick={() => setStep(3)}>{l.next}: {l.step3}</button>
            ) : (
              <SubmitButton className="btn-primary flex-1">{l.close}</SubmitButton>
            )}
          </div>
        </div>
      </div>
    </ActionForm>
  );
}
