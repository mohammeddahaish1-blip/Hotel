"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const hours = (v: string | null) => (v && /^\d{1,2}$/.test(v) ? Number(v) : null);

async function done(error: { message: string } | null, paths: string[]): Promise<ActionResult> {
  const { t } = await getDict();
  if (error) return { error: errorMessage(t, error) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}

// ---------------------------------------------------------------- the hotel (owner and managers)
async function hotel() {
  const ctx = await getCtx();
  if (!hasRole(ctx, ["manager"])) redirect("/denied?area=settings");
  return ctx;
}

export async function createSupportRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await hotel();
  const grant = fd.get("grant") === "on";
  const { error } = await ctx.supabase.rpc("support_create_request", {
    p_tenant: ctx.tenantId, p_title: s(fd, "title") ?? "", p_details: s(fd, "details") as string,
    p_grant_hours: (grant ? hours(s(fd, "hours")) ?? 4 : null) as number,
  });
  return done(error, ["/support"]);
}

export async function decideSupportRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await hotel();
  const { error } = await ctx.supabase.rpc("support_decide", {
    p_id: s(fd, "id")!, p_approve: s(fd, "approve") === "1", p_note: s(fd, "note") as string,
  });
  return done(error, ["/support", "/", "/dashboard"]);
}

export async function revokeSupportAccess(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await hotel();
  const { error } = await ctx.supabase.rpc("support_revoke", { p_id: s(fd, "id")! });
  return done(error, ["/support"]);
}

export async function cancelSupportRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await hotel();
  const { error } = await ctx.supabase.rpc("support_cancel", { p_id: s(fd, "id")! });
  return done(error, ["/support"]);
}

// ---------------------------------------------------------------- the Nuzul team (platform admins)
export async function adminCreateMaintenance(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const when = s(fd, "scheduled_for");
  // datetime-local has no zone: the team works in Oman time
  const at = when && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? `${when}:00+04:00` : null;
  const tenant = s(fd, "tenant")!;
  const { error } = await sb.rpc("admin_create_maintenance", {
    p_tenant: tenant, p_title: s(fd, "title") ?? "", p_details: s(fd, "details") as string,
    p_scheduled_for: at as string, p_hours: hours(s(fd, "hours")) ?? 0,
  });
  return done(error, ["/admin/support", `/admin/${tenant}`]);
}

export async function adminRequestAccess(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.rpc("admin_request_access", {
    p_id: s(fd, "id")!, p_hours: hours(s(fd, "hours")) ?? 0, p_note: s(fd, "note") as string,
  });
  return done(error, ["/admin/support"]);
}

export async function adminCompleteRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.rpc("admin_complete_request", { p_id: s(fd, "id")!, p_report: s(fd, "report") ?? "" });
  return done(error, ["/admin/support"]);
}

/** Enter the hotel under the access it granted, and open its first property. */
export async function adminStartSession(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { data, error } = await sb.rpc("admin_start_session", { p_id: s(fd, "id")! });
  if (error) return done(error, []);
  const property = (data as { property_id: string | null }).property_id;
  if (property) (await cookies()).set("property", property, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  redirect("/dashboard");
}

/** Leave the hotel: the session is closed and this person's access stops at once. */
export async function adminEndSession(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const sb = await requireAdmin();
  const { error } = await sb.rpc("admin_end_session", { p_tenant: s(fd, "tenant")!, p_summary: s(fd, "summary") as string });
  if (error) return done(error, []);
  (await cookies()).delete("property");
  redirect("/admin/support");
}
