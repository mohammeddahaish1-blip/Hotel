import "server-only";
import type { Ctx } from "./auth";
import { addDays, todayIn, zonedStart } from "./format";

/** One shop's day: income (sales in the system + photographed sales reports), costs (purchases + expenses). */
export type DayBook = { income: number; till: number; costs: number; photos: number };
export type ShopRow = { id: string; name: string; kind: "service" | "rental"; daily_photos: boolean; photos_since: string | null; created_at: string; active: boolean };

const localDay = (ts: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ts));

/** Days [from, to) for each shop: what came in and what went out. */
export async function loadShopBooks(ctx: Ctx, shopIds: string[], from: string, to: string) {
  const tz = ctx.property.timezone;
  const books = new Map<string, Map<string, DayBook>>();
  if (shopIds.length === 0) return books;
  const [{ data: sales }, { data: receipts }] = await Promise.all([
    ctx.supabase.from("shop_sales").select("shop_id, total, sold_at").in("shop_id", shopIds).is("voided_at", null)
      .gte("sold_at", zonedStart(from, tz)).lt("sold_at", zonedStart(to, tz)),
    ctx.supabase.from("shop_receipts").select("shop_id, business_date, kind, amount").in("shop_id", shopIds).is("voided_at", null)
      .gte("business_date", from).lt("business_date", to),
  ]);
  const day = (shop: string, d: string) => {
    if (!books.has(shop)) books.set(shop, new Map());
    const m = books.get(shop)!;
    if (!m.has(d)) m.set(d, { income: 0, till: 0, costs: 0, photos: 0 });
    return m.get(d)!;
  };
  for (const s of sales ?? []) {
    const b = day(s.shop_id, localDay(s.sold_at, tz));
    b.income += Number(s.total);
    b.till += Number(s.total);
  }
  for (const r of receipts ?? []) {
    const b = day(r.shop_id, r.business_date);
    b.photos += 1;
    if (r.kind === "sales") b.income += Number(r.amount ?? 0);
    else b.costs += Number(r.amount ?? 0);
  }
  return books;
}

export function sumBook(m: Map<string, DayBook> | undefined) {
  const out = { income: 0, till: 0, costs: 0, photos: 0 };
  for (const b of m?.values() ?? []) {
    out.income += b.income; out.till += b.till; out.costs += b.costs; out.photos += b.photos;
  }
  return out;
}

/** Past days (up to two weeks back, never before photos were required) with no invoice photo at all. */
export async function missingPhotoDays(ctx: Ctx, shops: ShopRow[]) {
  const today = todayIn(ctx.property.timezone);
  const watched = shops.filter((s) => s.kind === "service" && s.active && s.daily_photos);
  const out = new Map<string, string[]>();
  if (watched.length === 0) return out;
  const earliest = addDays(today, -14);
  const { data } = await ctx.supabase.from("shop_receipts").select("shop_id, business_date")
    .in("shop_id", watched.map((s) => s.id)).is("voided_at", null).gte("business_date", earliest);
  const have = new Set((data ?? []).map((r) => `${r.shop_id}|${r.business_date}`));
  for (const s of watched) {
    const since = s.photos_since ?? s.created_at.slice(0, 10);
    const missing: string[] = [];
    for (let d = since > earliest ? since : earliest; d < today; d = addDays(d, 1)) {
      if (!have.has(`${s.id}|${d}`)) missing.push(d);
    }
    if (missing.length) out.set(s.id, missing);
  }
  return out;
}

/** Workers whose residence card has expired or expires within 30 days (only what the caller may see). */
export async function expiringWorkers(ctx: Ctx) {
  const today = todayIn(ctx.property.timezone);
  const { data } = await ctx.supabase.from("shop_workers").select("id, shop_id, full_name, iqama_expiry")
    .eq("tenant_id", ctx.tenantId).eq("active", true).not("iqama_expiry", "is", null).lte("iqama_expiry", addDays(today, 30))
    .order("iqama_expiry");
  return (data ?? []) as { id: string; shop_id: string; full_name: string; iqama_expiry: string }[];
}
