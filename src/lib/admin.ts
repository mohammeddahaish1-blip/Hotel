import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { amount, CUR, type Currency } from "./currency";

export const SECTIONS = ["ceo", "companies", "plans", "finance", "marketing", "it", "security", "support", "team", "log"] as const;
export type Section = (typeof SECTIONS)[number];
export type PortalMe = {
  owner: boolean; staff: boolean; active: boolean; ok: boolean; roles: string[]; mfa_needed: boolean;
  perms: Partial<Record<Section, "view" | "edit">>;
};
export const ROLES = ["ceo", "finance", "marketing", "it", "security", "support"] as const;
export const ROLE_AR: Record<string, string> = { owner: "المالك", ceo: "المدير التنفيذي", finance: "المالية", marketing: "التسويق", it: "التقنية", security: "الأمن السيبراني", support: "الدعم" };
export const SECTION_AR: Record<Section, string> = {
  ceo: "لوحة القرار والأهداف", companies: "الشركات والاشتراكات", plans: "الباقات والأسعار والعروض", finance: "المالية والمصروفات",
  marketing: "التسويق والعملاء", it: "التقنية ووضع الصيانة", security: "الأمن وقفل الحسابات", support: "الدعم والتذاكر", team: "الفريق والصلاحيات", log: "السجل",
};
/** Where each section lives; a member opens the first one they may see. */
export const SECTION_HREF: Record<Section, string> = {
  ceo: "/admin", companies: "/admin/companies", marketing: "/admin/marketing", finance: "/admin/finance", plans: "/admin/plans",
  it: "/admin/it", security: "/admin/security", support: "/admin/support", team: "/admin/team", log: "/admin/log",
};

export function can(me: PortalMe, section: Section, need: "view" | "edit" = "view") {
  const lv = me.perms[section];
  return need === "view" ? !!lv : lv === "edit";
}

/** Who is signed in to the portal and what they may see (once per request). */
export const portalMe = cache(async () => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login?next=/admin");
  const { data } = await supabase.rpc("portal_me");
  return { supabase, me: (data ?? { owner: false, staff: false, active: false, ok: false, roles: [], mfa_needed: false, perms: {} }) as PortalMe };
});

/**
 * Owners' portal guard: the owner, or a team member in good standing. A member who still needs two-step
 * verification goes to set it up; a stopped member or an expired session sees why. Anyone else: the page doesn't exist.
 * With a section, the member must be allowed to see it.
 */
export async function requireAdmin(section?: Section | Section[]) {
  const { supabase, me } = await portalMe();
  if (!me.ok) {
    if (me.staff && me.active && me.mfa_needed) redirect("/mfa?next=/admin");
    if (me.staff) redirect(`/portal-blocked?why=${me.active ? "expired" : "stopped"}`);
    notFound();
  }
  if (section) {
    const list = Array.isArray(section) ? section : [section];
    if (!list.some((x) => can(me, x))) notFound();
  }
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
  staff_invite: "دعا عضواً للفريق", staff_join: "انضم للفريق", staff_roles: "عدّل أدوار عضو", staff_suspend: "أوقف عضواً", staff_resume: "أعاد عضواً",
  staff_remove: "أزال عضواً", session_end: "أنهى جلسة", security: "عدّل سياسة الأمان", approval_ok: "وافق على طلب", approval_no: "رفض طلباً",
  approval_ask: "طلب موافقة", decision: "سجّل قراراً", goals: "عدّل الأهداف", lead_stage: "حدّث مرحلة عميل", limits: "عدّل حدود الموافقة",
};
