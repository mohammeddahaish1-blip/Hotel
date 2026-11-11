"use client";

import { Minus, Plus } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { FormAction } from "@/components/ActionForm";
import { omr } from "@/lib/format";

type Item = { id: string; name: string; price: number };
type Guest = { reservation_id: string; unit: string; guest: string };

/** The till: tap items, pick how it is paid (or the guest's room), record. */
export function ShopSale({ shop, items, guests, action, lang, t }: {
  shop: string; items: Item[]; guests: Guest[]; action: FormAction; lang: "ar" | "en" | "ur" | "bn";
  t: { items: string; total: string; method: string; cash: string; card: string; transfer: string; room: string; roomPick: string; noGuests: string; note: string; record: string; clear: string; none: string };
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("cash");
  const [state, formAction, pending] = useActionState(async (prev: { error?: string; ok?: string; n?: number } | null, fd: FormData) => {
    const r = await action(prev, fd);
    return r ? { ...r, n: (prev?.n ?? 0) + 1 } : r;
  }, null);

  // a recorded sale empties the till for the next customer
  useEffect(() => {
    if (state?.ok) setQty({}); // eslint-disable-line react-hooks/set-state-in-effect
  }, [state]);

  const lines = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([item_id, q]) => ({ item_id, qty: q })), [qty]);
  const total = lines.reduce((sum, l) => sum + (items.find((i) => i.id === l.item_id)?.price ?? 0) * l.qty, 0);
  const money = (v: number) => omr(v, lang);
  const add = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(999, (q[id] ?? 0) + d)) }));

  if (items.length === 0) return <p className="text-sm text-muted">{t.none}</p>;
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="shop" value={shop} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => {
          const q = qty[i.id] ?? 0;
          return (
            <div key={i.id} className={`flex flex-col gap-2 rounded-xl border p-2.5 ${q ? "border-brand bg-brand-soft/50" : "border-line"}`}>
              <button type="button" onClick={() => add(i.id, 1)} className="text-start">
                <span className="block truncate text-sm font-semibold">{i.name}</span>
                <span className="num text-xs text-muted">{money(i.price)}</span>
              </button>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => add(i.id, -1)} disabled={!q} className="btn-ghost btn-sm px-2" aria-label={`− ${i.name}`}><Minus className="size-3.5" /></button>
                <span className="num min-w-6 text-center font-bold">{q}</span>
                <button type="button" onClick={() => add(i.id, 1)} className="btn-ghost btn-sm px-2" aria-label={`+ ${i.name}`}><Plus className="size-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t.method}</span>
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className="input">
            <option value="cash">{t.cash}</option>
            <option value="card">{t.card}</option>
            <option value="transfer">{t.transfer}</option>
            <option value="room" disabled={guests.length === 0}>{t.room}</option>
          </select>
        </label>
        {method === "room" ? (
          <label className="block">
            <span className="label">{t.roomPick}</span>
            <select name="reservation" required className="input">
              {guests.map((g) => <option key={g.reservation_id} value={g.reservation_id}>{g.unit} — {g.guest}</option>)}
            </select>
          </label>
        ) : (
          <label className="block"><span className="label">{t.note}</span><input name="note" maxLength={300} className="input" /></label>
        )}
      </div>
      {guests.length === 0 ? <p className="text-xs text-muted">{t.noGuests}</p> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-sm text-muted">{t.total}</span>
        <span className="num text-xl font-bold">{money(total)}</span>
        <div className="ms-auto flex gap-2">
          <button type="button" onClick={() => setQty({})} className="btn-ghost btn-sm" disabled={!lines.length}>{t.clear}</button>
          <button className="btn-primary" disabled={!lines.length || pending} aria-busy={pending}>{t.record}</button>
        </div>
      </div>
      {state?.error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</div> : null}
      {state?.ok ? <div key={state.n} role="status" className="flash rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{state.ok}</div> : null}
    </form>
  );
}
