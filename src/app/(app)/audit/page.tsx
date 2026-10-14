import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dateTime } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

const WATCHED = ["status", "stay", "unit_id", "room_total", "discount_amount", "amount", "voided_at", "rate_bp", "nightly_rate", "monthly_rate", "kind", "method", "role", "active", "closed_at", "difference"];

// FR-54: who, when, before → after. Read-only; the table is append-only in the database.
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireArea("audit");
  const { t, lang } = await getDict();
  const table = (await searchParams).table;
  let q = ctx.supabase.from("audit_log").select("*").eq("tenant_id", ctx.tenantId).order("at", { ascending: false }).limit(200);
  if (typeof table === "string" && table) q = q.eq("table_name", table);
  const [{ data: rows }, { data: staff }] = await Promise.all([
    q,
    ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
  ]);
  const name = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const tables = ["reservations", "payments", "charges", "invoices", "credit_notes", "unit_types", "rate_plans", "tax_rules", "cash_shifts", "expenses", "memberships"];

  return (
    <>
      <PageHeader title={t.audit_title} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <a href="/audit" className={`btn-sm ${!table ? "btn-primary" : "btn-ghost"}`}>*</a>
        {tables.map((x) => (
          <a key={x} href={`/audit?table=${x}`} className={`btn-sm ${table === x ? "btn-primary" : "btn-ghost"}`}>{x}</a>
        ))}
      </div>
      {!rows?.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>{t.date}</th><th>{t.audit_actor}</th><th>{t.audit_table}</th><th>{t.audit_action}</th><th>{t.audit_changes}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const before = (r.old_data ?? {}) as Record<string, unknown>;
                const after = (r.new_data ?? {}) as Record<string, unknown>;
                const changed = WATCHED.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && (k in before || k in after));
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs">{dateTime(r.at, ctx.property.timezone, lang)}</td>
                    <td className="text-xs">{r.actor ? name.get(r.actor) ?? r.actor.slice(0, 8) : "system"}</td>
                    <td className="text-xs">{r.table_name}</td>
                    <td className="text-xs">{r.action}</td>
                    <td className="text-xs" dir="ltr">
                      {changed.map((k) => (
                        <div key={k}>
                          <b>{k}</b>: {r.action === "insert" ? "" : `${JSON.stringify(before[k]) ?? "∅"} → `}{JSON.stringify(after[k]) ?? "∅"}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
