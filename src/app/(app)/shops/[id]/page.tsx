import Link from "next/link";
import { notFound } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime, gregorian, omr, plainOmr, todayIn, zonedStart } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Crumb, EditDetails, Empty, Field, PageHeader, Section, Stat } from "@/components/ui";
import {
  addShopMember, recordShopRent, recordShopSale, removeShopMember, saveShopItem, updateShop, voidShopRent, voidShopSale,
} from "@/app/actions/shops";
import { ShopSale } from "./ShopSale";
import { ShopBooks } from "./ShopBooks";

type Shop = {
  id: string; kind: "service" | "rental"; category: string; name: string; number: string | null; active: boolean; notes: string | null;
  renter_name: string | null; renter_phone: string | null; renter_cr: string | null; renter_activity: string | null;
  monthly_rent: number; deposit: number; contract_start: string | null; contract_end: string | null;
  daily_photos: boolean; photos_since: string | null; created_at: string;
};
type Item = { id: string; name: string; price: number; active: boolean };
type Sale = {
  id: string; code: string; total: number; method: string; sold_at: string; sold_by: string | null; note: string | null;
  voided_at: string | null; void_reason: string | null; shop_sale_lines: { name: string; qty: number; amount: number }[];
};
type Rent = { id: string; amount: number; method: string; paid_on: string; period: string | null; reference: string | null; voided_at: string | null; void_reason: string | null };
type RentStatus = { months: number; due: number; paid: number; balance: number; next_due: string | null; ended: boolean };

