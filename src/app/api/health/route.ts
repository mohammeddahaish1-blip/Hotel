/**
 * Uptime check for monitors and the Docker health check: is the app up, and can it reach Supabase?
 * Public and cheap; returns no data. 200 = healthy, 503 = Supabase unreachable.
 */
export async function GET() {
  const started = Date.now();
  let supabase = false;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    supabase = res.ok;
  } catch {
    supabase = false;
  }
  return Response.json(
    { ok: supabase, supabase, ms: Date.now() - started },
    { status: supabase ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
