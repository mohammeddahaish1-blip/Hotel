"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { parseBaisa } from "@/lib/format";
import { moneyError } from "@/lib/money";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const KINDS = new Set(["service", "rental"]);
const CATEGORIES = new Set(["laundry", "cafe", "restaurant", "minimarket", "salon", "office", "other"]);

async function done(error: { message: string } | null, paths: string[]): Promise<ActionResult> {
  const { t } = await getDict();
  if (error) return { error: errorMessage(t, error) };
  paths.forEach((p) => revalidatePath(p));
  return { ok: t.saved };
}

/** Owner or manager (they add and set up shops, their people and rent). */
async function admin() {
  const ctx = await getCtx();
  if (!hasRole(ctx, ["manager"])) redirect("/denied?area=settings");
  return ctx;
}

/** The shop columns from the add / edit form (rental details only for rental shops). */
function shopFields(fd: FormData, kind: string) {
  const category = s(fd, "category") ?? "other";
  const base = {
    name: s(fd, "name") ?? "",
    number: s(fd, "number"),
    category: CATEGORIES.has(category) ? category : "other",
    notes: s(fd, "notes"),
  };
  if (kind !== "rental") return base;
  return {
    ...base,
    renter_name: s(fd, "renter_name"),
    renter_phone: s(fd, "renter_phone"),
    renter_cr: s(fd, "renter_cr"),
    renter_activity: s(fd, "renter_activity"),
    monthly_rent: parseBaisa(s(fd, "monthly_rent")) ?? 0,
    deposit: parseBaisa(s(fd, "deposit")) ?? 0,
    contract_start: date(s(fd, "contract_start")),
    contract_end: date(s(fd, "contract_end")),
  };
}

export async function createShop(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { monthly_rent: "min0", deposit: "min0" });
  if (bad) return bad;
  const ctx = await admin();
  const kind = s(fd, "kind") ?? "service";
  if (!KINDS.has(kind)) return done({ message: "INVALID_VALUE: kind" }, []);
  const { data, error } = await ctx.supabase.from("shops")
    .insert({ tenant_id: ctx.tenantId, property_id: ctx.property.id, kind, ...shopFields(fd, kind) })
    .select("id").single();
  if (error) return done(error, []);
  revalidatePath("/shops");
  redirect(`/shops/${data.id}`);
}

export async function updateShop(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { monthly_rent: "min0", deposit: "min0" });
  if (bad) return bad;
  const ctx = await admin();
  const id = s(fd, "id")!;
  const { error } = await ctx.supabase.from("shops")
    .update({ ...shopFields(fd, s(fd, "kind") ?? "service"), active: fd.get("active") === "on" })
    .eq("id", id).eq("tenant_id", ctx.tenantId);
  return done(error, ["/shops", `/shops/${id}`]);
}

// ---------------------------------------------------------------- people of a shop
export async function addShopMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await admin();
  const shop = s(fd, "shop")!;
  const { error } = await ctx.supabase.from("shop_members")
    .upsert({ shop_id: shop, tenant_id: ctx.tenantId, user_id: s(fd, "user_id")!, access: s(fd, "access") ?? "seller" });
  return done(error, [`/shops/${shop}`]);
}

export async function removeShopMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await admin();
  const shop = s(fd, "shop")!;
  const { error } = await ctx.supabase.from("shop_members").delete().eq("shop_id", shop).eq("user_id", s(fd, "user_id")!);
  return done(error, [`/shops/${shop}`]);
}

// ---------------------------------------------------------------- items (owner, manager or the shop's manager)
export async function saveShopItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { price: "min0" });
  if (bad) return bad;
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  const id = s(fd, "id");
  const row = { name: s(fd, "name") ?? "", price: parseBaisa(s(fd, "price")) ?? 0, active: id ? fd.get("active") === "on" : true };
  const { error } = id
    ? await ctx.supabase.from("shop_items").update(row).eq("id", id).eq("shop_id", shop)
    : await ctx.supabase.from("shop_items").insert({ ...row, tenant_id: ctx.tenantId, shop_id: shop });
  return done(error, [`/shops/${shop}`]);
}

// ---------------------------------------------------------------- sales
export async function recordShopSale(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  let lines: { item_id: string; qty: number }[] = [];
  try {
    lines = (JSON.parse(String(fd.get("lines") ?? "[]")) as { item_id: string; qty: number }[])
      .filter((l) => typeof l.item_id === "string" && Number.isInteger(l.qty) && l.qty > 0);
  } catch {
    lines = [];
  }
  const method = s(fd, "method") ?? "cash";
  const { error } = await ctx.supabase.rpc("record_shop_sale", {
    p_shop: shop, p_lines: lines, p_method: method,
    p_reservation: (method === "room" ? s(fd, "reservation") : null) as string, p_note: s(fd, "note") as string,
  });
  return done(error, [`/shops/${shop}`, "/shops"]);
}

export async function voidShopSale(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  const { error } = await ctx.supabase.rpc("void_shop_sale", { p_sale: s(fd, "id")!, p_reason: s(fd, "reason") ?? "" });
  return done(error, [`/shops/${shop}`, "/shops"]);
}

// ---------------------------------------------------------------- rent of a rental shop
export async function recordShopRent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { amount: "pos" });
  if (bad) return bad;
  const ctx = await admin();
  const shop = s(fd, "shop")!;
  const { error } = await ctx.supabase.from("shop_rent_payments").insert({
    tenant_id: ctx.tenantId, shop_id: shop, amount: parseBaisa(s(fd, "amount")),
    method: s(fd, "method") ?? "transfer", paid_on: date(s(fd, "paid_on")) ?? undefined,
    period: s(fd, "period"), reference: s(fd, "reference"),
  });
  return done(error, [`/shops/${shop}`, "/shops"]);
}

export async function voidShopRent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await admin();
  const shop = s(fd, "shop")!;
  const reason = s(fd, "reason");
  if (!reason) {
    const { t } = await getDict();
    return { error: t.err_REASON_REQUIRED };
  }
  const { error } = await ctx.supabase.from("shop_rent_payments")
    .update({ voided_at: new Date().toISOString(), void_reason: reason }).eq("id", s(fd, "id")!).is("voided_at", null);
  return done(error, [`/shops/${shop}`, "/shops"]);
}
