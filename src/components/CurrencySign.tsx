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
      <svg viewBox="-4 20 715 379" className={`inline-block h-[0.75em] w-[1.42em] shrink-0 align-[-0.06em] ${className}`} role="img" aria-label={label} fill="currentColor">
        <path d="M702.3 207.0L314.7 206.7L310.7 205.7L291.0 183.7L281.0 165.7L279.7 159.0L281.0 149.0L284.7 142.7L291.3 136.0L305.0 128.0L322.3 124.7L340.0 125.7L356.0 130.0L376.3 140.0L396.3 154.0L412.3 168.0L436.3 192.7L464.3 88.0L464.3 84.3L444.3 65.7L429.7 54.3L410.0 42.3L391.7 34.3L369.7 28.3L345.0 28.3L325.3 36.0L309.7 48.3L291.3 71.3L275.7 97.7L265.3 121.0L257.3 147.0L253.3 167.7L251.0 204.3L249.7 206.3L119.7 206.7L77.3 278.0L77.7 279.3L276.0 279.7L280.7 283.7L307.0 317.0L306.0 318.0L46.3 318.0L41.3 324.7L3.3 390.7L585.3 391.3L588.7 387.7L628.3 320.0L627.7 318.0L491.3 317.7L469.0 311.3L450.7 304.0L425.7 291.7L407.3 280.7L408.3 279.7L659.7 279.7L702.3 208.7Z" />
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
