import type { getCtx } from "@/lib/auth";
import type { Dict } from "@/lib/i18n/dict";
import { addDays, todayIn } from "@/lib/format";
import { AUDIT_TABLES, describeAudit, type AuditLookups, type AuditRow, type AuditView } from "@/lib/audit";

type Ctx = Awaited<ReturnType<typeof getCtx>>;
type Params = Record<string, string | string[] | undefined>;

export type AuditFilters = {
  table: string; actor: string; action: string; period: string; from: string; to: string; sensitive: boolean; limit: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export function parseAuditFilters(sp: Params | URLSearchParams): AuditFilters {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) ?? "" : one(sp[k]));
  const table = get("table");
  const action = get("action");
  const limit = Math.min(Math.max(Number(get("limit")) || 100, 50), 2000);
  return {
    table: (AUDIT_TABLES as readonly string[]).includes(table) ? table : "",
    actor: /^[0-9a-f-]{36}$|^system$/.test(get("actor")) ? get("actor") : "",
    action: ["insert", "update", "delete"].includes(action) ? action : "",
    period: ["today", "7d", "30d", "custom"].includes(get("period"))
      ? get("period")
      : DATE.test(get("from")) || DATE.test(get("to")) ? "custom" : "",
    from: DATE.test(get("from")) ? get("from") : "",
    to: DATE.test(get("to")) ? get("to") : "",
    sensitive: get("sensitive") === "1",
    limit,
  };
}

export function filtersToQuery(f: AuditFilters, extra: Partial<AuditFilters> = {}) {
  const g = { ...f, ...extra };
  const q = new URLSearchParams();
  if (g.table) q.set("table", g.table);
  if (g.actor) q.set("actor", g.actor);
  if (g.action) q.set("action", g.action);
  if (g.period) q.set("period", g.period);
  if (g.period === "custom" && g.from) q.set("from", g.from);
  if (g.period === "custom" && g.to) q.set("to", g.to);
  if (g.sensitive) q.set("sensitive", "1");
  if (g.limit !== 100) q.set("limit", String(g.limit));
  return q.toString();
}

/** Start of a local calendar day in the property's timezone, as an ISO instant. */
export function zonedStart(day: string, tz: string): string {
  const utc = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(utc);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asLocal = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"));
  return new Date(utc.getTime() - (asLocal - utc.getTime())).toISOString();
}

function range(f: AuditFilters, tz: string): { from?: string; to?: string } {
  const today = todayIn(tz);
  if (f.period === "today") return { from: zonedStart(today, tz) };
  if (f.period === "7d") return { from: zonedStart(addDays(today, -6), tz) };
  if (f.period === "30d") return { from: zonedStart(addDays(today, -29), tz) };
  if (f.period === "custom") {
    return { from: f.from ? zonedStart(f.from, tz) : undefined, to: f.to ? zonedStart(addDays(f.to, 1), tz) : undefined };
  }
  return {};
}

/** Resolves the ids that appear in a batch of rows into names (staff, units, guests, stays). */
export async function auditLookups(ctx: Ctx, rows: AuditRow[]): Promise<AuditLookups> {
  const ids = (field: string) =>
    [...new Set(rows.flatMap((r) => [r.new_data?.[field], r.old_data?.[field]]).filter((v): v is string => typeof v === "string"))];
  const guestIds = ids("guest_id");
  const folioIds = ids("folio_id");
  const [{ data: staff }, { data: units }, { data: guests }, { data: folios }] = await Promise.all([
    ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
    ctx.supabase.from("units").select("id, number").eq("property_id", ctx.property.id),
    guestIds.length ? ctx.supabase.from("guests").select("id, full_name").in("id", guestIds) : Promise.resolve({ data: [] }),
    folioIds.length
      ? ctx.supabase.from("folios").select("id, reservation_id, reservations(code)").in("id", folioIds)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    staff: new Map((staff ?? []).map((m) => [m.user_id as string, m.full_name as string])),
    units: new Map((units ?? []).map((u) => [u.id as string, u.number as string])),
    guests: new Map(((guests ?? []) as { id: string; full_name: string }[]).map((g) => [g.id, g.full_name])),
    folios: new Map(
      ((folios ?? []) as { id: string; reservation_id: string | null; reservations: { code: string } | { code: string }[] | null }[]).map((f) => {
        const res = Array.isArray(f.reservations) ? f.reservations[0] : f.reservations;
        return [f.id, { reservationId: f.reservation_id, code: res?.code ?? null }];
      }),
    ),
    reservations: new Map(),
    tz: ctx.property.timezone,
  };
}

export type AuditEntry = AuditRow & AuditView;

/** Filtered page of the log, each row already described in plain language. */
export async function loadAudit(ctx: Ctx, f: AuditFilters, t: Dict, lang: "ar" | "en") {
  const { from, to } = range(f, ctx.property.timezone);
  // "sensitive" is decided per row in code, so read a wider window and trim afterwards
  const fetch = f.sensitive ? Math.max(f.limit * 5, 1000) : f.limit + 1;
  let q = ctx.supabase.from("audit_log").select("*").eq("tenant_id", ctx.tenantId).order("at", { ascending: false }).limit(fetch);
  if (f.table) q = q.eq("table_name", f.table);
  if (f.action) q = q.eq("action", f.action);
  if (f.actor === "system") q = q.is("actor", null);
  else if (f.actor) q = q.eq("actor", f.actor);
  if (from) q = q.gte("at", from);
  if (to) q = q.lt("at", to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditRow[];
  const lk = await auditLookups(ctx, rows);
  let entries: AuditEntry[] = rows.map((r) => ({ ...r, ...describeAudit(r, t, lang, lk) }));
  if (f.sensitive) entries = entries.filter((e) => e.sensitive);
  const hasMore = entries.length > f.limit;
  return { entries: entries.slice(0, f.limit), hasMore, lk };
}

/** Header numbers: activity today, sensitive actions today, most active person this week. */
export async function auditStats(ctx: Ctx, t: Dict, lang: "ar" | "en") {
  const tz = ctx.property.timezone;
  const today = todayIn(tz);
  const { data } = await ctx.supabase
    .from("audit_log")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .gte("at", zonedStart(addDays(today, -6), tz))
    .order("at", { ascending: false })
    .limit(3000);
  const rows = (data ?? []) as AuditRow[];
  const lk = await auditLookups(ctx, rows);
  const startToday = zonedStart(today, tz);
  const todays = rows.filter((r) => r.at >= startToday);
  const sensitiveToday = todays.filter((r) => describeAudit(r, t, lang, lk).sensitive).length;
  const counts = new Map<string, number>();
  for (const r of rows) if (r.actor) counts.set(r.actor, (counts.get(r.actor) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    today: todays.length,
    sensitiveToday,
    top: top ? { name: lk.staff.get(top[0]) ?? top[0].slice(0, 8), count: top[1] } : null,
  };
}
