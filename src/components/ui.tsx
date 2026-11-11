import Link from "next/link";
import { BadgeCheck, Ban, BedDouble, CalendarClock, ChevronLeft, CircleCheck, CircleX, Hourglass, KeyRound, LogOut, SprayCan, UserX, Wrench } from "lucide-react";
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

/** A figure tile; with href the whole tile opens the details behind the figure. */
export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-1 text-xs font-semibold text-muted">
        <span>{label}</span>
        {href ? <ChevronLeft className="size-3.5 shrink-0 opacity-60 ltr:rotate-180" aria-hidden /> : null}
      </div>
      <div className={`num mt-1 text-xl font-bold ${tone ? TONES[tone].split(" ")[1] : ""}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </>
  );
  return href ? <Link href={href} className="card block transition hover:border-brand hover:shadow-sm">{body}</Link> : <div className="card">{body}</div>;
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
export { EditDetails } from "@/components/EditDetails";

/** Grey placeholder block shown while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-xl ${className}`} />;
}

/** Page-shaped placeholder: title, a row of figures, then a few cards. */
export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
