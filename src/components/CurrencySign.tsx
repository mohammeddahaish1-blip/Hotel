import type { Currency } from "@/lib/currency";

/**
 * The official signs of the Omani rial, the Saudi riyal and the UAE dirham, drawn as small pictures: they are
 * new to Unicode and most phones and fonts cannot show them as text yet. They take the colour of the text
 * around them and are read out by name.
 */
export function CurrencySign({ cur, className = "" }: { cur: Currency; className?: string }) {
  const label = cur === "OMR" ? "ريال عُماني" : cur === "SAR" ? "ريال سعودي" : "درهم إماراتي";
  const cls = `inline-block h-[0.85em] w-[0.85em] shrink-0 align-[-0.06em] ${className}`;
  if (cur === "OMR") {
    // traced from the official sign: the letter ع over two slanted bars (a wide sign)
    return (
      <svg viewBox="-10 0 605 360" className={`inline-block h-[0.8em] w-[1.35em] shrink-0 align-[-0.08em] ${className}`} role="img" aria-label={label} fill="currentColor">
        <path d="M75 178H585L548 238H45ZM30 272H520L490 335H0ZM232 238C226 252 224 262 228 272H420L330 238ZM205 178C196 140 206 98 238 66C262 42 292 28 322 28C348 28 368 40 380 58C372 92 362 126 352 160C344 132 330 112 304 104C278 98 252 106 238 124C226 140 224 160 232 178Z" />
      </svg>
    );
  }
  if (cur === "SAR") {
    // traced from the official sign
    return (
      <svg viewBox="192.5 25.5 210 210" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M334 40L327 42L315 57L316 120L299 128L293 128L289 121L289 29L273 40L272 129L260 136L221 144L215 160L222 163L268 155L271 157L271 182L265 187L209 198L205 210L207 218L270 204L289 179L290 150L293 147L311 144L315 148L318 187L385 174L389 162L387 154L344 164L335 161L335 141L338 138L382 130L390 112L383 109L344 119L335 114ZM389 200L325 213L318 222L317 232L383 220Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className={cls} role="img" aria-label={label} fill="currentColor" fillRule="evenodd">
      <path d="M24 10h26c27 0 44 16 44 40S77 90 50 90H24zm13 12v56h12c19 0 31-11 31-28S68 22 49 22z" />
      <path d="M4 38c4 0 6 2 10 2h84v8H14c-4 0-6-2-10-2zM4 54c4 0 6 2 10 2h84v8H14c-4 0-6-2-10-2z" />
    </svg>
  );
}

/** A price: the figure with its currency sign beside it. */
export function Money({ value, cur, className = "", signClass = "" }: { value: string; cur: Currency; className?: string; signClass?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[0.22em] whitespace-nowrap ${className}`}>
      <span className="num">{value}</span>
      <CurrencySign cur={cur} className={signClass} />
    </span>
  );
}
