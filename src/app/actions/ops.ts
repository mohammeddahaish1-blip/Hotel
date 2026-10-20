"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { toBaisa } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

async function run(fn: (ctx: Awaited<ReturnType<typeof getCtx>>) => PromiseLike<{ error: unknown }>, paths: string[] = []): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await fn(ctx);
  if (error) return { error: errorMessage(t, error as { message: string }) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}

// ---------------------------------------------------------------- reservations
export async function createReservation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const kind = s(fd, "kind") ?? "nightly";
  const { data, error } = await ctx.supabase.rpc("create_reservation", {
    p_property: ctx.property.id,
    p_unit: s(fd, "unit")!,
    p_guest: s(fd, "guest")!,
    p_from: s(fd, "from")!,
    p_to: s(fd, "to")!,
    p_source: s(fd, "source") ?? "direct",
    p_kind: kind,
    p_adults: Number(s(fd, "adults") ?? 1),
    p_children: Number(s(fd, "children") ?? 0),
    p_discount: toBaisa(s(fd, "discount")),
    p_notes: s(fd, "notes"),
    p_status: s(fd, "status") ?? "confirmed",
    p_monthly_rent: kind === "contract" && s(fd, "monthly_rent") ? toBaisa(s(fd, "monthly_rent")) : null,
    p_deposit: toBaisa(s(fd, "deposit")),
  });
  if (error) return { error: errorMessage(t, error) };
  redirect(`/reservations/${data}`);
}

export async function checkIn(_: ActionResult, fd: FormData) {
  const id = s(fd, "id")!;
  return run((c) => c.supabase.rpc("check_in", { p_res: id }), [`/reservations/${id}`, "/board"]);
}

export async function checkOut(_: ActionResult, fd: FormData) {
  const id = s(fd, "id")!;
  return run(
    (c) => c.supabase.rpc("check_out", { p_res: id, p_allow_balance: fd.get("allow_balance") === "1" }),
    [`/reservations/${id}`, "/board", "/housekeeping"],
  );
}

export async function cancelReservation(_: ActionResult, fd: FormData) {
  const id = s(fd, "id")!;
  return run(
    (c) => c.supabase.rpc("cancel_reservation", { p_res: id, p_reason: s(fd, "reason"), p_no_show: fd.get("no_show") === "1" }),
    [`/reservations/${id}`],
  );
}

export async function changeReservation(_: ActionResult, fd: FormData) {
  const id = s(fd, "id")!;
  return run(
    (c) => c.supabase.rpc("change_reservation", { p_res: id, p_unit: s(fd, "unit")!, p_from: s(fd, "from")!, p_to: s(fd, "to")! }),
    [`/reservations/${id}`, "/calendar"],
  );
}

/** Used by the drag-and-drop calendar (FR-06). */
export async function moveReservation(id: string, unit: string, from: string, to: string): Promise<ActionResult> {
  const fd = new FormData();
  Object.entries({ id, unit, from, to }).forEach(([k, v]) => fd.set(k, v));
  return changeReservation(null, fd);
}

// ---------------------------------------------------------------- folio
export async function addCharge(_: ActionResult, fd: FormData) {
  const folio = s(fd, "folio")!;
  return run(
    (c) =>
      c.supabase.from("charges").insert({
        tenant_id: c.tenantId,
        folio_id: folio,
        kind: s(fd, "kind") ?? "other",
        description: s(fd, "description") ?? "",
        amount: toBaisa(s(fd, "amount")) * (s(fd, "kind") === "discount" ? -1 : 1),
        taxable: fd.get("taxable") === "on",
      }),
    [`/reservations/${s(fd, "res")}`],
  );
}

export async function voidCharge(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.from("charges").update({ voided_at: new Date().toISOString(), void_reason: s(fd, "reason") ?? "void" }).eq("id", s(fd, "id")!),
    [`/reservations/${s(fd, "res")}`],
  );
}

export async function addPayment(_: ActionResult, fd: FormData) {
  return run(
    (c) =>
      c.supabase.from("payments").insert({
        tenant_id: c.tenantId,
        folio_id: s(fd, "folio")!,
        kind: s(fd, "kind") ?? "payment",
        method: s(fd, "method") ?? "cash",
        amount: toBaisa(s(fd, "amount")),
        reference: s(fd, "reference"),
      }),
    [`/reservations/${s(fd, "res")}`, "/dashboard", "/finance"],
  );
}

export async function voidPayment(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.from("payments").update({ voided_at: new Date().toISOString(), void_reason: s(fd, "reason") ?? "void" }).eq("id", s(fd, "id")!),
    [`/reservations/${s(fd, "res")}`],
  );
}

export async function issueInvoice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase.rpc("issue_invoice", { p_folio: s(fd, "folio")!, p_language: s(fd, "language") ?? "bilingual" });
  if (error) return { error: errorMessage(t, error) };
  redirect(`/invoices/${data}`);
}

export async function issueCreditNote(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.rpc("issue_credit_note", { p_invoice: s(fd, "invoice")!, p_subtotal: toBaisa(s(fd, "amount")), p_reason: s(fd, "reason") ?? "" }),
    [`/invoices/${s(fd, "invoice")}`],
  );
}

