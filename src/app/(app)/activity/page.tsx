import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { addDays, todayIn, zonedStart } from "@/lib/format";
import { describeAudit, tableLabel, type AuditRow } from "@/lib/audit";
import { auditLookups } from "@/lib/audit-query";
import { Badge, Empty, PageHeader, Stat, type Tone } from "@/components/ui";

const ACTION_TONE: Record<string, Tone> = { insert: "ok", update: "info", delete: "danger" };
const ACTION_EMOJI: Record<string, React.ReactNode> = { insert: <Plus className="size-3.5 shrink-0" />, update: <Pencil className="size-3.5 shrink-0" />, delete: <Trash2 className="size-3.5 shrink-0" /> };

/**
 * What happened in the hotel, phone-friendly. Everyone sees their own operations;
 * owner and manager see everyone's and can pick one employee.
 */
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const seesAll = hasRole(ctx, ["manager"]);
  const sp = await searchParams;
  const person = seesAll ? (typeof sp.u === "string" && /^[0-9a-f-]{36}$/.test(sp.u) ? sp.u : "") : ctx.userId;

  let q = ctx.supabase.from("audit_log").select("*").eq("tenant_id", ctx.tenantId).order("at", { ascending: false }).limit(200);
  if (person) q = q.eq("actor", person);
  else q = q.not("actor", "is", null);
  const [{ data }, { data: staff }] = await Promise.all([
    q,
    ctx.supabase.from("memberships").select("user_id, full_name, job_title, role").eq("tenant_id", ctx.tenantId).order("created_at"),
  ]);
  const rows = (data ?? []) as AuditRow[];
  const lk = await auditLookups(ctx, rows);
  const entries = rows.map((r) => ({ ...r, ...describeAudit(r, t, lang === "ur" ? "en" : lang, lk) }));

  const today = todayIn(tz);
  const startToday = zonedStart(today, tz);
  const startYesterday = zonedStart(addDays(today, -1), tz);
  const groups = [
    { label: t.audit_today, rows: entries.filter((e) => e.at >= startToday) },
    { label: t.act_yesterday, rows: entries.filter((e) => e.at >= startYesterday && e.at < startToday) },
    { label: t.act_earlier, rows: entries.filter((e) => e.at < startYesterday) },
  ].filter((g) => g.rows.length);
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", timeZone: tz }).format(new Date(iso));
  const todayCount = groups[0]?.label === t.audit_today ? groups[0].rows.length : 0;

  return (
    <>
      <PageHeader title={t.nav_activity} sub={seesAll ? t.act_sub_all : t.act_sub_own} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={t.audit_stat_today} value={todayCount} />
        <Stat label={t.audit_stat_sensitive} value={entries.filter((e) => e.at >= startToday && e.sensitive).length} tone={entries.some((e) => e.at >= startToday && e.sensitive) ? "warn" : undefined} />
      </div>
      {seesAll ? (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          <Link href="/activity" className={`btn-sm shrink-0 ${!person ? "btn-primary" : "btn-ghost"}`}>{t.act_everyone}</Link>
          {(staff ?? []).map((m) => (
            <Link key={m.user_id} href={`/activity?u=${m.user_id}`} className={`btn-sm shrink-0 ${person === m.user_id ? "btn-primary" : "btn-ghost"}`}>
              {m.full_name || "—"}
            </Link>
          ))}
        </div>
      ) : null}
      {!groups.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 text-sm font-bold text-muted">{g.label}</h2>
              <ol className="card divide-y divide-line p-0">
                {g.rows.map((e) => (
                  <li key={e.id} className={`flex gap-3 px-4 py-3 ${e.sensitive ? "bg-warn-soft/40" : ""}`}>
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand" aria-hidden>
                      {(lk.staff.get(e.actor ?? "") ?? "؟").slice(0, 1)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <b>{lk.staff.get(e.actor ?? "") ?? "—"}</b>
                        <span className="text-xs text-muted">· {tableLabel(e.table_name, lang === "ur" ? "en" : lang)}</span>
                        <span className="num ms-auto text-xs text-muted">{g.label === t.act_earlier ? `${day(e.at)} ` : ""}{time(e.at)}</span>
                      </div>
                      <div className="mt-0.5 text-sm" dir="auto">
                        {e.href ? <Link href={e.href} className="hover:text-brand hover:underline">{e.summary}</Link> : e.summary}
                      </div>
                    </div>
                    <span className="shrink-0 self-center"><Badge tone={ACTION_TONE[e.action] ?? "gray"}>{ACTION_EMOJI[e.action]}</Badge></span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
