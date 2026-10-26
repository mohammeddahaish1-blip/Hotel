"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { toBaisa } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

export async function paySalary(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const method = String(fd.get("method") ?? "transfer");
  const { error } = await ctx.supabase.rpc("pay_salary", {
    p_property: ctx.property.id,
    p_user: String(fd.get("user_id")),
    p_month: String(fd.get("month")),
    p_amount: toBaisa(String(fd.get("amount") ?? "")),
    p_method: ["cash", "card", "transfer"].includes(method) ? method : "transfer",
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  return { ok: t.saved };
}

export async function cancelSalary(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.rpc("cancel_salary", { p_id: String(fd.get("id")) });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/finance");
  revalidatePath("/dashboard");
  return { ok: t.saved };
}
