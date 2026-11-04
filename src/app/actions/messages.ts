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
const TRIGGERS = ["booking_confirmed", "before_arrival", "after_checkin", "after_checkout", "rent_overdue", "contract_ending"];
const ACTIONS = ["whatsapp", "hk_task", "notify"];
const HK = ["checkout", "stayover", "weekly", "deep", "inspection"];

async function done(fn: (ctx: Awaited<ReturnType<typeof getCtx>>) => PromiseLike<{ error: unknown }>, paths: string[]): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await fn(ctx);
  if (error) return { error: errorMessage(t, error as { message: string }) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}

// ---------------------------------------------------------------- outbox
/** Called by the WhatsApp button: the message was handed to WhatsApp with this (possibly edited) text. */
export async function markMessageSent(id: string, text: string): Promise<ActionResult> {
  return done(
    (c) => c.supabase.from("message_outbox").update({ status: "sent", sent_at: new Date().toISOString(), sent_by: c.userId, sent_text: text.slice(0, 4000) }).eq("id", id).eq("status", "pending"),
    ["/messages"],
  );
}

export async function skipMessage(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("message_outbox").update({ status: "skipped", sent_by: c.userId, sent_at: new Date().toISOString() }).eq("id", s(fd, "id")!).eq("status", "pending"), ["/messages"]);
}

/** Queue one message by hand (from a booking), then open the messages page. */
export async function queueMessage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const res = s(fd, "reservation")!;
  const { data: r } = await ctx.supabase.from("reservations").select("guest_id").eq("id", res).maybeSingle();
  const { error } = await ctx.supabase.from("message_outbox").insert({
    tenant_id: ctx.tenantId, property_id: ctx.property.id, reservation_id: res, guest_id: r?.guest_id ?? null, template_key: s(fd, "template") ?? "booking_confirmed",
  });
  if (error) return { error: errorMessage(t, error) };
  redirect("/messages");
}

export async function doneNotice(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("staff_notices").update({ done_at: new Date().toISOString(), done_by: c.userId }).eq("id", s(fd, "id")!), ["/messages", "/dashboard"]);
}

export async function runAutomationNow(): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { data, error } = await ctx.supabase.rpc("automation_tick", { p_property: ctx.property.id });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/messages");
  revalidatePath("/settings/automation");
  return { ok: t.auto_ran.replace("{n}", String(data ?? 0)) };
}

// ---------------------------------------------------------------- rules
function rule(fd: FormData) {
  const trigger = s(fd, "trigger") ?? "";
  const action = s(fd, "action") ?? "";
  const hk = s(fd, "hk_kind");
  return {
    name: (s(fd, "name") ?? "").slice(0, 120),
    trigger: TRIGGERS.includes(trigger) ? trigger : "booking_confirmed",
    offset_days: Math.min(Math.max(Math.round(Number(s(fd, "offset") ?? 0)), 0), 90),
    action: ACTIONS.includes(action) ? action : "notify",
    template_key: action === "whatsapp" ? s(fd, "template") : null,
    hk_kind: action === "hk_task" && hk && HK.includes(hk) ? hk : null,
  };
}

export async function addRule(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("automation_rules").insert({ tenant_id: c.tenantId, ...rule(fd), property_id: s(fd, "all") === "on" ? null : c.property.id }), ["/settings/automation"]);
}

export async function updateRule(_: ActionResult, fd: FormData) {
  const r = rule(fd);
  return done((c) => c.supabase.from("automation_rules").update({ name: r.name, trigger: r.trigger, offset_days: r.offset_days, action: r.action, template_key: r.template_key, hk_kind: r.hk_kind }).eq("id", s(fd, "id")!), ["/settings/automation"]);
}

export async function toggleRule(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("automation_rules").update({ active: s(fd, "active") === "1" }).eq("id", s(fd, "id")!), ["/settings/automation"]);
}

export async function deleteRule(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("automation_rules").delete().eq("id", s(fd, "id")!), ["/settings/automation"]);
}

/** A ready-made starting set; the owner can switch off or change any of them. */
export async function addSuggestedRules(): Promise<ActionResult> {
  const { t } = await getDict();
  const base = [
    { name: t.auto_sug_confirm, trigger: "booking_confirmed", offset_days: 0, action: "whatsapp", template_key: "booking_confirmed" },
    { name: t.auto_sug_prearrival, trigger: "before_arrival", offset_days: 1, action: "whatsapp", template_key: "pre_arrival" },
    { name: t.auto_sug_thanks, trigger: "after_checkout", offset_days: 0, action: "whatsapp", template_key: "checkout_thanks" },
    { name: t.auto_sug_rent, trigger: "rent_overdue", offset_days: 3, action: "whatsapp", template_key: "payment_request" },
    { name: t.auto_sug_rent_notice, trigger: "rent_overdue", offset_days: 7, action: "notify", template_key: null },
    { name: t.auto_sug_contract, trigger: "contract_ending", offset_days: 30, action: "whatsapp", template_key: "contract_renewal" },
    { name: t.auto_sug_weekly, trigger: "after_checkin", offset_days: 7, action: "hk_task", template_key: null, hk_kind: "weekly" },
  ];
  return done((c) => c.supabase.from("automation_rules").insert(base.map((b) => ({ tenant_id: c.tenantId, property_id: null, ...b }))), ["/settings/automation"]);
}

// ---------------------------------------------------------------- templates
export async function saveTemplate(_: ActionResult, fd: FormData) {
  const key = (s(fd, "key") ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
  return done(
    (c) =>
      c.supabase.from("message_templates").upsert({
        tenant_id: c.tenantId, key, name: (s(fd, "name") ?? key).slice(0, 80),
        body_ar: (s(fd, "body_ar") ?? "").slice(0, 2000), body_en: (s(fd, "body_en") ?? s(fd, "body_ar") ?? "").slice(0, 2000),
        updated_at: new Date().toISOString(),
      }),
    ["/settings/automation", "/messages"],
  );
}

/** Back to the built-in wording (or remove a custom message). */
export async function resetTemplate(_: ActionResult, fd: FormData) {
  return done((c) => c.supabase.from("message_templates").delete().eq("tenant_id", c.tenantId).eq("key", s(fd, "key")!), ["/settings/automation", "/messages"]);
}
