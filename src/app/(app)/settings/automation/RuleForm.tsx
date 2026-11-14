"use client";

import { useState } from "react";

type Opt = { value: string; label: string };
type Labels = { when: string; what: string; days: string; message: string; hkKind: string; moreTriggers: string; willBe: string; allProps?: string };

/**
 * "When? → What happens?" for one automation rule. Only the field that belongs to the chosen action shows,
 * the day count hides where it means nothing, and the rule's name is the sentence the choices make.
 * Posts the same fields as before: name, trigger, offset, action, template, hk_kind (and "all" for a new rule).
 */
export function RuleForm({ triggers, rareTriggers, actions, templates, hkKinds, arrow, labels: l, initial }: {
  triggers: Opt[]; rareTriggers: Opt[]; actions: Opt[]; templates: Opt[]; hkKinds: Opt[]; arrow: string; labels: Labels;
  initial?: { trigger: string; offset: number; action: string; template: string | null; hkKind: string | null };
}) {
  const [trigger, setTrigger] = useState(initial?.trigger ?? "before_arrival");
  const [offset, setOffset] = useState(String(initial?.offset ?? 1));
  const [action, setAction] = useState(initial?.action ?? "whatsapp");
  const [template, setTemplate] = useState(initial?.template ?? templates[0]?.value ?? "");
  const [hkKind, setHkKind] = useState(initial?.hkKind ?? hkKinds[0]?.value ?? "");
  const [more, setMore] = useState(rareTriggers.some((x) => x.value === trigger));
  const timed = trigger !== "booking_confirmed";
  const n = timed ? offset || "0" : "0";
  const all = [...triggers, ...rareTriggers];
  const text = (x: Opt) => x.label.replace("{n}", n);
  const detail = action === "whatsapp" ? templates.find((x) => x.value === template)?.label : action === "hk_task" ? hkKinds.find((x) => x.value === hkKind)?.label : undefined;
  const sentence = `${text(all.find((x) => x.value === trigger) ?? all[0])} ${arrow} ${actions.find((x) => x.value === action)?.label ?? ""}${detail ? `: ${detail}` : ""}`;
  const choice = "flex cursor-pointer items-center gap-2 rounded-2xl border border-line px-3 py-2.5 text-sm font-semibold has-[:checked]:border-brand has-[:checked]:bg-brand-soft";
  const step = "num grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink";
  return (
    <div className="space-y-5">
      <input type="hidden" name="name" value={sentence.slice(0, 120)} />
      <input type="hidden" name="offset" value={n} />
      <fieldset>
        <legend className="mb-2 flex items-center gap-2 font-bold"><span className={step}>1</span>{l.when}</legend>
        <div className="grid gap-1.5">
          {(more ? all : triggers).map((x) => (
            <label key={x.value} className={choice}>
              <input type="radio" name="trigger" value={x.value} checked={trigger === x.value} onChange={() => setTrigger(x.value)} className="accent-[var(--brand)]" />
              {x.value === trigger ? text(x) : x.label.replace("{n}", "…")}
            </label>
          ))}
          {more ? null : <button type="button" className="px-1 text-start text-sm font-semibold text-brand" onClick={() => setMore(true)}>{l.moreTriggers}</button>}
        </div>
        {timed ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <span className="font-semibold text-muted">{l.days}</span>
            <input type="number" min={0} max={90} inputMode="numeric" value={offset} onChange={(e) => setOffset(e.target.value)} className="input num w-24" />
          </label>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="mb-2 flex items-center gap-2 font-bold"><span className={step}>2</span>{l.what}</legend>
        <div className="grid gap-1.5">
          {actions.map((x) => (
            <label key={x.value} className={choice}>
              <input type="radio" name="action" value={x.value} checked={action === x.value} onChange={() => setAction(x.value)} className="accent-[var(--brand)]" />
              {x.label}
            </label>
          ))}
        </div>
        {action === "whatsapp" ? (
          <label className="mt-3 block">
            <span className="label">{l.message}</span>
            <select name="template" value={template} onChange={(e) => setTemplate(e.target.value)} className="input">
              {templates.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
        ) : null}
        {action === "hk_task" ? (
          <label className="mt-3 block">
            <span className="label">{l.hkKind}</span>
            <select name="hk_kind" value={hkKind} onChange={(e) => setHkKind(e.target.value)} className="input">
              {hkKinds.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
        ) : null}
      </fieldset>
      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="text-xs font-semibold text-muted">{l.willBe}</div>
        <div className="font-bold">{sentence}</div>
      </div>
      {l.allProps ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="all" defaultChecked /> {l.allProps}</label> : null}
    </div>
  );
}
