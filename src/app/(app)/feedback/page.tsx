import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime } from "@/lib/format";
import { feedbackUrl, qrPng, qrSvg } from "@/lib/feedback-qr";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, Stat, type Tone } from "@/components/ui";
import { updateFeedback } from "@/app/actions/feedback";

type Row = {
  id: string; kind: "suggestion" | "complaint"; message: string; rating: number | null; guest_name: string | null;
  contact: string | null; room: string | null; status: "new" | "in_progress" | "resolved"; staff_notes: string | null;
  handled_by: string | null; handled_at: string | null; created_at: string;
};
const STATUS_TONE: Record<Row["status"], Tone> = { new: "danger", in_progress: "warn", resolved: "ok" };
const STATUSES = ["new", "in_progress", "resolved"] as const;

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  const ctx = await requireArea("feedback");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const kind = sp.kind === "suggestion" || sp.kind === "complaint" ? sp.kind : "";
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";

  const [{ data: rows }, { data: prop }, { data: staff }] = await Promise.all([
    ctx.supabase.from("feedback").select("*").eq("property_id", ctx.property.id).order("created_at", { ascending: false }).limit(500),
    ctx.supabase.from("properties").select("feedback_token").eq("id", ctx.property.id).single(),
    ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
  ]);
  const all = (rows ?? []) as Row[];
  const shown = all.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status));
  const who = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const rated = all.filter((r) => r.rating);
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length : null;
  const url = prop?.feedback_token ? await feedbackUrl(prop.feedback_token) : null;
  const [svg, png] = url ? await Promise.all([qrSvg(url), qrPng(url)]) : [null, null];
  const href = (k: string, st: string) => {
    const q = new URLSearchParams({ ...(k ? { kind: k } : {}), ...(st ? { status: st } : {}) }).toString();
    return q ? `/feedback?${q}` : "/feedback";
  };

  return (
    <>
      <PageHeader title={t.fb_title} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.fb_status_new} value={all.filter((r) => r.status === "new").length} tone={all.some((r) => r.status === "new") ? "danger" : undefined} />
        <Stat label={t.fb_complaint} value={all.filter((r) => r.kind === "complaint").length} />
        <Stat label={t.fb_suggestion} value={all.filter((r) => r.kind === "suggestion").length} />
        <Stat label={t.fb_avg_rating} value={avg ? `${avg.toFixed(1)} ★` : "—"} hint={rated.length ? `${rated.length}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {[["", t.fb_all], ["complaint", `😟 ${t.fb_complaint}`], ["suggestion", `💡 ${t.fb_suggestion}`]].map(([k, l]) => (
              <Link key={k || "all"} href={href(k, status)} className={`btn-sm ${kind === k ? "btn-primary" : "btn-ghost"}`}>{l}</Link>
            ))}
            <span className="mx-1 border-s border-line" />
            {[["", t.fb_all], ...STATUSES.map((s) => [s, t[`fb_status_${s}` as DictKey]])].map(([s, l]) => (
              <Link key={s || "any"} href={href(kind, s)} className={`btn-sm ${status === s ? "btn-primary" : "btn-ghost"}`}>{l}</Link>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty>{t.fb_empty}</Empty>
          ) : (
            shown.map((r) => (
              <article key={r.id} className={`card ${r.status === "new" && r.kind === "complaint" ? "border-danger/50" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.kind === "complaint" ? "danger" : "brand"}>{r.kind === "complaint" ? `😟 ${t.fb_complaint}` : `💡 ${t.fb_suggestion}`}</Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{t[`fb_status_${r.status}` as DictKey]}</Badge>
                  {r.rating ? <span className="text-sm text-warn" dir="ltr" aria-label={`${r.rating}/5`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></span> : null}
                  <span className="ms-auto text-xs text-muted">{dateTime(r.created_at, ctx.property.timezone, lang)}</span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed" dir="auto">{r.message}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>👤 {r.guest_name ?? t.fb_anonymous}</span>
                  {r.room ? <span>🚪 {t.fb_room} {r.room}</span> : null}
                  {r.contact ? <span dir="ltr">📞 {r.contact}</span> : null}
                  {r.handled_by ? <span>{t.fb_handled_by}: {who.get(r.handled_by) ?? "—"}</span> : null}
                </div>
                <ActionForm action={updateFeedback} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[10rem_1fr_auto]">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="status" defaultValue={r.status} className="input py-2">
                    {STATUSES.map((s) => <option key={s} value={s}>{t[`fb_status_${s}` as DictKey]}</option>)}
                  </select>
                  <input name="notes" defaultValue={r.staff_notes ?? ""} placeholder={t.fb_notes} maxLength={2000} className="input py-2" />
                  <SubmitButton className="btn-primary btn-sm">{t.fb_update}</SubmitButton>
                </ActionForm>
              </article>
            ))
          )}
        </div>

        <div>
          <Section title={t.fb_qr_title}>
            {url && svg && png ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto w-56 rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
                <p className="text-xs text-muted">{t.fb_qr_hint}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/feedback/qr" className="btn-primary btn-sm">{t.fb_qr_print}</Link>
                  <a href={png} download={`nuzul-feedback-qr.png`} className="btn-ghost btn-sm">{t.fb_qr_download}</a>
                  <a href={url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">{t.fb_qr_open}</a>
                </div>
                <div className="break-all text-[11px] text-muted" dir="ltr">{url}</div>
              </div>
            ) : (
              <Empty>{t.none}</Empty>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
