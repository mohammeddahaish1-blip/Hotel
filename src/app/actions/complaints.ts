"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/** An employee (not a manager) writes to the owner; the database decides who may. */
export async function submitStaffComplaint(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.rpc("submit_staff_complaint", {
    p_tenant: ctx.tenantId, p_category: s(fd, "category") ?? "other", p_body: s(fd, "body") ?? "",
    p_about: s(fd, "about") as string, p_anonymous: fd.get("anonymous") === "on",
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/complaints");
  return { ok: t.sc_sent };
}

/** The owner marks a complaint and answers it (only the writer sees the answer). */
export async function answerStaffComplaint(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (ctx.role !== "owner") return { error: t.err_FORBIDDEN };
  const reply = s(fd, "reply");
  const status = s(fd, "status") ?? "seen";
  const { error } = await ctx.supabase.from("staff_complaints")
    .update({ status: ["new", "seen", "resolved"].includes(status) ? status : "seen", owner_reply: reply, replied_at: reply ? new Date().toISOString() : null })
    .eq("id", s(fd, "id")!).eq("tenant_id", ctx.tenantId);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/complaints");
  return { ok: t.saved };
}
