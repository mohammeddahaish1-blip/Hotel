"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Fades its content up the first time it scrolls into view (plain content when motion is reduced or JS is off). */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { el.classList.add("lp-in"); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("lp-in"); io.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`lp-reveal ${className}`} style={{ ["--d" as string]: `${delay}ms` }}>{children}</div>;
}
