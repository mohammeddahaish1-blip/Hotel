"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { renderContract } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/** Generate the contract from the template, freeze it and sign it on behalf of the hotel. */
export async function issueContract(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const res = s(fd, "res")!;
  const body = await renderContract(ctx, t, res);
  if (!body) return { error: t.err_generic };
  const { error } = await ctx.supabase.rpc("create_contract_document", { p_reservation: res, p_title: t.ct_title_default, p_body: body });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath(`/reservations/${res}`);
  return { ok: t.saved };
}

export async function voidContract(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.rpc("void_contract_document", { p_id: s(fd, "id")!, p_reason: s(fd, "reason") });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath(`/reservations/${s(fd, "res")}`);
  return { ok: t.saved };
}

export async function saveContractTemplate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (ctx.role !== "owner") return { error: t.perm_owner_only };
  const { error } = await ctx.supabase.from("tenants").update({ contract_template: s(fd, "template")?.slice(0, 20000) ?? null }).eq("id", ctx.tenantId);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings/automation");
  return { ok: t.saved };
}

/** Guest signs on the public page (no login). IP and device are kept with the signature. */
export async function signContract(token: string, name: string, signature: string): Promise<ActionResult> {
  const { t } = await getDict();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_contract_document", { p_token: token, p_name: name, p_signature: signature, p_ip: ip, p_ua: h.get("user-agent")?.slice(0, 300) ?? null });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath(`/s/${token}`);
  return { ok: t.saved };
}
