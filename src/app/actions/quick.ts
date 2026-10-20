"use server";

import { revalidatePath } from "next/cache";
import { can, getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";

export type SearchHit = { kind: "unit" | "reservation" | "guest"; id: string; title: string; subtitle: string; href: string };

/** Global search across units, reservations and guests (RLS decides what each employee finds). */
export async function globalSearch(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const ctx = await getCtx();
  const { data } = await ctx.supabase.rpc("global_search", { p_property: ctx.property.id, p_q: term });
  return ((data ?? []) as { kind: SearchHit["kind"]; ref_id: string; title: string; subtitle: string }[])
    .filter((r) => (r.kind === "guest" ? can(ctx, "guests") : r.kind === "reservation" ? can(ctx, "reservations") : true))
    .map((r) => ({
      kind: r.kind,
      id: r.ref_id,
      title: r.title,
      subtitle: r.subtitle,
      href: r.kind === "unit" ? (can(ctx, "calendar") ? "/calendar" : "/board") : r.kind === "reservation" ? `/reservations/${r.ref_id}` : `/guests/${r.ref_id}`,
    }));
}

export type GuestLite = { id: string; full_name: string; phone: string | null };

export async function findGuests(q: string): Promise<GuestLite[]> {
  const term = q.trim().replace(/[%,()]/g, " ");
  if (term.length < 2) return [];
  const ctx = await getCtx();
  const { data } = await ctx.supabase
    .from("guests")
    .select("id, full_name, phone")
    .eq("tenant_id", ctx.tenantId)
    .or(`full_name.ilike.%${term}%,full_name_ar.ilike.%${term}%,phone.ilike.%${term}%,doc_number.ilike.%${term}%`)
    .limit(6);
  return (data ?? []) as GuestLite[];
}

/** Price + availability of one unit for a period (null = not available). */
export async function quoteUnit(unitId: string, from: string, to: string): Promise<{ quote: number } | null> {
  const ctx = await getCtx();
  const { data } = await ctx.supabase.rpc("available_units", { p_property: ctx.property.id, p_from: from, p_to: to });
  const hit = ((data ?? []) as { unit_id: string; quote: number }[]).find((u) => u.unit_id === unitId);
  return hit ? { quote: Number(hit.quote) } : null;
}

/** Booking from the calendar: optional new guest (with consent) + reservation, in one step. */
export async function quickBook(input: {
  unitId: string;
  from: string;
  to: string;
  source: string;
  guestId?: string;
  newGuest?: { full_name: string; phone?: string; doc_type?: string; doc_number?: string; nationality?: string; consent: boolean };
  checkInNow?: boolean;
}): Promise<{ id?: string; error?: string }> {
  const ctx = await getCtx();
  const { t } = await getDict();
  let guestId = input.guestId;
  if (!guestId) {
    const g = input.newGuest;
    if (!g?.full_name?.trim()) return { error: t.qb_need_guest };
    if (!g.consent) return { error: t.consent_required };
    const { data, error } = await ctx.supabase
      .from("guests")
      .insert({
        tenant_id: ctx.tenantId,
        full_name: g.full_name.trim(),
        phone: g.phone?.trim() || null,
        doc_type: g.doc_type || null,
        doc_number: g.doc_number?.trim() || null,
        nationality: g.nationality?.trim().toUpperCase() || null,
        consent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return { error: errorMessage(t, error) };
    guestId = data.id;
  }
  const { data: resId, error } = await ctx.supabase.rpc("create_reservation", {
    p_property: ctx.property.id,
    p_unit: input.unitId,
    p_guest: guestId,
    p_from: input.from,
    p_to: input.to,
    p_source: input.source || "direct",
  });
  if (error) return { error: errorMessage(t, error) };
  if (input.checkInNow) {
    const { error: ciError } = await ctx.supabase.rpc("check_in", { p_res: resId });
    if (ciError) {
      revalidatePath("/calendar");
      return { id: resId as string, error: errorMessage(t, ciError) };
    }
  }
  revalidatePath("/calendar");
  revalidatePath("/board");
  revalidatePath("/dashboard");
  return { id: resId as string };
}
