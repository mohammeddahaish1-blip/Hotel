import "server-only";
import { hasRole, type Ctx } from "./auth";
import { todayIn } from "./format";

export type PropertyRow = {
  id: string; name_ar: string; name_en: string | null; kind: string; address: string | null; phone: string | null;
  license_no: string | null; whatsapp: string | null; photo_path: string | null; timezone: string;
  check_in_time: string; check_out_time: string;
};
export type BoardRow = { unit_id: string; number: string; floor_name: string | null; type_name: string; status: string; reservation_id: string | null; guest_name: string | null };
export type PropertyStats = { units: number; occupied: number; collected: number | null; outstanding: number | null; board: BoardRow[] };

export const PROPERTY_COLUMNS = "id, name_ar, name_en, kind, address, phone, license_no, whatsapp, photo_path, timezone, check_in_time, check_out_time";

/** Live occupancy and (for finance roles) this month's money, per property. */
export async function propertyStats(ctx: Ctx, props: PropertyRow[]): Promise<Map<string, PropertyStats>> {
  const money = hasRole(ctx, ["manager", "accountant"]);
  const out = new Map<string, PropertyStats>();
  await Promise.all(
    props.map(async (p) => {
      const today = todayIn(p.timezone);
      const [{ data: board }, income, aging] = await Promise.all([
        ctx.supabase.rpc("unit_board", { p_property: p.id }),
        money ? ctx.supabase.rpc("daily_income", { p_property: p.id, p_from: `${today.slice(0, 8)}01`, p_to: today }) : Promise.resolve({ data: null }),
        money ? ctx.supabase.rpc("aging_report", { p_property: p.id }) : Promise.resolve({ data: null }),
      ]);
      const rows = (board ?? []) as BoardRow[];
      out.set(p.id, {
        units: rows.length,
        occupied: rows.filter((r) => r.status === "occupied").length,
        collected: money ? ((income.data ?? []) as { amount: number }[]).reduce((a, r) => a + Number(r.amount), 0) : null,
        outstanding: money ? ((aging.data ?? []) as { balance: number }[]).reduce((a, r) => a + Number(r.balance), 0) : null,
        board: rows,
      });
    }),
  );
  return out;
}

/** Short-lived links to the private property photos. */
export async function photoUrls(ctx: Ctx, props: PropertyRow[]): Promise<Map<string, string>> {
  const withPhoto = props.filter((p) => p.photo_path);
  if (!withPhoto.length) return new Map();
  const { data } = await ctx.supabase.storage.from("property-photos").createSignedUrls(withPhoto.map((p) => p.photo_path!), 3600);
  const m = new Map<string, string>();
  (data ?? []).forEach((u, i) => u.signedUrl && m.set(withPhoto[i].id, u.signedUrl));
  return m;
}
