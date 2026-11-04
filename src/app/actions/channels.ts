"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const CHANNELS = ["airbnb", "booking", "agoda", "expedia", "other"];

export async function addFeed(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const url = (s(fd, "url") ?? "").replace(/^webcal:\/\//i, "https://");
  if (!/^https:\/\/\S+$/.test(url)) return { error: t.ch_bad_url };
  const channel = s(fd, "channel") ?? "other";
  const { error } = await ctx.supabase.from("ical_feeds").insert({
    tenant_id: ctx.tenantId, property_id: ctx.property.id, unit_id: s(fd, "unit")!, channel: CHANNELS.includes(channel) ? channel : "other", url,
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/channels");
  return { ok: t.saved };
}

export async function toggleFeed(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.from("ical_feeds").update({ active: s(fd, "active") === "1" }).eq("id", s(fd, "id")!);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/channels");
  return { ok: t.saved };
}

export async function deleteFeed(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await ctx.supabase.from("ical_feeds").delete().eq("id", s(fd, "id")!);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/channels");
  return { ok: t.saved };
}

/** Ask every channel calendar now, wait a moment, then read the answers. */
export async function syncChannelsNow(): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data: started, error } = await ctx.supabase.rpc("ical_sync", { p_property: ctx.property.id, p_step: "start" });
  if (error) return { error: errorMessage(t, error) };
  let read = 0;
  for (let i = 0; i < 4 && read < Number(started ?? 0); i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const { data } = await ctx.supabase.rpc("ical_sync", { p_property: ctx.property.id, p_step: "collect" });
    read += Number(data ?? 0);
  }
  revalidatePath("/channels");
  revalidatePath("/calendar");
  return { ok: t.ch_synced.replace("{n}", String(read)).replace("{total}", String(started ?? 0)) };
}

export async function convertChannelBlock(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase.rpc("convert_channel_block", { p_block: s(fd, "block")!, p_guest: s(fd, "guest")! });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/channels");
  revalidatePath("/calendar");
  redirect(`/reservations/${data}`);
}
