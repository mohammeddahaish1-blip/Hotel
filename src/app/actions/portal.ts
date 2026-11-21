"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { adminLog, requireAdmin, ROLES } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/currency";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (fd: FormData, k = "id") => (UUID.test(s(fd, k) ?? "") ? s(fd, k)! : "00000000-0000-0000-0000-000000000000");

/** Database refusals in plain words. */
function why(msg: string) {
  if (/not allowed|FORBIDDEN|row-level security|permission denied/i.test(msg)) return "ما عندك صلاحية لهذا.";
  if (/not yourself/.test(msg)) return "ما تقدر توقف حسابك أنت.";
  if (/owner/.test(msg)) return "حساب المالك ما يتأثر من هنا.";
  if (/bad email/.test(msg)) return "البريد غير صحيح.";
  if (/bad times/.test(msg)) return "وقت النهاية لازم يكون بعد وقت البداية.";
  if (/not found/.test(msg)) return "ما لقيناه، يمكن انحذف أو تغيّر.";
  return "تعذّر الحفظ، حاول مرة ثانية.";
}
async function done(error: { message: string } | null, ok = "تم الحفظ"): Promise<ActionResult> {
  if (error) return { error: why(error.message) };
  revalidatePath("/admin", "layout");
  return { ok };
}
const roles = (fd: FormData) => fd.getAll("roles").map(String).filter((r) => (ROLES as readonly string[]).includes(r));

// ---------- team
export async function teamInvite(_: ActionResult, fd: FormData): Promise<ActionResult & { link?: string }> {
  const sb = await requireAdmin("team");
  const email = s(fd, "email");
  const rs = roles(fd);
  if (!email) return { error: "اكتب البريد." };
  if (!rs.length) return { error: "اختر دوراً واحداً على الأقل." };
  const { data, error } = await sb.rpc("admin_invite_staff", { p_email: email, p_roles: rs, p_require_mfa: fd.get("mfa") === "on" });
  if (error) return { error: why(error.message) };
  const h = await headers();
  revalidatePath("/admin/team");
  return { ok: "تم إنشاء الدعوة. انسخ الرابط وأرسله له.", link: `https://${h.get("host") ?? "nuzul-hotel.vercel.app"}/join?token=${data as string}` };
}
export async function teamSetRoles(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("team");
  const rs = roles(fd);
  if (!rs.length) return { error: "اختر دوراً واحداً على الأقل، أو أزل العضو." };
  const { error } = await sb.rpc("admin_set_staff", { p_user: id(fd, "user"), p_roles: rs, p_require_mfa: fd.get("mfa") === "on", p_name: s(fd, "name") as string });
  return done(error);
}
export async function teamSuspend(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin(["team", "security"]);
  const on = s(fd, "active") === "1";
  const { error } = await sb.rpc("admin_suspend_staff", { p_user: id(fd, "user"), p_active: on });
  return done(error, on ? "رجع العضو للبوابة." : "تم إيقاف العضو وقطع جلساته.");
}
export async function teamRemove(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("team");
  const { error } = await sb.rpc("admin_remove_staff", { p_user: id(fd, "user") });
  return done(error, "تمت إزالة العضو.");
}
export async function teamRevokeInvite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("team");
  const { error } = await sb.rpc("admin_revoke_invite", { p_id: id(fd) });
  return done(error, "أُلغيت الدعوة.");
}
/** The owner changes what one role may do in one section. */
export async function teamSetPerm(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("team");
  const role = s(fd, "role"), section = s(fd, "section"), level = s(fd, "level");
  if (!role || !section) return { error: "بيانات ناقصة." };
  const q = level === "view" || level === "edit"
    ? sb.from("platform_role_perms").upsert({ role, section, level })
    : sb.from("platform_role_perms").delete().eq("role", role).eq("section", section);
  const { error } = await q;
  return done(error);
}

/** The invited person, signed in with the invited email, joins the team. */
export async function joinTeam(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("accept_platform_invite", { p_token: s(fd, "token") ?? "" });
  if (error) return { error: "سجّل دخولك أولاً بالبريد اللي وصلته الدعوة." };
  const msg: Record<string, string> = {
    invalid: "الرابط غير صالح أو أُلغي.", used: "هذا الرابط استُخدم من حساب آخر.", expired: "انتهت صلاحية الرابط، اطلب رابطاً جديداً.",
    wrong_email: "أنت داخل بحساب غير البريد اللي وصلته الدعوة. اخرج وادخل بالبريد الصحيح.",
  };
  if (data !== "ok") return { error: msg[data as string] ?? "تعذّر قبول الدعوة." };
  return { ok: "انضممت للفريق." };
}

