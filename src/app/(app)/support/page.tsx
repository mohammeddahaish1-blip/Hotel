import { SettingsTabs } from "../settings/SettingsTabs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { History, LifeBuoy, ShieldCheck, Wrench } from "lucide-react";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section, type Tone } from "@/components/ui";
import { cancelSupportRequest, createSupportRequest, decideSupportRequest, revokeSupportAccess } from "@/app/actions/support";

type Req = {
  id: string; kind: "maintenance" | "change"; title: string; details: string | null; status: string;
  scheduled_for: string | null; access_hours: number | null; access_from: string | null; access_until: string | null;
  from_team: boolean; decision_note: string | null; report: string | null; completed_at: string | null; created_at: string;
};
type Sess = { id: string; request_id: string; user_id: string; staff_name: string; started_at: string; ends_by: string; ended_at: string | null; summary: string | null };

const TONE: Record<string, Tone> = { open: "info", awaiting_hotel: "warn", approved: "ok", rejected: "gray", done: "ok", cancelled: "gray" };

function minutes(a: string, b: string, lang: string) {
  const [h, mn] = lang === "ar" ? ["س", "د"] : ["h", "m"];
  const m = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));
  return m < 60 ? `${m} ${mn}` : `${Math.floor(m / 60)} ${h} ${m % 60 ? `${m % 60} ${mn}` : ""}`.trim();
}

/** The hotel's side of support: ask the Nuzul team for a change, approve maintenance, see every entry. */
export default async function SupportPage() {
  const ctx = await getCtx();
  if (!hasRole(ctx, ["manager"])) redirect("/denied?area=settings");
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const when = (d: string | null) => dateTime(d, tz, lang);
  const [{ data: reqs }, { data: sess }] = await Promise.all([
    ctx.supabase.from("support_requests").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(60),
    ctx.supabase.from("support_sessions").select("*").eq("tenant_id", ctx.tenantId).order("started_at", { ascending: false }).limit(60),
  ]);
  const requests = (reqs ?? []) as Req[];
  const sessions = (sess ?? []) as Sess[];
  const now = new Date().toISOString();
  const byId = new Map(requests.map((r) => [r.id, r]));
  const waiting = requests.filter((r) => r.status === "awaiting_hotel");
  const rest = requests.filter((r) => r.status !== "awaiting_hotel");

  const card = (r: Req) => {
    const live = r.status === "approved" && r.access_until && r.access_until > now;
    return (
      <li key={r.id} className="border-b border-line py-3 last:border-0">
        <div className="flex flex-wrap items-center gap-2">
          {r.kind === "maintenance" ? <Wrench className="size-4 shrink-0 text-muted" aria-hidden /> : <LifeBuoy className="size-4 shrink-0 text-muted" aria-hidden />}
          <span className="font-semibold">{r.title}</span>
          <Badge tone="gray">{t[`sup_k_${r.kind}` as DictKey]}</Badge>
          <Badge tone={live ? "ok" : TONE[r.status] ?? "gray"}>
            {r.status === "approved" && !live ? t.sup_s_auto : t[`sup_st_${r.status}` as DictKey]}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted">
          {when(r.created_at)}{r.from_team ? ` · ${t.sup_by_team}` : ""}
          {r.scheduled_for ? ` · ${t.sup_scheduled}: ${when(r.scheduled_for)}` : ""}
        </div>
        {r.details ? <p className="mt-2 whitespace-pre-line text-sm">{r.details}</p> : null}
        {r.status === "awaiting_hotel" && r.access_hours ? (
          <p className="mt-2 text-sm font-semibold text-warn">{t.sup_access_hours.replace("{n}", String(r.access_hours))}</p>
        ) : null}
        {r.status === "approved" && r.access_from && r.access_until ? (
          <p className="mt-2 text-sm">{t.sup_access_window.replace("{a}", when(r.access_from)).replace("{b}", when(r.access_until))}</p>
        ) : null}
        {r.decision_note ? <p className="mt-1 text-xs text-muted">{r.decision_note}</p> : null}
        {r.report ? (
          <div className="mt-2 rounded-xl bg-ok-soft px-3 py-2 text-sm">
            <div className="text-xs font-bold text-ok">{t.sup_report} · {when(r.completed_at)}</div>
            <p className="mt-1 whitespace-pre-line">{r.report}</p>
          </div>
        ) : null}

        {r.status === "awaiting_hotel" ? (
          <ActionForm action={decideSupportRequest} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={r.id} />
            <input name="note" placeholder={t.sup_note} aria-label={t.sup_note} maxLength={500} className="input min-w-0 flex-1 py-2" />
            <button name="approve" value="1" className="btn-primary btn-sm">{t.sup_approve}</button>
            <button name="approve" value="0" className="btn-ghost btn-sm text-danger">{t.sup_reject}</button>
          </ActionForm>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {live ? (
            <ActionForm action={revokeSupportAccess}>
              <input type="hidden" name="id" value={r.id} />
              <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.sup_revoke_q}>{t.sup_revoke}</SubmitButton>
            </ActionForm>
          ) : null}
          {["open", "awaiting_hotel", "approved"].includes(r.status) && !r.from_team ? (
            <ActionForm action={cancelSupportRequest}>
              <input type="hidden" name="id" value={r.id} />
              <SubmitButton className="btn-ghost btn-sm" confirm={t.sup_cancel_q}>{t.sup_cancel}</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <>
      <SettingsTabs ctx={ctx} t={t} current="support" />
      <PageHeader title={t.sup_title} sub={t.sup_sub} />
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /> {t.sup_hint}
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {waiting.length ? (
            <Section title={t.sup_st_awaiting_hotel}><ul>{waiting.map(card)}</ul></Section>
          ) : null}
          <Section title={t.sup_list}>
            {rest.length ? <ul>{rest.map(card)}</ul> : <Empty>{t.sup_none}</Empty>}
          </Section>
          <Section title={t.sup_sessions}>
            {sessions.length === 0 ? <Empty>{t.sup_sessions_none}</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {sessions.map((x) => {
                  const end = x.ended_at ?? (x.ends_by < now ? x.ends_by : null);
                  return (
                    <li key={x.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold">{x.staff_name}</span>
                        {end ? <span className="num text-xs text-muted">{minutes(x.started_at, end, lang)}</span> : <Badge tone="warn">{t.sup_s_now}</Badge>}
                        {!x.ended_at && end ? <Badge tone="gray">{t.sup_s_auto}</Badge> : null}
                        <Link href={`/audit?actor=${x.user_id}`} className="ms-auto inline-flex items-center gap-1 text-xs text-brand">
                          <History className="size-3.5 shrink-0" aria-hidden /> {t.sup_s_changes}
                        </Link>
                      </div>
                      <div className="text-xs text-muted">
                        {when(x.started_at)} ← {end ? when(end) : "…"} · {byId.get(x.request_id)?.title ?? ""}
                      </div>
                      {x.summary ? <p className="mt-1 text-xs">{x.summary}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
        <Section title={t.sup_new}>
          <ActionForm action={createSupportRequest} resetOnSuccess className="space-y-3">
            <Field label={t.sup_req_title}><input name="title" required minLength={2} maxLength={120} className="input" /></Field>
            <Field label={t.sup_req_details}><textarea name="details" rows={4} maxLength={2000} className="input" /></Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="grant" className="mt-1" /> {t.sup_grant}
            </label>
            <Field label={t.sup_hours}>
              <select name="hours" defaultValue="4" className="input">
                {[1, 2, 4, 8, 24, 48, 72].map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
            <SubmitButton className="btn-primary w-full">{t.sup_send}</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
