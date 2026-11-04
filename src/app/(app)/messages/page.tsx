import { BellRing, Check, Settings2, Zap } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dateTime } from "@/lib/format";
import { loadTemplates, renderOutbox } from "@/lib/messages";
import { doneNotice, markMessageSent, runAutomationNow, skipMessage } from "@/app/actions/messages";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { MessageCard } from "@/components/MessageCard";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";

/** Guest messages waiting to be sent (from automation rules or queued by hand), and notices for the owner/manager. */
export default async function MessagesPage() {
  const ctx = await requireArea("reservations");
  if (!hasRole(ctx, ["manager", "reception"])) redirect("/reservations");
  const { t, lang } = await getDict();
  const isManager = hasRole(ctx, ["manager"]);
  const [{ data: pending }, { data: sent }, { data: notices }, templates] = await Promise.all([
    ctx.supabase.from("message_outbox").select("id, template_key, reservation_id, payload, due_at, rule_id").eq("property_id", ctx.property.id)
      .eq("status", "pending").lte("due_at", new Date().toISOString()).order("due_at").limit(100),
    ctx.supabase.from("message_outbox").select("id, template_key, reservation_id, payload, status, sent_at, sent_text").eq("property_id", ctx.property.id)
      .neq("status", "pending").order("sent_at", { ascending: false }).limit(20),
    isManager
      ? ctx.supabase.from("staff_notices").select("id, title, created_at, reservation_id, reservations(code, units(number), guests(full_name))")
          .eq("property_id", ctx.property.id).is("done_at", null).order("created_at")
      : Promise.resolve({ data: [] }),
    loadTemplates(ctx, lang),
  ]);
  // Messages whose wording has {pay_link} get a payment link for the current balance
  const needsLink = new Set(templates.filter((x) => `${x.body_ar}${x.body_en}`.includes("{pay_link}")).map((x) => x.key));
  const due = (pending ?? []) as { id: string; template_key: string; reservation_id: string | null; payload: Record<string, unknown> }[];
  await Promise.all(
    due.filter((m) => needsLink.has(m.template_key) && !m.payload.payment_link_token).map(async (m) => {
      const { data } = await ctx.supabase.rpc("ensure_outbox_payment_link", { p_outbox: m.id });
      if (data) m.payload = { ...m.payload, payment_link_token: data };
    }),
  );
  const cards = await renderOutbox(ctx, due, templates);
  const sentInfo = await renderOutbox(ctx, (sent ?? []) as never, templates);
  const tz = ctx.property.timezone;

  return (
    <>
      <PageHeader
        title={t.msg_title}
        sub={t.msg_hint}
        actions={
          <>
            <ActionForm action={runAutomationNow}>
              <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Zap className="size-4 shrink-0" />{t.auto_run_now}</SubmitButton>
            </ActionForm>
            {isManager ? (
              <Link href="/settings/automation" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Settings2 className="size-4 shrink-0" />{t.auto_title}</Link>
            ) : null}
          </>
        }
      />
      <div className="space-y-4">
        {(notices ?? []).length ? (
          <Section title={`${t.notice_title} (${(notices ?? []).length})`}>
            <ul className="divide-y divide-line">
              {((notices ?? []) as unknown as { id: string; title: string; created_at: string; reservation_id: string | null; reservations: { code: string; units: { number: string } | null; guests: { full_name: string } | null } | null }[]).map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <BellRing className="size-4 shrink-0 text-warn" />
                  <span className="flex-1">
                    <b>{n.title}</b>
                    {n.reservations ? (
                      <Link href={`/reservations/${n.reservation_id}`} className="ms-2 text-brand">{n.reservations.code} · {n.reservations.units?.number} · {n.reservations.guests?.full_name}</Link>
                    ) : null}
                    <span className="ms-2 text-xs text-muted">{dateTime(n.created_at, tz, lang)}</span>
                  </span>
                  <ActionForm action={doneNotice}>
                    <input type="hidden" name="id" value={n.id} />
                    <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1"><Check className="size-3.5 shrink-0" />{t.notice_done}</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title={`${t.msg_pending} (${cards.length})`}>
          {cards.length === 0 ? (
            <Empty>{t.msg_none}</Empty>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {cards.map((m) => (
                <div key={m.id} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="brand">{m.template}</Badge>
                    <span className="font-semibold">{m.guest}</span>
                    {m.unit ? <span className="text-muted">· {t.unit} {m.unit}</span> : null}
                    {m.reservationId ? <Link href={`/reservations/${m.reservationId}`} className="ms-auto text-xs text-brand">{t.msg_open_res}</Link> : null}
                  </div>
                  <MessageCard id={m.id} phone={m.phone} text={m.text} markSent={markMessageSent} labels={{ send: t.msg_send, noPhone: t.msg_no_phone, sent: t.msg_sent }} />
                  <ActionForm action={skipMessage} className="mt-1">
                    <input type="hidden" name="id" value={m.id} />
                    <SubmitButton className="btn-ghost btn-sm text-muted">{t.msg_skip}</SubmitButton>
                  </ActionForm>
                </div>
              ))}
            </div>
          )}
        </Section>

        {(sent ?? []).length ? (
          <Section title={t.msg_recent}>
            <ul className="divide-y divide-line text-sm">
              {(sent ?? []).map((m, i) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone={m.status === "sent" ? "ok" : "gray"}>{m.status === "sent" ? t.msg_sent : t.msg_skipped}</Badge>
                  <span>{sentInfo[i]?.template}</span>
                  <span className="text-muted">{sentInfo[i]?.guest}</span>
                  <span className="ms-auto text-xs text-muted">{m.sent_at ? dateTime(m.sent_at, tz, lang) : ""}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </>
  );
}
