import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { hasRole, type Ctx } from "@/lib/auth";
import type { Dict, Lang } from "@/lib/i18n/dict";
import { addDays, gregorian, omr, parseRange, todayIn } from "@/lib/format";

type Res = { id: string; code: string; stay: string; kind: string; status: string; units: { number: string } | null; guests: { full_name: string } | null };
type Item = { date: string; kind: "arrival" | "departure" | "rent" | "cheque" | "contract_end"; label: string; amount?: number; href: string };

const KIND_LABEL: Record<Item["kind"], keyof Dict> = {
  arrival: "tb_arrival", departure: "tb_departure", rent: "tb_rent", cheque: "tb_cheque", contract_end: "tb_contract_end",
};
const KIND_DOT: Record<Item["kind"], string> = {
  arrival: "bg-ok", departure: "bg-info", rent: "bg-warn", cheque: "bg-violet", contract_end: "bg-danger",
};

/** "Good morning, …": what needs attention today (with amounts) and what is coming in the next 7 days. */
export async function TodayBoard({ ctx, t, lang }: { ctx: Ctx; t: Dict; lang: Lang }) {
  const db = ctx.supabase;
  const pid = ctx.property.id;
  const today = todayIn(ctx.property.timezone);
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);
  const money = hasRole(ctx, ["manager", "reception", "accountant"]);
  const [{ data: resRows }, { data: cheques }, { data: rents }, { data: corr }] = await Promise.all([
    db.from("reservations").select("id, code, stay, kind, status, units(number), guests(full_name)").eq("property_id", pid)
      .in("status", ["tentative", "confirmed", "checked_in"]).limit(1000),
    money
      ? db.from("cheques").select("id, cheque_no, amount, due_date, status, reservation_id, guests(full_name)").eq("property_id", pid)
          .in("status", ["pending", "bounced"]).lte("due_date", in7)
      : Promise.resolve({ data: [] }),
    money
      ? db.from("billing_schedules").select("id, due_date, amount, contracts!inner(reservation_id, reservations!inner(property_id, units(number), guests(full_name)))")
          .eq("contracts.reservations.property_id", pid).eq("status", "scheduled").lte("due_date", in7)
      : Promise.resolve({ data: [] }),
    hasRole(ctx, ["manager"]) ? db.from("correction_requests").select("id").eq("property_id", pid).eq("status", "pending") : Promise.resolve({ data: [] }),
  ]);
  const res = ((resRows ?? []) as unknown as Res[]).map((r) => ({ ...r, ...parseRange(r.stay) }));
  const who = (r: { guests: { full_name: string } | null; units: { number: string } | null }) => `${r.guests?.full_name ?? "—"}${r.units ? ` · ${r.units.number}` : ""}`;
  const chq = (cheques ?? []) as unknown as { id: string; cheque_no: string; amount: number; due_date: string; status: string; reservation_id: string | null; guests: { full_name: string } | null }[];
  const rent = (rents ?? []) as unknown as { id: string; due_date: string; amount: number; contracts: { reservation_id: string; reservations: { units: { number: string } | null; guests: { full_name: string } | null } } }[];
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

  const arrivals = res.filter((r) => r.from === today && r.status !== "checked_in");
  const departures = res.filter((r) => r.to === today && r.status === "checked_in");
  const chqToday = chq.filter((c) => c.status === "pending" && c.due_date === today);
  const chqLate = chq.filter((c) => c.status === "pending" && c.due_date < today);
  const bounced = chq.filter((c) => c.status === "bounced");
  const rentLate = rent.filter((b) => b.due_date <= today);
  const ending = res.filter((r) => r.kind === "contract" && r.to >= today && r.to <= in30);
  const tiles = [
    { label: t.dash_arrivals, n: arrivals.length, href: "/reservations", tone: "ok" },
    { label: t.dash_departures, n: departures.length, href: "/reservations?view=in_house", tone: "info" },
    ...(money
      ? [
          { label: t.tb_cheques_due, n: chqToday.length, amount: sum(chqToday), href: "/finance/cheques", tone: "warn" },
          { label: t.chq_overdue, n: chqLate.length, amount: sum(chqLate), href: "/finance/cheques", tone: "danger" },
          { label: t.tb_overdue_rent, n: rentLate.length, amount: sum(rentLate), href: "/finance", tone: "danger" },
          { label: t.chq_bounced_list, n: bounced.length, amount: sum(bounced), href: "/finance/cheques", tone: "danger" },
        ]
      : []),
    { label: t.contracts_ending, n: ending.length, href: "/finance/cheques", tone: "warn" },
    ...(hasRole(ctx, ["manager"]) ? [{ label: t.tb_corrections, n: (corr ?? []).length, href: "/finance/corrections", tone: "warn" }] : []),
  ].filter((x) => x.n > 0);
  const TONE: Record<string, string> = { ok: "text-ok", info: "text-info", warn: "text-warn", danger: "text-danger" };

  const items: Item[] = [
    ...res.filter((r) => r.from > today && r.from <= in7 && r.status !== "checked_in").map((r) => ({ date: r.from, kind: "arrival" as const, label: who(r), href: `/reservations/${r.id}` })),
    ...res.filter((r) => r.to > today && r.to <= in7 && r.kind !== "contract").map((r) => ({ date: r.to, kind: "departure" as const, label: who(r), href: `/reservations/${r.id}` })),
    ...rent.filter((b) => b.due_date > today).map((b) => ({ date: b.due_date, kind: "rent" as const, label: who(b.contracts.reservations), amount: b.amount, href: `/reservations/${b.contracts.reservation_id}` })),
    ...chq.filter((c) => c.status === "pending" && c.due_date > today).map((c) => ({ date: c.due_date, kind: "cheque" as const, label: `${c.cheque_no} · ${c.guests?.full_name ?? "—"}`, amount: c.amount, href: c.reservation_id ? `/reservations/${c.reservation_id}` : "/finance/cheques" })),
    ...res.filter((r) => r.kind === "contract" && r.to > today && r.to <= in7).map((r) => ({ date: r.to, kind: "contract_end" as const, label: who(r), href: `/reservations/${r.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: ctx.property.timezone }).format(new Date()));
  const first = (ctx.fullName || "").split(" ")[0];
  const dayLabel = (d: string) => (d === addDays(today, 1) ? t.tb_tomorrow : gregorian(d, lang));

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-3">
      <section className="card lg:col-span-2">
        <h2 className="text-2xl font-bold">{hour < 12 ? t.tb_morning : t.tb_evening}{first ? (lang === "ar" ? ` يا ${first}` : lang === "ur" ? `، ${first}` : `, ${first}`) : ""}</h2>
        <p className="mt-1 text-sm text-muted">{t.tb_attention} · {gregorian(today, lang)}</p>
        {tiles.length ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tiles.map((x) => (
              <Link key={x.label} href={x.href} className="rounded-xl border border-line bg-surface-2/50 p-3 transition hover:border-brand">
                <div className="text-xs text-muted">{x.label}</div>
                <div className={`num text-2xl font-bold ${TONE[x.tone]}`}>{x.n}</div>
                {"amount" in x && x.amount ? <div className="num text-xs font-semibold">{omr(x.amount, lang)}</div> : null}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-ok-soft px-4 py-3 text-sm font-semibold text-ok"><span className="inline-flex items-center gap-2"><CircleCheck className="size-4 shrink-0" />{t.tb_all_clear}</span></p>
        )}
      </section>
      <section className="card">
        <h2 className="h2 mb-3">{t.tb_next7}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t.tb_nothing}</p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {items.slice(0, 40).map((it, i) => (
              <li key={i}>
                <Link href={it.href} className="flex items-start gap-2 rounded-lg px-1 py-1 text-sm hover:bg-surface-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[it.kind]}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted">{dayLabel(it.date)} · {t[KIND_LABEL[it.kind]]}</span>
                    <span className="block truncate" dir="auto">{it.label}</span>
                  </span>
                  {it.amount ? <span className="num shrink-0 text-xs font-semibold">{omr(it.amount, lang)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
