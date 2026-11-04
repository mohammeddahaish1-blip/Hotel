import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(["airbnb", "booking", "agoda", "expedia", "other"]);
const ymd = (d: string) => d.replaceAll("-", "");

/**
 * A unit's private calendar for Airbnb / Booking.com / Agoda: the nights we sold, with no guest details.
 * ?for=airbnb leaves out bookings that came from that channel itself.
 */
export async function GET(req: Request, { params }: RouteContext<"/ical/[token]">) {
  const token = (await params).token.replace(/\.ics$/i, "");
  if (!UUID.test(token)) return new Response("Not found", { status: 404 });
  const forChannel = new URL(req.url).searchParams.get("for");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unit_ical_public", {
    p_token: token, p_exclude_channel: forChannel && CHANNELS.has(forChannel) ? forChannel : null,
  });
  if (error) return new Response("Error", { status: 500 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = ((data ?? []) as { uid: string; start_date: string; end_date: string; summary: string }[]).map((e) =>
    ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(e.start_date)}`, `DTEND;VALUE=DATE:${ymd(e.end_date)}`, `SUMMARY:${e.summary}`, "END:VEVENT"].join("\r\n"),
  );
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuzul PMS//Channel calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events, "END:VCALENDAR", ""].join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="unit-${token.slice(0, 8)}.ics"` },
  });
}
