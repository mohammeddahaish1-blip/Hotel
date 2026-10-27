"use server";

import { revalidatePath } from "next/cache";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { toBaisa } from "@/lib/format";
import { uploadTo } from "@/lib/storage";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const refresh = (...paths: (string | null)[]) => paths.forEach((p) => p && revalidatePath(p));

// ---------------------------------------------------------------- payment proof
export async function attachPaymentProof(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const up = await uploadTo(ctx, "payment-proofs", fd.get("proof"));
  if (!up) return { error: t.err_generic };
  if ("error" in up) return { error: errorMessage(t, up.error as { message: string }) };
  const { error } = await ctx.supabase.rpc("set_payment_proof", { p_payment: s(fd, "id")!, p_path: up.path });
  if (error) return { error: errorMessage(t, error) };
  refresh(s(fd, "res") ? `/reservations/${s(fd, "res")}` : null, "/finance");
  return { ok: t.saved };
}

// ---------------------------------------------------------------- correction requests
/** Staff who may not change money ask the owner/manager instead (void a payment/charge, fix or archive an expense). */
export async function requestCorrection(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const target = s(fd, "target");
  const action = s(fd, "action") === "edit" ? "edit" : "void";
  if (!target || !["payment", "charge", "expense"].includes(target)) return { error: t.err_generic };
  const proposed: Record<string, unknown> = {};
  if (action === "edit") {
    if (s(fd, "amount")) proposed.amount = toBaisa(s(fd, "amount"));
    if (s(fd, "description")) proposed.description = s(fd, "description");
  }
  const { error } = await ctx.supabase.from("correction_requests").insert({
    tenant_id: ctx.tenantId,
    property_id: ctx.property.id,
    target,
    target_id: s(fd, "id")!,
    action,
    proposed,
    reason: s(fd, "reason") ?? "",
    requested_by: ctx.userId,
  });
  if (error) return { error: errorMessage(t, error) };
  refresh(s(fd, "res") ? `/reservations/${s(fd, "res")}` : null, "/finance", "/finance/corrections");
  return { ok: t.cr_sent };
}

export async function decideCorrection(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (!hasRole(ctx, ["manager"])) return { error: t.err_FORBIDDEN };
  const { error } = await ctx.supabase.rpc("decide_correction", {
    p_id: s(fd, "id")!,
    p_approve: fd.get("approve") === "1",
    p_note: s(fd, "note"),
  });
  if (error) return { error: errorMessage(t, error) };
  refresh("/finance/corrections", "/finance", "/dashboard", "/reservations");
  return { ok: t.saved };
}

// ---------------------------------------------------------------- cheques
export async function addCheque(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const photo = await uploadTo(ctx, "cheque-photos", fd.get("photo"));
  if (photo && "error" in photo) return { error: errorMessage(t, photo.error as { message: string }) };
  const res = s(fd, "res");
  let guest = s(fd, "guest");
  if (res && !guest) {
    const { data } = await ctx.supabase.from("reservations").select("guest_id").eq("id", res).maybeSingle();
    guest = (data?.guest_id as string | null) ?? null;
  }
  const { error } = await ctx.supabase.from("cheques").insert({
    tenant_id: ctx.tenantId,
    property_id: ctx.property.id,
    reservation_id: res,
    guest_id: guest,
    cheque_no: s(fd, "cheque_no") ?? "",
    bank: s(fd, "bank"),
    amount: toBaisa(s(fd, "amount")),
    due_date: s(fd, "due_date")!,
    photo_path: photo?.path ?? null,
    notes: s(fd, "notes"),
  });
  if (error) return { error: errorMessage(t, error) };
  refresh(res ? `/reservations/${res}` : null, "/finance/cheques", "/dashboard");
  return { ok: t.saved };
}

export async function setChequeStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.rpc("set_cheque_status", {
    p_cheque: s(fd, "id")!,
    p_status: s(fd, "status")!,
    p_reason: s(fd, "reason"),
  });
  if (error) return { error: errorMessage(t, error) };
  refresh(s(fd, "res") ? `/reservations/${s(fd, "res")}` : null, "/finance/cheques", "/finance", "/dashboard");
  return { ok: t.saved };
}
