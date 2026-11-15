"use client";

import { useLayoutEffect, useRef, useState } from "react";

const NUMBER = /[\d٠-٩][\d٠-٩.,٫٬]*/;

/**
 * A figure that counts up to its value when it first appears. The server sends the finished text, so the
 * number is right without JavaScript and for people who asked for less motion; only the digits are animated.
 */
export function CountUp({ text, value, locale, decimals = 0, ms = 800 }: { text: string; value: number; locale: string; decimals?: number; ms?: number }) {
  const [shown, setShown] = useState(text);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current) { setShown(text); return; }
    done.current = true;
    if (!value || !NUMBER.test(text) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(text); return; }
    const fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const target = Math.abs(value);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      if (p >= 1) { setShown(text); return; }
      setShown(text.replace(NUMBER, fmt.format(target * eased)));
      raf = requestAnimationFrame(tick);
    };
    setShown(text.replace(NUMBER, fmt.format(0)));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, value, locale, decimals, ms]);
  return <span aria-label={text}><span aria-hidden>{shown}</span></span>;
}
