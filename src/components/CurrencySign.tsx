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
    return (
      <svg viewBox="0 0 100 100" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M74 6c-6-2-13-3-19-2C39 6 30 16 31 28c1 11 11 18 24 18h3l-5 9h12l7-13c2-4-1-8-5-8H54c-7 0-12-3-12-8 0-6 6-11 15-11 5 0 10 1 14 3z" />
        <path d="M22 60h64l-7 12H15z" />
        <path d="M8 80h86l-7 12H1z" />
      </svg>
    );
  }
  if (cur === "SAR") {
    return (
      <svg viewBox="0 0 100 100" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M41 4l11-3v66l-11 3z" />
        <path d="M63 14l11-3v44l-11 3z" />
        <path d="M18 56l11-3v20l38-8v11L18 87z" />
        <path d="M82 42l11-3v40c0 9-6 15-15 17l-6 1V86l4-1c4-1 6-3 6-7z" />
        <path d="M10 49l83-18v11L10 60z" />
        <path d="M10 68l57-12v11L10 79z" />
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
