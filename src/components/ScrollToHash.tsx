"use client";

import { useEffect } from "react";

/**
 * Pages that stream in after a loading skeleton miss the browser's jump to "#section".
 * Rendered inside the page, this scrolls to it once the content is actually there.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return null;
}
