"use client";

import { useState } from "react";
import { ReceiptInput } from "@/components/FinanceInputs";

type Opt = { value: string; label: string };

/**
 * Recording a payment: the amount is filled with what is left, the method is three buttons, and the
 * picture of the proof becomes required for a bank transfer. Kind and reference sit under "more details".
 * Posts amount, method, kind, reference and proof (the form around it adds folio and res).
 */
export function PaymentForm({ balance, methods, kinds, labels: l }: {
  balance: string; methods: Opt[]; kinds: Opt[];
  labels: { amount: string; all: string; how: string; proof: string; proofReady: string; proofHint: string; more: string; kind: string; reference: string };
}) {
  const [amount, setAmount] = useState(balance);
  const [method, setMethod] = useState(methods[0]?.value ?? "cash");
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="label">{l.amount}</span>
        <span className="flex gap-2">
          <input name="amount" required inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="input num py-3 text-start text-2xl font-bold" />
          {balance ? <button type="button" className="shrink-0 rounded-full bg-brand-soft px-4 text-sm font-semibold text-brand" onClick={() => setAmount(balance)}>{l.all}</button> : null}
        </span>
      </label>
      <fieldset>
        <legend className="label">{l.how}</legend>
        <input type="hidden" name="method" value={method} />
        <div data-seg role="group" aria-label={l.how} className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1">
          {methods.map((x) => (
            <button
              key={x.value}
              type="button"
              aria-pressed={method === x.value}
              onClick={() => setMethod(x.value)}
              className={`min-h-11 flex-1 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${method === x.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <ReceiptInput name="proof" label={l.proof} ready={l.proofReady} required={method === "transfer"} />
        <p className="mt-1 text-xs text-muted">{l.proofHint}</p>
      </div>
      <details className="rounded-2xl bg-surface-2 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-brand">{l.more}</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">{l.kind}</span>
            <select name="kind" defaultValue={kinds[0]?.value} className="input">{kinds.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          </label>
          <label className="block"><span className="label">{l.reference}</span><input name="reference" className="input" /></label>
        </div>
      </details>
    </div>
  );
}
