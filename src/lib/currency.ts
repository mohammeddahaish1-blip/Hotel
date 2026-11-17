/**
 * Subscription currencies. Amounts are stored in whole minor units: the Omani rial in baisa (1/1000),
 * the Saudi riyal and the UAE dirham in halalas / fils (1/100).
 */
export const CURRENCIES = ["OMR", "SAR", "AED"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CUR: Record<Currency, { minor: number; decimals: number; ar: string; en: string; country: string }> = {
  OMR: { minor: 1000, decimals: 3, ar: "ريال عُماني", en: "Omani rial", country: "عُمان" },
  SAR: { minor: 100, decimals: 2, ar: "ريال سعودي", en: "Saudi riyal", country: "السعودية" },
  AED: { minor: 100, decimals: 2, ar: "درهم إماراتي", en: "UAE dirham", country: "الإمارات" },
};

export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);

/** Visitors from Saudi Arabia see riyals, from the UAE dirhams; everyone else sees Omani rials. */
export function currencyForCountry(country: string | null | undefined): Currency {
  const c = (country ?? "").toUpperCase();
  return c === "SA" ? "SAR" : c === "AE" ? "AED" : "OMR";
}

/** "1,234.5" style figure: whole numbers without decimals, anything else with the currency's decimals. */
export function amount(minor: number | null | undefined, cur: Currency, locale = "en-US", always = false): string {
  const v = Number(minor ?? 0) / CUR[cur].minor;
  const whole = Number.isInteger(v) && !always;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: whole ? 0 : CUR[cur].decimals, maximumFractionDigits: CUR[cur].decimals }).format(v);
}

/** Plain number for an input box: "15" or "15.5". */
export const plainAmount = (minor: number | null | undefined, cur: Currency) => (minor == null ? "" : String(Number((Number(minor) / CUR[cur].minor).toFixed(CUR[cur].decimals))));

/** "15.5" typed by a person → minor units, or null when it is not a valid amount for the currency. */
export function parseAmount(v: string | null | undefined, cur: Currency): number | null {
  if (v == null) return null;
  const s = v.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٫,]/g, ".");
  if (!s) return null;
  const re = new RegExp(`^\\d{1,9}(\\.\\d{1,${CUR[cur].decimals}})?$`);
  if (!re.test(s)) return null;
  return Math.round(Number(s) * CUR[cur].minor);
}

export type Rates = { sar_per_omr: number; aed_per_omr: number };
/** Any amount → baisa, at the rates the team set. */
export function toBaisaAt(minor: number, cur: Currency, r: Rates): number {
  if (cur === "OMR") return minor;
  const per = cur === "SAR" ? Number(r.sar_per_omr) : Number(r.aed_per_omr);
  return Math.round((minor * 10) / per);
}
