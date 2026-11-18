"use client";

import { useEffect } from "react";

const NAVS = 'nav[class~="bg-gray-soft"], [data-seg]';

/**
 * Makes the white pill of every tab bar slide from the tab you left to the tab you opened. The bars are drawn
 * by the server and replaced on each page, so the last position is remembered here and the pill starts from it.
 * Without JavaScript, or with reduced motion, the bars look exactly as the server drew them.
 */
export function TabGlide() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const last = new Map<string, { x: number; y: number; w: number; h: number }>();
    let queued = false;
    const sync = () => {
      queued = false;
      document.querySelectorAll<HTMLElement>(NAVS).forEach((nav, i) => {
        const active = nav.querySelector<HTMLElement>(':scope > [aria-current], :scope > [aria-pressed="true"]');
        if (!active) return;
        const key = nav.getAttribute("aria-label") ?? `tabs-${i}`;
        const to = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
        let pill = nav.querySelector<HTMLElement>(":scope > .tab-pill");
        const place = (r: typeof to) => {
          pill!.style.transform = `translate(${r.x}px, ${r.y}px)`;
          pill!.style.width = `${r.w}px`;
          pill!.style.height = `${r.h}px`;
        };
        if (!pill) {
          pill = document.createElement("span");
          pill.className = "tab-pill";
          pill.setAttribute("aria-hidden", "true");
          nav.classList.add("tabs-glide");
          nav.prepend(pill);
          const from = last.get(key);
          if (from && (from.x !== to.x || from.w !== to.w)) {
            pill.style.transition = "none";
            place(from);
            void pill.offsetWidth; // start from where the pill was on the page before
            pill.style.transition = "";
          }
        }
        place(to);
        last.set(key, to);
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-current"] });
    window.addEventListener("resize", queue);
    queue();
    return () => { mo.disconnect(); window.removeEventListener("resize", queue); };
  }, []);
  return null;
}
