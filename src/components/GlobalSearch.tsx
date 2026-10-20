"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { globalSearch, type SearchHit } from "@/app/actions/quick";

type Labels = { placeholder: string; none: string; unit: string; reservation: string; guest: string };

/** One search box for guests, bookings and rooms. "/" focuses it from anywhere. */
export function GlobalSearch({ labels }: { labels: Labels }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    // short queries show nothing (the dropdown only renders from 2 characters)
    if (q.trim().length < 2) return;
    const id = setTimeout(() => {
      startTransition(async () => {
        setHits(await globalSearch(q));
        setActive(0);
      });
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };
  const kindLabel = { unit: labels.unit, reservation: labels.reservation, guest: labels.guest };

  return (
    <div ref={box} className="relative w-full max-w-md">
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && hits[active]) go(hits[active]);
          else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
        placeholder={labels.placeholder}
        autoComplete="off"
        className="input py-2 pe-10"
        aria-label={labels.placeholder}
      />
      <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-muted sm:block">/</kbd>
      {open && q.trim().length >= 2 ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          {pending && !hits.length ? <div className="px-3 py-2 text-sm text-muted">…</div> : null}
          {!pending && !hits.length ? <div className="px-3 py-2 text-sm text-muted">{labels.none}</div> : null}
          <ul>
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm ${i === active ? "bg-brand-soft" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{h.title}</span>
                    {h.subtitle ? <span dir="auto" className="block truncate text-xs text-muted">{h.subtitle}</span> : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-gray-soft px-2 py-0.5 text-[10px] text-muted">{kindLabel[h.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
