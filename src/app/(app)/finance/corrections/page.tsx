import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime, omr } from "@/lib/format";
import { decideCorrection } from "@/app/actions/money";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, type Tone } from "@/components/ui";

type Req = {
  id: string; target: "payment" | "charge" | "expense"; target_id: string; action: "void" | "edit"; proposed: { amount?: number; description?: string };
  reason: string; status: "pending" | "approved" | "rejected"; requested_by: string; requested_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null;
};
const TONE: Record<Req["status"], Tone> = { pending: "warn", approved: "ok", rejected: "danger" };

/** Owner/manager decide on staff correction requests (the change is applied by the database on approval). */
export default async function CorrectionsPage() {
  const ctx = await requireArea("finance");
  if (!hasRole(ctx, ["manager"])) redirect("/finance");
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const [{ data: rows }, { data: staff }] = await Promise.all([
    ctx.supabase.from("correction_requests").select("*").eq("property_id", ctx.property.id).order("requested_at", { ascending: false }).limit(200),
    ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
  ]);
  const reqs = (rows ?? []) as Req[];
  const who = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));

  // What each request is about (amount, description, link)
  const ids = (k: Req["target"]) => reqs.filter((r) => r.target === k).map((r) => r.target_id);
  const [{ data: pays }, { data: chs }, { data: exps }] = await Promise.all([
    ids("payment").length ? ctx.supabase.from("payments").select("id, amount, receipt_no, voided_at, folios(reservation_id)").in("id", ids("payment")) : Promise.resolve({ data: [] }),
    ids("charge").length ? ctx.supabase.from("charges").select("id, amount, description, voided_at, folios(reservation_id)").in("id", ids("charge")) : Promise.resolve({ data: [] }),
    ids("expense").length ? ctx.supabase.from("expenses").select("id, amount, description, archived_at").in("id", ids("expense")) : Promise.resolve({ data: [] }),
  ]);
  type Subject = { amount: number; label: string; href: string | null };
  const subject = new Map<string, Subject>();
  for (const p of (pays ?? []) as unknown as { id: string; amount: number; receipt_no: number | null; folios: { reservation_id: string | null } | null }[])
    subject.set(p.id, { amount: p.amount, label: `${t.rc_receipt} #${p.receipt_no ?? ""}`, href: p.folios?.reservation_id ? `/reservations/${p.folios.reservation_id}` : null });
  for (const c of (chs ?? []) as unknown as { id: string; amount: number; description: string; folios: { reservation_id: string | null } | null }[])
    subject.set(c.id, { amount: c.amount, label: c.description, href: c.folios?.reservation_id ? `/reservations/${c.folios.reservation_id}` : null });
  for (const e of (exps ?? []) as { id: string; amount: number; description: string }[])
    subject.set(e.id, { amount: e.amount, label: e.description, href: "/finance" });

  const pending = reqs.filter((r) => r.status === "pending");
  const done = reqs.filter((r) => r.status !== "pending");
  const card = (r: Req, open: boolean) => {
    const sub = subject.get(r.target_id);
    return (
      <article key={r.id} className="rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={TONE[r.status]}>{t[`cr_${r.status}` as DictKey]}</Badge>
          <b>{t[`cr_action_${r.action}` as DictKey]} {t[`cr_target_${r.target}` as DictKey]}</b>
          {sub ? (sub.href ? <Link href={sub.href} className="text-brand">{sub.label}</Link> : <span>{sub.label}</span>) : null}
          {sub ? <span className="num font-semibold">{omr(sub.amount, lang)}</span> : null}
          {r.action === "edit" && r.proposed.amount != null ? <span className="text-ok">→ {omr(r.proposed.amount, lang)}</span> : null}
          <span className="ms-auto text-xs text-muted">{who.get(r.requested_by) ?? "—"} · {dateTime(r.requested_at, tz, lang)}</span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-sm" dir="auto"><MessageCircle className="mt-0.5 size-4 shrink-0 text-muted" /> {r.reason}</p>
        {open ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            {[["1", t.cr_approve, "btn-primary"], ["0", t.cr_reject, "btn-ghost"]].map(([v, l, c]) => (
              <ActionForm key={v} action={decideCorrection} className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="approve" value={v} />
                {v === "0" ? <input name="note" placeholder={t.cr_note} className="input w-auto py-1.5" /> : null}
                <SubmitButton className={`${c} btn-sm`} confirm={v === "1" ? `${l}?` : undefined}>{l}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        ) : r.decided_at ? (
          <p className="mt-2 text-xs text-muted">{who.get(r.decided_by ?? "") ?? "—"} · {dateTime(r.decided_at, tz, lang)}{r.decision_note ? ` · ${r.decision_note}` : ""}</p>
        ) : null}
      </article>
    );
  };

  return (
    <>
      <PageHeader title={t.cr_title} sub={t.cr_hint} />
      <div className="space-y-4">
        <Section title={`${t.cr_pending} (${pending.length})`}>
          {pending.length ? <div className="space-y-3">{pending.map((r) => card(r, true))}</div> : <Empty>{t.cr_none}</Empty>}
        </Section>
        {done.length ? (
          <Section title={t.cr_history}>
            <div className="space-y-3">{done.map((r) => card(r, false))}</div>
          </Section>
        ) : null}
      </div>
    </>
  );
}
