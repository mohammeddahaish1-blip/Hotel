"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the alerts bell current without a reload: when a housekeeping task of this property
 * changes (a unit marked ready, a task started …) the page data is fetched again in place.
 * If the live connection is unavailable, it still catches up when the tab is shown again
 * and once a minute while it is open.
 */
export function LiveAlerts({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let last = 0;
    // several changes at once (or a slow page) cause one refresh, not a burst
    const refresh = () => {
      if (document.hidden || Date.now() - last < 2000) return;
      last = Date.now();
      router.refresh();
    };
    const channel = supabase
      .channel(`hk-${propertyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hk_tasks", filter: `property_id=eq.${propertyId}` }, refresh)
      .subscribe();
    const onShow = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onShow);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [propertyId, router]);
  return null;
}
