"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** NFR-02: end sessions on shared reception iPads after inactivity. */
export function IdleLogout({ minutes }: { minutes: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await createClient().auth.signOut();
        window.location.replace("/login?reason=idle"); // full reload clears in-memory state
      }, minutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes]);
  return null;
}
