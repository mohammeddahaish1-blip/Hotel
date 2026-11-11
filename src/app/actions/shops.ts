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
    .insert({
      tenant_id: ctx.tenantId, property_id: ctx.property.id, kind, ...shopFields(fd, kind),
      ...(kind === "service" && fd.get("daily_photos") === "on"
        ? { daily_photos: true, photos_since: new Intl.DateTimeFormat("en-CA", { timeZone: ctx.property.timezone }).format(new Date()) }
        : {}),
    })
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
  const daily = fd.get("daily_photos") === "on";
  const { error } = await ctx.supabase.from("shops")
    .update({ ...shopFields(fd, s(fd, "kind") ?? "service"), active: fd.get("active") === "on", daily_photos: daily })
    .eq("id", id).eq("tenant_id", ctx.tenantId);
  // photos are required from the day the owner switches it on (earlier days are never flagged)
  if (!error && daily) {
    await ctx.supabase.from("shops").update({ photos_since: new Intl.DateTimeFormat("en-CA", { timeZone: ctx.property.timezone }).format(new Date()) })
      .eq("id", id).is("photos_since", null);
  }
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

// ---------------------------------------------------------------- shop books: workers and invoice photos
export async function saveShopWorker(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { salary: "min0" });
  if (bad) return bad;
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  const id = s(fd, "id");
  const row = {
    full_name: s(fd, "full_name") ?? "", job_title: s(fd, "job_title"), phone: s(fd, "phone"), nationality: s(fd, "nationality"),
    salary: parseBaisa(s(fd, "salary")) ?? 0, iqama_no: s(fd, "iqama_no"), iqama_expiry: date(s(fd, "iqama_expiry")),
    joined_on: date(s(fd, "joined_on")), notes: s(fd, "notes"),
    ...(id ? { active: fd.get("active") === "on" } : {}),
  };
  const { error } = id
    ? await ctx.supabase.from("shop_workers").update(row).eq("id", id).eq("shop_id", shop)
    : await ctx.supabase.from("shop_workers").insert({ ...row, tenant_id: ctx.tenantId, shop_id: shop });
  return done(error, [`/shops/${shop}`, "/shops"]);
}

/** The cashier photographs an invoice; its amount is typed or read from the photo by Claude. */
export async function uploadShopReceipt(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { amount: "posOpt" });
  if (bad) return bad;
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const shop = s(fd, "shop")!;
  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: t.bk_need_photo };
  const typed = s(fd, "amount") ? parseBaisa(s(fd, "amount")) : null;
  const { readReceipt, receiptReaderEnabled } = await import("@/lib/receipt-reader");
  if (typed == null && !receiptReaderEnabled()) return { error: t.bk_need_amount };
  const kind = ["sales", "purchase", "expense"].includes(s(fd, "kind") ?? "") ? s(fd, "kind")! : "sales";
  const day = date(s(fd, "day")) ?? new Intl.DateTimeFormat("en-CA", { timeZone: ctx.property.timezone }).format(new Date());

  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.tenantId}/${shop}/${crypto.randomUUID()}.${ext}`;
  const up = await ctx.supabase.storage.from("shop-receipts").upload(path, file, { contentType: file.type || "image/jpeg" });
  if (up.error) return { error: errorMessage(t, up.error) };

  let amount = typed;
  let status = typed != null ? "manual" : "pending";
  let vendor: string | null = null;
  if (typed == null) {
    const reading = await readReceipt(Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg");
    amount = reading?.total ?? null;
    vendor = reading?.vendor ?? null;
    status = amount != null ? "read" : "failed";
  }
  const { error } = await ctx.supabase.from("shop_receipts").insert({
    tenant_id: ctx.tenantId, shop_id: shop, business_date: day, kind, amount, vendor, photo_path: path, read_status: status,
    note: s(fd, "note"),
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath(`/shops/${shop}`);
  revalidatePath("/shops");
  if (status === "failed") return { error: t.bk_read_fail };
  if (status === "read") {
    const { omr } = await import("@/lib/format");
    return { ok: t.bk_read_ok.replace("{a}", omr(amount!, lang)) };
  }
  return { ok: t.saved };
}

export async function fixShopReceipt(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const bad = await moneyError(fd, { amount: "min0" });
  if (bad) return bad;
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  const kind = s(fd, "kind");
  const { error } = await ctx.supabase.from("shop_receipts")
    .update({ amount: parseBaisa(s(fd, "amount")) ?? 0, read_status: "manual", ...(kind && ["sales", "purchase", "expense"].includes(kind) ? { kind } : {}) })
    .eq("id", s(fd, "id")!).eq("shop_id", shop);
  return done(error, [`/shops/${shop}`, "/shops"]);
}

export async function voidShopReceipt(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const shop = s(fd, "shop")!;
  const reason = s(fd, "reason");
  if (!reason) {
    const { t } = await getDict();
    return { error: t.err_REASON_REQUIRED };
  }
  const { error } = await ctx.supabase.from("shop_receipts")
    .update({ voided_at: new Date().toISOString(), void_reason: reason }).eq("id", s(fd, "id")!).eq("shop_id", shop).is("voided_at", null);
  return done(error, [`/shops/${shop}`, "/shops"]);
}
