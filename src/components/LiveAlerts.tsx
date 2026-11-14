"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// tables behind the event-driven alerts (cleaning, maintenance, complaints, payment proofs,
// corrections, cheques, channel sync, staff notices); each user only hears rows they may read
const BY_PROPERTY = ["hk_tasks", "maintenance_tickets", "feedback", "payment_links", "correction_requests", "cheques", "channel_blocks", "ical_feeds", "staff_notices"];
const BY_TENANT = ["staff_complaints"];

/**
 * Keeps the alerts bell current without a reload: when one of those rows changes, the page data
 * is fetched again in place. A burst of changes (a channel sync touching many rows) causes one
 * refresh. If the live connection is unavailable, it still catches up when the tab is shown
 * again and once a minute while it is open.
 */
export function LiveAlerts({ propertyId, tenantId }: { propertyId: string; tenantId: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let wait: number | undefined;
    let first = 0;
    const refresh = () => {
      wait = undefined;
      first = 0;
      if (!document.hidden) router.refresh();
    };
    // wait for the changes to settle (1.5 s of quiet), but never longer than 5 s
    const changed = () => {
      const now = Date.now();
      if (!first) first = now;
      window.clearTimeout(wait);
      wait = window.setTimeout(refresh, Math.max(0, Math.min(1500, first + 5000 - now)));
    };
    let channel = supabase.channel(`alerts-${propertyId}`);
    for (const table of BY_PROPERTY) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `property_id=eq.${propertyId}` }, changed);
    }
    for (const table of BY_TENANT) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` }, changed);
    }
    channel.subscribe();
    const onShow = () => { if (!document.hidden) changed(); };
    document.addEventListener("visibilitychange", onShow);
    const timer = window.setInterval(changed, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
      window.clearTimeout(wait);
      void supabase.removeChannel(channel);
    };
  }, [propertyId, tenantId, router]);
  return null;
}
