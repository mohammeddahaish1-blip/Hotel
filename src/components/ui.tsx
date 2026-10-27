import { BadgeCheck, Ban, Pencil, BedDouble, CalendarClock, CircleCheck, CircleX, Hourglass, KeyRound, LogOut, SprayCan, UserX, Wrench } from "lucide-react";
import type { ReactNode } from "react";

const TONES = {
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  violet: "bg-violet-soft text-violet",
  gray: "bg-gray-soft text-muted",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const UNIT_STATUS_TONE: Record<string, Tone> = {
  available: "ok",
  reserved: "info",
  occupied: "violet",
  dirty: "warn",
  maintenance: "danger",
  out_of_service: "gray",
};

/** Line icon shown before a unit status label (wrench for maintenance, spray for cleaning …). */
export const UNIT_STATUS_EMOJI: Record<string, ReactNode> = {
  available: <CircleCheck className="size-3.5 shrink-0" />,
  reserved: <CalendarClock className="size-3.5 shrink-0" />,
  occupied: <BedDouble className="size-3.5 shrink-0" />,
  dirty: <SprayCan className="size-3.5 shrink-0" />,
  maintenance: <Wrench className="size-3.5 shrink-0" />,
  out_of_service: <Ban className="size-3.5 shrink-0" />,
};

export const RES_STATUS_EMOJI: Record<string, ReactNode> = {
  tentative: <Hourglass className="size-3.5 shrink-0" />,
  confirmed: <BadgeCheck className="size-3.5 shrink-0" />,
  checked_in: <KeyRound className="size-3.5 shrink-0" />,
  checked_out: <LogOut className="size-3.5 shrink-0" />,
  cancelled: <CircleX className="size-3.5 shrink-0" />,
  no_show: <UserX className="size-3.5 shrink-0" />,
};

export const RES_STATUS_TONE: Record<string, Tone> = {
  tentative: "gray",
  confirmed: "info",
  checked_in: "violet",
  checked_out: "ok",
  cancelled: "danger",
  no_show: "warn",
};

/** "‹ Parent" link shown above a page title, to step back up one level. */
export function Crumb({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="no-print mb-1 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
      <span aria-hidden>‹</span> {label}
    </a>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h1">{title}</h1>
        {sub ? <div className="mt-1 text-sm text-muted">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 no-print">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`num mt-1 text-xl font-bold ${tone ? TONES[tone].split(" ")[1] : ""}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="h2">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** "Edit" button that opens an inline edit form under a row or card (no page change). */
export function EditDetails({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className="btn-ghost btn-sm inline-flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <Pencil className="size-3.5 shrink-0" aria-hidden />{label}
      </summary>
      <div className="mt-2 rounded-xl border border-line bg-surface-2/60 p-3">{children}</div>
    </details>
  );
}
