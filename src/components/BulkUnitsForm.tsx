"use client";

import { useMemo, useState } from "react";
import type { FormAction } from "@/components/ActionForm";
import { ActionForm, SubmitButton } from "@/components/ActionForm";

type Opt = { id: string; name: string; sort?: number };
export type BulkLabels = {
  title: string; type: string; floor: string; noFloor: string; sequence: string; list: string; prefix: string; prefixPh: string;
  start: string; count: string; listPh: string; preview: string; existing: string; add: string; none: string;
};

/** Add many units at once: a numbered sequence (optionally with a prefix) or a typed list, previewed before saving. */
export function BulkUnitsForm({ action, types, floors, existing, labels }: {
  action: FormAction;
  types: Opt[];
  floors: Opt[];
  existing: string[];
  labels: BulkLabels;
}) {
  const [mode, setMode] = useState<"sequence" | "list">("sequence");
  const [floor, setFloor] = useState("");
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState("101");
  const [startTouched, setStartTouched] = useState(false);
  const [count, setCount] = useState("10");
  const [list, setList] = useState("");
  const taken = useMemo(() => new Set(existing), [existing]);

  const numbers = useMemo(() => {
    if (mode === "list") {
      return [...new Set(list.split(/[\s,،;]+/).map((x) => x.trim()).filter((x) => /^[\p{L}\p{N}-]{1,20}$/u.test(x)))].slice(0, 500);
    }
    const a = Number(start);
    const n = Math.min(Math.max(Math.floor(Number(count) || 0), 0), 200);
    if (!Number.isInteger(a) || a < 0) return [];
    return Array.from({ length: n }, (_, i) => `${prefix.trim()}${a + i}`);
  }, [mode, list, start, count, prefix]);
  const fresh = numbers.filter((x) => !taken.has(x));

  // Choosing a floor suggests its usual numbering (floor 2 → 201), until the start is typed by hand
  function pickFloor(id: string) {
    setFloor(id);
    const f = floors.find((x) => x.id === id);
    if (!startTouched && f?.sort !== undefined && f.sort > 0) setStart(String(f.sort * 100 + 1));
  }

  return (
    <ActionForm action={action} className="space-y-3">
      <div className="label">{labels.title}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="unit_type" required aria-label={labels.type} className="input">
          {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="floor" value={floor} onChange={(e) => pickFloor(e.target.value)} aria-label={labels.floor} className="input">
          <option value="">{labels.noFloor}</option>
          {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <div className="inline-flex rounded-xl border border-line p-0.5 text-sm" role="tablist">
        {(["sequence", "list"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 ${mode === m ? "bg-brand text-brand-ink" : "text-muted"}`}
          >
            {m === "sequence" ? labels.sequence : labels.list}
          </button>
        ))}
      </div>

      {mode === "sequence" ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="block"><span className="label">{labels.prefix}</span>
            <input value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 6))} placeholder={labels.prefixPh} dir="ltr" className="input" />
          </label>
          <label className="block"><span className="label">{labels.start}</span>
            <input value={start} onChange={(e) => { setStart(e.target.value.replace(/\D/g, "")); setStartTouched(true); }} inputMode="numeric" dir="ltr" className="input" />
          </label>
          <label className="block"><span className="label">{labels.count}</span>
            <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" dir="ltr" className="input" />
          </label>
        </div>
      ) : (
        <textarea value={list} onChange={(e) => setList(e.target.value)} rows={2} placeholder={labels.listPh} dir="ltr" className="input" />
      )}

      <div>
        <div className="mb-1 text-xs text-muted">{labels.preview.replace("{n}", String(fresh.length))}</div>
        {numbers.length ? (
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {numbers.map((x) => (
              <span
                key={x}
                title={taken.has(x) ? labels.existing : undefined}
                className={`num rounded-md border px-1.5 py-0.5 text-xs ${taken.has(x) ? "border-line text-muted line-through" : "border-brand/40 bg-brand-soft text-brand"}`}
              >
                {x}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">{labels.none}</p>
        )}
        {numbers.length > fresh.length ? <p className="mt-1 text-xs text-muted">{labels.existing}</p> : null}
      </div>

      <input type="hidden" name="numbers" value={fresh.join(",")} />
      <SubmitButton className="btn-primary w-full">{labels.add.replace("{n}", String(fresh.length))}</SubmitButton>
    </ActionForm>
  );
}
