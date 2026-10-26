"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { dictionaries } from "@/lib/i18n/dict";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/** Public: a guest submits a suggestion or complaint from the QR-code page (no account). */
export async function submitGuestFeedback(token: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const l = fd.get("lang");
  const t = dictionaries[l === "en" || l === "ur" ? l : "ar"];
  const kind = s(fd, "kind") === "complaint" ? "complaint" : "suggestion";
  const message = s(fd, "message") ?? "";
  if (message.length < 3) return { error: t.err_generic };
  const rating = Number(s(fd, "rating"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_feedback", {
    p_token: token,
    p_kind: kind,
    p_message: message.slice(0, 2000),
    p_rating: rating >= 1 && rating <= 5 ? rating : null,
    p_name: s(fd, "name")?.slice(0, 120) ?? null,
    p_contact: s(fd, "contact")?.slice(0, 120) ?? null,
    p_room: s(fd, "room")?.slice(0, 20) ?? null,
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/feedback");
  return { ok: "sent" };
}

/** Staff: move an entry along (new → in progress → resolved) and keep internal notes. */
export async function updateFeedback(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const status = s(fd, "status");
  const { data, error } = await ctx.supabase
    .from("feedback")
    .update({
      ...(status && ["new", "in_progress", "resolved"].includes(status)
        ? { status, handled_by: status === "new" ? null : ctx.userId, handled_at: status === "new" ? null : new Date().toISOString() }
        : {}),
      staff_notes: s(fd, "notes"),
    })
    .eq("id", s(fd, "id")!)
    .select("id");
  if (error) return { error: errorMessage(t, error) };
  if (!data?.length) return { error: t.err_FORBIDDEN };
  revalidatePath("/feedback");
  revalidatePath("/dashboard");
  return { ok: t.saved };
}
