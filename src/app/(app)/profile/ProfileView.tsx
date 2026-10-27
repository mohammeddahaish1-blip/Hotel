import { BriefcaseBusiness, CalendarClock, CalendarDays, CreditCard, History, IdCard, Lock, Mail, Phone, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hasRole, type Ctx } from "@/lib/auth";
import type { Dict, DictKey, Lang } from "@/lib/i18n/dict";
import { gregorian, omr, todayIn } from "@/lib/format";
import { updateStaffProfile } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Field, type Tone } from "@/components/ui";

export type StaffProfile = {
  user_id: string; full_name: string; job_title: string | null; role: string; active: boolean; joined_at: string;
  email: string; phone: string | null; civil_id: string | null; salary: number | null;
  work_card_no: string | null; work_card_expiry: string | null;
};

/** Days from today (property time zone) until an ISO date; negative once it has passed. */
function daysUntil(date: string, tz: string) {
  return Math.round((Date.parse(date) - Date.parse(todayIn(tz))) / 86_400_000);
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-0">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{label}</div>
        <div className="mt-0.5 font-semibold">{children}</div>
      </div>
    </div>
  );
}

/** One employee's profile card; owner and managers also get the edit form. */
export function ProfileView({ ctx, p, t, lang }: { ctx: Ctx; p: StaffProfile; t: Dict; lang: Lang }) {
  const self = p.user_id === ctx.userId;
  const canEdit = hasRole(ctx, ["manager"]) && (p.role !== "owner" || self);
  const I = "size-5 shrink-0";
  const none = <span className="font-normal text-muted">—</span>;
  let card: { tone: Tone; label: string } | null = null;
  if (p.work_card_expiry) {
    const d = daysUntil(p.work_card_expiry, ctx.property.timezone);
    card = d < 0 ? { tone: "danger", label: t.prof_card_expired }
      : d <= 30 ? { tone: "warn", label: t.prof_card_days.replace("{n}", String(d)) }
      : { tone: "ok", label: t.prof_card_ok };
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card flex flex-col items-center gap-2 py-6 text-center lg:self-start">
        <div className="grid size-20 place-items-center rounded-full bg-brand-soft text-brand">
          <UserRound className="size-10" strokeWidth={1.5} />
        </div>
        <div className="text-xl font-bold">{p.full_name || p.email}</div>
        <div className="text-sm text-muted">{p.job_title || t[`role_${p.role}` as DictKey]}</div>
        {!p.active ? <Badge tone="gray">{t.prof_inactive}</Badge> : null}
        {!self && hasRole(ctx, ["manager"]) ? (
          <Link href={`/activity?u=${p.user_id}`} className="btn-ghost btn-sm mt-2 inline-flex items-center gap-1.5">
            <History className="size-4 shrink-0" />{t.prof_activity}
          </Link>
        ) : null}
      </section>

      <section className="card lg:col-span-2">
        <Row icon={<UserRound className={I} />} label={t.name}>{p.full_name || none}</Row>
        <Row icon={<BriefcaseBusiness className={I} />} label={t.job_title}>{p.job_title || t[`role_${p.role}` as DictKey]}</Row>
        <Row icon={<Mail className={I} />} label={t.email}><span dir="ltr">{p.email}</span></Row>
        <Row icon={<Phone className={I} />} label={t.staff_phone}>{p.phone ? <a href={`tel:${p.phone}`} dir="ltr" className="text-brand">{p.phone}</a> : none}</Row>
        <Row icon={<Wallet className={I} />} label={t.staff_salary_short}>{p.salary != null ? <span className="num">{omr(p.salary, lang)}</span> : none}</Row>
        <Row icon={<IdCard className={I} />} label={t.staff_civil_id}>{p.civil_id ? <span dir="ltr" className="num">{p.civil_id}</span> : none}</Row>
        <Row icon={<CreditCard className={I} />} label={t.staff_card_no}>{p.work_card_no ? <span dir="ltr" className="num">{p.work_card_no}</span> : none}</Row>
        <Row icon={<CalendarClock className={I} />} label={t.staff_card_expiry}>
          {p.work_card_expiry ? (
            <span className="inline-flex flex-wrap items-center gap-2">{gregorian(p.work_card_expiry, lang)} {card ? <Badge tone={card.tone}>{card.label}</Badge> : null}</span>
          ) : none}
        </Row>
        <Row icon={<CalendarDays className={I} />} label={t.prof_joined}>{gregorian(p.joined_at.slice(0, 10), lang)}</Row>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><Lock className="size-3.5 shrink-0" /> {canEdit ? t.staff_private_hint : t.prof_hint}</p>
      </section>

      {canEdit ? (
        <section className="card lg:col-span-3">
          <h2 className="h2 mb-3">{t.prof_edit}</h2>
          <ActionForm action={updateStaffProfile} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="user_id" value={p.user_id} />
            <Field label={t.staff_phone}><input name="phone" defaultValue={p.phone ?? ""} dir="ltr" inputMode="tel" placeholder="+968" className="input" /></Field>
            <Field label={t.staff_civil_id}><input name="civil_id" defaultValue={p.civil_id ?? ""} dir="ltr" inputMode="numeric" className="input" /></Field>
            <Field label={t.staff_salary}><input name="salary" defaultValue={p.salary != null ? (p.salary / 1000).toFixed(3) : ""} inputMode="decimal" placeholder="0.000" className="input" /></Field>
            <Field label={t.staff_card_no}><input name="work_card_no" defaultValue={p.work_card_no ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.staff_card_expiry}><input name="work_card_expiry" type="date" defaultValue={p.work_card_expiry ?? ""} className="input" /></Field>
            <div className="flex items-end"><SubmitButton className="btn-primary w-full">{t.save}</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