/** One shop: the till and the day's sales (service shop), or the contract and rent (rental shop); people for the owner. */
export default async function ShopPage({ params, searchParams }: PageProps<"/shops/[id]">) {
  const ctx = await getCtx();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const admin = hasRole(ctx, ["manager"]);
  const access = admin ? "admin" : ctx.shops.find((x) => x.id === id)?.access;
  if (!access) notFound();
  const { data: shop } = await ctx.supabase.from("shops").select("*").eq("id", id).maybeSingle();
  if (!shop) notFound();
  const x = shop as Shop;
  const { t, lang } = await getDict();
  const money = (v: number) => omr(v, lang);
  const tz = ctx.property.timezone;
  const manages = access === "admin" || access === "manager";
  const sp = await searchParams;
  const day = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) && manages ? sp.d : todayIn(tz);
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const [{ data: staff }, service, rental, { data: members }] = await Promise.all([
    ctx.supabase.from("memberships").select("user_id, full_name, role, active, support_until, staff_kind").eq("tenant_id", ctx.tenantId),
    x.kind === "service"
      ? Promise.all([
          ctx.supabase.from("shop_items").select("id, name, price, active").eq("shop_id", id).order("sort").order("name"),
          ctx.supabase.from("shop_sales").select("id, code, total, method, sold_at, sold_by, note, voided_at, void_reason, shop_sale_lines(name, qty, amount)")
            .eq("shop_id", id).gte("sold_at", zonedStart(day, tz)).lt("sold_at", zonedStart(nextDay, tz)).order("sold_at", { ascending: false }),
          ctx.supabase.rpc("shop_in_house", { p_shop: id }),
        ])
      : null,
    x.kind === "rental"
      ? Promise.all([
          ctx.supabase.rpc("shop_rent_status", { p_shop: id }),
          ctx.supabase.from("shop_rent_payments").select("id, amount, method, paid_on, period, reference, voided_at, void_reason")
            .eq("shop_id", id).order("paid_on", { ascending: false }),
        ])
      : null,
    admin ? ctx.supabase.from("shop_members").select("user_id, access").eq("shop_id", id) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((staff ?? []).map((m) => [m.user_id as string, (m.full_name as string) || "—"]));
  const cat = t[`shp_cat_${x.category}` as DictKey];
  const accessLabel = (a: string) => t[`shp_acc_${a}` as DictKey];

  const items = (service?.[0].data ?? []) as Item[];
  const sales = (service?.[1].data ?? []) as Sale[];
  const guests = (service?.[2].data ?? []) as { reservation_id: string; unit: string; guest: string }[];
  const live = sales.filter((s) => !s.voided_at);
  const byMethod = ["cash", "card", "transfer", "room"].map((m) => [m, live.filter((s) => s.method === m).reduce((a, s) => a + Number(s.total), 0)] as const);
  const status = (rental?.[0].data ?? null) as RentStatus | null;
  const rents = (rental?.[1].data ?? []) as Rent[];
  const methodLabel = (m: string) => t[`shp_m_${m}` as DictKey];

  return (
    <>
      {admin || ctx.shops.length > 1 ? <Crumb href="/shops" label={t.nav_shops} /> : null}
      <PageHeader
        title={x.name}
        sub={<span className="inline-flex flex-wrap items-center gap-2">{cat}{x.number ? ` · ${x.number}` : ""} <Badge tone="gray">{x.kind === "service" ? t.shp_kind_service : t.shp_kind_rental}</Badge>{!x.active ? <Badge tone="warn">{t.shp_inactive}</Badge> : null}</span>}
        actions={admin ? (
          <EditDetails label={t.shp_edit}>
            <ActionForm action={updateShop} className="space-y-3">
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="kind" value={x.kind} />
              <Field label={t.shp_name}><input name="name" required maxLength={80} defaultValue={x.name} className="input" /></Field>
              <Field label={t.shp_category}>
                <select name="category" defaultValue={x.category} className="input">
                  {["laundry", "cafe", "restaurant", "minimarket", "salon", "office", "other"].map((c) => <option key={c} value={c}>{t[`shp_cat_${c}` as DictKey]}</option>)}
                </select>
              </Field>
              <Field label={t.shp_number}><input name="number" maxLength={30} defaultValue={x.number ?? ""} className="input" /></Field>
              {x.kind === "rental" ? (
                <>
                  <Field label={t.shp_renter_name}><input name="renter_name" maxLength={120} defaultValue={x.renter_name ?? ""} className="input" /></Field>
                  <Field label={t.shp_renter_phone}><input name="renter_phone" dir="ltr" maxLength={30} defaultValue={x.renter_phone ?? ""} className="input" /></Field>
                  <Field label={t.shp_renter_cr}><input name="renter_cr" dir="ltr" maxLength={40} defaultValue={x.renter_cr ?? ""} className="input" /></Field>
                  <Field label={t.shp_renter_activity}><input name="renter_activity" maxLength={120} defaultValue={x.renter_activity ?? ""} className="input" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t.shp_rent}><input name="monthly_rent" inputMode="decimal" dir="ltr" defaultValue={plainOmr(x.monthly_rent)} className="input" /></Field>
                    <Field label={t.shp_deposit}><input name="deposit" inputMode="decimal" dir="ltr" defaultValue={plainOmr(x.deposit)} className="input" /></Field>
                    <Field label={t.shp_start}><input name="contract_start" type="date" defaultValue={x.contract_start ?? ""} className="input" /></Field>
                    <Field label={t.shp_end}><input name="contract_end" type="date" defaultValue={x.contract_end ?? ""} className="input" /></Field>
                  </div>
                </>
              ) : null}
              <Field label={t.shp_notes}><textarea name="notes" rows={2} maxLength={1000} defaultValue={x.notes ?? ""} className="input" /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={x.active} /> {t.shp_active}</label>
              {x.kind === "service" ? (
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="daily_photos" defaultChecked={x.daily_photos} className="mt-1" /> {t.bk_daily_photos}</label>
              ) : null}
              <SubmitButton className="btn-primary w-full">{t.save}</SubmitButton>
            </ActionForm>
          </EditDetails>
        ) : null}
      />

      {x.kind === "service" && manages ? (
        <ShopBooks ctx={ctx} shop={{ ...x, kind: "service" }} day={day} admin={admin} t={t} lang={lang} names={names} />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {x.kind === "service" ? (
            <>
              {x.active ? (
                <Section title={t.shp_sell}>
                  <ShopSale
                    shop={x.id} items={items.filter((i) => i.active)} guests={guests} action={recordShopSale} lang={lang}
                    t={{
                      items: t.shp_items, total: t.shp_total, method: t.shp_method, cash: t.shp_m_cash, card: t.shp_m_card,
                      transfer: t.shp_m_transfer, room: t.shp_m_room, roomPick: t.shp_room, noGuests: t.shp_no_guests,
                      note: t.shp_note, record: t.shp_record, clear: t.shp_clear, none: t.shp_no_items,
                    }}
                  />
                </Section>
              ) : null}

              <Section
                title={`${t.shp_sales} · ${gregorian(day, lang)}`}
                actions={manages ? (
                  <form className="flex gap-2">
                    <input type="date" name="d" defaultValue={day} aria-label={t.shp_sales} className="input w-auto py-1.5 text-sm" />
                    <button className="btn-ghost btn-sm">{t.search}</button>
                  </form>
                ) : null}
              >
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {byMethod.map(([m, v]) => <Stat key={m} label={methodLabel(m)} value={<span className="num">{money(v)}</span>} />)}
                </div>
                {sales.length === 0 ? <Empty>{t.shp_sales_none}</Empty> : (
                  <ul className="divide-y divide-line text-sm">
                    {sales.map((s) => (
                      <li key={s.id} className={`py-2.5 ${s.voided_at ? "text-muted" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="num font-semibold">{s.code}</span>
                          <span className={`num font-bold ${s.voided_at ? "line-through" : ""}`}>{money(s.total)}</span>
                          <Badge tone={s.method === "room" ? "info" : "gray"}>{methodLabel(s.method)}</Badge>
                          {s.voided_at ? <Badge tone="danger">{t.shp_voided}</Badge> : null}
                          <span className="ms-auto text-xs text-muted">{dateTime(s.sold_at, tz, lang)} · {names.get(s.sold_by ?? "") ?? "—"}</span>
                        </div>
                        <div className="text-xs text-muted">{s.shop_sale_lines.map((l) => `${l.qty}× ${l.name}`).join("، ")}{s.note ? ` · ${s.note}` : ""}</div>
                        {s.voided_at ? <div className="text-xs text-danger">{s.void_reason}</div> : manages ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-danger">{t.shp_void}</summary>
                            <ActionForm action={voidShopSale} className="mt-1.5 flex flex-wrap gap-2">
                              <input type="hidden" name="id" value={s.id} /><input type="hidden" name="shop" value={x.id} />
                              <input name="reason" required minLength={2} maxLength={300} placeholder={t.shp_void_reason} aria-label={t.shp_void_reason} className="input min-w-0 flex-1 py-1.5" />
                              <SubmitButton className="btn-danger btn-sm">{t.shp_void}</SubmitButton>
                            </ActionForm>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          ) : (
            <>
              <Section title={t.shp_contract}>
                {!x.contract_start ? <Empty>{t.shp_no_contract}</Empty> : (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label={t.shp_due} value={<span className="num">{money(status?.due ?? 0)}</span>} hint={t.shp_months.replace("{n}", String(status?.months ?? 0))} />
                      <Stat label={t.shp_paid} value={<span className="num">{money(status?.paid ?? 0)}</span>} />
                      <Stat label={t.shp_balance} value={<span className="num">{money(status?.balance ?? 0)}</span>} tone={(status?.balance ?? 0) > 0 ? "danger" : "ok"} />
                      <Stat label={t.shp_next_due} value={status?.ended ? t.shp_ended : gregorian(status?.next_due ?? null, lang)} />
                    </div>
                  </>
                )}
                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {[
                    [t.shp_renter_name, x.renter_name], [t.shp_renter_phone, x.renter_phone], [t.shp_renter_cr, x.renter_cr],
                    [t.shp_renter_activity, x.renter_activity], [t.shp_rent, money(x.monthly_rent)], [t.shp_deposit, money(x.deposit)],
                    [t.shp_start, gregorian(x.contract_start, lang)], [t.shp_end, gregorian(x.contract_end, lang)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5">
                      <dt className="text-muted">{k}</dt><dd className="font-semibold">{v || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              <Section title={t.shp_rent_payments}>
                {rents.length === 0 ? <Empty>{t.shp_rent_none}</Empty> : (
                  <ul className="divide-y divide-line text-sm">
                    {rents.map((p) => (
                      <li key={p.id} className={`py-2.5 ${p.voided_at ? "text-muted" : ""}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className={`num font-bold ${p.voided_at ? "line-through" : ""}`}>{money(p.amount)}</span>
                          <span className="text-xs text-muted">{gregorian(p.paid_on, lang)}{p.period ? ` · ${p.period}` : ""}{p.reference ? ` · ${p.reference}` : ""}</span>
                          {p.voided_at ? <Badge tone="danger">{t.shp_voided}</Badge> : null}
                        </div>
                        {p.voided_at ? <div className="text-xs text-danger">{p.void_reason}</div> : admin ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-danger">{t.shp_void}</summary>
                            <ActionForm action={voidShopRent} className="mt-1.5 flex flex-wrap gap-2">
                              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="shop" value={x.id} />
                              <input name="reason" required minLength={2} maxLength={300} placeholder={t.shp_void_reason} aria-label={t.shp_void_reason} className="input min-w-0 flex-1 py-1.5" />
                              <SubmitButton className="btn-danger btn-sm">{t.shp_void}</SubmitButton>
                            </ActionForm>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>

        <div className="space-y-4">
          {x.kind === "service" && manages ? (
            <Section title={t.shp_items}>
              <ul className="space-y-2">
                {items.map((i) => (
                  <li key={i.id}>
                    <ActionForm action={saveShopItem} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="shop" value={x.id} /><input type="hidden" name="id" value={i.id} />
                      <input name="name" required maxLength={80} defaultValue={i.name} aria-label={t.shp_item_name} className="input min-w-0 flex-1 py-1.5" />
                      <input name="price" inputMode="decimal" dir="ltr" defaultValue={plainOmr(i.price)} aria-label={t.shp_price} className="input w-24 py-1.5" />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={i.active} /> {t.shp_item_active}</label>
                      <SubmitButton className="btn-ghost btn-sm">{t.save}</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
              <ActionForm action={saveShopItem} resetOnSuccess className="mt-4 grid grid-cols-[1fr_6rem] gap-2 border-t border-line pt-4">
                <input type="hidden" name="shop" value={x.id} />
                <Field label={t.shp_item_name}><input name="name" required maxLength={80} className="input" /></Field>
                <Field label={t.shp_price}><input name="price" required inputMode="decimal" dir="ltr" placeholder="0.000" className="input" /></Field>
                <SubmitButton className="btn-primary col-span-2">{t.shp_add_item}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}

          {x.kind === "rental" && admin ? (
            <Section title={t.shp_record_rent}>
              <ActionForm action={recordShopRent} resetOnSuccess className="space-y-3">
                <input type="hidden" name="shop" value={x.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.shp_amount}><input name="amount" required inputMode="decimal" dir="ltr" defaultValue={x.monthly_rent ? plainOmr(x.monthly_rent) : ""} className="input" /></Field>
                  <Field label={t.shp_method}>
                    <select name="method" defaultValue="transfer" className="input">
                      {["transfer", "cash", "card"].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label={t.shp_period}><input name="period" maxLength={40} className="input" /></Field>
                <Field label={t.shp_reference}><input name="reference" maxLength={80} dir="ltr" className="input" /></Field>
                <Field label={t.shp_paid_on}><input name="paid_on" type="date" defaultValue={todayIn(tz)} className="input" /></Field>
                <SubmitButton className="btn-primary w-full">{t.shp_record_rent}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}

          {admin ? (
            <Section title={t.shp_people}>
              <p className="mb-3 text-xs text-muted">{t.shp_people_hint} <Link href="/shops/staff" className="font-semibold text-brand">{t.ss_title}</Link></p>
              {(members ?? []).length === 0 ? <p className="text-sm text-muted">{t.shp_people_none}</p> : (
                <ul className="mb-3 divide-y divide-line text-sm">
                  {(members ?? []).map((m) => (
                    <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="font-semibold">{names.get(m.user_id) ?? "—"}</span>
                      <span className="text-xs text-muted">{accessLabel(m.access)}</span>
                      <ActionForm action={removeShopMember} className="ms-auto">
                        <input type="hidden" name="shop" value={x.id} /><input type="hidden" name="user_id" value={m.user_id} />
                        <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.shp_remove_q}>{t.shp_remove}</SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={addShopMember} className="space-y-2">
                <input type="hidden" name="shop" value={x.id} />
                <Field label={t.shp_person}>
                  <select name="user_id" required className="input">
                    {(staff ?? []).filter((m) => m.active && !m.support_until && m.staff_kind === "shop" && !(members ?? []).some((x2) => x2.user_id === m.user_id))
                      .map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || "—"}</option>)}
                  </select>
                </Field>
                <select name="access" aria-label={t.shp_people} className="input">
                  {(x.kind === "rental" ? ["renter"] : ["seller", "manager"]).map((a) => <option key={a} value={a}>{accessLabel(a)}</option>)}
                </select>
                <SubmitButton className="btn-primary w-full">{t.shp_add_person}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
