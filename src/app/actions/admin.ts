"use server";

import { revalidatePath } from "next/cache";
import { adminLog, requireAdmin, todayIso, STATUS_AR, type AdminRow } from "@/lib/admin";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { parseBaisa } from "@/lib/format";
import { moneyError } from "@/lib/money";
import { FEATURES } from "@/lib/plan";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const int = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

async function done(error: { message: string } | null, paths: string[]): Promise<ActionResult> {
  const { t } = await getDict();
  if (error) return { error: errorMessage(t, error) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}

export async function adminSetSubscription(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const bad = await moneyError(fd, { price_override: "min0" });
  if (bad) return bad;
  const tenant = s(fd, "tenant")!;
  const { error } = await sb.rpc("admin_set_subscription", {
    p_tenant: tenant, p_plan: s(fd, "plan")!, p_status: s(fd, "status")!,
    p_period_end: date(s(fd, "period_end")) as string, p_trial_ends: date(s(fd, "trial_ends")) as string,
    p_price_override: s(fd, "price_override") ? parseBaisa(s(fd, "price_override")) as number : (null as unknown as number),
    p_notes: s(fd, "notes") as string,
  });
  if (!error) await adminLog(sb, "subscription", tenant, `${s(fd, "plan")} · ${STATUS_AR[s(fd, "status") ?? ""] ?? s(fd, "status")}`);
  return done(error, ["/admin", `/admin/${tenant}`]);
}

export async function adminRecordPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const bad = await moneyError(fd, { amount: "pos" });
  if (bad) return bad;
  const tenant = s(fd, "tenant")!;
  const { error } = await sb.rpc("admin_record_payment", {
    p_tenant: tenant, p_amount: parseBaisa(s(fd, "amount")) as number, p_months: int(s(fd, "months")) ?? 1,
    p_method: s(fd, "method") as string, p_reference: s(fd, "reference") as string, p_paid_on: date(s(fd, "paid_on")) as string,
  });
  if (!error) await adminLog(sb, "payment", tenant, `${s(fd, "amount")} ر.ع. · ${int(s(fd, "months")) ?? 1} شهر`);
  return done(error, ["/admin", `/admin/${tenant}`, "/admin/payments"]);
}

export async function adminVoidPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.rpc("admin_void_payment", { p_id: s(fd, "id")! });
  if (!error) await adminLog(sb, "payment_void", s(fd, "tenant"), null);
  return done(error, ["/admin", `/admin/${s(fd, "tenant")}`, "/admin/payments"]);
}

export async function adminSavePlan(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const bad = await moneyError(fd, { price: "min0" });
  if (bad) return bad;
  const code = (s(fd, "code") ?? "").toLowerCase();
  if (!/^[a-z0-9_]{2,30}$/.test(code)) return { error: "رمز الباقة: حروف إنجليزية صغيرة وأرقام فقط، مثل gold" };
  if (!s(fd, "name_ar")) return { error: "اكتب اسم الباقة." };
  const features = fd.getAll("features").map(String).filter((f) => (FEATURES as readonly string[]).includes(f));
  const { error } = await sb.rpc("admin_save_plan", {
    p_code: code, p_name_ar: s(fd, "name_ar")!, p_name_en: s(fd, "name_en") ?? "", p_price: parseBaisa(s(fd, "price")) ?? 0,
    p_max_units: int(s(fd, "max_units")) as number, p_max_properties: int(s(fd, "max_properties")) as number,
    p_features: features, p_active: fd.get("active") === "on", p_sort: int(s(fd, "sort")) ?? 0,
  });
  if (!error) await adminLog(sb, "plan", null, code);
  return done(error, ["/admin", "/admin/plans", "/upgrade"]);
}

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

/** Stopping a subscription locks a whole hotel out: its own button, with a reason, never a dropdown choice. */
async function setStatus(fd: FormData, status: "suspended" | "active"): Promise<ActionResult> {
  const sb = await requireAdmin();
  const tenant = uuid(s(fd, "tenant"));
  const reason = s(fd, "reason");
  if (!tenant) return { error: "شركة غير معروفة." };
  if (status === "suspended" && (!reason || reason.length < 3)) return { error: "اكتب سبب الإيقاف." };
  const { data } = await sb.rpc("admin_overview");
  const r = ((data ?? []) as AdminRow[]).find((x) => x.id === tenant);
  if (!r?.plan_code) return { error: "لا يوجد اشتراك لهذه الشركة." };
  const { error } = await sb.rpc("admin_set_subscription", {
    p_tenant: tenant, p_plan: r.plan_code, p_status: status,
    p_period_end: r.current_period_end as string, p_trial_ends: r.trial_ends_at as string,
    p_price_override: r.price_override as number,
    p_notes: (status === "suspended" ? `موقوف: ${reason}` : r.notes) as string,
  });
  if (!error) await adminLog(sb, status === "suspended" ? "suspend" : "resume", tenant, reason);
  return done(error, ["/admin", `/admin/${tenant}`]);
}
export async function adminSuspend(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return setStatus(fd, "suspended");
}
export async function adminResume(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return setStatus(fd, "active");
}

/** A company the team expects to sign up: noted now, given its plan once the owner registers. */
export async function adminAddProspect(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const company = s(fd, "company");
  const email = (s(fd, "email") ?? "").toLowerCase();
  if (!company) return { error: "اكتب اسم الشركة." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "اكتب بريد المالك بشكل صحيح." };
  const days = int(s(fd, "trial_days")) ?? 14;
  if (days > 365) return { error: "مدة التجربة حتى 365 يوماً." };
  const { error } = await sb.from("admin_prospects").insert({
    company, email, phone: s(fd, "phone"), plan_code: s(fd, "plan"), trial_days: days, notes: s(fd, "notes"),
  });
  if (!error) await adminLog(sb, "prospect_add", null, company);
  return done(error, ["/admin"]);
}

export async function adminDropProspect(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.from("admin_prospects").delete().eq("id", uuid(s(fd, "id")) ?? "");
  if (!error) await adminLog(sb, "prospect_drop", null, s(fd, "company"));
  return done(error, ["/admin"]);
}

/** The owner has registered: give the new company the plan and trial that were agreed. */
export async function adminApplyProspect(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const id = uuid(s(fd, "id"));
  const tenant = uuid(s(fd, "tenant"));
  if (!id || !tenant) return { error: "بيانات ناقصة." };
  const { data: pr } = await sb.from("admin_prospects").select("company, plan_code, trial_days, notes").eq("id", id).maybeSingle();
  if (!pr) return { error: "لم نجد هذه الشركة في القائمة." };
  const ends = new Date(Date.parse(todayIso()) + Number(pr.trial_days) * 86_400_000).toISOString().slice(0, 10);
  const { error } = await sb.rpc("admin_set_subscription", {
    p_tenant: tenant, p_plan: pr.plan_code as string, p_status: Number(pr.trial_days) > 0 ? "trial" : "active",
    p_period_end: null as unknown as string, p_trial_ends: (Number(pr.trial_days) > 0 ? ends : null) as string,
    p_price_override: null as unknown as number, p_notes: pr.notes as string,
  });
  if (error) return done(error, []);
  await sb.from("admin_prospects").update({ tenant_id: tenant }).eq("id", id);
  await adminLog(sb, "prospect_apply", tenant, `${pr.plan_code} · تجربة ${pr.trial_days} يوم`);
  return done(null, ["/admin", `/admin/${tenant}`]);
}
