"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { toBaisa } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const owner = (fd: FormData) => ({
  name: s(fd, "name") ?? "",
  phone: s(fd, "phone"),
  email: s(fd, "email"),
  commission_bp: Math.round(Math.min(Math.max(Number(s(fd, "commission") ?? 10), 0), 100) * 100),
  language: s(fd, "language") === "en" ? "en" : "ar",
});

export async function createOwner(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (!hasRole(ctx, ["manager"])) return { error: t.err_FORBIDDEN };
  const { data, error } = await ctx.supabase.from("unit_owners").insert({ tenant_id: ctx.tenantId, ...owner(fd) }).select("id").single();
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/properties/owners");
  redirect(`/properties/owners/${data.id}`);
}

export async function updateOwner(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const { data, error } = await ctx.supabase.from("unit_owners").update(owner(fd)).eq("id", id).select("id");
  if (error) return { error: errorMessage(t, error) };
  if (!data?.length) return { error: t.err_FORBIDDEN };
  revalidatePath(`/properties/owners/${id}`);
  revalidatePath("/properties/owners");
  return { ok: t.saved };
}

/** The ticked units belong to this owner; units un-ticked here are released. */
export async function assignUnits(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const ticked = fd.getAll("units").map(String);
  const { error: e1 } = await ctx.supabase.from("units").update({ owner_id: null }).eq("owner_id", id).eq("property_id", ctx.property.id);
  if (e1) return { error: errorMessage(t, e1) };
  if (ticked.length) {
    const { error } = await ctx.supabase.from("units").update({ owner_id: id }).in("id", ticked).eq("property_id", ctx.property.id);
    if (error) return { error: errorMessage(t, error) };
  }
  revalidatePath(`/properties/owners/${id}`);
  revalidatePath("/properties/owners");
  return { ok: t.saved };
}

export async function recordPayout(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const method = s(fd, "method") ?? "transfer";
  const { error } = await ctx.supabase.from("owner_payouts").insert({
    tenant_id: ctx.tenantId,
    owner_id: id,
    amount: toBaisa(s(fd, "amount")),
    paid_on: s(fd, "paid_on")!,
    method: ["cash", "card", "transfer"].includes(method) ? method : "transfer",
    reference: s(fd, "reference"),
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath(`/properties/owners/${id}`);
  return { ok: t.saved };
}
