"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, PRIORITY, byIso2, byIso3, flag, splitInternational, type Country } from "@/lib/countries";

type Lang = "ar" | "en" | "ur" | "bn";

/** Arabic-Indic and Persian digits typed on an Arabic keyboard become 0-9. */
const ascii = (v: string) =>
  v.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
type Labels = { search: string; none: string; country: string };

/**
 * Phone number with a country picker (flag + dialling code), so nobody has to know their code.
 * Gives the number in international form, e.g. +96891234567; a leading trunk 0 ("050…") is dropped.
 * Typing a full number with + or 00 switches the country by itself. With `name`, a hidden input
 * carries the value for ordinary forms.
 */
export function PhoneInput({
  value, defaultValue, onChange, name, lang, labels, nationality, label, defaultCountry = "OM",
}: {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (v: string) => void;
  name?: string;
  lang?: Lang;
  labels: Labels;
  nationality?: string | null;
  label?: string;
  defaultCountry?: string;
}) {
  const lng: Lang = lang ?? ((typeof document !== "undefined" && ["ar", "en", "ur"].includes(document.documentElement.lang) ? document.documentElement.lang : "ar") as Lang);
  const initial = value ?? defaultValue ?? "";
  const parsed = /^(\+|00)\d/.test(initial) ? splitInternational(initial) : null;
  // chosen: picked by hand or fixed by typing; until then the guest's nationality decides, then Oman
  const [chosen, setChosen] = useState<Country | null>(parsed?.country ?? null);
  const country: Country = chosen ?? byIso3(nationality) ?? byIso2(defaultCountry)!;
  const setCountry = setChosen;
  const [national, setNational] = useState(parsed ? parsed.national : initial);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const full = (c: Country, n: string) => {
    const clean = ascii(n).replace(/[\s\-().]/g, "");
    if (!clean) return "";
    return `+${c.dial}${c.iso2 === "IT" ? clean : clean.replace(/^0+/, "")}`;
  };
  const emit = (c: Country, n: string) => onChange?.(full(c, n));

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const list = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    let en: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([lng], { type: "region" }); en = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old browser: codes only */ }
    const rows = COUNTRIES.map((c) => ({ ...c, name: names?.of(c.iso2) ?? c.iso2, en: en?.of(c.iso2) ?? c.iso2 }));
    const top = PRIORITY.map((i) => rows.find((r) => r.iso2 === i)!).filter(Boolean);
    const rest = rows.filter((r) => !PRIORITY.includes(r.iso2)).sort((a, b) => a.name.localeCompare(b.name, lng));
    return [...top, ...rest];
  }, [lng]);

  const term = q.trim().toLowerCase().replace(/^\+|^00/, "");
  const shown = term
    ? list.filter((c) => c.name.toLowerCase().includes(term) || c.en.toLowerCase().includes(term) || c.dial.startsWith(term) || c.iso2.toLowerCase() === term)
    : list;

  const pick = (c: Country) => {
    setCountry(c);
    setOpen(false);
    setQ("");
    emit(c, national);
  };

  return (
    <div ref={box} className="relative" dir="ltr">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={labels.country}
          className="input flex w-auto shrink-0 items-center gap-1 px-2.5"
        >
          <span aria-hidden className="text-lg leading-none">{flag(country.iso2)}</span>
          <span className="num text-sm">+{country.dial}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
        </button>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          aria-label={label}
          placeholder={country.iso2 === "OM" ? "9123 4567" : ""}
          onChange={(e) => {
            const v = ascii(e.target.value);
            const intl = /^(\+|00)\d{2,}/.test(v.trim()) ? splitInternational(v.trim().replace(/[\s\-().]/g, "")) : null;
            if (intl) { setCountry(intl.country); setNational(intl.national); emit(intl.country, intl.national); }
            else { if (!chosen && v.trim()) setChosen(country); setNational(v); emit(country, v); }
          }}
          className="input min-w-0 flex-1"
        />
      </div>
      {name ? <input type="hidden" name={name} value={full(country, national)} /> : null}

      {open ? (
        <>
          <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/25 sm:hidden" />
          <div
            dir={lng === "en" ? "ltr" : "rtl"}
            className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-line bg-surface p-2 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:start-0 sm:top-full sm:mt-1 sm:w-80"
          >
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.search} aria-label={labels.search} className="input ps-9" />
            </label>
            <ul role="listbox" aria-label={labels.country} className="max-h-[50vh] overflow-y-auto sm:max-h-72">
              {shown.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{labels.none}</li> : null}
              {shown.map((c, i) => (
                <li key={c.iso2}>
                  {!term && i === PRIORITY.length ? <div className="my-1 border-t border-line" /> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.iso2 === country.iso2}
                    onClick={() => pick(c)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-2 ${c.iso2 === country.iso2 ? "bg-brand-soft text-brand" : ""}`}
                  >
                    <span aria-hidden className="text-lg leading-none">{flag(c.iso2)}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span dir="ltr" className="num text-xs text-muted">+{c.dial}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
