"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { addDays, gregorian, parseRange, todayIn } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

const PATHS = ["/night-audit", "/board", "/reservations", "/dashboard"];

/** Close the business day; the database recounts what is still open before accepting it. */
export async function closeNightAudit(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const note = String(fd.get("note") ?? "").trim();
  const { error } = await ctx.supabase.rpc("close_night_audit", { p_property: ctx.property.id, p_note: note || null });
  if (error) return { error: errorMessage(t, error) };
  PATHS.forEach((p) => revalidatePath(p));
  return { ok: t.na_closed_ok.replace("{date}", gregorian(todayIn(ctx.property.timezone), lang)) };
}

/** A guest past their departure date stays one more night: the departure moves to tomorrow. */
export async function extendOneNight(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = String(fd.get("id") ?? "");
  const { data: r } = await ctx.supabase.from("reservations").select("unit_id, stay").eq("id", id).maybeSingle();
  if (!r) return { error: t.err_NOT_FOUND };
  const { from } = parseRange(r.stay as string);
  const { error } = await ctx.supabase.rpc("change_reservation", {
    p_res: id, p_unit: r.unit_id, p_from: from, p_to: addDays(todayIn(ctx.property.timezone), 1),
  });
  if (error) return { error: errorMessage(t, error) };
  [...PATHS, `/reservations/${id}`].forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}
