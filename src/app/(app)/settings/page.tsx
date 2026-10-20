import { AREAS, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, omr, parseRange, plainOmr } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Field, PageHeader, Section, UNIT_STATUS_EMOJI, UNIT_STATUS_TONE } from "@/components/ui";
import {
  addFloor, addRatePlan, addUnitType, bulkUnits, deleteRatePlan, inviteUser, setUnitService, updateMember,
  updateProperty, updateTax, updateTenantPolicy, updateUnitType,
} from "@/app/actions/settings";

const ROLES = ["owner", "manager", "reception", "accountant", "housekeeping", "maintenance"];

export default async function SettingsPage() {
  const ctx = await requireArea("settings");
  const { t, lang } = await getDict();
  const db = ctx.supabase;
  const [{ data: prop }, { data: tenant }, { data: types }, { data: floors }, { data: units }, { data: plans }, { data: taxes }, { data: members }, { data: invites }] =
    await Promise.all([
      db.from("properties").select("*").eq("id", ctx.property.id).single(),
      db.from("tenants").select("*").eq("id", ctx.tenantId).single(),
      db.from("unit_types").select("*").eq("property_id", ctx.property.id).order("created_at"),
      db.from("floors").select("*").eq("property_id", ctx.property.id).order("sort"),
      db.from("units").select("id, number, status, unit_type_id, floor_id").eq("property_id", ctx.property.id).order("number"),
      db.from("rate_plans").select("*, unit_types!inner(property_id, name_ar)").eq("unit_types.property_id", ctx.property.id).order("period"),
      db.from("tax_rules").select("*").eq("tenant_id", ctx.tenantId).order("sort"),
      db.from("memberships").select("*").eq("tenant_id", ctx.tenantId).order("created_at"),
      db.from("invitations").select("*").eq("tenant_id", ctx.tenantId).is("accepted_at", null),
    ]);
  const typeName = new Map((types ?? []).map((x) => [x.id, x.name_ar]));
  const isOwner = ctx.role === "owner";

  return (
    <>
      <PageHeader title={t.set_title} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t.set_property}>
          <ActionForm action={updateProperty} className="grid gap-2 sm:grid-cols-2">
            <Field label={t.set_name_ar}><input name="name_ar" defaultValue={prop?.name_ar} required className="input" /></Field>
            <Field label={t.set_name_en}><input name="name_en" defaultValue={prop?.name_en ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.set_address} className="sm:col-span-2"><input name="address" defaultValue={prop?.address ?? ""} className="input" /></Field>
            <Field label={t.phone}><input name="phone" defaultValue={prop?.phone ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.set_whatsapp}><input name="whatsapp" defaultValue={prop?.whatsapp ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.email}><input name="email" defaultValue={prop?.email ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.onb_municipality}><input name="municipality" defaultValue={prop?.municipality ?? ""} className="input" /></Field>
            <Field label={t.set_license}><input name="license_no" defaultValue={prop?.license_no ?? ""} className="input" /></Field>
            <Field label={t.vat_no}><input name="vat_no" defaultValue={prop?.vat_no ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.set_retention}><input name="doc_retention_days" type="number" min={1} defaultValue={prop?.doc_retention_days ?? 365} className="input" /></Field>
            <div className="flex items-end"><SubmitButton className="btn-primary w-full">{t.save}</SubmitButton></div>
          </ActionForm>
        </Section>

        <Section title={t.set_taxes}>
          <div className="space-y-2">
            {(taxes ?? []).map((x) => (
              <ActionForm key={x.id} action={updateTax} className="grid grid-cols-12 items-center gap-2 text-sm">
                <input type="hidden" name="id" value={x.id} />
                <span className="col-span-4">{lang === "ar" ? x.name_ar : x.name_en}</span>
                <input name="rate" defaultValue={(x.rate_bp / 100).toString()} inputMode="decimal" className="input col-span-2" aria-label={t.set_rate_pct} />
                <select name="basis" defaultValue={x.basis} className="input col-span-3">
                  <option value="base">{t.basis_base}</option>
                  <option value="cumulative">{t.basis_cumulative}</option>
                </select>
                <label className="col-span-1 flex items-center"><input type="checkbox" name="active" defaultChecked={x.active} aria-label={t.active} /></label>
                <div className="col-span-2"><SubmitButton className="btn-ghost btn-sm w-full">{t.save}</SubmitButton></div>
              </ActionForm>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {lang === "ar"
              ? "الترتيب في الفاتورة: رسم الخدمة ← رسم السياحة ← رسم البلدية ← ضريبة القيمة المضافة. أكّد أساس الحساب مع محاسب المنشأة."
              : "Invoice order: service charge → tourism levy → municipality fee → VAT. Confirm the calculation basis with your accountant."}
          </p>
          <ActionForm action={updateTenantPolicy} className="mt-4 flex items-end gap-2">
            <Field label={t.set_discount_limit} className="flex-1">
              <input name="discount_pct" defaultValue={((tenant?.max_reception_discount_bp ?? 1000) / 100).toString()} inputMode="decimal" className="input" />
            </Field>
            <SubmitButton className="btn-ghost">{t.save}</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={t.set_unit_types}>
          <div className="space-y-2">
            {(types ?? []).map((x) => (
              <ActionForm key={x.id} action={updateUnitType} className="grid grid-cols-12 items-end gap-2 text-sm">
                <input type="hidden" name="id" value={x.id} />
                <span className="col-span-3 pb-2 font-semibold">{x.name_ar}</span>
                <Field label={t.set_nightly} className="col-span-3"><input name="nightly" defaultValue={plainOmr(x.nightly_rate)} inputMode="decimal" className="input" /></Field>
                <Field label={t.set_monthly} className="col-span-3"><input name="monthly" defaultValue={plainOmr(x.monthly_rate)} inputMode="decimal" className="input" /></Field>
                <Field label={t.set_capacity} className="col-span-1"><input name="capacity" defaultValue={x.capacity} type="number" min={1} className="input px-2" /></Field>
                <div className="col-span-2"><SubmitButton className="btn-ghost btn-sm w-full">{t.save}</SubmitButton></div>
              </ActionForm>
            ))}
          </div>
          <ActionForm action={addUnitType} resetOnSuccess className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-3">
            <Field label={t.set_name_ar}><input name="name_ar" required className="input" /></Field>
            <Field label={t.set_name_en}><input name="name_en" dir="ltr" className="input" /></Field>
            <Field label={t.type}>
              <select name="kind" className="input">
                <option value="room">{lang === "ar" ? "غرفة" : "Room"}</option>
                <option value="suite">{lang === "ar" ? "جناح" : "Suite"}</option>
                <option value="studio">{lang === "ar" ? "استوديو" : "Studio"}</option>
                <option value="apartment">{lang === "ar" ? "شقة" : "Apartment"}</option>
              </select>
            </Field>
            <Field label={t.set_nightly}><input name="nightly" required inputMode="decimal" className="input" /></Field>
            <Field label={t.set_monthly}><input name="monthly" inputMode="decimal" className="input" /></Field>
            <Field label={t.set_capacity}><input name="capacity" type="number" min={1} defaultValue={2} className="input" /></Field>
            <SubmitButton className="btn-primary sm:col-span-3">{t.add}</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={t.set_rate_plans}>
          <table className="table mb-3">
            <tbody>
              {(plans ?? []).map((p) => {
                const r = parseRange(p.period as string);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="text-xs">{typeName.get(p.unit_type_id)}</td>
                    <td className="text-xs">{gregorian(r.from, lang)} → {gregorian(r.to, lang)}</td>
                    <td className="num">{p.nightly_rate !== null ? omr(p.nightly_rate, lang) : "—"}</td>
                    <td>
                      <ActionForm action={deleteRatePlan}>
                        <input type="hidden" name="id" value={p.id} />
                        <SubmitButton className="btn-ghost btn-sm" confirm={t.delete}>{t.delete}</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ActionForm action={addRatePlan} resetOnSuccess className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label={t.set_season_name}><input name="name" required className="input" /></Field>
            <Field label={t.type}>
              <select name="unit_type" required className="input">
                {(types ?? []).map((x) => <option key={x.id} value={x.id}>{x.name_ar}</option>)}
              </select>
            </Field>
            <Field label={t.set_nightly}><input name="nightly" inputMode="decimal" className="input" /></Field>
            <Field label={t.from}><input name="from" type="date" required className="input" /></Field>
            <Field label={t.to}><input name="to" type="date" required className="input" /></Field>
            <Field label={t.set_monthly}><input name="monthly" inputMode="decimal" className="input" /></Field>
            <SubmitButton className="btn-primary sm:col-span-3">{t.add}</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={`${t.set_units} (${(units ?? []).length})`}>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <ActionForm action={addFloor} resetOnSuccess className="space-y-2">
              <div className="label">{t.set_floors}: {(floors ?? []).map((f) => f.name).join("، ") || "—"}</div>
              <div className="flex gap-2">
                <input name="name" required placeholder={t.floor} className="input" />
                <input name="sort" type="number" defaultValue={(floors ?? []).length + 1} className="input w-20" />
                <SubmitButton className="btn-ghost">{t.add}</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={bulkUnits} resetOnSuccess className="space-y-2">
              <div className="label">{t.set_bulk_units}</div>
              <input name="spec" required placeholder="101-120, 201-220" dir="ltr" className="input" />
              <div className="flex gap-2">
                <select name="unit_type" required className="input">
                  {(types ?? []).map((x) => <option key={x.id} value={x.id}>{x.name_ar}</option>)}
                </select>
                <select name="floor" className="input">
                  <option value="">—</option>
                  {(floors ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <SubmitButton className="btn-primary">{t.add}</SubmitButton>
              </div>
              <p className="text-xs text-muted">{t.set_bulk_hint}</p>
            </ActionForm>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(units ?? []).map((u) => (
              <ActionForm key={u.id} action={setUnitService}>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="out" value={u.status === "out_of_service" ? "0" : "1"} />
                <button
                  disabled={!["available", "dirty", "out_of_service"].includes(u.status)}
                  title={`${typeName.get(u.unit_type_id)} — ${t[`st_${u.status}` as DictKey]}`}
                  className="rounded-lg border border-line px-2 py-1 text-xs"
                >
                  <span className="num font-semibold">{u.number}</span>{" "}
                  {u.status === "out_of_service" ? <Badge tone={UNIT_STATUS_TONE[u.status]}><span aria-hidden>{UNIT_STATUS_EMOJI.out_of_service}</span> {t.st_out_of_service}</Badge> : null}
                </button>
              </ActionForm>
            ))}
          </div>
        </Section>

        <Section title={t.set_staff}>
          <datalist id="job-titles">
            {["مدير الفندق", "مشرف الوردية", "موظف استقبال", "محاسب", "مشرف التنظيف", "عامل تنظيف", "فني صيانة", "مدير الإيرادات"].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <div className="space-y-2">
            {(members ?? []).map((m) => {
              const locked = m.user_id === ctx.userId || (!isOwner && ["owner", "manager"].includes(m.role));
              const title = m.job_title || t[`role_${m.role}` as DictKey];
              return (
                <ActionForm key={m.user_id} action={updateMember} className="grid grid-cols-12 items-center gap-2 text-sm">
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <span className="col-span-4 truncate font-semibold">{m.full_name || m.user_id.slice(0, 8)}</span>
                  {locked ? (
                    <span className="col-span-8 text-muted">{title}</span>
                  ) : (
                    <>
                      <input
                        name="job_title"
                        list="job-titles"
                        defaultValue={m.job_title ?? ""}
                        placeholder={t[`role_${m.role}` as DictKey]}
                        aria-label={t.job_title}
                        className="input col-span-4"
                      />
                      <label className="col-span-2 flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={m.active} /> {t.active}</label>
                      <div className="col-span-2"><SubmitButton className="btn-ghost btn-sm w-full">{t.save}</SubmitButton></div>
                    </>
                  )}
                </ActionForm>
              );
            })}
          </div>
          {(invites ?? []).length ? (
            <div className="mt-3 text-xs text-muted">
              {t.pending_invites}: {(invites ?? []).map((i) => `${i.email} (${i.job_title || t[`role_${i.role}` as DictKey]})`).join("، ")}
            </div>
          ) : null}
          <ActionForm action={inviteUser} resetOnSuccess className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="h2">{t.set_invite}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t.name}><input name="full_name" required className="input" /></Field>
              <Field label={t.email}><input name="email" type="email" required dir="ltr" autoCapitalize="none" className="input" /></Field>
              <Field label={t.job_title}>
                <input name="job_title" list="job-titles" required placeholder={t.job_title_hint} className="input" />
              </Field>
            </div>
            {isOwner ? (
              <div>
                <div className="label">{t.invite_sections}</div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {AREAS.map((a) => (
                    <label key={a} className="flex items-start gap-2 rounded-xl border border-line px-2.5 py-2 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50">
                      <input type="checkbox" name="areas" value={a} defaultChecked={a === "board"} className="mt-0.5" />
                      <span>
                        <span className="block text-sm font-semibold">{t[`nav_${a}` as DictKey]}</span>
                        <span className="text-muted">{t[`perm_desc_${a}` as DictKey]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <Field label={t.role}>
                <select name="role" className="input">
                  {ROLES.filter((r) => !["owner", "manager"].includes(r)).map((r) => <option key={r} value={r}>{t[`role_${r}` as DictKey]}</option>)}
                </select>
              </Field>
            )}
            <SubmitButton className="btn-primary w-full sm:w-auto sm:px-10">{t.set_invite}</SubmitButton>
            <p className="text-xs text-muted">{t.set_invite_hint}</p>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
