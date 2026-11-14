import { Check, CreditCard, User } from "lucide-react";
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
  const canBackdate = ctx.role === "owner" || ctx.role === "manager";
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
    for (const [k, v] of [...p.entries()]) if (v === "") p.delete(k);
    return `/reservations/new?${p.toString()}`;
  };
  const n = nights(from, to);

  // ---- four steps, one open at a time; a finished step folds into one line with "change"
  const done = { 1: searched, 2: Boolean(selected), 3: Boolean(guest) } as const;
  const firstOpen = !done[1] ? 1 : !done[2] ? 2 : !done[3] ? 3 : 4;
  const asked = Number(str("step"));
  const step = asked >= 1 && asked <= 3 && asked < firstOpen ? asked : firstOpen;
  const cheapest = units.length ? Math.min(...units.map((u) => (kind === "contract" ? u.monthly_rate : u.quote))) : 0;
  const price = (u: Avail) => (kind === "contract" ? `${omr(u.monthly_rate, lang)} / ${lang === "ar" ? "شهر" : lang === "ur" ? "ماہ" : "mo"}` : omr(u.quote, lang));
  const names = [t.res_step_when, t.res_step_unit, t.res_step_guest, t.res_step_review];
  const dot = (n: number) => `num grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${n === step ? "bg-brand text-brand-ink" : n < firstOpen ? "bg-ok-soft text-ok" : "bg-gray-soft text-muted"}`;
  const folded = (n: 1 | 2 | 3, text: string) => (
    <section className="card flex flex-wrap items-center gap-3 py-3">
      <span className={dot(n)}><Check className="size-4" strokeWidth={3} aria-hidden /></span>
      <div className="min-w-48 flex-1">
        <div className="text-xs font-semibold text-muted">{names[n - 1]}</div>
        <div className="font-semibold">{text}</div>
      </div>
      <Link href={keep({ step: String(n) })} scroll={false} className="btn-ghost btn-sm">{t.res_change_step}</Link>
    </section>
  );
  const kindCard = "flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-line px-3 py-2.5 text-center has-[:checked]:border-brand has-[:checked]:bg-brand-soft";

  return (
    <>
      <Crumb href="/reservations" label={t.nav_reservations} />
      <PageHeader title={t.res_new} />
      <ol className="card mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
        {names.map((name, i) => (
          <li key={name} aria-current={i + 1 === step ? "step" : undefined} className={`flex items-center gap-2 text-sm ${i + 1 === step ? "font-bold" : "font-semibold text-muted"}`}>
            <span className={dot(i + 1)}>{i + 1 < firstOpen && i + 1 !== step ? <Check className="size-4" strokeWidth={3} aria-hidden /> : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>

      <div className="mx-auto max-w-3xl space-y-3">
        {/* 1 — when */}
        {step === 1 ? (
          <Section title={t.res_step_when}>
            <form className="space-y-4">
              {guestId ? <input type="hidden" name="guest" value={guestId} /> : null}
              <div className="grid grid-cols-2 gap-2">
                <label className={kindCard}>
                  <input type="radio" name="kind" value="nightly" defaultChecked={kind === "nightly"} className="sr-only" />
                  <span className="font-bold">{t.kind_nightly}</span><span className="text-xs text-muted">{t.res_kind_nightly_hint}</span>
                </label>
                <label className={kindCard}>
                  <input type="radio" name="kind" value="contract" defaultChecked={kind === "contract"} className="sr-only" />
                  <span className="font-bold">{t.kind_contract}</span><span className="text-xs text-muted">{t.res_kind_contract_hint}</span>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t.res_check_in_date}><input type="date" name="from" defaultValue={from} min={canBackdate ? undefined : today} required className="input" /></Field>
                <Field label={t.res_check_out_date}><input type="date" name="to" defaultValue={to} required className="input" /></Field>
              </div>
              {/* common lengths in one tap: they keep the arrival date and move the departure */}
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 7, 30].map((d) => (
                  <Link key={d} href={keep({ to: addDays(from, d), kind: d === 30 ? kind : "nightly", unit: "" })} scroll={false} className={`btn-sm ${searched && n === d ? "btn-primary" : "btn-ghost"}`}>
                    {t.res_n_nights.replace("{n}", String(d))}
                  </Link>
                ))}
              </div>
              <button className="btn-primary w-full">{t.res_show_units}</button>
            </form>
            {searched && from < today ? (
              <div role="alert" className="mt-2 text-xs font-semibold text-warn">{canBackdate ? t.res_past_warn : t.err_PAST_DATES}</div>
            ) : null}
            {error ? <div className="mt-3 text-sm text-danger">{error.message}</div> : null}
          </Section>
        ) : done[1] ? (
          folded(1, `${kind === "contract" ? t.kind_contract : t.kind_nightly} · ${gregorian(from, lang)} – ${gregorian(to, lang)} · ${t.res_n_nights.replace("{n}", String(n))}`)
        ) : null}

        {/* 2 — which unit */}
        {step === 2 ? (
          <Section title={`${t.res_step_unit} (${units.length})`}>
            <p className="mb-3 text-xs text-muted">{t.res_n_nights.replace("{n}", String(n))} · {hijri(from, lang)} → {hijri(to, lang)}</p>
            {from < today ? <div role="alert" className="mb-2 text-xs font-semibold text-warn">{canBackdate ? t.res_past_warn : t.err_PAST_DATES}</div> : null}
            {error ? <div className="mb-3 text-sm text-danger">{error.message}</div> : null}
            {units.length === 0 ? (
              <Empty>{t.res_no_units}</Empty>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {units.map((u) => (
                  <Link
                    key={u.unit_id}
                    href={keep({ unit: u.unit_id, step: "" })}
                    scroll={false}
                    className={`rounded-2xl border p-3 ${u.unit_id === unitId ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="num text-xl font-bold">{u.number}</span>
                      {units.length > 1 && (kind === "contract" ? u.monthly_rate : u.quote) === cheapest ? <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">{t.res_cheapest}</span> : null}
                    </div>
                    <div className="truncate text-xs text-muted">{u.type_name}{u.floor_name ? ` · ${u.floor_name}` : ""} · {u.capacity} <User className="inline size-3" /></div>
                    <div className="num mt-1 text-sm font-semibold">{price(u)}</div>
                  </Link>
                ))}
              </div>
            )}
          </Section>
        ) : done[2] && selected ? (
          folded(2, `${t.unit} ${selected.number} · ${selected.type_name}${selected.floor_name ? ` · ${selected.floor_name}` : ""} · ${price(selected)}`)
        ) : null}

        {/* 3 — who */}
        {step === 3 ? (
          <Section title={t.res_step_guest}>
            <form className="flex gap-2">
              {Object.entries({ from, to, kind, unit: unitId, step: "3" }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
              <input name="gq" defaultValue={gq} placeholder={`${t.name} / ${t.phone}`} aria-label={`${t.name} / ${t.phone}`} className="input" />
              <button className="btn-ghost shrink-0">{t.search}</button>
            </form>
            <ul className="mt-2 divide-y divide-line">
              {(guestResults ?? []).map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{g.full_name}</span>
                    <span dir="ltr" className="block text-start text-xs text-muted">{g.phone}</span>
                  </span>
                  <Link href={keep({ guest: g.id, step: "" })} scroll={false} className="btn-primary btn-sm">{t.res_pick}</Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 text-sm font-semibold text-muted">{t.res_first_time}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Link href={`/guests/new?read=1&next=${encodeURIComponent(keep({ step: "" }))}`} className="btn-ghost w-full"><CreditCard className="size-4 shrink-0" />{t.rd_register}</Link>
              <Link href={`/guests/new?next=${encodeURIComponent(keep({ step: "" }))}`} className="btn-ghost w-full">+ {t.res_new_guest}</Link>
            </div>
          </Section>
        ) : done[3] && guest ? (
          folded(3, `${guest.full_name}${guest.phone ? ` · ${guest.phone}` : ""}`)
        ) : null}

        {/* 4 — review and confirm */}
        {step === 4 && selected && guest ? (
          <Section title={t.res_step_review}>
            <ActionForm action={createReservation} className="space-y-4">
              <input type="hidden" name="unit" value={selected.unit_id} />
              <input type="hidden" name="guest" value={guest.id} />
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              <input type="hidden" name="kind" value={kind} />
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-surface-2 p-4">
                <div className="text-sm">
                  <div className="font-bold">{guest.full_name}</div>
                  <div>{t.unit} <b className="num">{selected.number}</b> · {selected.type_name}</div>
                  <div className="text-muted">{gregorian(from, lang)} – {gregorian(to, lang)} · {t.res_n_nights.replace("{n}", String(n))}</div>
                </div>
                <div className="text-end">
                  <div className="text-xs font-semibold text-muted">{kind === "nightly" ? t.res_quote : t.res_monthly_rent}</div>
                  <div className="num text-3xl font-bold leading-tight">{omr(kind === "nightly" ? selected.quote : selected.monthly_rate, lang)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.res_adults}><input name="adults" type="number" min={1} defaultValue={1} className="input" /></Field>
                <Field label={t.res_children}><input name="children" type="number" min={0} defaultValue={0} className="input" /></Field>
              </div>
              {kind === "contract" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t.res_monthly_rent}><input name="monthly_rent" inputMode="decimal" defaultValue={plainOmr(selected.monthly_rate)} className="input" /></Field>
                  <Field label={t.res_deposit}><input name="deposit" inputMode="decimal" defaultValue="0" className="input" /></Field>
                </div>
              ) : null}
              {/* the rest keeps its usual value unless someone opens this */}
              <details className="rounded-2xl bg-surface-2 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-brand">{t.fin_more_details}</summary>
                <div className="mt-3 space-y-2">
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
                  </div>
                  <p className="text-xs text-muted">{t.res_tentative_hint}</p>
                  <Field label={t.res_discount}><input name="discount" inputMode="decimal" defaultValue="0" className="input" /></Field>
                  <Field label={t.notes}><input name="notes" className="input" /></Field>
                </div>
              </details>
              <SubmitButton className="btn-primary w-full">{t.res_confirm}</SubmitButton>
            </ActionForm>
          </Section>
        ) : null}
      </div>
    </>
  );
}
