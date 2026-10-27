import { Check, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr } from "@/lib/format";
import { PROPERTY_COLUMNS, photoUrls, propertyStats, type PropertyRow } from "@/lib/properties";
import { switchProperty, updatePropertyInfo } from "@/app/actions/properties";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ReceiptInput } from "@/components/FinanceInputs";
import { PropertyPhoto } from "@/components/PropertyPhoto";
import { Badge, Crumb, Empty, Field, PageHeader, Stat, UNIT_STATUS_EMOJI } from "@/components/ui";

// Card edge colour per unit status (legend below the grid)
const EDGE: Record<string, string> = {
  occupied: "border-e-4 border-e-violet", reserved: "border-e-4 border-e-info", available: "border-e-4 border-e-ok",
  dirty: "border-e-4 border-e-warn", maintenance: "border-e-4 border-e-danger", out_of_service: "border-e-4 border-e-line",
};
const STATUSES = ["occupied", "reserved", "available", "dirty", "maintenance", "out_of_service"];

export default async function PropertyPage({ params }: PageProps<"/properties/[id]">) {
  const ctx = await requireArea("board");
  const { t, lang } = await getDict();
  const { id } = await params;
  const { data } = await ctx.supabase.from("properties").select(PROPERTY_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (!data) notFound();
  const p = data as PropertyRow;
  const [stats, photos] = await Promise.all([propertyStats(ctx, [p]), photoUrls(ctx, [p])]);
  const st = stats.get(p.id)!;
  const name = lang === "en" && p.name_en ? p.name_en : p.name_ar;
  const isCurrent = p.id === ctx.property.id;
  const canEdit = hasRole(ctx, ["manager"]);
  const pct = st.units ? Math.round((st.occupied / st.units) * 100) : 0;
  const info: [string, string | null][] = [
    [t.prop_kind, t[`kind_${p.kind}` as DictKey]],
    [t.phone, p.phone],
    [t.set_address, p.address],
    [t.set_license, p.license_no],
    [t.prop_times, `${p.check_in_time.slice(0, 5)} / ${p.check_out_time.slice(0, 5)}`],
  ];

  return (
    <>
      <Crumb href="/properties" label={t.nav_properties} />
      <PageHeader
        title={name}
        sub={[t[`kind_${p.kind}` as DictKey], p.address].filter(Boolean).join("، ")}
        actions={
          isCurrent ? <Badge tone="brand"><Check className="size-3.5 shrink-0" /> {t.prop_current}</Badge> : (
            <form action={switchProperty}>
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton className="btn-primary">{t.prop_make_current}</SubmitButton>
            </form>
          )
        }
      />

      <section className="card mb-4 flex flex-col gap-5 sm:flex-row">
        <PropertyPhoto url={photos.get(p.id)} alt={name} className="h-44 w-full shrink-0 rounded-xl sm:w-64" />
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3">
          {info.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-semibold" dir="auto">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t.units} value={st.units} />
        <Stat label={t.prop_occupancy} value={st.occupied} hint={`${pct}%`} />
        {st.collected !== null ? <Stat label={t.prop_collected} value={omr(st.collected, lang)} /> : null}
        {st.outstanding !== null ? <Stat label={t.prop_outstanding} value={omr(st.outstanding, lang)} tone={st.outstanding ? "danger" : undefined} /> : null}
      </div>

      <section className="card mb-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="h2">{t.units}</h2>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {STATUSES.map((s) => <span key={s}>{UNIT_STATUS_EMOJI[s]} {t[`st_${s}` as DictKey]}</span>)}
          </div>
        </div>
        {st.board.length === 0 ? (
          <Empty>{t.prop_no_units}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {st.board.map((u) => {
              const card = (
                <div className={`h-full rounded-xl border border-line bg-surface p-3 ${EDGE[u.status] ?? ""} ${u.status === "available" ? "border-dashed" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="num text-base font-bold">{u.number}</span>
                    <span aria-hidden>{UNIT_STATUS_EMOJI[u.status]}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{u.type_name}</div>
                  <div className="truncate text-xs">{u.guest_name ?? t[`st_${u.status}` as DictKey]}</div>
                </div>
              );
              return u.reservation_id && isCurrent ? <a key={u.unit_id} href={`/reservations/${u.reservation_id}`}>{card}</a> : <div key={u.unit_id}>{card}</div>;
            })}
          </div>
        )}
      </section>

      {canEdit ? (
        <details className="card">
          <summary className="cursor-pointer font-semibold"><Pencil className="inline size-4" /> {t.prop_edit}</summary>
          <ActionForm action={updatePropertyInfo} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={p.id} />
            <Field label={t.set_name_ar}><input name="name_ar" defaultValue={p.name_ar} required className="input" /></Field>
            <Field label={t.set_name_en}><input name="name_en" defaultValue={p.name_en ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.prop_kind}>
              <select name="kind" defaultValue={p.kind} className="input">
                <option value="hotel">{t.kind_hotel}</option>
                <option value="apartments">{t.kind_apartments}</option>
                <option value="mixed">{t.kind_mixed}</option>
              </select>
            </Field>
            <Field label={t.phone}><input name="phone" defaultValue={p.phone ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.set_address}><input name="address" defaultValue={p.address ?? ""} className="input" /></Field>
            <Field label={t.set_license}><input name="license_no" defaultValue={p.license_no ?? ""} className="input" /></Field>
            <div className="sm:col-span-2"><ReceiptInput name="photo" label={t.prop_photo} ready="" accept="image/*" /></div>
            <div className="sm:col-span-2"><SubmitButton className="btn-primary">{t.save}</SubmitButton></div>
          </ActionForm>
        </details>
      ) : null}
    </>
  );
}