// ---------- security
export async function securityKillSession(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("security");
  const { error } = await sb.rpc("admin_kill_session", { p_id: id(fd) });
  return done(error, "انتهت الجلسة.");
}
export async function securityKillOthers(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("security");
  const ids = fd.getAll("ids").map(String).filter((x) => UUID.test(x));
  for (const x of ids) {
    const { error } = await sb.rpc("admin_kill_session", { p_id: x });
    if (error && !/owner/.test(error.message)) return { error: why(error.message) };
  }
  return done(null, "انتهت الجلسات الأخرى.");
}
export async function securitySave(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("security");
  const h = Number(s(fd, "hours"));
  if (!Number.isInteger(h) || h < 1 || h > 168) return { error: "مدة الجلسة: من 1 إلى 168 ساعة." };
  const { error } = await sb.rpc("admin_save_security", { p_session_hours: h });
  return done(error);
}

// ---------- IT
export async function itSaveOps(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("it");
  const when = (k: string) => {
    const v = s(fd, k);
    return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+04:00` : null; // entered in Muscat time
  };
  const { error } = await sb.rpc("admin_save_ops", { p_on: fd.get("on") === "on", p_msg: s(fd, "msg") as string, p_from: when("from") as string, p_to: when("to") as string });
  return done(error);
}

// ---------- CEO
export async function ceoDecide(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("ceo");
  const ok = s(fd, "ok") === "1";
  const { error } = await sb.rpc("admin_decide_approval", { p_id: id(fd), p_ok: ok, p_note: s(fd, "note") as string });
  return done(error, ok ? "تمت الموافقة وطُبّق التغيير." : "تم الرفض.");
}
export async function ceoAddDecision(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("ceo");
  const title = s(fd, "title");
  if (!title || title.length < 2) return { error: "اكتب القرار." };
  const { data: c } = await sb.auth.getClaims();
  const { error } = await sb.from("platform_decisions").insert({ title, reason: s(fd, "reason"), decided_on: s(fd, "on") ?? undefined, created_by: c?.claims?.sub });
  if (!error) await adminLog(sb, "decision", null, title);
  return done(error, "تم تسجيل القرار.");
}
export async function ceoDropDecision(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("ceo");
  const { error } = await sb.from("platform_decisions").delete().eq("id", id(fd));
  return done(error, "حُذف.");
}
export async function ceoSaveGoals(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("ceo");
  const month = s(fd, "month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { error: "الشهر غير صحيح." };
  const rows: { month: string; metric: string; target: number }[] = [];
  const drop: string[] = [];
  for (const m of ["new_paying", "new_trials", "conversion"]) {
    const v = s(fd, m);
    if (!v) { drop.push(m); continue; }
    const n = Number(v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    if (!Number.isFinite(n) || n <= 0) return { error: "الأهداف أرقام أكبر من صفر." };
    rows.push({ month: `${month}-01`, metric: m, target: n });
  }
  const mrr = s(fd, "mrr");
  if (mrr) {
    const v = parseAmount(mrr, "OMR");
    if (!v) return { error: "هدف الدخل: رقم بالريال العُماني." };
    rows.push({ month: `${month}-01`, metric: "mrr", target: v });
  } else drop.push("mrr");
  if (rows.length) {
    const { error } = await sb.from("platform_goals").upsert(rows);
    if (error) return { error: why(error.message) };
  }
  if (drop.length) await sb.from("platform_goals").delete().eq("month", `${month}-01`).in("metric", drop);
  await adminLog(sb, "goals", null, month);
  return done(null);
}
/** Discount and expense limits above which a member needs the CEO's approval (owner/CEO only). */
export async function ceoSaveLimits(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("ceo");
  const d = Number(s(fd, "discount"));
  const e = parseAmount(s(fd, "expense"), "OMR");
  if (!Number.isInteger(d) || d < 0 || d > 100) return { error: "حد الخصم: من 0 إلى 100%." };
  if (e == null) return { error: "حد المصروف: رقم بالريال العُماني." };
  const { error } = await sb.rpc("admin_save_limits", { p_discount: d, p_expense: e });
  if (!error) await adminLog(sb, "limits", null, `${d}% · ${s(fd, "expense")} ر.ع`);
  return done(error);
}

// ---------- marketing
export async function leadStage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin("marketing");
  const stage = s(fd, "stage");
  const source = s(fd, "source");
  if (!stage || !["new", "contacted", "demo", "trial", "won", "lost"].includes(stage)) return { error: "اختر المرحلة." };
  const patch: Record<string, unknown> = { stage, stage_at: new Date().toISOString(), lost_reason: stage === "lost" ? s(fd, "lost_reason") : null };
  if (source && ["instagram", "referral", "search", "direct", "other"].includes(source)) patch.source = source;
  if (stage !== "new") patch.handled_at = new Date().toISOString();
  const { error } = await sb.from("trial_requests").update(patch).eq("id", id(fd));
  if (!error) await adminLog(sb, "lead_stage", null, `${s(fd, "name") ?? ""} · ${stage}`);
  return done(error);
}
