import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { amount, CUR, type Currency } from "./currency";

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

export type AdminRow = {
  id: string; name: string; created_at: string; owner_name: string | null; owner_email: string | null;
  properties: number; units: number; staff: number; bookings_30d: number; last_activity: string | null;
  plan_code: string | null; plan_name: string | null; status: string | null; trial_ends_at: string | null; current_period_end: string | null;
  notes: string | null; price: number | null; price_override: number | null; last_paid_on: string | null;
  /** "month" or "year"; price is per that period in the company's currency, price_omr the same in baisa */
  billing_period: "month" | "year" | null; currency: Currency | null; price_omr: number | null;
};

/** What a company brings in per month, in baisa (a yearly price spread over twelve months). */
export const monthlyBaisa = (r: AdminRow) => (r.price_omr == null ? 0 : r.billing_period === "year" ? Math.round(r.price_omr / 12) : r.price_omr);
/** What a company brings in per year, in baisa. */
export const yearlyBaisa = (r: AdminRow) => (r.price_omr == null ? 0 : r.billing_period === "year" ? r.price_omr : r.price_omr * 12);
/** Its price as words for a message ("30 ريال عُماني شهرياً"). */
export const priceWords = (r: AdminRow) =>
  r.price == null ? "" : `${amount(r.price, r.currency ?? "OMR")} ${CUR[r.currency ?? "OMR"].ar} ${r.billing_period === "year" ? "سنوياً" : "شهرياً"}`;
/** Paying companies: the ones whose money counts in the expected income. */
export const paying = (r: AdminRow) => r.status === "active" || r.status === "past_due";

const DAY = 86_400_000;
export const todayIso = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Muscat
export const daysTo = (d: string | null) => (d ? Math.round((Date.parse(d) - Date.parse(todayIso())) / DAY) : null);

/** Why a company needs the team's attention today, or null when it does not. */
export function attention(r: AdminRow): { tone: "danger" | "warn"; text: string } | null {
  if (r.status === "suspended") return { tone: "danger", text: "الاشتراك موقوف" };
  if (r.status === "past_due") return { tone: "danger", text: "متأخر في الدفع" };
  if (r.status === "trial") {
    const n = daysTo(r.trial_ends_at);
    if (n !== null && n < 0) return { tone: "danger", text: `انتهت التجربة منذ ${-n} يوم` };
    if (n !== null && n <= 7) return { tone: "warn", text: n === 0 ? "التجربة تنتهي اليوم" : `التجربة تنتهي خلال ${n} يوم` };
  }
  if (r.status === "active") {
    const n = daysTo(r.current_period_end);
    if (n !== null && n < 0) return { tone: "danger", text: `انتهى المدفوع منذ ${-n} يوم` };
    if (n !== null && n <= 7) return { tone: "warn", text: n === 0 ? "المدفوع ينتهي اليوم" : `المدفوع ينتهي خلال ${n} يوم` };
  }
  return null;
}

/** Ready-made reminder for the owner, opened in the team member's own mail or WhatsApp. */
export function reminderLinks(r: AdminRow, price: string, date: string) {
  const text = `السلام عليكم${r.owner_name ? ` ${r.owner_name.split("،")[0]}` : ""}،\nنذكّركم بأن اشتراك «${r.name}» في نُزُل ${r.status === "trial" ? "التجريبي ينتهي" : "مدفوع حتى"} ${date}.${r.price != null ? ` قيمة الاشتراك ${price}.` : ""}\nنسعد بخدمتكم، وشكراً لكم.`;
  const mail = (r.owner_email ?? "").split(",")[0].trim();
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    mail: mail ? `mailto:${mail}?subject=${encodeURIComponent("تذكير اشتراك نُزُل")}&body=${encodeURIComponent(text)}` : null,
  };
}

/** One line in the portal's own log (who changed what); never blocks the action it records. */
export async function adminLog(sb: Awaited<ReturnType<typeof createClient>>, action: string, tenant: string | null, detail?: string | null) {
  await sb.from("admin_log").insert({ action, tenant_id: tenant, detail: detail ? detail.slice(0, 500) : null });
}
export const ACTION_AR: Record<string, string> = {
  subscription: "عدّل الاشتراك", payment: "سجّل دفعة", payment_void: "ألغى دفعة", plan: "حفظ باقة",
  suspend: "أوقف الاشتراك", resume: "أعاد تفعيل الاشتراك", prospect_add: "أضاف شركة متوقعة", prospect_drop: "حذف شركة متوقعة",
  prospect_apply: "طبّق باقة شركة جديدة", maintenance: "جدول صيانة", prices: "عدّل الأسعار والعروض", expense_add: "أضاف مصروفاً", expense_drop: "حذف مصروفاً", rates: "عدّل أسعار الصرف", trial_sent: "أرسل رابط تجربة", trial_extend: "مدّد رابط تجربة", trial_drop: "حذف طلب تجربة",
};
