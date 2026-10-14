"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveReservation } from "@/app/actions/ops";
import { addDays, nights } from "@/lib/format";

export type Bar = { id: string; code: string; unitId: string; from: string; to: string; status: string; kind: string; guest: string };

const BAR_TONE: Record<string, string> = {
  tentative: "bg-gray-soft text-ink border-line",
  confirmed: "bg-info-soft text-info border-info/30",
  checked_in: "bg-violet-soft text-violet border-violet/30",
  checked_out: "bg-ok-soft text-ok border-ok/30",
};

export function TapeChart({
  start, days, today, lang, units, bars, labels,
}: {
  start: string; days: number; today: string; lang: "ar" | "en";
  units: { id: string; number: string; status: string }[];
  bars: Bar[];
  labels: { moved: string; unit: string };
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [drag, setDrag] = useState<Bar | null>(null);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const end = addDays(start, days);
  const cell = 64;

  function onDrop(unitId: string, day: string) {
    const b = drag;
    setDrag(null);
    if (!b) return;
    // Keep the same length; checked-in guests keep their arrival date and only change unit.
    const len = nights(b.from, b.to);
    const from = b.status === "checked_in" ? b.from : day;
    const to = b.status === "checked_in" ? b.to : addDays(day, len);
    if (unitId === b.unitId && from === b.from) return;
    startTransition(async () => {
      const r = await moveReservation(b.id, unitId, from, to);
      if (r?.error) setMsg({ tone: "err", text: r.error });
      else {
        setMsg({ tone: "ok", text: labels.moved });
        router.refresh();
      }
    });
  }

  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric" }).format(new Date(`${d}T00:00:00`));
  const hijriDay = (d: string) =>
    new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00`));

  return (
    <div className={pending ? "opacity-60" : ""}>
      {msg ? (
        <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.tone === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>{msg.text}</div>
      ) : null}
      <div className="card overflow-x-auto p-0">
        <div className="relative" style={{ minWidth: 90 + days * cell }}>
          <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
            <div className="w-[90px] shrink-0 p-2 text-xs font-semibold text-muted">{labels.unit}</div>
            {dates.map((d) => (
              <div key={d} style={{ width: cell }} className={`shrink-0 border-s border-line p-1 text-center text-[11px] ${d === today ? "bg-brand-soft font-bold text-brand" : "text-muted"}`}>
                <div>{dayLabel(d)}</div>
                <div className="opacity-70">{hijriDay(d)}</div>
              </div>
            ))}
          </div>
          {units.map((u) => {
            const rowBars = bars.filter((b) => b.unitId === u.id);
            return (
              <div key={u.id} className="relative flex border-b border-line" style={{ height: 44 }}>
                <div className="num w-[90px] shrink-0 p-2 text-sm font-bold">{u.number}</div>
                {dates.map((d) => (
                  <div
                    key={d}
                    style={{ width: cell }}
                    className={`shrink-0 border-s border-line ${d === today ? "bg-brand-soft/40" : ""} ${drag ? "hover:bg-info-soft" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDrop(u.id, d)}
                  />
                ))}
                {rowBars.map((b) => {
                  const s = b.from < start ? start : b.from;
                  const e = b.to > end ? end : b.to;
                  const offset = nights(start, s);
                  const width = Math.max(nights(s, e), 0);
                  if (width === 0) return null;
                  const movable = b.status !== "checked_out";
                  return (
                    <a
                      key={b.id}
                      href={`/reservations/${b.id}`}
                      draggable={movable}
                      onDragStart={() => setDrag(b)}
                      onDragEnd={() => setDrag(null)}
                      title={`${b.code} · ${b.guest}`}
                      className={`absolute top-1.5 truncate rounded-lg border px-2 py-1 text-xs font-semibold ${BAR_TONE[b.status] ?? ""} ${movable ? "cursor-grab" : ""}`}
                      style={{
                        insetInlineStart: 90 + offset * cell + cell / 2,
                        width: width * cell - 4,
                        height: 30,
                      }}
                    >
                      {b.guest || b.code}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
