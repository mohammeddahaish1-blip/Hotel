import { initial } from "@/lib/profile-link";
import { BriefcaseBusiness, CalendarClock, CalendarDays, CreditCard, History, IdCard, Lock, Mail, Phone, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hasRole, type Ctx } from "@/lib/auth";
import type { Dict, DictKey, Lang } from "@/lib/i18n/dict";
import { gregorian, omr, plainOmr, todayIn } from "@/lib/format";
import { updateProfileField } from "@/app/actions/settings";
import { InlineField } from "@/components/InlineField";
import { Badge, type Tone } from "@/components/ui";

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

/** One employee's profile. Owner and managers edit each detail where it is shown (pencil on the line). */
export function ProfileView({ ctx, p, t, lang }: { ctx: Ctx; p: StaffProfile; t: Dict; lang: Lang }) {
  const self = p.user_id === ctx.userId;
  const canEdit = hasRole(ctx, ["manager"]) && (p.role !== "owner" || self);
  const I = "size-5 shrink-0";
  const none = <span className="font-normal text-muted">—</span>;
  const labels = { edit: t.edit, save: t.save, cancel: t.cancel, country: t.phone_country, search: t.phone_search, none: t.phone_none };
  const field = (f: string, icon: ReactNode, label: string, display: ReactNode, value: string, kind?: "text" | "numeric" | "money" | "date" | "phone") => (
    <InlineField icon={icon} label={label} display={display} field={f} kind={kind} value={value} userId={p.user_id} action={updateProfileField} canEdit={canEdit} labels={labels} />
  );
  let card: { tone: Tone; label: string } | null = null;
  if (p.work_card_expiry) {
    const d = daysUntil(p.work_card_expiry, ctx.property.timezone);
    card = d < 0 ? { tone: "danger", label: t.prof_card_expired }
      : d <= 30 ? { tone: "warn", label: t.prof_card_days.replace("{n}", String(d)) }
      : { tone: "ok", label: t.prof_card_ok };
  }
  const roleName = t[`role_${p.role}` as DictKey];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="card flex flex-col items-center gap-2 py-6 text-center lg:self-start">
        <div className="grid size-20 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" aria-hidden>
          {initial(p.full_name || p.email)}
        </div>
        <div className="text-xl font-bold">{p.full_name || p.email}</div>
        <div className="text-sm text-muted">{p.job_title || roleName}</div>
        {!p.active ? <Badge tone="gray">{t.prof_inactive}</Badge> : null}
        <Link href={`/audit?actor=${p.user_id}`} className="btn-ghost btn-sm mt-2 inline-flex items-center gap-1.5">
          <History className="size-4 shrink-0" />{self ? t.prof_my_activity : t.prof_activity}
        </Link>
      </section>

      <section className="card lg:col-span-2">
        {field("full_name", <UserRound className={I} />, t.name, p.full_name || none, p.full_name ?? "")}
        {field("job_title", <BriefcaseBusiness className={I} />, t.job_title, p.job_title || roleName, p.job_title ?? "")}
        <Row icon={<Mail className={I} />} label={t.email}><span dir="ltr">{p.email}</span></Row>
        {field("phone", <Phone className={I} />, t.staff_phone,
          p.phone ? <a href={`tel:${p.phone}`} dir="ltr" className="text-brand">{p.phone}</a> : none, p.phone ?? "", "phone")}
        {field("salary", <Wallet className={I} />, t.staff_salary_short,
          p.salary != null ? <span className="num">{omr(p.salary, lang)}</span> : none, p.salary != null ? plainOmr(p.salary) : "", "money")}
        {field("civil_id", <IdCard className={I} />, t.staff_civil_id,
          p.civil_id ? <span dir="ltr" className="num">{p.civil_id}</span> : none, p.civil_id ?? "", "numeric")}
        {field("work_card_no", <CreditCard className={I} />, t.staff_card_no,
          p.work_card_no ? <span dir="ltr" className="num">{p.work_card_no}</span> : none, p.work_card_no ?? "")}
        {field("work_card_expiry", <CalendarClock className={I} />, t.staff_card_expiry,
          p.work_card_expiry ? (
            <span className="inline-flex flex-wrap items-center gap-2">{gregorian(p.work_card_expiry, lang)} {card ? <Badge tone={card.tone}>{card.label}</Badge> : null}</span>
          ) : none, p.work_card_expiry ?? "", "date")}
        <Row icon={<CalendarDays className={I} />} label={t.prof_joined}>{gregorian(p.joined_at.slice(0, 10), lang)}</Row>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><Lock className="size-3.5 shrink-0" /> {canEdit ? t.prof_edit_hint : t.prof_hint}</p>
      </section>
    </div>
  );
}
