"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
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
  return done(error, ["/admin", `/admin/${tenant}`]);
}

export async function adminVoidPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.rpc("admin_void_payment", { p_id: s(fd, "id")! });
  return done(error, ["/admin", `/admin/${s(fd, "tenant")}`]);
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
  return done(error, ["/admin", "/admin/plans", "/upgrade"]);
}
