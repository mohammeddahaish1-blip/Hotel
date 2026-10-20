import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dateTime } from "@/lib/format";
import { AUDIT_TABLES, actionLabel, actorLabel, tableLabel } from "@/lib/audit";
import { auditStats, filtersToQuery, loadAudit, parseAuditFilters } from "@/lib/audit-query";
import { Badge, Empty, PageHeader, Stat, type Tone } from "@/components/ui";

const ACTION_TONE: Record<string, Tone> = { insert: "ok", update: "info", delete: "danger" };
const ACTION_EMOJI: Record<string, string> = { insert: "➕", update: "✏️", delete: "🗑️" };

// FR-54: who, when, before → after — in plain language. Read-only; the table is append-only in the database.
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await requireArea("audit");
  const { t, lang } = await getDict();
  const f = parseAuditFilters(await searchParams);
  const [{ entries, hasMore, lk }, stats] = await Promise.all([loadAudit(ctx, f, t, lang), auditStats(ctx, t, lang)]);
  const staff = [...lk.staff.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = !!(f.table || f.actor || f.action || f.period || f.sensitive);
  const qs = filtersToQuery(f);

  return (
    <>
      <PageHeader
        title={t.audit_title}
        actions={<a href={`/api/export/audit${qs ? `?${qs}` : ""}`} className="btn-ghost btn-sm">⬇️ {t.audit_export}</a>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t.audit_stat_today} value={stats.today} />
        <Stat
          label={t.audit_stat_sensitive}
          value={<Link href={`/audit?period=today&sensitive=1`}>⚠️ {stats.sensitiveToday}</Link>}
          tone={stats.sensitiveToday ? "warn" : undefined}
        />
        <Stat label={t.audit_stat_top} value={stats.top ? stats.top.name : "—"} hint={stats.top ? `${stats.top.count} ${t.audit_ops}` : undefined} />
      </div>

      <form method="get" className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-muted">
          {t.audit_table}
          <select name="table" defaultValue={f.table} className="input mt-1">
            <option value="">{t.audit_all_tables}</option>
            {AUDIT_TABLES.map((x) => <option key={x} value={x}>{tableLabel(x, lang)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          {t.audit_actor}
          <select name="actor" defaultValue={f.actor} className="input mt-1">
            <option value="">{t.audit_all_users}</option>
            {staff.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            <option value="system">{t.audit_system}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          {t.audit_action}
          <select name="action" defaultValue={f.action} className="input mt-1">
            <option value="">{t.audit_all_actions}</option>
            {["insert", "update", "delete"].map((a) => <option key={a} value={a}>{ACTION_EMOJI[a]} {actionLabel(a, lang)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          {t.audit_period}
          <select name="period" defaultValue={f.period} className="input mt-1">
            <option value="">{t.audit_any_time}</option>
            <option value="today">{t.audit_today}</option>
            <option value="7d">{t.audit_7d}</option>
            <option value="30d">{t.audit_30d}</option>
            <option value="custom">{t.audit_custom}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-muted">
          {t.from}
          <input type="date" name="from" defaultValue={f.from} className="input mt-1" />
        </label>
        <label className="text-xs font-semibold text-muted">
          {t.to}
          <input type="date" name="to" defaultValue={f.to} className="input mt-1" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm" title={t.audit_sensitive_hint}>
          <input type="checkbox" name="sensitive" value="1" defaultChecked={f.sensitive} />
          ⚠️ {t.audit_sensitive_only}
        </label>
        <div className="flex items-end gap-2">
          <button className="btn-primary btn-sm">{t.audit_apply}</button>
          {filtered ? <Link href="/audit" className="btn-ghost btn-sm">{t.audit_reset}</Link> : null}
        </div>
        <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">⚠️ {t.audit_sensitive_hint}</p>
      </form>

      {!entries.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <>
          <div className="mb-2 text-xs text-muted">{t.audit_count.replace("{n}", String(entries.length))}</div>
          <div className="card overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr><th>{t.date}</th><th>{t.audit_actor}</th><th>{t.audit_table}</th><th>{t.audit_action}</th><th>{t.audit_what}</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className={e.sensitive ? "bg-warn-soft/40" : undefined}>
                    <td className="whitespace-nowrap text-xs">{dateTime(e.at, ctx.property.timezone, lang)}</td>
                    <td className="whitespace-nowrap text-xs">{actorLabel(e.actor, lk, lang)}</td>
                    <td className="whitespace-nowrap text-xs">{tableLabel(e.table_name, lang)}</td>
                    <td className="whitespace-nowrap">
                      <Badge tone={ACTION_TONE[e.action] ?? "gray"}>
                        <span aria-hidden>{ACTION_EMOJI[e.action]}</span> {actionLabel(e.action, lang)}
                      </Badge>
                    </td>
                    <td className="min-w-72 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {e.sensitive ? <Badge tone="warn">⚠️ {t.audit_sensitive}</Badge> : null}
                        {e.href ? (
                          <Link href={e.href} className="font-medium hover:text-brand hover:underline">{e.summary}</Link>
                        ) : (
                          <span className="font-medium">{e.summary}</span>
                        )}
                      </div>
                      {e.changes.length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted">{t.audit_changes} ({e.changes.length})</summary>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {e.changes.map((c) => (
                              <li key={c.field}>
                                <span className="font-semibold">{c.label}:</span>{" "}
                                {c.before !== null ? (
                                  <>
                                    <span className="text-danger line-through" dir="auto">{c.before}</span> {lang === "ar" ? "←" : "→"}{" "}
                                  </>
                                ) : null}
                                <span className="text-ok" dir="auto">{c.after}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore ? (
            <div className="mt-3 text-center">
              <Link href={`/audit?${filtersToQuery(f, { limit: f.limit + 100 })}`} scroll={false} className="btn-ghost btn-sm">{t.audit_more}</Link>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
