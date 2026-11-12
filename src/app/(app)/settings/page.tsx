import { getPlan } from "@/lib/plan";
import { PhoneInput } from "@/components/PhoneInput";
import { Lock, ShieldCheck, FileSpreadsheet, FolderArchive } from "lucide-react";
import Link from "next/link";
import { AREAS, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, omr, parseRange, plainOmr } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BulkUnitsForm } from "@/components/BulkUnitsForm";
import { Badge, EditDetails, Field, PageHeader, Section, UNIT_STATUS_EMOJI, UNIT_STATUS_TONE } from "@/components/ui";
import {
  addFloor, addRatePlan, addUnitType, bulkAddUnits, cancelInvite, deleteUnit, deleteUnitType, renameUnitType, deleteFloor, deleteRatePlan, inviteUser, setUnitActive, setUnitService,
  updateFloor, updateMember, updateProperty, updateRatePlan, updateStaffProfile, updateTax, updateTenantPolicy, updateUnit, updateUnitType,
} from "@/app/actions/settings";

const UNIT_KINDS = ["room", "suite", "studio", "apartment"] as const;
const ROLES = ["owner", "manager", "reception", "accountant", "housekeeping", "maintenance"];

export default async function SettingsPage() {
  const ctx = await requireArea("settings");
  const { t, lang } = await getDict();
  const db = ctx.supabase;
  const [plan, { data: subPays }] = await Promise.all([
    getPlan(ctx),
    ctx.role === "owner"
      ? ctx.supabase.from("subscription_payments").select("id, amount, period_start, period_end, paid_on, voided_at").eq("tenant_id", ctx.tenantId).order("paid_on", { ascending: false }).limit(24)
      : Promise.resolve({ data: [] as { id: string; amount: number; period_start: string; period_end: string; paid_on: string; voided_at: string | null }[] }),
  ]);
  const [{ data: prop }, { data: tenant }, { data: types }, { data: floors }, { data: units }, { data: plans }, { data: taxes }, { data: members }, { data: invites }] =
    await Promise.all([
      db.from("properties").select("*").eq("id", ctx.property.id).single(),
      db.from("tenants").select("*").eq("id", ctx.tenantId).single(),
      db.from("unit_types").select("*").eq("property_id", ctx.property.id).order("created_at"),
      db.from("floors").select("*").eq("property_id", ctx.property.id).order("sort"),
      db.from("units").select("id, number, status, unit_type_id, floor_id, active").eq("property_id", ctx.property.id).order("number"),
      db.from("rate_plans").select("*, unit_types!inner(property_id, name_ar)").eq("unit_types.property_id", ctx.property.id).order("period"),
      db.from("tax_rules").select("*").eq("tenant_id", ctx.tenantId).order("sort"),
      db.from("memberships").select("*").eq("tenant_id", ctx.tenantId).is("support_until", null).order("created_at"),
      db.from("invitations").select("*").eq("tenant_id", ctx.tenantId).eq("staff_kind", "hotel").is("accepted_at", null),
    ]);
  // shop staff are managed under Shops → Shop staff, not here
  const shopStaffCount = (members ?? []).filter((m) => m.staff_kind === "shop").length;
  const hotelMembers = (members ?? []).filter((m) => m.staff_kind !== "shop");
  const { data: profiles } = await db.from("staff_profiles").select("*").eq("tenant_id", ctx.tenantId);
  const profile = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const typeName = new Map((types ?? []).map((x) => [x.id, x.name_ar]));
  const floorName = new Map((floors ?? []).map((f) => [f.id, f.name]));
  const unitsPerType = new Map<string, number>();
  for (const u of units ?? []) unitsPerType.set(u.unit_type_id, (unitsPerType.get(u.unit_type_id) ?? 0) + 1);
  const isOwner = ctx.role === "owner";

  return (
    <>
      <PageHeader title={t.set_title} />
      {ctx.role === "owner" && plan.code ? (
        <section className="card mb-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">{t.sub_title}</h2>
            <Link href="/upgrade" className="btn-ghost btn-sm">{t.sub_compare}</Link>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="label">{t.sub_plan}</div><div className="font-bold">{(lang === "en" || lang === "bn") && plan.nameEn ? plan.nameEn : plan.name}</div></div>
            <div><div className="label">{t.sub_status}</div><Badge tone={plan.status === "active" ? "ok" : plan.status === "trial" ? "info" : "danger"}>{t[`sub_st_${plan.status}` as DictKey]}</Badge></div>
            <div>
              <div className="label">{plan.status === "trial" ? t.sub_trial_until : t.sub_until}</div>
              <div className="font-semibold">{gregorian(plan.status === "trial" ? plan.trialEndsAt : plan.periodEnd, lang)}</div>
            </div>
            <div><div className="label">{t.sub_price}</div><div className="num font-semibold">{plan.price != null ? omr(plan.price, lang) : "—"}</div></div>
          </div>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-muted">{t.sub_payments} ({(subPays ?? []).length})</summary>
            {(subPays ?? []).length === 0 ? <p className="mt-2 text-xs text-muted">{t.sub_no_payments}</p> : (
              <ul className="mt-2 divide-y divide-line">
                {(subPays ?? []).map((x) => (
                  <li key={x.id} className={`flex flex-wrap justify-between gap-2 py-1.5 ${x.voided_at ? "text-muted line-through" : ""}`}>
                    <span>{gregorian(x.paid_on, lang)}</span>
                    <span className="text-muted">{gregorian(x.period_start, lang)} → {gregorian(x.period_end, lang)}</span>
                    <span className="num font-semibold">{omr(x.amount, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      ) : null}
      {ctx.role === "owner" || ctx.role === "manager" ? (
        <section className="card mb-4 flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h2 className="h2 inline-flex items-center gap-1.5"><ShieldCheck className="size-5 text-brand" /> {t.exp_all}</h2>
            <p className="text-sm text-muted">{t.exp_all_hint}</p>
          </div>
          <a href="/api/export/all?kind=excel" className="btn-primary btn-sm inline-flex items-center gap-1.5"><FileSpreadsheet className="size-4 shrink-0" />{t.exp_excel}</a>
          <a href="/api/export/all?kind=docs" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><FolderArchive className="size-4 shrink-0" />{t.exp_docs}</a>
        </section>
      ) : null}
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
            <Field label={t.set_bank_name}><input name="bank_name" defaultValue={prop?.bank_name ?? ""} className="input" /></Field>
            <Field label={t.set_bank_account}><input name="bank_account_name" defaultValue={prop?.bank_account_name ?? ""} className="input" /></Field>
            <Field label="IBAN" className="sm:col-span-2"><input name="bank_iban" defaultValue={prop?.bank_iban ?? ""} dir="ltr" className="input" /></Field>
            <Field label={t.set_pay_instructions} className="sm:col-span-2"><textarea name="payment_instructions" defaultValue={prop?.payment_instructions ?? ""} rows={2} maxLength={500} className="input" /></Field>
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
            {(types ?? []).map((x) => {
              const used = unitsPerType.get(x.id) ?? 0;
              return (
                <div key={x.id} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{x.name_ar}</span>
                    {x.name_en ? <span dir="ltr" className="text-xs text-muted">{x.name_en}</span> : null}
                    <Badge tone="gray">{t[`ukind_${x.kind}` as DictKey] ?? x.kind}</Badge>
                    <span className="text-xs text-muted">{t.type_units_count.replace("{n}", String(used))}</span>
                    <span className="ms-auto flex items-start gap-1.5">
                      <EditDetails label={t.edit}>
                        <ActionForm action={renameUnitType} className="grid min-w-64 gap-1.5">
                          <input type="hidden" name="id" value={x.id} />
                          <input name="name_ar" defaultValue={x.name_ar} required aria-label={t.set_name_ar} placeholder={t.set_name_ar} className="input py-1.5" />
                          <input name="name_en" defaultValue={x.name_en ?? ""} aria-label={t.set_name_en} placeholder={t.set_name_en} dir="ltr" className="input py-1.5" />
                          <select name="kind" defaultValue={x.kind} aria-label={t.type} className="input py-1.5">
                            {UNIT_KINDS.map((k) => <option key={k} value={k}>{t[`ukind_${k}` as DictKey]}</option>)}
                          </select>
                          <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                        </ActionForm>
                      </EditDetails>
                      <ActionForm action={deleteUnitType}>
                        <input type="hidden" name="id" value={x.id} />
                        <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.type_delete_q.replace("{name}", x.name_ar)}>{t.delete}</SubmitButton>
                      </ActionForm>
                    </span>
                  </div>
                  <ActionForm action={updateUnitType} className="grid grid-cols-12 items-end gap-2 text-sm">
                    <input type="hidden" name="id" value={x.id} />
                    <Field label={t.set_nightly} className="col-span-4"><input name="nightly" defaultValue={plainOmr(x.nightly_rate)} inputMode="decimal" className="input" /></Field>
                    <Field label={t.set_monthly} className="col-span-4"><input name="monthly" defaultValue={plainOmr(x.monthly_rate)} inputMode="decimal" className="input" /></Field>
                    <Field label={t.set_capacity} className="col-span-2"><input name="capacity" defaultValue={x.capacity} type="number" min={1} className="input px-2" /></Field>
                    <div className="col-span-2"><SubmitButton className="btn-ghost btn-sm w-full">{t.save}</SubmitButton></div>
                  </ActionForm>
                </div>
              );
            })}
          </div>
          <ActionForm action={addUnitType} resetOnSuccess className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-3">
            <Field label={t.set_name_ar}><input name="name_ar" required className="input" /></Field>
            <Field label={t.set_name_en}><input name="name_en" dir="ltr" className="input" /></Field>
            <Field label={t.type}>
              <select name="kind" className="input">
                {UNIT_KINDS.map((k) => <option key={k} value={k}>{t[`ukind_${k}` as DictKey]}</option>)}
              </select>
            </Field>
            <Field label={t.set_nightly}><input name="nightly" required inputMode="decimal" className="input" /></Field>
            <Field label={t.set_monthly}><input name="monthly" inputMode="decimal" className="input" /></Field>
            <Field label={t.set_capacity}><input name="capacity" type="number" min={1} defaultValue={2} className="input" /></Field>
            <SubmitButton className="btn-primary sm:col-span-3">{t.add}</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={t.set_rate_plans}>
          <div className="overflow-x-auto"><table className="table mb-3">
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
                      <EditDetails label={t.edit}>
                        <ActionForm action={updateRatePlan} className="grid min-w-64 gap-1.5">
                          <input type="hidden" name="id" value={p.id} />
                          <input name="name" defaultValue={p.name} required aria-label={t.set_season_name} className="input py-1.5" />
                          <input type="date" name="from" defaultValue={r.from} required aria-label={t.from} className="input py-1.5" />
                          <input type="date" name="to" defaultValue={r.to} required aria-label={t.to} className="input py-1.5" />
                          <input name="nightly" defaultValue={p.nightly_rate !== null ? plainOmr(p.nightly_rate) : ""} placeholder={t.set_nightly} inputMode="decimal" className="input py-1.5" />
                          <input name="monthly" defaultValue={p.monthly_rate !== null ? plainOmr(p.monthly_rate) : ""} placeholder={t.set_monthly} inputMode="decimal" className="input py-1.5" />
                          <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                        </ActionForm>
                      </EditDetails>
                    </td>
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
          </table></div>
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
            <div className="space-y-2">
              <div className="label">{t.set_floors}</div>
              <div className="flex flex-wrap gap-1.5">
                {(floors ?? []).map((f) => (
                  <EditDetails key={f.id} label={f.name}>
                    <ActionForm action={updateFloor} className="flex gap-1.5">
                      <input type="hidden" name="id" value={f.id} />
                      <input name="name" defaultValue={f.name} required aria-label={t.floor} className="input py-1.5" />
                      <input name="sort" type="number" defaultValue={f.sort} aria-label="#" className="input w-16 py-1.5" />
                      <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteFloor} className="mt-1.5">
                      <input type="hidden" name="id" value={f.id} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.delete}>{t.delete}</SubmitButton>
                    </ActionForm>
                  </EditDetails>
                ))}
              </div>
              {/* its own form: the floor editors above are forms too, and forms must not be nested */}
              <ActionForm action={addFloor} resetOnSuccess className="flex gap-2">
                <input name="name" required placeholder={t.floor} aria-label={t.floor} className="input" />
                <input name="sort" type="number" defaultValue={(floors ?? []).length + 1} aria-label="#" className="input w-20" />
                <SubmitButton className="btn-ghost">{t.add}</SubmitButton>
              </ActionForm>
            </div>
            {(types ?? []).length ? (
              <BulkUnitsForm
                action={bulkAddUnits}
                types={(types ?? []).map((x) => ({ id: x.id, name: x.name_ar }))}
                floors={(floors ?? []).map((f) => ({ id: f.id, name: f.name, sort: f.sort }))}
                existing={(units ?? []).map((u) => u.number)}
                labels={{
                  title: t.set_bulk_units, type: t.type, floor: t.floor, noFloor: t.bulk_no_floor, sequence: t.bulk_sequence, list: t.bulk_list,
                  prefix: t.bulk_prefix, prefixPh: "A-", start: t.bulk_start, count: t.bulk_count, listPh: "101 102 105 PH1",
                  preview: t.bulk_preview, existing: t.bulk_existing, add: t.bulk_add, none: t.bulk_none,
                }}
              />
            ) : (
              <p className="text-sm text-muted">{t.bulk_need_type}</p>
            )}
          </div>
          {(units ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t.units_none}</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="table">
                <thead><tr><th>{t.unit}</th><th>{t.type}</th><th>{t.floor}</th><th>{t.status}</th><th></th></tr></thead>
                <tbody>
                  {(units ?? []).map((u) => (
                    <tr key={u.id} className={u.active ? undefined : "opacity-55"}>
                      <td className="num font-semibold">{u.number}</td>
                      <td className="text-xs">{typeName.get(u.unit_type_id)}</td>
                      <td className="text-xs">{floorName.get(u.floor_id ?? "") ?? "—"}</td>
                      <td>
                        {!u.active ? <Badge tone="gray">{t.unit_inactive}</Badge> : (
                          <Badge tone={UNIT_STATUS_TONE[u.status]}><span aria-hidden>{UNIT_STATUS_EMOJI[u.status]}</span> {t[`st_${u.status}` as DictKey]}</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-start justify-end gap-1">
                          <EditDetails label={t.edit}>
                            <ActionForm action={updateUnit} className="grid min-w-56 gap-1.5">
                              <input type="hidden" name="id" value={u.id} />
                              <input name="number" defaultValue={u.number} required aria-label={t.unit} placeholder={t.unit} className="input py-1.5" />
                              <select name="unit_type" defaultValue={u.unit_type_id} aria-label={t.type} className="input py-1.5">
                                {(types ?? []).map((x) => <option key={x.id} value={x.id}>{x.name_ar}</option>)}
                              </select>
                              <select name="floor" defaultValue={u.floor_id ?? ""} aria-label={t.floor} className="input py-1.5">
                                <option value="">—</option>
                                {(floors ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                              <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                            </ActionForm>
                            {u.active && ["available", "dirty", "out_of_service"].includes(u.status) ? (
                              <ActionForm action={setUnitService} className="mt-1.5">
                                <input type="hidden" name="id" value={u.id} />
                                <input type="hidden" name="out" value={u.status === "out_of_service" ? "0" : "1"} />
                                <SubmitButton className="btn-ghost btn-sm w-full">{u.status === "out_of_service" ? t.unit_back_in_service : t.unit_out_of_service}</SubmitButton>
                              </ActionForm>
                            ) : null}
                          </EditDetails>
                          <ActionForm action={setUnitActive}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                            <SubmitButton className={`btn-ghost btn-sm ${u.active ? "" : "text-ok"}`} confirm={u.active ? t.unit_deactivate_q : undefined}>
                              {u.active ? t.unit_deactivate : t.unit_activate}
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={deleteUnit}>
                            <input type="hidden" name="id" value={u.id} />
                            <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.unit_delete_q.replace("{n}", u.number)}>{t.delete}</SubmitButton>
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title={t.set_staff}>
          <datalist id="job-titles">
            {["مدير الفندق", "مشرف الوردية", "موظف استقبال", "محاسب", "مشرف التنظيف", "عامل تنظيف", "فني صيانة", "مدير الإيرادات"].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <div className="space-y-2">
            {hotelMembers.map((m) => {
              const locked = m.user_id === ctx.userId || (!isOwner && ["owner", "manager"].includes(m.role));
              const title = m.job_title || t[`role_${m.role}` as DictKey];
              const pr = profile.get(m.user_id);
              return (
                <div key={m.user_id} className="rounded-xl border border-line p-2">
                <ActionForm action={updateMember} className="grid grid-cols-12 items-center gap-2 text-sm">
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <Link href={`/profile/${m.user_id}`} className="col-span-4 truncate font-semibold text-brand hover:underline">{m.full_name || m.user_id.slice(0, 8)}</Link>
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
                {m.role !== "owner" || m.user_id === ctx.userId ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-brand">
                      {t.staff_details}
                      {pr ? <span className="ms-2 text-muted">{[pr.phone, pr.civil_id && `${t.staff_civil_id}: ${pr.civil_id}`, pr.salary != null && `${t.staff_salary_short}: ${omr(pr.salary, lang)}`, pr.work_card_expiry && `${t.staff_card_expiry}: ${gregorian(pr.work_card_expiry, lang)}`].filter(Boolean).join(" · ")}</span> : null}
                    </summary>
                    <ActionForm action={updateStaffProfile} className="mt-2 grid gap-2 sm:grid-cols-3">
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <PhoneInput name="phone" defaultValue={pr?.phone ?? ""} lang={lang} label={t.staff_phone} labels={{ country: t.phone_country, search: t.phone_search, none: t.phone_none }} />
                      <input name="civil_id" defaultValue={pr?.civil_id ?? ""} placeholder={t.staff_civil_id} aria-label={t.staff_civil_id} dir="ltr" inputMode="numeric" className="input py-2" />
                      <input name="salary" defaultValue={pr?.salary != null ? (pr.salary / 1000).toFixed(3) : ""} placeholder={t.staff_salary} aria-label={t.staff_salary} inputMode="decimal" className="input py-2" />
                      <input name="work_card_no" defaultValue={pr?.work_card_no ?? ""} placeholder={t.staff_card_no} aria-label={t.staff_card_no} dir="ltr" className="input py-2" />
                      <input name="work_card_expiry" type="date" defaultValue={pr?.work_card_expiry ?? ""} aria-label={t.staff_card_expiry} title={t.staff_card_expiry} className="input py-2" />
                      <SubmitButton className="btn-ghost btn-sm">{t.save}</SubmitButton>
                    </ActionForm>
                  </details>
                ) : null}
                </div>
              );
            })}
            <p className="flex items-start gap-1.5 text-xs text-muted"><Lock className="size-3.5 shrink-0" /> {t.staff_private_hint}</p>
            {shopStaffCount ? (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
                <Link href="/shops/staff" className="font-semibold text-brand">{t.ss_hotel_note.replace("{n}", String(shopStaffCount))}</Link>
              </p>
            ) : null}
          </div>
          {(invites ?? []).length ? (
            <div className="mt-3 text-xs">
              <div className="mb-1 text-muted">{t.pending_invites}:</div>
              <ul className="space-y-1">
                {(invites ?? []).map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate"><span dir="ltr">{i.email}</span> · {i.full_name} ({i.job_title || t[`role_${i.role}` as DictKey]})</span>
                    <ActionForm action={cancelInvite}>
                      <input type="hidden" name="id" value={i.id} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.inv_cancel_q}>{t.inv_cancel}</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
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
              <div><span className="label">{t.staff_phone}</span><PhoneInput name="phone" lang={lang} label={t.staff_phone} labels={{ country: t.phone_country, search: t.phone_search, none: t.phone_none }} /></div>
              <Field label={t.staff_civil_id}><input name="civil_id" dir="ltr" inputMode="numeric" className="input" /></Field>
              <Field label={t.staff_salary}><input name="salary" inputMode="decimal" placeholder="0.000" className="input" /></Field>
              <Field label={t.staff_card_no}><input name="work_card_no" dir="ltr" className="input" /></Field>
              <Field label={t.staff_card_expiry}><input name="work_card_expiry" type="date" className="input" /></Field>
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
