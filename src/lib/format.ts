import { intlLocale } from "./i18n/dict";
// Money is stored as integer baisa (1 OMR = 1000 baisa) — NFR-11.

/** Arabic-Indic / Persian digits and the Arabic decimal mark become plain ASCII; spaces, thousands marks and a currency word are dropped. */
export function normalizeAmount(raw: string): string {
  let v = raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/\u066b/g, ".")
    .replace(/(ر\.?\s?ع\.?|ريال|omr)/gi, "")
    .replace(/[\s\u066c\u00a0]/g, "");
  // a lone comma followed by 1–3 digits is a decimal comma ("25,5"); otherwise commas are thousands marks
  if (!v.includes(".") && /^-?\d+,\d{1,3}$/.test(v) && !/^-?\d{1,3},\d{3}$/.test(v)) v = v.replace(",", ".");
  return v.replace(/,/g, "");
}

/** Strict: integer baisa, 0 for an empty field, or null when the text is not a plain amount ("abc", "1.2.3", "25.1234"). */
export function parseBaisa(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 1000) : null;
  const v = normalizeAmount(raw);
  if (v === "") return 0;
  if (!/^-?(\d+(\.\d{0,3})?|\.\d{1,3})$/.test(v)) return null;
  return Math.round(Number(v) * 1000);
}

/** Lenient conversion for display and already-validated input; invalid text counts as 0. */
export function toBaisa(omr: string | number | null | undefined): number {
  return parseBaisa(omr) ?? 0;
}

export function omr(baisa: number | string | null | undefined, lang: "ar" | "en" | "ur" = "ar"): string {
  const v = Number(baisa ?? 0) / 1000;
  const s = new Intl.NumberFormat(lang === "ar" ? "ar-OM" : lang === "ur" ? "ur-PK-u-nu-latn" : "en-OM", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(v);
  return lang === "en" ? `OMR ${s}` : `${s} ر.ع.`;
}

export function plainOmr(baisa: number | string | null | undefined): string {
  return (Number(baisa ?? 0) / 1000).toFixed(3);
}

export function pct(bp: number | null | undefined): string {
  return `${((bp ?? 0) / 100).toFixed(1)}%`;
}

export function gregorian(d: string | Date | null | undefined, lang: "ar" | "en" | "ur" = "ar"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return new Intl.DateTimeFormat(intlLocale(lang), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function hijri(d: string | Date | null | undefined, lang: "ar" | "en" | "ur" = "ar"): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d;
  return new Intl.DateTimeFormat(`${lang === "ar" ? "ar-SA" : lang === "ur" ? "ur-PK" : "en"}-u-ca-islamic-umalqura-nu-latn`, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function dateTime(d: string | null | undefined, tz = "Asia/Muscat", lang: "ar" | "en" | "ur" = "ar"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(intlLocale(lang), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(d));
}

/** Parse a Postgres daterange literal like "[2026-10-14,2026-10-17)". */
export function parseRange(r: string | null | undefined): { from: string; to: string } {
  const m = /^[[(]([^,]*),([^\])]*)[\])]$/.exec(r ?? "");
  return { from: m?.[1] ?? "", to: m?.[2] ?? "" };
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nights(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function todayIn(tz = "Asia/Muscat"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** Start of a local calendar day in the property's timezone, as an ISO instant. */
export function zonedStart(day: string, tz: string): string {
  const utc = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(utc);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asLocal = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"));
  return new Date(utc.getTime() - (asLocal - utc.getTime())).toISOString();
}

/** wa.me click-to-chat link (FR-55). Omani numbers default to +968. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `968${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function csv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens Arabic text as UTF-8
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}
