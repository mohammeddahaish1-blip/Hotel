import { NextResponse, type NextRequest } from "next/server";
import { getCtx, can } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { csv, dateTime } from "@/lib/format";
import { actionLabel, actorLabel, tableLabel } from "@/lib/audit";
import { loadAudit, parseAuditFilters } from "@/lib/audit-query";

/** Audit log as CSV (opens in Excel), with the same filters as the page. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!can(ctx, "audit")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { t, lang } = await getDict();
  const f = { ...parseAuditFilters(req.nextUrl.searchParams), limit: 2000 };
  const { entries, lk } = await loadAudit(ctx, f, t, lang);
  const rows = entries.map((e) => ({
    [t.date]: dateTime(e.at, ctx.property.timezone, lang),
    [t.audit_actor]: actorLabel(e.actor, lk, lang),
    [t.audit_table]: tableLabel(e.table_name, lang),
    [t.audit_action]: actionLabel(e.action, lang),
    [t.audit_what]: e.summary,
    [t.audit_sensitive]: e.sensitive ? "!" : "",
    [t.audit_changes]: e.changes.map((c) => `${c.label}: ${c.before !== null ? `${c.before} → ` : ""}${c.after}`).join(" | "),
  }));
  const body = csv(rows, [t.date, t.audit_actor, t.audit_table, t.audit_action, t.audit_what, t.audit_sensitive, t.audit_changes]);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
