import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section, type Tone } from "@/components/ui";
import { answerStaffComplaint, submitStaffComplaint } from "@/app/actions/complaints";

type Complaint = {
  id: string; author_id: string | null; author_name: string | null; category: string; about_user_id: string | null;
  body: string; status: string; owner_reply: string | null; replied_at: string | null; created_at: string;
};
const TONE: Record<string, Tone> = { new: "danger", seen: "warn", resolved: "ok" };
const CATS = ["salary", "treatment", "schedule", "workload", "safety", "other"];

/** Staff complaint box: employees write to the owner; the owner reads and answers. Managers have no access. */
export default async function ComplaintsPage() {
  const ctx = await getCtx();
  const owner = ctx.role === "owner";
  const writer = !hasRole(ctx, ["manager"]) && !ctx.supportUntil;
  if (!owner && !writer) redirect("/denied");
  const { t, lang } = await getDict();
  const tz = ctx.property.timezone;
  const [{ data }, { data: staff }] = await Promise.all([
    ctx.supabase.from("staff_complaints").select("*").eq("tenant_id", ctx.tenantId).order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("memberships").select("user_id, full_name, role").eq("tenant_id", ctx.tenantId).eq("active", true).is("support_until", null),
  ]);
  const list = (data ?? []) as Complaint[];
  const names = new Map((staff ?? []).map((m) => [m.user_id as string, (m.full_name as string) || "—"]));
  const cat = (c: string) => t[`sc_cat_${c}` as DictKey];
  const st = (c: string) => t[`sc_st_${c}` as DictKey];

  const card = (c: Complaint) => (
    <li key={c.id} className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[c.status] ?? "gray"}>{st(c.status)}</Badge>
        <Badge tone="gray">{cat(c.category)}</Badge>
        {owner ? <span className="text-sm font-semibold">{t.sc_from}: {c.author_name ?? t.sc_anon}</span> : null}
        {c.about_user_id ? <span className="text-sm text-muted">{t.sc_about_label}: {names.get(c.about_user_id) ?? "—"}</span> : null}
        <span className="ms-auto text-xs text-muted">{dateTime(c.created_at, tz, lang)}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm">{c.body}</p>
      {c.owner_reply && !owner ? (
        <div className="mt-2 rounded-xl bg-ok-soft px-3 py-2 text-sm">
          <div className="text-xs font-bold text-ok">{t.sc_reply} · {dateTime(c.replied_at, tz, lang)}</div>
          <p className="mt-1 whitespace-pre-line">{c.owner_reply}</p>
        </div>
      ) : null}
      {owner ? (
        <ActionForm action={answerStaffComplaint} className="mt-2 space-y-2">
          <input type="hidden" name="id" value={c.id} />
          {c.author_id ? (
            <textarea name="reply" rows={2} maxLength={2000} defaultValue={c.owner_reply ?? ""} placeholder={t.sc_reply_ph} aria-label={t.sc_reply} className="input" />
          ) : <p className="text-xs text-muted">{t.sc_anon_no_reply}</p>}
          <div className="flex flex-wrap gap-2">
            <select name="status" defaultValue={c.status === "new" ? "seen" : c.status} aria-label={t.status} className="input w-auto py-1.5">
              {["new", "seen", "resolved"].map((x) => <option key={x} value={x}>{st(x)}</option>)}
            </select>
            <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
          </div>
        </ActionForm>
      ) : null}
    </li>
  );

  return (
    <>
      <PageHeader title={owner ? t.sc_title_owner : t.sc_title_staff} sub={owner ? t.sc_sub_owner : t.sc_sub_staff} />
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
        <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden /> {owner ? t.sc_sub_owner : t.sc_sub_staff}
      </p>
      {owner ? (
        <Section title={t.sc_title_owner}>{list.length ? <ul>{list.map(card)}</ul> : <Empty>{t.sc_none}</Empty>}</Section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title={t.sc_new}>
            <ActionForm action={submitStaffComplaint} resetOnSuccess className="space-y-3">
              <Field label={t.sc_category}>
                <select name="category" defaultValue="salary" className="input">
                  {CATS.map((c) => <option key={c} value={c}>{cat(c)}</option>)}
                </select>
              </Field>
              <Field label={t.sc_about}>
                <select name="about" defaultValue="" className="input">
                  <option value="">{t.sc_about_none}</option>
                  {(staff ?? []).filter((m) => m.user_id !== ctx.userId && m.role !== "owner")
                    .map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || "—"}</option>)}
                </select>
              </Field>
              <Field label={t.sc_body}><textarea name="body" required minLength={3} maxLength={3000} rows={6} className="input" /></Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="anonymous" className="mt-1" />
                <span>{t.sc_anonymous}<span className="block text-xs text-muted">{t.sc_anonymous_hint}</span></span>
              </label>
              <SubmitButton className="btn-primary w-full">{t.sc_send}</SubmitButton>
            </ActionForm>
          </Section>
          <div className="lg:col-span-2">
            <Section title={t.sc_mine}>{list.length ? <ul>{list.map(card)}</ul> : <Empty>{t.sc_none_mine}</Empty>}</Section>
          </div>
        </div>
      )}
    </>
  );
}
