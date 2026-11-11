import Link from "next/link";
import { redirect } from "next/navigation";
import { Store, Warehouse } from "lucide-react";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr, todayIn, zonedStart } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import { createShop } from "@/app/actions/shops";
import { ShopKindFields } from "./ShopKindFields";

type Shop = { id: string; kind: "service" | "rental"; category: string; name: string; number: string | null; active: boolean; renter_name: string | null; monthly_rent: number };
type RentStatus = { balance: number; months: number } | null;

/** All shops (owner, managers) or the shops this person works in. */
export default async function ShopsPage() {
  const ctx = await getCtx();
  const admin = hasRole(ctx, ["manager"]);
  if (!admin && ctx.shops.length === 0) redirect(ctx.areas.length ? "/denied?area=settings" : "/no-access");
  const { t, lang } = await getDict();
  const { data } = await ctx.supabase.from("shops")
    .select("id, kind, category, name, number, active, renter_name, monthly_rent")
    .eq("tenant_id", ctx.tenantId).order("kind").order("name");
  const shops = (data ?? []) as Shop[];
  // a seller or renter with one shop goes straight to it
  if (!admin && shops.length === 1) redirect(`/shops/${shops[0].id}`);

  const today = todayIn(ctx.property.timezone);
  const [{ data: sales }, rents] = await Promise.all([
    ctx.supabase.from("shop_sales").select("shop_id, total").eq("tenant_id", ctx.tenantId).is("voided_at", null)
      .gte("sold_at", zonedStart(today, ctx.property.timezone)),
    Promise.all(shops.filter((x) => x.kind === "rental").map(async (x) => {
      const { data: st } = await ctx.supabase.rpc("shop_rent_status", { p_shop: x.id });
      return [x.id, st as RentStatus] as const;
    })),
  ]);
  const todayBy = new Map<string, number>();
  for (const r of sales ?? []) todayBy.set(r.shop_id, (todayBy.get(r.shop_id) ?? 0) + Number(r.total));
  const rentBy = new Map(rents);
  const cat = (c: string) => t[`shp_cat_${c}` as DictKey];

  return (
    <>
      <PageHeader title={t.nav_shops} sub={t.shp_sub} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={admin ? "lg:col-span-2" : "lg:col-span-3"}>
          {shops.length === 0 ? <Empty>{admin ? t.shp_none : t.shp_none_staff}</Empty> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shops.map((x) => {
                const st = rentBy.get(x.id);
                return (
                  <Link key={x.id} href={`/shops/${x.id}`} className="card flex flex-col gap-2 hover:border-brand">
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
                    {x.kind === "service" ? (
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="text-muted">{t.shp_today}</span>
                        <span className="num font-semibold">{omr(todayBy.get(x.id) ?? 0, lang)}</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="truncate text-muted">{x.renter_name ?? t.shp_renter}</span>
                        {st ? (
                          st.balance > 0
                            ? <Badge tone="danger">{t.shp_balance}: {omr(st.balance, lang)}</Badge>
                            : <Badge tone="ok">{t.shp_settled}</Badge>
                        ) : null}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        {admin ? (
          <Section title={t.shp_add}>
            <ActionForm action={createShop} className="space-y-3">
              <Field label={t.shp_name}><input name="name" required maxLength={80} className="input" /></Field>
              <ShopKindFields
                t={{
                  kind: t.shp_kind, service: t.shp_kind_service, rental: t.shp_kind_rental, category: t.shp_category,
                  renterName: t.shp_renter_name, renterPhone: t.shp_renter_phone, rent: t.shp_rent, start: t.shp_start, end: t.shp_end,
                }}
                categories={["laundry", "cafe", "restaurant", "minimarket", "salon", "office", "other"].map((c) => ({ value: c, label: cat(c) }))}
              />
              <Field label={t.shp_number}><input name="number" maxLength={30} className="input" /></Field>
              <SubmitButton className="btn-primary w-full">{t.shp_add}</SubmitButton>
            </ActionForm>
          </Section>
        ) : null}
      </div>
    </>
  );
}
