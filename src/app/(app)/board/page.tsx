import { Zap } from "lucide-react";
import Link from "next/link";
import { requireArea, can, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, todayIn } from "@/lib/format";
import { Badge, Empty, PageHeader, UNIT_STATUS_EMOJI, UNIT_STATUS_TONE } from "@/components/ui";
import { BoardQuickBook } from "@/components/BoardQuickBook";

type Row = {
  unit_id: string;
  number: string;
  floor_name: string | null;
  type_name: string;
  status: string;
  reservation_id: string | null;
  guest_name: string | null;
  departure: string | null;
  next_arrival: string | null;
};

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const ctx = await requireArea("board");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const filter = typeof sp.status === "string" ? sp.status : null;
  const { data, error } = await ctx.supabase.rpc("unit_board", { p_property: ctx.property.id });
  if (error) throw new Error(error.message);
  const everything = data as Row[];
  const rows = everything.filter((r) => !filter || r.status === filter);
  const floors = [...new Set(rows.map((r) => r.floor_name ?? "—"))];
  const statuses = ["occupied", "available", "reserved", "dirty", "maintenance", "out_of_service"];
  const canBook = can(ctx, "reservations") && hasRole(ctx, ["manager", "reception"]);
  const today = todayIn(ctx.property.timezone);
  // the whole tile takes the colour of its state (the state is also written on it)
  const TILE: Record<string, string> = {
    occupied: "bg-gray-soft", available: "bg-ok-soft", reserved: "bg-info-soft", dirty: "bg-warn-soft", maintenance: "bg-danger-soft", out_of_service: "bg-surface-2 border border-dashed border-line",
  };
  const DOT: Record<string, string> = { occupied: "bg-muted", available: "bg-ok", reserved: "bg-info", dirty: "bg-warn", maintenance: "bg-danger", out_of_service: "bg-line" };
  const isOverdue = (r: Row) => r.status === "occupied" && !!r.departure && r.departure < today;
  const leavesToday = (r: Row) => r.status === "occupied" && r.departure === today;
  const urgent = everything.filter((r) => isOverdue(r) || leavesToday(r));
  const chip = (href: string, on: boolean, n: number, label: string, dot?: string) => (
    <Link key={href} href={href} aria-current={on ? "true" : undefined} className={`flex min-w-24 shrink-0 flex-col rounded-2xl border px-3.5 py-2 ${on ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
      <span className="num text-xl font-bold leading-tight">{n}</span>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">{dot ? <span className={`size-2.5 rounded-sm ${dot}`} aria-hidden /> : null}{label}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title={t.units}
        actions={canBook ? <Link href="/reservations/new" className="btn-primary">{t.res_new}</Link> : null}
      />
      {/* the counts are the filter: each number says how many, and pressing it shows only those */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-0.5">
        {chip("/board", !filter, everything.length, t.fb_all)}
        {statuses.filter((x) => everything.some((r) => r.status === x) || filter === x).map((x) =>
          chip(`/board?status=${x}`, filter === x, everything.filter((r) => r.status === x).length, t[`st_${x}` as DictKey], DOT[x]),
        )}
      </div>

      {urgent.length && !filter ? (
        <section className="mb-5 rounded-3xl bg-warn-soft p-4">
          <h2 className="h2 text-warn">{t.board_action} <span className="num">({urgent.length})</span></h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {urgent.map((r) => (
              <li key={r.unit_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-3">
                <span className="num text-xl font-bold">{r.number}</span>
                <span className="min-w-32 flex-1">
                  <span className="block truncate font-semibold">{r.guest_name}</span>
                  <span className={`block text-sm font-semibold ${isOverdue(r) ? "text-danger" : "text-muted"}`}>{isOverdue(r) ? t.board_overdue : t.board_leaving_today}</span>
                </span>
                {r.reservation_id && canBook ? <Link href={`/reservations/${r.reservation_id}`} className={`btn-sm ${isOverdue(r) ? "btn-primary" : "btn-ghost"}`}>{t.board_open_res}</Link> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <Empty>{t.none}</Empty>
      ) : (
        floors.map((f) => (
          <div key={f} className="mb-5">
            <div className="mb-2 text-xs font-bold text-muted">{t.floor}: {f}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {rows
                .filter((r) => (r.floor_name ?? "—") === f)
                .map((r) => {
                  const bookable = canBook && r.status === "available" && !r.reservation_id;
                  const overdue = isOverdue(r);
                  // one way out of every tile, by its state
                  const go: [string, string] | null =
                    r.reservation_id && canBook ? [`/reservations/${r.reservation_id}`, t.board_open_res]
                    : r.status === "dirty" && can(ctx, "housekeeping") ? ["/housekeeping", t.board_go_clean]
                    : r.status === "maintenance" && can(ctx, "maintenance") ? ["/maintenance", t.board_go_fix]
                    : null;
                  const body = (
                    <div className={`flex h-full min-h-28 flex-col rounded-2xl p-3 ${TILE[r.status] ?? "bg-surface-2"} ${overdue ? "ring-2 ring-danger" : ""}`}>
                      <span className="num text-2xl font-bold leading-tight">{r.number}</span>
                      <span className="text-xs font-semibold"><span aria-hidden>{UNIT_STATUS_EMOJI[r.status]}</span> {t[`st_${r.status}` as DictKey]}</span>
                      <span className="mt-1.5 truncate text-sm">{r.guest_name ?? r.type_name}</span>
                      {overdue ? (
                        <span className="text-xs font-bold text-danger">{t.board_overdue}</span>
                      ) : leavesToday(r) ? (
                        <span className="text-xs font-bold">{t.board_leaving_today}</span>
                      ) : r.departure ? (
                        <span className="text-xs text-muted">{t.to}: {gregorian(r.departure, lang)}</span>
                      ) : r.next_arrival ? (
                        <span className="text-xs text-muted">{t.res_upcoming}: {gregorian(r.next_arrival, lang)}</span>
                      ) : null}
                      {bookable ? (
                        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-bold text-brand"><Zap className="size-3.5 shrink-0" /> {t.qb_title}</span>
                      ) : go ? (
                        <span className="mt-auto pt-2 text-xs font-bold underline underline-offset-4">{go[1]}</span>
                      ) : null}
                    </div>
                  );
                  if (bookable) {
                    return (
                      <BoardQuickBook key={r.unit_id} unitId={r.unit_id} unitNumber={r.number} today={today} t={t} lang={lang}>
                        {body}
                      </BoardQuickBook>
                    );
                  }
                  return go ? <Link key={r.unit_id} href={go[0]}>{body}</Link> : <div key={r.unit_id}>{body}</div>;
                })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
