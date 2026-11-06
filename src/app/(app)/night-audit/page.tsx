import Link from "next/link";
import { redirect } from "next/navigation";
import { requireArea, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dateTime, gregorian, omr, parseRange, todayIn } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { cancelReservation, checkIn, checkOut } from "@/app/actions/ops";
import { closeNightAudit, extendOneNight } from "@/app/actions/audit";

type Res = { id: string; code: string; stay: string; status: string; units: { number: string } | null; guests: { full_name: string } | null };

/** Daily close: clear guests past their departure and bookings whose arrival passed, then close the day. */
export default async function NightAuditPage() {
  const ctx = await requireArea("reservations");
  if (!hasRole(ctx, ["manager", "reception"])) redirect("/denied?area=reservations");
  const { t, lang } = await getDict();
  const today = todayIn(ctx.property.timezone);
  const manager = hasRole(ctx, ["manager"]);

  const [{ data: inHouse }, { data: upcoming }, { data: shifts }, { data: last }] = await Promise.all([
    ctx.supabase.from("reservations").select("id, code, stay, status, units(number), guests(full_name)")
      .eq("property_id", ctx.property.id).eq("status", "checked_in"),
    ctx.supabase.from("reservations").select("id, code, stay, status, units(number), guests(full_name)")
      .eq("property_id", ctx.property.id).in("status", ["tentative", "confirmed"]),
    ctx.supabase.from("cash_shifts").select("id").eq("property_id", ctx.property.id).is("closed_at", null),
    ctx.supabase.from("night_audits").select("business_date, closed_at, closed_by, pending, note")
      .eq("property_id", ctx.property.id).order("business_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const withRange = (rows: unknown) => ((rows ?? []) as Res[]).map((r) => ({ ...r, ...parseRange(r.stay) }));
  const overstays = withRange(inHouse).filter((r) => r.to < today).sort((a, b) => a.to.localeCompare(b.to));
  const noShows = withRange(upcoming).filter((r) => r.from < today).sort((a, b) => a.from.localeCompare(b.from));
  const arrivals = withRange(upcoming).filter((r) => r.from === today);
  const pending = overstays.length + noShows.length;

  // balance per overstaying guest, so check-out with an open account is a conscious choice
  const balances = new Map<string, number>();
  if (overstays.length) {
    const { data: folios } = await ctx.supabase.from("folios").select("id, reservation_id").in("reservation_id", overstays.map((r) => r.id));
    await Promise.all((folios ?? []).map(async (f) => {
      const { data } = await ctx.supabase.rpc("folio_summary", { p_folio: f.id });
      balances.set(f.reservation_id as string, Number((data as { balance?: number } | null)?.balance ?? 0));
    }));
  }
  let closer: string | null = null;
  if (last?.closed_by) {
    const { data: m } = await ctx.supabase.from("memberships").select("full_name").eq("tenant_id", ctx.tenantId).eq("user_id", last.closed_by).maybeSingle();
    closer = m?.full_name ?? null;
  }
  const closedToday = last?.business_date === today;

  const row = (r: (typeof overstays)[number], extra: React.ReactNode, sub: string) => (
    <li key={r.id} className="flex flex-wrap items-center gap-2 py-3">
      <div className="min-w-0 flex-1">
        <Link href={`/reservations/${r.id}`} className="font-semibold text-brand">{r.guests?.full_name ?? "—"}</Link>
        <div className="text-xs text-muted">
          <span className="num">{r.code}</span> · {t.unit} <b className="num">{r.units?.number}</b> · {sub}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{extra}</div>
    </li>
  );

  return (
    <>
      <PageHeader title={t.na_title} sub={`${t.na_business_date}: ${gregorian(today, lang)}`} />
      <p className="mb-4 max-w-2xl text-sm text-muted">{t.na_intro}</p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.na_overstays_short} value={overstays.length} tone={overstays.length ? "danger" : "ok"} />
        <Stat label={t.na_noshows_short} value={noShows.length} tone={noShows.length ? "warn" : "ok"} />
        <Stat label={t.na_arrivals_short} value={arrivals.length} />
        <Stat label={t.na_shifts_short} value={(shifts ?? []).length} hint={(shifts ?? []).length ? <Link href="/finance" className="text-brand">{t.nav_finance}</Link> : null} />
      </div>

      <div className="space-y-4">
        <Section title={t.na_overstays.replace("{n}", String(overstays.length))}>
          {overstays.length === 0 ? <Empty>{t.na_overstays_none}</Empty> : (
            <ul className="divide-y divide-line">
              {overstays.map((r) => {
                const bal = balances.get(r.id) ?? 0;
                return row(r, (
                  <>
                    {bal > 0 ? <Badge tone="danger">{t.res_balance_warning}: {omr(bal, lang)}</Badge> : null}
                    <ActionForm action={extendOneNight}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn-ghost btn-sm">{t.na_extend}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={checkOut}>
                      <input type="hidden" name="id" value={r.id} />
                      {bal > 0 ? <input type="hidden" name="allow_balance" value="1" /> : null}
                      <SubmitButton className={bal > 0 ? "btn-danger btn-sm" : "btn-primary btn-sm"} confirm={bal > 0 ? t.res_balance_warning : undefined}>
                        {bal > 0 ? t.res_force_checkout : t.res_check_out}
                      </SubmitButton>
                    </ActionForm>
                  </>
                ), t.na_departed_on.replace("{date}", gregorian(r.to, lang)));
              })}
            </ul>
          )}
        </Section>

        <Section title={t.na_noshows.replace("{n}", String(noShows.length))}>
          {noShows.length === 0 ? <Empty>{t.na_noshows_none}</Empty> : (
            <ul className="divide-y divide-line">
              {noShows.map((r) => row(r, (
                <>
                  {r.to > today ? (
                    <ActionForm action={checkIn}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn-ghost btn-sm">{t.na_checkin_now}</SubmitButton>
                    </ActionForm>
                  ) : null}
                  <ActionForm action={cancelReservation}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="no_show" value="1" />
                    <SubmitButton className="btn-primary btn-sm" confirm={t.res_no_show}>{t.res_no_show}</SubmitButton>
                  </ActionForm>
                </>
              ), t.na_arrival_was.replace("{date}", gregorian(r.from, lang))))}
            </ul>
          )}
        </Section>

        {arrivals.length ? (
          <Section title={t.na_arrivals.replace("{n}", String(arrivals.length))}>
            <ul className="divide-y divide-line">
              {arrivals.map((r) => row(r, (
                <ActionForm action={checkIn}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn-ghost btn-sm">{t.res_check_in}</SubmitButton>
                </ActionForm>
              ), t.na_arriving_today))}
            </ul>
          </Section>
        ) : null}

        <Section title={t.na_close}>
          <p className="mb-3 text-sm text-muted">
            {last
              ? t.na_last.replace("{date}", gregorian(last.business_date, lang)).replace("{name}", closer ?? "—").replace("{at}", dateTime(last.closed_at, ctx.property.timezone, lang))
              : t.na_never}
            {last?.note ? <span className="block">“{last.note}”</span> : null}
          </p>
          {pending > 0 && !manager ? (
            <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{t.na_pending_block}</p>
          ) : (
            <ActionForm action={closeNightAudit} className="flex flex-wrap items-start gap-2">
              {pending > 0 ? (
                <input name="note" required minLength={3} maxLength={300} placeholder={t.na_close_note} aria-label={t.na_close_note} className="input min-w-0 flex-1" />
              ) : null}
              <SubmitButton className="btn-primary">{closedToday ? t.na_close_again : t.na_close}</SubmitButton>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
