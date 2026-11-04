import Link from "next/link";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
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

  return (
    <>
      <PageHeader
        title={t.cal_title}
        sub={<>{t.cal_hint} {t.qb_hint}</>}
        actions={
          <>
            <Link className="btn-ghost btn-sm" href={`/calendar?start=${addDays(start, -7)}`}>{t.cal_prev}</Link>
            <Link className="btn-ghost btn-sm" href="/calendar">{t.cal_today}</Link>
            <Link className="btn-ghost btn-sm" href={`/calendar?start=${addDays(start, 7)}`}>{t.cal_next}</Link>
          </>
        }
      />
      <TapeChart
        start={start}
        days={DAYS}
        today={today}
        lang={lang}
        units={(units ?? []).map((u) => ({ id: u.id, number: u.number, status: u.status }))}
        bars={bars}
        labels={{ moved: t.cal_moved, unit: t.unit }}
        t={t}
        canBook={hasRole(ctx, ["manager", "reception"])}
      />
    </>
  );
}