// ---------------------------------------------------------------- finance
export async function openShift(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.from("cash_shifts").insert({ tenant_id: c.tenantId, property_id: c.property.id, opening_float: toBaisa(s(fd, "float")) }),
    ["/finance"],
  );
}

export async function closeShift(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.rpc("close_shift", { p_shift: s(fd, "shift")!, p_counted: toBaisa(s(fd, "counted")), p_notes: s(fd, "notes") }),
    ["/finance"],
  );
}

/** Stores an optional receipt photo/PDF under <tenant>/<expense>/ and links it to the expense. */
async function attachReceipt(ctx: Awaited<ReturnType<typeof getCtx>>, expenseId: string, fd: FormData) {
  const file = fd.get("receipt");
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.tenantId}/${expenseId}/${crypto.randomUUID()}.${ext}`;
  const up = await ctx.supabase.storage.from("expense-receipts").upload(path, file, { contentType: file.type || "image/jpeg" });
  if (up.error) return up.error;
  const { error } = await ctx.supabase.from("expenses").update({ attachment_path: path }).eq("id", expenseId);
  return error;
}

export async function addExpense(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase
    .from("expenses")
    .insert({
      tenant_id: ctx.tenantId,
      property_id: ctx.property.id,
      category: s(fd, "category") ?? "other",
      description: s(fd, "description") ?? "",
      amount: toBaisa(s(fd, "amount")),
      expense_date: s(fd, "date") ?? undefined,
      method: s(fd, "method") ?? "cash",
    })
    .select("id")
    .single();
  if (error) return { error: errorMessage(t, error) };
  const upErr = await attachReceipt(ctx, data.id, fd);
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  if (upErr) return { error: errorMessage(t, upErr as { message: string }) };
  return { ok: t.saved };
}

export async function updateExpense(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase
    .from("expenses")
    .update({
      category: s(fd, "category") ?? "other",
      description: s(fd, "description") ?? "",
      amount: toBaisa(s(fd, "amount")),
      expense_date: s(fd, "date") ?? undefined,
      ...(s(fd, "method") ? { method: s(fd, "method")! } : {}),
    })
    .eq("id", s(fd, "id")!)
    .select("id");
  if (error) return { error: errorMessage(t, error) };
  // RLS hides rows the user may not change: no row updated means no permission
  if (!data?.length) return { error: t.err_FORBIDDEN };
  const upErr = await attachReceipt(ctx, data[0].id, fd);
  if (upErr) return { error: errorMessage(t, upErr as { message: string }) };
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  return { ok: t.saved };
}

export async function deleteExpense(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase.from("expenses").delete().eq("id", s(fd, "id")!).select("id");
  if (error) return { error: errorMessage(t, error) };
  if (!data?.length) return { error: t.err_FORBIDDEN };
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  return { ok: t.saved };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function postDueRent(_: ActionResult, __: FormData) {
  return run((c) => c.supabase.rpc("post_due_billing", { p_tenant: c.tenantId }), ["/finance"]);
}

// ---------------------------------------------------------------- housekeeping & maintenance
export async function setHkStatus(_: ActionResult, fd: FormData) {
  return run((c) => c.supabase.rpc("set_hk_task_status", { p_task: s(fd, "id")!, p_status: s(fd, "status")! }), ["/housekeeping", "/board"]);
}

export async function addHkTask(_: ActionResult, fd: FormData) {
  return run(
    (c) =>
      c.supabase.from("hk_tasks").insert({
        tenant_id: c.tenantId,
        property_id: c.property.id,
        unit_id: s(fd, "unit")!,
        kind: s(fd, "kind") ?? "stayover",
        priority: Number(s(fd, "priority") ?? 2),
        due_date: s(fd, "date") ?? undefined,
        notes: s(fd, "notes"),
      }),
    ["/housekeeping"],
  );
}

export async function createTicket(_: ActionResult, fd: FormData) {
  return run(
    (c) =>
      c.supabase.from("maintenance_tickets").insert({
        tenant_id: c.tenantId,
        property_id: c.property.id,
        unit_id: s(fd, "unit")!,
        title: s(fd, "title") ?? "",
        description: s(fd, "description"),
        priority: Number(s(fd, "priority") ?? 2),
        blocks_availability: fd.get("blocks") === "on",
      }),
    ["/maintenance", "/board"],
  );
}

export async function updateTicket(_: ActionResult, fd: FormData) {
  return run(
    (c) => c.supabase.from("maintenance_tickets").update({ status: s(fd, "status")! }).eq("id", s(fd, "id")!),
    ["/maintenance", "/board"],
  );
}

// ---------------------------------------------------------------- compliance
export async function logSubmission(_: ActionResult, fd: FormData) {
  return run(
    (c) =>
      c.supabase.from("compliance_submissions").update({ status: "submitted", submitted_at: new Date().toISOString(), response: s(fd, "response") }).eq("id", s(fd, "id")!),
    ["/compliance"],
  );
}
