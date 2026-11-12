import Link from "next/link";
import { redirect } from "next/navigation";
import { X } from "lucide-react";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import {
  cancelShopInvite, inviteShopStaff, placeShopStaff, removeShopMember, setShopStaffActive,
} from "@/app/actions/shops";

type Shop = { id: string; name: string; kind: "service" | "rental"; active: boolean };
type Member = { user_id: string; full_name: string; active: boolean; staff_kind: "hotel" | "shop" };
type Link_ = { shop_id: string; user_id: string; access: string };
type Invite = { id: string; email: string; full_name: string; shop_id: string | null; shop_access: string | null };

/** People who work in the shops only: invited here, kept apart from hotel staff (owner and managers). */
export default async function ShopStaffPage() {
  const ctx = await getCtx();
  if (!hasRole(ctx, ["manager"])) redirect(ctx.shops.length ? "/shops" : "/denied?area=settings");
  const { t } = await getDict();
  const [{ data: shopRows }, { data: memberRows }, { data: linkRows }, { data: inviteRows }] = await Promise.all([
    ctx.supabase.from("shops").select("id, name, kind, active").eq("tenant_id", ctx.tenantId).order("kind").order("name"),
    ctx.supabase.from("memberships").select("user_id, full_name, active, staff_kind").eq("tenant_id", ctx.tenantId).is("support_until", null).order("created_at"),
    ctx.supabase.from("shop_members").select("shop_id, user_id, access").eq("tenant_id", ctx.tenantId),
    ctx.supabase.from("invitations").select("id, email, full_name, shop_id, shop_access")
      .eq("tenant_id", ctx.tenantId).eq("staff_kind", "shop").is("accepted_at", null).order("created_at"),
  ]);
  const shops = (shopRows ?? []) as Shop[];
  const members = (memberRows ?? []) as Member[];
  const links = (linkRows ?? []) as Link_[];
  const invites = (inviteRows ?? []) as Invite[];
  const shopName = new Map(shops.map((x) => [x.id, x.name]));
  const acc = (a: string) => t[`shp_acc_${a}` as DictKey].split(" — ")[0];
  const staff = members.filter((m) => m.staff_kind === "shop");
  // hotel employees linked to a shop before the two were separated
  const legacy = links.filter((l) => members.some((m) => m.user_id === l.user_id && m.staff_kind === "hotel"));
  const placeOptions = shops.filter((x) => x.active).flatMap((x) =>
    (x.kind === "rental" ? ["renter"] : ["manager", "seller"]).map((a) => ({ value: `${x.id}:${a}`, label: `${x.name} · ${acc(a)}` })));

  const shopBadges = (userId: string) => links.filter((l) => l.user_id === userId).map((l) => (
    <span key={l.shop_id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">
      <Link href={`/shops/${l.shop_id}`}>{shopName.get(l.shop_id) ?? "—"} · {acc(l.access)}</Link>
      <ActionForm action={removeShopMember} className="inline-flex">
        <input type="hidden" name="shop" value={l.shop_id} /><input type="hidden" name="user_id" value={userId} />
        <SubmitButton className="rounded-full p-0.5 hover:bg-brand/10" confirm={t.shp_remove_q}><X className="size-3" aria-label={t.shp_remove} /></SubmitButton>
      </ActionForm>
    </span>
  ));

  return (
    <>
      <PageHeader title={t.ss_title} sub={t.ss_sub} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={`${t.ss_list} (${staff.length})`}>
            {staff.length === 0 && invites.length === 0 ? <Empty>{t.ss_none}</Empty> : (
              <ul className="divide-y divide-line">
                {staff.map((m) => (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">{(m.full_name || "؟").slice(0, 1)}</span>
                    <span className="min-w-0">
                      <Link href={`/profile/${m.user_id}`} className="block truncate font-semibold">{m.full_name || "—"}</Link>
                      {!m.active ? <Badge tone="gray">{t.ss_stopped}</Badge> : null}
                    </span>
                    <span className="flex flex-1 flex-wrap gap-1.5">{shopBadges(m.user_id)}</span>
                    <details className="w-full sm:w-auto">
                      <summary className="btn-ghost btn-sm cursor-pointer list-none">{t.ss_edit}</summary>
                      <div className="mt-2 grid gap-2 rounded-xl bg-surface-2 p-3">
                        {placeOptions.length ? (
                          <ActionForm action={placeShopStaff} className="flex flex-wrap gap-2">
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <select name="place" aria-label={t.ss_place} className="input flex-1 py-2">
                              {placeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <SubmitButton className="btn-primary btn-sm">{t.ss_add_to_shop}</SubmitButton>
                          </ActionForm>
                        ) : null}
                        <ActionForm action={setShopStaffActive}>
                          <input type="hidden" name="user_id" value={m.user_id} />
                          {m.active ? null : <input type="hidden" name="active" value="on" />}
                          <SubmitButton className={`btn-ghost btn-sm ${m.active ? "text-danger" : ""}`} confirm={m.active ? t.ss_stop_q : undefined}>
                            {m.active ? t.ss_stop : t.ss_resume}
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </li>
                ))}
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 py-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 font-bold text-muted">{(i.full_name || i.email).slice(0, 1)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{i.full_name || "—"}</span>
                      <span className="block text-xs text-muted"><span dir="ltr">{i.email}</span> · {t.ss_pending}</span>
                    </span>
                    <span className="flex flex-1 flex-wrap gap-1.5">
                      {i.shop_id && i.shop_access ? <Badge tone="gray">{shopName.get(i.shop_id) ?? "—"} · {acc(i.shop_access)}</Badge> : null}
                    </span>
                    <ActionForm action={cancelShopInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <SubmitButton className="btn-ghost btn-sm">{t.ss_cancel_invite}</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {legacy.length ? (
            <Section title={t.ss_legacy_title}>
              <p className="mb-2 text-xs text-muted">{t.ss_legacy_hint}</p>
              <ul className="divide-y divide-line text-sm">
                {legacy.map((l) => (
                  <li key={`${l.shop_id}-${l.user_id}`} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-semibold">{members.find((m) => m.user_id === l.user_id)?.full_name || "—"}</span>
                    <Badge tone="warn">{shopName.get(l.shop_id) ?? "—"} · {acc(l.access)}</Badge>
                    <ActionForm action={removeShopMember} className="ms-auto">
                      <input type="hidden" name="shop" value={l.shop_id} /><input type="hidden" name="user_id" value={l.user_id} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.shp_remove_q}>{t.shp_remove}</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>

        <Section title={t.ss_add}>
          {placeOptions.length === 0 ? <Empty>{t.ss_no_shops}</Empty> : (
            <ActionForm action={inviteShopStaff} className="space-y-3">
              <Field label={t.ss_name}><input name="full_name" required maxLength={120} className="input" /></Field>
              <Field label={t.ss_email}><input name="email" type="email" required dir="ltr" className="input" /></Field>
              <Field label={t.ss_place}>
                <select name="place" className="input">
                  {placeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <ul className="space-y-1 text-xs text-muted">
                <li>{t.shp_acc_manager}</li><li>{t.shp_acc_seller}</li><li>{t.shp_acc_renter}</li>
              </ul>
              <SubmitButton className="btn-primary w-full">{t.ss_send}</SubmitButton>
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">{t.ss_login_hint}</p>
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">{t.ss_workers_note}</p>
            </ActionForm>
          )}
        </Section>
      </div>
    </>
  );
}
