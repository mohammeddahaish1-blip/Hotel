import { Download, Filter, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { can, getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { isRtl } from "@/lib/i18n/dict";
import { addDays, todayIn, zonedStart } from "@/lib/format";
import { AUDIT_TABLES, actionLabel, actorLabel, tableLabel } from "@/lib/audit";
import { auditStats, filtersToQuery, loadAudit, parseAuditFilters } from "@/lib/audit-query";
import { initial, profileHref } from "@/lib/profile-link";
import { Badge, Empty, PageHeader, Stat, type Tone } from "@/components/ui";

const ACTION_TONE: Record<string, Tone> = { insert: "ok", update: "info", delete: "danger" };
const ACTION_ICON: Record<string, React.ReactNode> = { insert: <Plus className="size-3.5 shrink-0" />, update: <Pencil className="size-3.5 shrink-0" />, delete: <Trash2 className="size-3.5 shrink-0" /> };

/**
 * One log for the whole hotel (the former "activity" feed and the audit log): who did what and when,
 * with the before → after of every change. Owner, manager and accountant see everyone's operations,
 * can filter and export; every other employee sees their own. The table is append-only in the database.
 */
export default async function LogPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const seesAll = can(ctx, "audit");
  const f = parseAuditFilters(await searchParams);
  if (!seesAll) f.actor = ctx.userId;
  const [{ entries, hasMore, lk }, stats, { data: staffRows }] = await Promise.all([
    loadAudit(ctx, f, t, lang),
    auditStats(ctx, t, lang),
    seesAll ? ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId).order("created_at") : Promise.resolve({ data: [] }),
  ]);
  const staff = (staffRows ?? []) as { user_id: string; full_name: string | null }[];
  const filtered = !!(f.table || f.action || f.period || f.sensitive);
  const qs = filtersToQuery(f);
  const al = lang === "ur" ? "en" : lang;

  const today = todayIn(tz);
  const startToday = zonedStart(today, tz);
  const startYesterday = zonedStart(addDays(today, -1), tz);
  const groups = [
    { key: "today", label: t.audit_today, rows: entries.filter((e) => e.at >= startToday) },
    { key: "yesterday", label: t.act_yesterday, rows: entries.filter((e) => e.at >= startYesterday && e.at < startToday) },
    { key: "earlier", label: t.act_earlier, rows: entries.filter((e) => e.at < startYesterday) },
  ].filter((g) => g.rows.length);
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: tz }).format(new Date(iso));
  const chip = (href: string, label: string, on: boolean) => (
    <Link key={href} href={href} className={`btn-sm shrink-0 ${on ? "btn-primary" : "btn-ghost"}`}>{label}</Link>
  );
  const withActor = (actor: string) => `/audit?${filtersToQuery({ ...f, actor, limit: 100 })}`;

  return (
    <>
      <PageHeader
        title={t.nav_activity}
        sub={seesAll ? t.act_sub_all : t.act_sub_own}
        actions={seesAll ? (
          <a href={`/api/export/audit${qs ? `?${qs}` : ""}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Download className="size-4 shrink-0" /> {t.audit_export}</a>
        ) : null}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t.audit_stat_today} value={stats.today} />
        <Stat
          label={t.audit_stat_sensitive}
          value={<Link href={`/audit?${filtersToQuery({ ...f, period: "today", sensitive: true, limit: 100 })}`} className="inline-flex items-center gap-1.5"><TriangleAlert className="size-5" /> {stats.sensitiveToday}</Link>}
          tone={stats.sensitiveToday ? "warn" : undefined}
        />
        {seesAll ? <Stat label={t.audit_stat_top} value={stats.top ? stats.top.name : "—"} hint={stats.top ? `${stats.top.count} ${t.audit_ops}` : undefined} /> : null}
      </div>

      {seesAll ? (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {chip(withActor(""), t.act_everyone, !f.actor)}
          {staff.map((m) => chip(withActor(m.user_id), m.full_name || "—", f.actor === m.user_id))}
          {chip(withActor("system"), t.audit_system, f.actor === "system")}
        </div>
      ) : null}

      <details className="card mb-4" open={filtered}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <Filter className="size-4 shrink-0 text-muted" /> {seesAll ? t.log_filters : t.log_filter_only}
          {filtered ? <Badge tone="brand">{t.log_filtered}</Badge> : null}
        </summary>
        <form method="get" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {f.actor && seesAll ? <input type="hidden" name="actor" value={f.actor} /> : null}
          <label className="text-xs font-semibold text-muted">
            {t.audit_table}
            <select name="table" defaultValue={f.table} className="input mt-1">
              <option value="">{t.audit_all_tables}</option>
              {AUDIT_TABLES.map((x) => <option key={x} value={x}>{tableLabel(x, lang)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-muted">
            {t.audit_action}
            <select name="action" defaultValue={f.action} className="input mt-1">
              <option value="">{t.audit_all_actions}</option>
              {["insert", "update", "delete"].map((a) => <option key={a} value={a}>{actionLabel(a, lang)}</option>)}
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
          <label className="flex items-center gap-2 self-end pb-2 text-sm" title={t.audit_sensitive_hint}>
            <input type="checkbox" name="sensitive" value="1" defaultChecked={f.sensitive} />
            <TriangleAlert className="size-4 shrink-0" /> {t.audit_sensitive_only}
          </label>
          <label className="text-xs font-semibold text-muted">
            {t.from}
            <input type="date" name="from" defaultValue={f.from} className="input mt-1" />
          </label>
          <label className="text-xs font-semibold text-muted">
            {t.to}
            <input type="date" name="to" defaultValue={f.to} className="input mt-1" />
          </label>
          <div className="flex items-end gap-2">
            <button className="btn-primary btn-sm">{t.audit_apply}</button>
            {filtered ? <Link href={`/audit?${filtersToQuery({ ...f, table: "", action: "", period: "", from: "", to: "", sensitive: false, limit: 100, actor: seesAll ? f.actor : "" })}`} className="btn-ghost btn-sm">{t.audit_reset}</Link> : null}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted sm:col-span-2 lg:col-span-4"><TriangleAlert className="size-3.5 shrink-0" /> {t.audit_sensitive_hint}</p>
        </form>
      </details>

      {!groups.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-sm font-bold text-muted">{g.label}</h2>
              <ol className="card divide-y divide-line p-0">
                {g.rows.map((e) => {
                  const who = actorLabel(e.actor, lk, al);
                  const href = profileHref(ctx, e.actor);
                  return (
                    <li key={e.id} className={`flex gap-3 px-4 py-3 ${e.sensitive ? "bg-warn-soft/40" : ""}`}>
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand" aria-hidden>
                        {initial(who)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-sm">
                          {href ? <Link href={href} className="font-bold hover:text-brand hover:underline">{who}</Link> : <b>{who}</b>}
                          <span className="text-xs text-muted">· {tableLabel(e.table_name, al)}</span>
                          {e.sensitive ? <Badge tone="warn"><TriangleAlert className="size-3.5 shrink-0" /> {t.audit_sensitive}</Badge> : null}
                          <span className="num ms-auto text-xs text-muted">{g.key === "earlier" ? `${day(e.at)} ` : ""}{time(e.at)}</span>
                        </div>
                        <div className="mt-0.5 text-sm" dir="auto">
                          {e.href ? <Link href={e.href} className="hover:text-brand hover:underline">{e.summary}</Link> : e.summary}
                        </div>
                        {e.changes.length ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-muted">{t.audit_changes} ({e.changes.length})</summary>
                            <ul className="mt-1 space-y-0.5 text-xs">
                              {e.changes.map((c) => (
                                <li key={c.field}>
                                  <span className="font-semibold">{c.label}:</span>{" "}
                                  {c.before !== null ? <><span className="text-danger" dir="auto">{c.before}</span> {isRtl(lang) ? "←" : "→"}{" "}</> : null}
                                  <span className="text-ok" dir="auto">{c.after}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                      <span className="shrink-0 self-center"><Badge tone={ACTION_TONE[e.action] ?? "gray"}>{ACTION_ICON[e.action]}</Badge></span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {hasMore ? (
            <div className="text-center">
              <Link href={`/audit?${filtersToQuery(f, { limit: f.limit + 100 })}`} scroll={false} className="btn-ghost btn-sm">{t.audit_more}</Link>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
