import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Store, Warehouse } from "lucide-react";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { addDays, gregorian, omr, todayIn } from "@/lib/format";
import { loadShopBooks, missingPhotoDays, sumBook, type ShopRow } from "@/lib/shop-books";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader } from "@/components/ui";
import { createShop } from "@/app/actions/shops";
import { ShopKindFields } from "./ShopKindFields";

type Shop = ShopRow & { category: string; number: string | null; renter_name: string | null; monthly_rent: number };
type RentStatus = { balance: number; months: number } | null;

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12-01` : `${y}-${String(mo - 1).padStart(2, "0")}-01`;
};

/** All shops with what they took today and this month (owner, managers), or the shops this person works in. */
export default async function ShopsPage({ searchParams }: PageProps<"/shops">) {
  const ctx = await getCtx();
  const admin = hasRole(ctx, ["manager"]);
  if (!admin && ctx.shops.length === 0) redirect(ctx.areas.length ? "/denied?area=settings" : "/no-access");
  const { t, lang } = await getDict();
  const { data } = await ctx.supabase.from("shops")
    .select("id, kind, category, name, number, active, renter_name, monthly_rent, daily_photos, photos_since, created_at")
    .eq("tenant_id", ctx.tenantId).order("kind").order("name");
  const shops = (data ?? []) as Shop[];
  // a worker, cashier or renter with one shop goes straight to it
  if (!admin && shops.length === 1) redirect(`/shops/${shops[0].id}`);

  const today = todayIn(ctx.property.timezone);
  const sp = await searchParams;
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : monthStart(today);
  const monthEnd = nextMonth(month);
  const service = shops.filter((x) => x.kind === "service");
  const seeBooks = (id: string) => admin || ctx.shops.some((x) => x.id === id && x.access === "manager");

  const [todayBooks, monthBooks, missing, { data: workers }, { data: rentPaid }, rents] = await Promise.all([
    loadShopBooks(ctx, service.map((x) => x.id), today, addDays(today, 1)),
    admin ? loadShopBooks(ctx, service.map((x) => x.id), month, monthEnd) : Promise.resolve(new Map()),
    missingPhotoDays(ctx, shops.filter((x) => seeBooks(x.id))),
    admin ? ctx.supabase.from("shop_workers").select("shop_id, salary").eq("tenant_id", ctx.tenantId).eq("active", true) : Promise.resolve({ data: [] }),
    admin ? ctx.supabase.from("shop_rent_payments").select("amount").eq("tenant_id", ctx.tenantId).is("voided_at", null)
      .gte("paid_on", month).lt("paid_on", monthEnd) : Promise.resolve({ data: [] }),
    Promise.all(shops.filter((x) => x.kind === "rental").map(async (x) => {
      const { data: st } = await ctx.supabase.rpc("shop_rent_status", { p_shop: x.id });
      return [x.id, st as RentStatus] as const;
    })),
  ]);
  const salaries = new Map<string, number>();
  for (const w of (workers ?? []) as { shop_id: string; salary: number }[]) salaries.set(w.shop_id, (salaries.get(w.shop_id) ?? 0) + Number(w.salary));
  const rentBy = new Map(rents);
  const rentMonth = ((rentPaid ?? []) as { amount: number }[]).reduce((a, r) => a + Number(r.amount), 0);
  const cat = (c: string) => t[`shp_cat_${c}` as DictKey];
  const money = (v: number) => omr(v, lang);

  // the owner's table: one row per service shop
  const rows = service.map((x) => {
    const m = sumBook(monthBooks.get(x.id));
    const sal = salaries.get(x.id) ?? 0;
    return { x, today: sumBook(todayBooks.get(x.id)).income, income: m.income, costs: m.costs, salaries: sal, net: m.income - m.costs - sal };
  });
  const tot = rows.reduce((a, r) => ({ today: a.today + r.today, income: a.income + r.income, costs: a.costs + r.costs, salaries: a.salaries + r.salaries, net: a.net + r.net }),
    { today: 0, income: 0, costs: 0, salaries: 0, net: 0 });

  const netOf = new Map(rows.map((r) => [r.x.id, r.net]));
  // two tabs when the hotel has both kinds; rented shops that owe come first
  const both = service.length > 0 && service.length < shops.length;
  const kind = sp.k === "rental" ? "rental" : "service";
  const list = (both ? shops.filter((x) => x.kind === kind) : shops)
    .slice().sort((a, b) => (rentBy.get(b.id)?.balance ?? 0) - (rentBy.get(a.id)?.balance ?? 0));
  const href = (m: string | null, k: string) => {
    const q = new URLSearchParams();
    if (m) q.set("m", m);
    if (k === "rental") q.set("k", "rental");
    const str = q.toString();
    return str ? `/shops?${str}` : "/shops";
  };
  const curM = typeof sp.m === "string" && month !== monthStart(today) ? month.slice(0, 7) : null;
  const monthName = new Intl.DateTimeFormat(lang === "ar" ? "ar-OM-u-nu-latn" : lang === "ur" ? "ur-PK-u-nu-latn" : lang === "bn" ? "bn-BD-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }).format(new Date(`${month}T00:00:00`));

  return (
    <>
      <PageHeader title={t.nav_shops} sub={t.shp_sub} />

      {admin ? (
        <details className="group mb-4">
          <summary className="btn-primary inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">{t.shp_add}</summary>
          <div className="card mt-3 max-w-xl">
            <ActionForm action={createShop} className="space-y-3">
              <Field label={t.shp_name}><input name="name" required maxLength={80} className="input" /></Field>
              <ShopKindFields
                t={{
                  kind: t.shp_kind, service: t.shp_kind_service, rental: t.shp_kind_rental, category: t.shp_category,
                  renterName: t.shp_renter_name, renterPhone: t.shp_renter_phone, rent: t.shp_rent, start: t.shp_start, end: t.shp_end,
                  daily: t.bk_daily_photos,
                }}
                categories={["laundry", "cafe", "restaurant", "minimarket", "salon", "office", "other"].map((c) => ({ value: c, label: cat(c) }))}
              />
              <Field label={t.shp_number}><input name="number" maxLength={30} className="input" /></Field>
              <SubmitButton className="btn-primary w-full">{t.shp_add}</SubmitButton>
            </ActionForm>
          </div>
        </details>
      ) : null}

      {admin && service.length ? (
        <section className="card mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">{monthName}</h2>
            <div className="flex gap-1.5">
              <Link href={href(prevMonth(month).slice(0, 7), kind)} className="btn-ghost btn-sm" aria-label={t.fin_prev_month}><ChevronRight className="size-4 rtl:rotate-0 ltr:rotate-180" /></Link>
              <Link href={href(null, kind)} className="btn-ghost btn-sm">{t.fin_this_month}</Link>
              <Link href={href(monthEnd.slice(0, 7), kind)} className="btn-ghost btn-sm" aria-label={t.fin_next_month}><ChevronLeft className="size-4 rtl:rotate-0 ltr:rotate-180" /></Link>
            </div>
          </div>
          {/* the whole month in one line; the table is one press away */}
          <p className="mt-2 text-sm">
            {t.bk_today} <b className="num">{money(tot.today)}</b>
            <span className="text-muted"> · </span>{t.bk_income} <b className="num">{money(tot.income)}</b>
            <span className="text-muted"> · </span>{t.bk_net} <b className={`num text-lg ${tot.net < 0 ? "text-danger" : "text-ok"}`}>{money(tot.net)}</b>
            {shops.some((x) => x.kind === "rental") ? <><span className="text-muted"> · </span>{t.bk_rent} <b className="num">{money(rentMonth)}</b></> : null}
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-brand">{t.shp_table}</summary>
            <p className="my-2 text-xs text-muted">{t.bk_sub}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line text-start">
                  <th className="py-2 text-start font-normal">{t.shp_name}</th>
                  <th className="py-2 text-start font-normal">{t.bk_today}</th>
                  <th className="py-2 text-start font-normal">{t.bk_income}</th>
                  <th className="py-2 text-start font-normal">{t.bk_costs}</th>
                  <th className="py-2 text-start font-normal">{t.bk_salaries}</th>
                  <th className="py-2 text-start font-normal">{t.bk_net}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.x.id} className="border-b border-line last:border-0">
                    <td className="py-2">
                      <Link href={`/shops/${r.x.id}`} className="font-semibold text-brand">{r.x.name}</Link>
                      {missing.get(r.x.id)?.length ? <span className="ms-2"><Badge tone="danger">{t.bk_missing.replace("{n}", String(missing.get(r.x.id)!.length))}</Badge></span> : null}
                    </td>
                    <td className="num py-2">{money(r.today)}</td>
                    <td className="num py-2">{money(r.income)}</td>
                    <td className="num py-2">{money(r.costs)}</td>
                    <td className="num py-2">{money(r.salaries)}</td>
                    <td className={`num py-2 font-bold ${r.net < 0 ? "text-danger" : "text-ok"}`}>{money(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        </section>
      ) : null}

      {both ? (
        <nav className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1" aria-label={t.nav_shops}>
          {([["service", t.shp_tab_ours, service.length], ["rental", t.shp_tab_rented, shops.length - service.length]] as const).map(([k, label, n]) => (
            <Link key={k} href={href(curM, k)} aria-current={kind === k ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${kind === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
              {label} <span className="num text-xs">{n}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {list.length === 0 ? <Empty>{admin ? t.shp_none : t.shp_none_staff}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((x) => {
            const st = rentBy.get(x.id);
            const miss = missing.get(x.id);
            return (
                  <Link key={x.id} href={`/shops/${x.id}`} className={`card flex flex-col gap-2 hover:border-brand ${miss?.length ? "border-danger" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                        {x.kind === "service" ? <Store className="size-5" aria-hidden /> : <Warehouse className="size-5" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{x.name}</div>
                        <div className="text-xs text-muted">{cat(x.category)}{x.number ? ` · ${x.number}` : ""}</div>
                      </div>
                      {!x.active ? <Badge tone="gray">{t.shp_inactive}</Badge> : null}
                    </div>
                    {miss?.length ? (
                      <div className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-semibold text-danger">
                        {t.bk_missing.replace("{n}", String(miss.length))} — {miss.slice(-3).map((d) => gregorian(d, lang)).join("، ")}
                      </div>
                    ) : null}
                    {x.kind === "service" ? (
                      <>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-muted">{t.shp_today}</span>
                        <span className="num font-semibold">{money(sumBook(todayBooks.get(x.id)).income)}</span>
                      </div>
                      {admin && netOf.has(x.id) ? (
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-muted">{t.shp_net_month}</span>
                          <span className={`num font-bold ${netOf.get(x.id)! < 0 ? "text-danger" : "text-ok"}`}>{money(netOf.get(x.id)!)}</span>
                        </div>
                      ) : null}
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="truncate text-muted">{x.renter_name ?? t.shp_renter}</span>
                        {st ? (
                          st.balance > 0
                            ? <Badge tone="danger">{t.shp_balance}: {money(st.balance)}</Badge>
                            : <Badge tone="ok">{t.shp_settled}</Badge>
                        ) : null}
                      </div>
                    )}
                  </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
