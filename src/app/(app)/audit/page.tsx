import { ChevronDown, Download, ExternalLink, Filter, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { can, getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, isRtl, type DictKey } from "@/lib/i18n/dict";
import { addDays, todayIn, zonedStart } from "@/lib/format";
import { AUDIT_TABLES, actionLabel, actorLabel, auditTag, tableLabel, type AuditTag } from "@/lib/audit";
import { auditStats, filtersToQuery, loadAudit, parseAuditFilters } from "@/lib/audit-query";
import { initial, profileHref } from "@/lib/profile-link";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";

const TAG_TONE: Record<AuditTag["tone"], string> = {
  ok: "bg-ok-soft text-ok", info: "bg-info-soft text-info", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger",
  brand: "bg-brand-soft text-brand", violet: "bg-violet-soft text-violet", gray: "bg-gray-soft text-muted",
};

/**
 * One log for the whole hotel: who did what and when, one line each — time, the person and their job,
 * a plain sentence and a coloured tag — and the before → after on tap. Owner, manager and accountant
 * see everyone (with per-person counts, filters and export); every other employee sees their own.
 */
export default async function LogPage({ searchParams }: PageProps<"/audit">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const seesAll = can(ctx, "audit");
  const f = parseAuditFilters(await searchParams);
  if (!seesAll) f.actor = ctx.userId;
  const weekAgo = zonedStart(addDays(todayIn(tz), -6), tz);
  const [{ entries, hasMore, lk }, stats, { data: staffRows }, { data: weekRows }] = await Promise.all([
    loadAudit(ctx, f, t, lang),
    auditStats(ctx, t, lang),
    ctx.supabase.from("memberships").select("user_id, full_name, job_title, role").eq("tenant_id", ctx.tenantId).order("created_at"),
    seesAll
      ? ctx.supabase.from("audit_log").select("actor").eq("tenant_id", ctx.tenantId).gte("at", weekAgo).not("actor", "is", null).limit(10000)
      : Promise.resolve({ data: [] as { actor: string }[] }),
  ]);
  const staff = (staffRows ?? []) as { user_id: string; full_name: string | null; job_title: string | null; role: string }[];
  const jobOf = new Map(staff.map((m) => [m.user_id, m.job_title || t[`role_${m.role}` as DictKey] || ""]));
  const weekCount = new Map<string, number>();
  for (const r of (weekRows ?? []) as { actor: string }[]) weekCount.set(r.actor, (weekCount.get(r.actor) ?? 0) + 1);
  const weekTotal = [...weekCount.values()].reduce((x, y) => x + y, 0);
  const filtered = !!(f.table || f.action || f.period || f.sensitive);
  const qs = filtersToQuery(f);
  const al = lang === "ur" ? "en" : lang;

  // one section per day: "Today, Saturday 07/11/2026"
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
  const today = todayIn(tz);
  const yesterday = addDays(today, -1);
  const loc = intlLocale(lang);
  const dayTitle = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat(loc, { weekday: "long", timeZone: "UTC" }).format(d);
    const date = key.split("-").reverse().join("/");
    const rel = key === today ? t.audit_today : key === yesterday ? t.act_yesterday : null;
    return rel ? `${rel}، ${weekday} ${date}` : `${weekday} ${date}`;
  };
  const days: { key: string; rows: typeof entries }[] = [];
  for (const e of entries) {
    const k = dayKey(e.at);
    const last = days[days.length - 1];
    if (last && last.key === k) last.rows.push(e); else days.push({ key: k, rows: [e] });
  }
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const withActor = (actor: string) => `/audit?${filtersToQuery({ ...f, actor, limit: 100 })}`;
  const chip = (href: string, label: string, count: number | null, on: boolean) => (
    <Link key={href} href={href} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${on ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface hover:bg-surface-2"}`}>
      {label}{count !== null ? <span className={`num text-xs ${on ? "opacity-80" : "text-muted"}`}>{count}</span> : null}
    </Link>
  );

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
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">{t.log_who}</h2>
          <span className="text-xs text-muted">{t.log_last7}</span>
        </div>
      ) : null}
      {seesAll ? (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {chip(withActor(""), t.act_everyone, weekTotal, !f.actor)}
          {staff.map((m) => chip(withActor(m.user_id), m.full_name || "—", weekCount.get(m.user_id) ?? 0, f.actor === m.user_id))}
          {chip(withActor("system"), t.audit_system, null, f.actor === "system")}
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

      {!days.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.key}>
              <h2 className="mb-2 text-sm font-bold">{dayTitle(d.key)}</h2>
              <ol className="card divide-y divide-line overflow-hidden p-0">
                {d.rows.map((e) => {
                  const who = actorLabel(e.actor, lk, al);
                  const job = e.actor ? jobOf.get(e.actor) ?? "" : "";
                  const href = profileHref(ctx, e.actor);
                  const tag = auditTag(e, al);
                  const more = e.changes.length > 0 || !!e.href;
                  const line = (
                    <>
                      <span className="num w-11 shrink-0 text-sm text-muted">{time(e.at)}</span>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand" aria-hidden>{initial(who)}</span>
                      <span className="min-w-0 flex-1 sm:w-40 sm:flex-none">
                        {href ? (
                          <Link href={href} className="block truncate font-bold hover:text-brand hover:underline">{who}</Link>
                        ) : (
                          <span className="block truncate font-bold">{who}</span>
                        )}
                        {job ? <span className="block truncate text-xs text-muted">{job}</span> : null}
                      </span>
                      <span className="order-last w-full text-sm leading-6 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1" dir="auto">
                        {e.summary}
                        {/* a bare "edited …" also says what was edited */}
                        {e.action === "update" && e.changes.length && !/[←→]/.test(e.summary) ? (
                          <span className="text-muted"> — {e.changes.slice(0, 3).map((c) => c.label).join("، ")}{e.changes.length > 3 ? "…" : ""}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {e.sensitive ? <TriangleAlert className="size-4 shrink-0 text-warn" aria-label={t.audit_sensitive} /> : null}
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TAG_TONE[tag.tone]}`}>
                          <span className="size-1.5 rounded-full bg-current" aria-hidden />{tag.label}
                        </span>
                        {more ? <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden /> : <span className="size-4" />}
                      </span>
                    </>
                  );
                  return (
                    <li key={e.id} className={e.sensitive ? "bg-warn-soft/30" : undefined}>
                      {more ? (
                        <details className="group">
                          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-surface-2/60 sm:flex-nowrap [&::-webkit-details-marker]:hidden">{line}</summary>
                          <div className="space-y-2 border-t border-line bg-surface-2/40 px-4 py-3 text-xs sm:ps-[7.5rem]">
                            {e.changes.length ? (
                              <ul className="space-y-1">
                                {e.changes.map((c) => (
                                  <li key={c.field}>
                                    <span className="font-semibold">{c.label}:</span>{" "}
                                    {c.before !== null ? <><span className="text-danger line-through decoration-danger/40" dir="auto">{c.before}</span> {isRtl(lang) ? "←" : "→"}{" "}</> : null}
                                    <span className="font-semibold text-ok" dir="auto">{c.after}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {e.href ? (
                              <Link href={e.href} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                                <ExternalLink className="size-3.5 shrink-0" /> {t.log_open}
                              </Link>
                            ) : null}
                          </div>
                        </details>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:flex-nowrap">{line}</div>
                      )}
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
