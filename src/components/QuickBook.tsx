"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dict, DictKey } from "@/lib/i18n/dict";
import { addDays, nights, omr } from "@/lib/format";
import { findGuests, quickBook, quoteUnit, type GuestLite } from "@/app/actions/quick";

const SOURCES = ["direct", "walk_in", "phone", "whatsapp", "booking", "agoda", "expedia", "airbnb", "corporate", "other"];

export type QuickBookTarget = { unitId: string; unitNumber: string; from: string };

/** Booking dialog opened from an empty calendar cell: dates, price, guest (existing or new), done. */
export function QuickBook({ target, today, t, lang, onClose }: { target: QuickBookTarget; today: string; t: Dict; lang: "ar" | "en" | "ur"; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState(target.from);
  const [to, setTo] = useState(addDays(target.from, 1));
  const [quote, setQuote] = useState<number | null | undefined>(undefined);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GuestLite[]>([]);
  const [guest, setGuest] = useState<GuestLite | null>(null);
  const [ng, setNg] = useState({ full_name: "", phone: "", doc_type: "", doc_number: "", nationality: "", consent: false });
  const [source, setSource] = useState("walk_in");
  const [checkInNow, setCheckInNow] = useState(target.from === today);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (to <= from) return;
    let live = true;
    quoteUnit(target.unitId, from, to).then((r) => live && setQuote(r ? r.quote : null));
    return () => {
      live = false;
    };
  }, [from, to, target.unitId]);

  useEffect(() => {
    if (mode !== "existing" || q.trim().length < 2) return;
    const id = setTimeout(() => findGuests(q).then(setResults), 250);
    return () => clearTimeout(id);
  }, [q, mode]);

  const n = nights(from, to);
  const canCheckIn = from === today;

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await quickBook({
        unitId: target.unitId,
        from,
        to,
        source,
        guestId: mode === "existing" ? guest?.id : undefined,
        newGuest: mode === "new" ? ng : undefined,
        checkInNow: canCheckIn && checkInNow,
      });
      if (r.id) {
        setDoneId(r.id);
        router.refresh();
      }
      if (r.error) setError(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.qb_title}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">{t.qb_title} · {t.unit} {target.unitNumber}</div>
            <div className="text-xs text-muted">{n} {t.nightsLabel}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label={t.cancel}>✕</button>
        </div>

        {doneId ? (
          <div className="space-y-3 text-center">
            <div className="rounded-2xl bg-ok-soft px-4 py-6 text-lg font-bold text-ok">✓ {t.qb_done}</div>
            {error ? <div className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{error}</div> : null}
            <div className="flex justify-center gap-2">
              <Link href={`/reservations/${doneId}`} className="btn-primary">{t.qb_open}</Link>
              <button type="button" onClick={onClose} className="btn-ghost">{t.back}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">{t.res_check_in_date}</span>
                <input type="date" value={from} min={today} onChange={(e) => { setFrom(e.target.value); if (e.target.value >= to) setTo(addDays(e.target.value, 1)); }} className="input" />
              </label>
              <label className="block">
                <span className="label">{t.res_check_out_date}</span>
                <input type="date" value={to} min={addDays(from, 1)} onChange={(e) => setTo(e.target.value)} className="input" />
              </label>
            </div>
            <div className={`rounded-xl px-3 py-2 text-sm ${quote === null ? "bg-danger-soft text-danger" : "bg-surface-2"}`}>
              {quote === undefined ? "…" : quote === null ? t.qb_unavailable : <>{t.res_quote}: <b className="num">{omr(quote, lang)}</b></>}
            </div>

            <div>
              <div className="mb-2 flex gap-1 rounded-xl bg-surface-2 p-1">
                {(["existing", "new"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${mode === m ? "bg-surface shadow" : "text-muted"}`}>
                    {m === "existing" ? t.qb_existing : t.qb_new}
                  </button>
                ))}
              </div>
              {mode === "existing" ? (
                guest ? (
                  <div className="flex items-center justify-between rounded-xl border border-brand bg-brand-soft/50 px-3 py-2 text-sm">
                    <span>
                      <b>{guest.full_name}</b> <span dir="ltr" className="text-muted">{guest.phone}</span>
                    </span>
                    <button type="button" onClick={() => setGuest(null)} className="text-xs text-brand">{t.edit}</button>
                  </div>
                ) : (
                  <>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t.name} / ${t.phone} / ${t.doc_number}`} className="input" autoFocus />
                    <ul className="mt-1 divide-y divide-line">
                      {results.map((g) => (
                        <li key={g.id}>
                          <button type="button" onClick={() => setGuest(g)} className="flex w-full justify-between px-2 py-2 text-sm hover:bg-surface-2">
                            <span>{g.full_name}</span>
                            <span dir="ltr" className="text-muted">{g.phone}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input value={ng.full_name} onChange={(e) => setNg({ ...ng, full_name: e.target.value })} placeholder={t.full_name} className="input col-span-2" />
                  <input value={ng.phone} onChange={(e) => setNg({ ...ng, phone: e.target.value })} placeholder={`${t.phone} +968`} dir="ltr" className="input" />
                  <input value={ng.nationality} onChange={(e) => setNg({ ...ng, nationality: e.target.value })} placeholder="OMN" maxLength={3} dir="ltr" className="input uppercase" />
                  <select value={ng.doc_type} onChange={(e) => setNg({ ...ng, doc_type: e.target.value })} className="input">
                    <option value="">{t.doc_type}</option>
                    {(["oman_id", "gcc_id", "passport", "resident_card", "other"] as const).map((d) => (
                      <option key={d} value={d}>{t[`dt_${d}` as DictKey]}</option>
                    ))}
                  </select>
                  <input value={ng.doc_number} onChange={(e) => setNg({ ...ng, doc_number: e.target.value })} placeholder={t.doc_number} dir="ltr" className="input" />
                  <label className="col-span-2 flex items-start gap-2 rounded-xl bg-surface-2 p-2.5 text-xs">
                    <input type="checkbox" checked={ng.consent} onChange={(e) => setNg({ ...ng, consent: e.target.checked })} className="mt-0.5" />
                    <span>{t.consent_label}</span>
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 items-end gap-2">
              <label className="block">
                <span className="label">{t.source}</span>
                <select value={source} onChange={(e) => setSource(e.target.value)} className="input">
                  {SOURCES.map((x) => <option key={x} value={x}>{t[`src_${x}` as DictKey]}</option>)}
                </select>
              </label>
              {canCheckIn ? (
                <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
                  <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} />
                  {t.qb_check_in_now}
                </label>
              ) : null}
            </div>

            {error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div> : null}
            <button type="button" onClick={submit} disabled={pending || quote === null || n < 1} className="btn-primary w-full">
              {pending ? "…" : t.res_confirm}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
