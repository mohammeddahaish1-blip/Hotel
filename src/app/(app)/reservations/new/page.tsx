import { CreditCard, User } from "lucide-react";
import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { addDays, gregorian, hijri, nights, omr, plainOmr, todayIn } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Empty, Field, PageHeader, Section, Crumb } from "@/components/ui";
import { createReservation } from "@/app/actions/ops";

type Avail = { unit_id: string; number: string; type_name: string; floor_name: string | null; capacity: number; quote: number; monthly_rate: number };

const SOURCES = ["direct", "walk_in", "phone", "whatsapp", "booking", "agoda", "expedia", "airbnb", "corporate", "other"];

export default async function NewReservationPage({ searchParams }: PageProps<"/reservations/new">) {
  const ctx = await requireArea("reservations");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = todayIn(ctx.property.timezone);
  const kind = str("kind") === "contract" ? "contract" : "nightly";
  const from = str("from") || today;
  const to = str("to") || addDays(from, kind === "contract" ? 30 : 1);
  const unitId = str("unit");
  const guestId = str("guest");
  const searched = Boolean(str("from"));

  const { data: avail, error } = searched
    ? await ctx.supabase.rpc("available_units", { p_property: ctx.property.id, p_from: from, p_to: to })
    : { data: null, error: null };
  const units = (avail ?? []) as Avail[];
  const selected = units.find((u) => u.unit_id === unitId);

  const { data: guest } = guestId
    ? await ctx.supabase.from("guests").select("id, full_name, phone").eq("id", guestId).maybeSingle()
    : { data: null };
  const gq = str("gq");
  const { data: guestResults } = gq
    ? await ctx.supabase.from("guests").select("id, full_name, phone").or(`full_name.ilike.%${gq.replace(/[%,()]/g, " ")}%,phone.ilike.%${gq.replace(/[%,()]/g, " ")}%`).limit(8)
    : { data: null };

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ from, to, kind, ...(unitId ? { unit: unitId } : {}), ...(guestId ? { guest: guestId } : {}), ...extra });
    return `/reservations/new?${p.toString()}`;
  };
  const n = nights(from, to);

  return (
    <>
      <Crumb href="/reservations" label={t.nav_reservations} />
      <PageHeader title={t.res_new} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={t.res_search_avail}>
            <form className="grid gap-3 sm:grid-cols-4">
              <Field label={t.res_kind}>
                <select name="kind" defaultValue={kind} className="input">
                  <option value="nightly">{t.kind_nightly}</option>
                  <option value="contract">{t.kind_contract}</option>
                </select>
              </Field>
              <Field label={t.res_check_in_date}><input type="date" name="from" defaultValue={from} min={today} required className="input" /></Field>
              <Field label={t.res_check_out_date}><input type="date" name="to" defaultValue={to} required className="input" /></Field>
              {guestId ? <input type="hidden" name="guest" value={guestId} /> : null}
              <div className="flex items-end"><button className="btn-primary w-full">{t.search}</button></div>
            </form>
            {searched ? (
              <div className="mt-2 text-xs text-muted">{n} {t.nightsLabel} · {hijri(from, lang)} → {hijri(to, lang)}</div>
            ) : null}
            {error ? <div className="mt-3 text-sm text-danger">{error.message}</div> : null}
          </Section>

          {searched ? (
            <Section title={`${t.res_available_units} (${units.length})`}>
              {units.length === 0 ? (
                <Empty>{t.res_no_units}</Empty>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {units.map((u) => (
                    <Link
                      key={u.unit_id}
                      href={keep({ unit: u.unit_id })}
                      className={`rounded-xl border p-3 ${u.unit_id === unitId ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
                    >
                      <div className="num text-lg font-bold">{u.number}</div>
                      <div className="truncate text-xs text-muted">{u.type_name} · {u.capacity} <User className="inline size-3" /></div>
                      <div className="num mt-1 text-sm font-semibold">
                        {kind === "contract" ? `${omr(u.monthly_rate, lang)} / ${lang === "ar" ? "شهر" : lang === "ur" ? "ماہ" : "mo"}` : omr(u.quote, lang)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          ) : null}
        </div>

        <div className="space-y-4">
          <Section title={t.guest}>
            {guest ? (
              <div className="flex items-center justify-between rounded-xl bg-surface-2 p-3 text-sm">
                <div>
                  <div className="font-semibold">{guest.full_name}</div>
                  <div dir="ltr" className="text-xs text-muted">{guest.phone}</div>
                </div>
                <Link href={keep({ guest: "" })} className="text-xs text-brand">{t.edit}</Link>
              </div>
            ) : (
              <>
                <form className="flex gap-2">
                  {Object.entries({ from, to, kind, unit: unitId }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                  <input name="gq" defaultValue={gq} placeholder={`${t.name} / ${t.phone}`} className="input" />
                  <button className="btn-ghost btn-sm">{t.search}</button>
                </form>
                <ul className="mt-2 divide-y divide-line">
                  {(guestResults ?? []).map((g) => (
                    <li key={g.id}>
                      <Link href={keep({ guest: g.id })} className="flex justify-between py-2 text-sm">
                        <span>{g.full_name}</span>
                        <span dir="ltr" className="text-muted">{g.phone}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/guests/new?read=1&next=${encodeURIComponent(keep({}))}`}
                  className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2"
                >
                  <CreditCard className="size-4 shrink-0" />{t.rd_register}
                </Link>
                <Link
                  href={`/guests/new?next=${encodeURIComponent(keep({}))}`}
                  className="btn-ghost mt-2 w-full"
                >
                  + {t.res_new_guest}
                </Link>
              </>
            )}
          </Section>

          {selected && guest ? (
            <Section title={t.res_confirm}>
              <ActionForm action={createReservation} className="space-y-3">
                <input type="hidden" name="unit" value={selected.unit_id} />
                <input type="hidden" name="guest" value={guest.id} />
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="to" value={to} />
                <input type="hidden" name="kind" value={kind} />
                <div className="rounded-xl bg-surface-2 p-3 text-sm">
                  <div>{t.unit} <b>{selected.number}</b> · {selected.type_name}</div>
                  <div className="text-muted">{gregorian(from, lang)} → {gregorian(to, lang)} ({n} {t.nightsLabel})</div>
                  {kind === "nightly" ? <div className="num mt-1 font-bold">{t.res_quote}: {omr(selected.quote, lang)}</div> : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t.source}>
                    <select name="source" className="input">
                      {SOURCES.map((x) => <option key={x} value={x}>{t[`src_${x}` as DictKey]}</option>)}
                    </select>
                  </Field>
                  <Field label={t.status}>
                    <select name="status" className="input">
                      <option value="confirmed">{t.rs_confirmed}</option>
                      <option value="tentative">{t.rs_tentative}</option>
                    </select>
                  </Field>
                  <Field label={t.res_adults}><input name="adults" type="number" min={1} defaultValue={1} className="input" /></Field>
                  <Field label={t.res_children}><input name="children" type="number" min={0} defaultValue={0} className="input" /></Field>
                </div>
                {kind === "contract" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t.res_monthly_rent}><input name="monthly_rent" inputMode="decimal" defaultValue={plainOmr(selected.monthly_rate)} className="input" /></Field>
                    <Field label={t.res_deposit}><input name="deposit" inputMode="decimal" defaultValue="0" className="input" /></Field>
                  </div>
                ) : null}
                <Field label={t.res_discount}><input name="discount" inputMode="decimal" defaultValue="0" className="input" /></Field>
                <Field label={t.notes}><input name="notes" className="input" /></Field>
                <SubmitButton className="btn-primary w-full">{t.res_confirm}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
