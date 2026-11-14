import Link from "next/link";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { addDays, parseRange, todayIn } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { TapeChart, type Bar } from "@/components/TapeChart";

const DAYS = 14;

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const ctx = await requireArea("calendar");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const start = typeof sp.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : addDays(today, -2);
  const end = addDays(start, DAYS);

  const [{ data: units }, { data: res }, { data: blocks }] = await Promise.all([
    ctx.supabase.from("units").select("id, number, status").eq("property_id", ctx.property.id).eq("active", true).order("number"),
    ctx.supabase
      .from("reservations")
      .select("id, code, stay, status, kind, unit_id, guests(full_name)")
      .eq("property_id", ctx.property.id)
      .in("status", ["tentative", "confirmed", "checked_in", "checked_out"])
      .overlaps("stay", `[${start},${end})`),
    // nights sold on Airbnb / Booking / ... not yet turned into a booking here
    ctx.supabase
      .from("channel_blocks")
      .select("id, unit_id, stay, summary, ical_feeds(channel)")
      .eq("property_id", ctx.property.id)
      .is("removed_at", null)
      .is("reservation_id", null)
      .overlaps("stay", `[${start},${end})`),
  ]);
  const bars: Bar[] = (res ?? []).map((r) => {
    const s = parseRange(r.stay as string);
    return {
      id: r.id,
      code: r.code,
      unitId: r.unit_id,
      from: s.from,
      to: s.to,
      status: r.status,
      kind: r.kind,
      guest: (r.guests as unknown as { full_name: string } | null)?.full_name ?? "",
    };
  });
  for (const b of blocks ?? []) {
    const s = parseRange(b.stay as string);
    const ch = (b.ical_feeds as unknown as { channel: string } | null)?.channel ?? "other";
    bars.push({ id: b.id, code: ch, unitId: b.unit_id, from: s.from, to: s.to, status: "channel", kind: "nightly", guest: `${t[`src_${ch}` as DictKey] ?? ch}`, href: `/channels/convert/${b.id}` });
  }

  const canBook = hasRole(ctx, ["manager", "reception"]);
  const locale = intlLocale(lang);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, o).format(new Date(`${d}T00:00:00`));
  const lastDay = addDays(end, -1);
  // the same colours as the bars in the chart, named once under the title
  const TONE: Record<string, string> = {
    tentative: "bg-gray-soft border-line", confirmed: "bg-info-soft border-info/30", checked_in: "bg-violet-soft border-violet/30",
    checked_out: "bg-ok-soft border-ok/30", channel: "bg-warn-soft border-warn/40 border-dashed",
  };
  const legend: [string, string][] = [
    ["tentative", t.rs_tentative], ["confirmed", t.rs_confirmed], ["checked_in", t.rs_checked_in], ["checked_out", t.rs_checked_out], ["channel", t.cal_channel],
  ];

  return (
    <>
      <PageHeader
        title={fmt(start, { month: "long", year: "numeric" })}
        sub={`${fmt(start, { day: "numeric", month: "short" })} – ${fmt(lastDay, { day: "numeric", month: "short" })}`}
        actions={
          <>
            <Link className="btn-ghost btn-sm" href={`/calendar?start=${addDays(start, -7)}`}>{t.cal_prev}</Link>
            <Link className={`btn-sm ${start === addDays(today, -2) ? "btn-primary" : "btn-ghost"}`} href="/calendar">{t.cal_today}</Link>
            <Link className="btn-ghost btn-sm" href={`/calendar?start=${addDays(start, 7)}`}>{t.cal_next}</Link>
            <form className="flex items-center gap-1.5">
              <input type="date" name="start" defaultValue={start} aria-label={t.cal_jump} title={t.cal_jump} className="input w-auto py-1.5 text-sm" />
              <button className="btn-ghost btn-sm">{t.cal_go}</button>
            </form>
          </>
        }
      />
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-semibold text-muted">
        {legend.map(([k, label]) => (
          <li key={k} className="flex items-center gap-1.5"><span className={`h-3 w-6 rounded border ${TONE[k]}`} aria-hidden />{label}</li>
        ))}
        <li className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-brand" aria-hidden />{t.cal_today}</li>
      </ul>
      {canBook ? <p className="mb-3 hidden rounded-2xl bg-brand-soft px-4 py-2.5 text-sm md:block">{t.cal_tips}</p> : null}

      <TapeChart
        start={start}
        days={DAYS}
        today={today}
        lang={lang}
        units={(units ?? []).map((u) => ({ id: u.id, number: u.number, status: u.status }))}
        bars={bars}
        labels={{ moved: t.cal_moved, unit: t.unit }}
        t={t}
        canBook={canBook}
      />

      {/* phones: the same fortnight as a list, unit by unit (dragging does not work by touch) */}
      <div className="md:hidden">
        <ul className="space-y-2">
          {(units ?? []).map((u) => {
            const mine = bars.filter((b) => b.unitId === u.id).sort((a, b) => a.from.localeCompare(b.from));
            return (
              <li key={u.id} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-lg font-bold">{u.number}</span>
                  {canBook ? <Link href={`/reservations/new?from=${today}&to=${addDays(today, 1)}&unit=${u.id}`} className="btn-ghost btn-sm">{t.res_new}</Link> : null}
                </div>
                {mine.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">{t.cal_free}</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {mine.map((b) => (
                      <li key={b.id}>
                        <Link href={b.href ?? `/reservations/${b.id}`} className="flex items-center gap-2 text-sm">
                          <span className={`h-3 w-6 shrink-0 rounded border ${TONE[b.status] ?? ""}`} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-semibold">{b.guest || b.code}</span>
                          <span className="num shrink-0 text-xs text-muted">{fmt(b.from, { day: "numeric", month: "short" })} – {fmt(b.to, { day: "numeric", month: "short" })}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {canBook ? <p className="mt-3 text-xs text-muted">{t.cal_mobile_note}</p> : null}
      </div>
    </>
  );
}
