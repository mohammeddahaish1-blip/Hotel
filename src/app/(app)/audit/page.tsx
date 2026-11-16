import { ChevronDown, Download, ExternalLink, Filter, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { canOpen, can, getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, isRtl, type DictKey } from "@/lib/i18n/dict";
import { addDays, todayIn, zonedStart } from "@/lib/format";
import { AUDIT_TABLES, actionLabel, actorLabel, auditTag, tableLabel, type AuditTag } from "@/lib/audit";
import { AUDIT_SCAN, auditStats, filtersToQuery, loadAudit, parseAuditFilters } from "@/lib/audit-query";
import { FilterSelect } from "@/components/FilterSelect";
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
  const filtered = !!(f.table || f.action || f.sensitive || f.period === "custom");
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
  const periodHref = (period: string) => `/audit?${filtersToQuery({ ...f, period, from: "", to: "", limit: 100 })}`;
  // every small form on the page keeps the other choices
  const keep = (skip: string[]) =>
    [...new URLSearchParams(filtersToQuery({ ...f, limit: 100 })).entries()].filter(([k]) => !skip.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const recordOf = (href: string | null) => /^\/(reservations|guests)\/([0-9a-f-]{36})$/.exec(href ?? "");
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
          <div className="text-end">
            <a href={`/api/export/audit${qs ? `?${qs}` : ""}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Download className="size-4 shrink-0" /> {t.rep_download}</a>
            <div className="mt-1 text-xs text-muted">{t.log_export_hint}</div>
          </div>
        ) : null}
      />

      {/* the three numbers, as one line */}
      <p className="mb-3 text-sm">
        {t.audit_stat_today} <b className="num">{stats.today}</b>
        <span className="text-muted"> · </span>
        {t.audit_sensitive} <Link href={`/audit?${filtersToQuery({ ...f, period: "today", from: "", to: "", sensitive: true, limit: 100 })}`} className={`num font-bold ${stats.sensitiveToday ? "text-warn" : ""}`}>{stats.sensitiveToday}</Link>
        {seesAll && stats.top ? <><span className="text-muted"> · </span>{t.audit_stat_top} <b>{stats.top.name}</b> <span className="num text-muted">({stats.top.count})</span></> : null}
      </p>

      {stats.sensitiveToday && !f.sensitive ? (
        <section className="mb-4 flex flex-wrap items-center gap-3 rounded-3xl bg-warn-soft p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-warn"><TriangleAlert className="size-5" aria-hidden /></span>
          <div className="min-w-48 flex-1">
            <h2 className="font-bold text-warn">{t.log_sens_title.replace("{n}", String(stats.sensitiveToday))}</h2>
            <p className="text-sm">{stats.sensitiveKinds.join(" · ")}</p>
          </div>
          <Link href={`/audit?${filtersToQuery({ ...f, period: "today", from: "", to: "", sensitive: true, limit: 100 })}`} className="btn-primary btn-sm">{t.log_show}</Link>
        </section>
      ) : null}

      <div className="card mb-4 space-y-3">
        <form method="get" className="flex gap-2">
          {keep(["q"])}
          <input type="search" name="q" defaultValue={f.q} placeholder={t.log_search} aria-label={t.log_search} className="input rounded-full" />
          <button className="btn-ghost shrink-0">{t.search}</button>
        </form>
        {f.q ? <p className="text-xs text-muted">{t.log_search_note.replace("{n}", String(AUDIT_SCAN))}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex max-w-full gap-1.5 overflow-x-auto" role="group" aria-label={t.audit_period}>
            {([["", t.audit_any_time], ["today", t.audit_today], ["yesterday", t.act_yesterday], ["7d", t.audit_7d], ["30d", t.audit_30d]] as const).map(([k, label]) => (
              <Link key={k || "all"} href={periodHref(k)} aria-current={f.period === k ? "true" : undefined} className={`btn-sm shrink-0 ${f.period === k ? "btn-primary" : "btn-ghost"}`}>{label}</Link>
            ))}
          </div>
          {seesAll ? (
            <form method="get" className="ms-auto flex items-center gap-2">
              {keep(["actor"])}
              <span className="text-sm font-semibold">{t.log_who_q}</span>
              <FilterSelect name="actor" label={t.log_who_q} value={f.actor} options={[["", t.act_everyone], ...staff.map((m): [string, string] => [m.user_id, `${m.full_name || "—"} (${weekCount.get(m.user_id) ?? 0})`]), ["system", t.audit_system]]} />
            </form>
          ) : null}
        </div>
        {f.record ? (
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {t.log_one_record}
            <Link href={`/audit?${filtersToQuery({ ...f, record: "", limit: 100 })}`} className="btn-ghost btn-sm">{t.audit_reset}</Link>
          </p>
        ) : null}
        <details open={filtered} className="rounded-2xl bg-surface-2 p-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <Filter className="size-4 shrink-0 text-muted" /> {t.log_more_filters}
            {filtered ? <Badge tone="brand">{t.log_filtered}</Badge> : null}
          </summary>
          <form method="get" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {keep(["table", "action", "sensitive", "from", "to", "period"])}
            {f.period && f.period !== "custom" ? <input type="hidden" name="period" value={f.period} /> : null}
            <label className="text-xs font-semibold text-muted">
              {t.log_about}
              <select name="table" defaultValue={f.table} className="input mt-1">
                <option value="">{t.audit_all_tables}</option>
                {AUDIT_TABLES.map((x) => <option key={x} value={x}>{tableLabel(x, lang)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t.log_what}
              <select name="action" defaultValue={f.action} className="input mt-1">
                <option value="">{t.audit_all_actions}</option>
                {["insert", "update", "delete"].map((x) => <option key={x} value={x}>{actionLabel(x, lang)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-muted">
              {t.log_custom}: {t.from}
              <input type="date" name="from" defaultValue={f.period === "custom" ? f.from : ""} className="input mt-1" />
            </label>
            <label className="text-xs font-semibold text-muted">
              {t.to}
              <input type="date" name="to" defaultValue={f.period === "custom" ? f.to : ""} className="input mt-1" />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2" title={t.audit_sensitive_hint}>
              <input type="checkbox" name="sensitive" value="1" defaultChecked={f.sensitive} />
              <TriangleAlert className="size-4 shrink-0" /> {t.audit_sensitive_only}
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:justify-end">
              <button className="btn-primary btn-sm">{t.audit_apply}</button>
              {filtered ? <Link href={`/audit?${filtersToQuery({ ...f, table: "", action: "", period: f.period === "custom" ? "" : f.period, from: "", to: "", sensitive: false, limit: 100 })}`} className="btn-ghost btn-sm">{t.audit_reset}</Link> : null}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted sm:col-span-2 lg:col-span-4"><TriangleAlert className="size-3.5 shrink-0" /> {t.audit_sensitive_hint}</p>
          </form>
        </details>
      </div>

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
                  const link = canOpen(ctx, e.href) ? e.href : null;
                  const more = e.changes.length > 0 || !!link;
                  const line = (
                    <>
                      {/* tablets and desktops: time, person, sentence, tag in one row */}
                      <span className="hidden w-full items-center gap-x-3 sm:flex">
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
                      <span className="min-w-0 flex-1 text-sm leading-6" dir="auto">
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
                      </span>
                      {/* phones: what happened first, then who and when */}
                      <span className="flex w-full flex-col gap-0.5 sm:hidden">
                        <span className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-sm leading-6" dir="auto">
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
                        </span>
                        <span className="text-xs text-muted">{who}{job ? ` · ${job}` : ""} · <span className="num">{time(e.at)}</span></span>
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
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {link ? (
                                <Link href={link} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                                  <ExternalLink className="size-3.5 shrink-0" /> {t.log_open}
                                </Link>
                              ) : null}
                              {seesAll && recordOf(e.href) && !f.record ? (
                                <Link href={`/audit?record=${recordOf(e.href)![2]}`} className="font-semibold text-brand hover:underline">
                                  {recordOf(e.href)![1] === "guests" ? t.log_all_guest : t.log_all_res}
                                </Link>
                              ) : null}
                            </div>
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
