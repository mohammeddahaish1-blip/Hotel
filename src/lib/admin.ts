import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** System owners' portal guard: signed in and listed in platform_admins, otherwise the page doesn't exist. */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const { data } = await supabase.rpc("my_subscription", { p_tenant: null as unknown as string });
  if ((data as { is_admin?: boolean } | null)?.is_admin !== true) notFound();
  return supabase;
}

export const STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export const STATUS_AR: Record<string, string> = { trial: "تجريبي", active: "فعّال", past_due: "متأخر الدفع", suspended: "موقوف", cancelled: "ملغى" };
export const STATUS_TONE: Record<string, "ok" | "info" | "warn" | "danger" | "gray"> = { trial: "info", active: "ok", past_due: "warn", suspended: "danger", cancelled: "gray" };
export const FEATURE_AR: Record<string, string> = {
  messages: "رسائل النزلاء", automation: "الأتمتة", payment_links: "روابط الدفع", contracts: "العقود الإلكترونية",
  channels: "ربط القنوات", analytics: "التحليلات", import: "الاستيراد", owners: "ملاك الوحدات", assistant: "المساعد الذكي",
  multi_property: "تعدد العقارات",
};
