import { SettingsTabs } from "../SettingsTabs";
import { requireFeature } from "@/lib/plan";
import Link from "next/link";
import { Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { isRtl, type DictKey } from "@/lib/i18n/dict";
import { loadTemplates, PLACEHOLDERS } from "@/lib/messages";
import { SUGGESTED_RULES } from "@/lib/automation-suggested";
import { addDays, gregorian, omr, todayIn } from "@/lib/format";
import { RuleForm } from "./RuleForm";
import { TemplateEditor } from "./TemplateEditor";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT } from "@/lib/contracts";
import { saveContractTemplate } from "@/app/actions/contracts";
import {
  addRule, addSuggestedRule, addSuggestedRules, deleteRule, resetTemplate, runAutomationNow, saveTemplate, toggleRule, updateRule,
} from "@/app/actions/messages";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, EditDetails, Empty, Field, PageHeader, Section } from "@/components/ui";

const TRIGGERS = ["booking_confirmed", "before_arrival", "after_checkin", "after_checkout"] as const;
const RARE_TRIGGERS = ["rent_overdue", "contract_ending"] as const;
const ACTIONS = ["whatsapp", "hk_task", "notify"] as const;
const HK = ["stayover", "weekly", "deep", "inspection", "checkout"] as const;

type Rule = { id: string; name: string; trigger: string; offset_days: number; action: string; template_key: string | null; hk_kind: string | null; active: boolean; property_id: string | null };

/** Owner/manager: "when this happens, do that" rules, and the wording of every guest message. */
export default async function AutomationPage({ searchParams }: PageProps<"/settings/automation">) {
  const ctx = await requireArea("settings");
  await requireFeature(ctx, "automation");
  if (!hasRole(ctx, ["manager"])) redirect("/settings");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const isOwner = ctx.role === "owner";
  // three subjects, one at a time: the rules, the wording of the messages, the contract text (owner)
  const view = sp.a === "messages" ? "messages" : sp.a === "contract" && isOwner ? "contract" : "rules";
  const [{ data }, templates, { data: tenant }] = await Promise.all([
    ctx.supabase.from("automation_rules").select("*").eq("tenant_id", ctx.tenantId).order("created_at"),
    loadTemplates(ctx, lang),
    ctx.supabase.from("tenants").select("contract_template").eq("id", ctx.tenantId).single(),
  ]);
  const rules = (data ?? []) as Rule[];
  const tplName = new Map(templates.map((x) => [x.key, x.name]));
  const arrow = isRtl(lang) ? "←" : "→";
  const whenText = (trigger: string, n: number) => t[`auto_tr_${trigger}` as DictKey].replace("{n}", String(n));
  const doText = (r: { action: string; template_key: string | null; hk_kind?: string | null }) =>
    r.action === "whatsapp" ? `${t.auto_ac_whatsapp}: ${tplName.get(r.template_key ?? "") ?? r.template_key}` : r.action === "hk_task" ? `${t.auto_ac_hk_task}: ${t[`hk_kind_${r.hk_kind ?? "stayover"}` as DictKey]}` : t.auto_ac_notify;
  // ready-made rules not switched on yet (same trigger, day count and action as an existing rule counts as on)
  const same = (a: { trigger: string; offset_days: number; action: string; template_key: string | null }, b: Rule) =>
    a.trigger === b.trigger && a.offset_days === b.offset_days && a.action === b.action && (a.template_key ?? null) === (b.template_key ?? null);
  const ready = SUGGESTED_RULES.filter((x) => !rules.some((r) => same(x, r)));

  const formProps = {
    triggers: TRIGGERS.map((x) => ({ value: x, label: t[`auto_tr_${x}` as DictKey] })),
    rareTriggers: RARE_TRIGGERS.map((x) => ({ value: x, label: t[`auto_tr_${x}` as DictKey] })),
    actions: ACTIONS.map((x) => ({ value: x, label: t[`auto_ac_${x}` as DictKey] })),
    templates: templates.map((x) => ({ value: x.key, label: x.name })),
    hkKinds: HK.map((x) => ({ value: x, label: t[`hk_kind_${x}` as DictKey] })),
    arrow,
  };
  const formLabels = { when: t.auto_q_when, what: t.auto_q_what, days: t.auto_q_days, message: t.auto_q_msg, hkKind: t.auto_hk_kind, moreTriggers: t.auto_more_triggers, willBe: t.auto_will_be };

  // ---- messages: the one being edited, and sample values for the preview
  const picked = typeof sp.k === "string" ? sp.k : "";
  const current = picked === "new" ? null : (templates.find((x) => x.key === picked) ?? templates[0] ?? null);
  const today = todayIn(ctx.property.timezone);
  const samples: Record<(typeof PLACEHOLDERS)[number], string> = {
    guest: lang === "ar" || lang === "ur" ? "سالم الحارثي" : "Salim Al Harthi",
    hotel: ctx.property.name_ar, unit: "204", code: "R-2611",
    from: gregorian(addDays(today, 1), lang), to: gregorian(addDays(today, 3), lang),
    checkin_time: "14:00", hotel_phone: "+968 2400 0100", balance: omr(45000, lang),
    pay_link: "nuzul.app/pay/…", review_link: "nuzul.app/review/…", sign_link: "nuzul.app/sign/…",
  };
  const placeholders = PLACEHOLDERS.map((k) => ({ key: k, label: t[`ph_${k}` as DictKey], sample: samples[k] }));
  const editorLabels = { name: t.name, insert: t.tpl_insert, body: t.tpl_body, preview: t.tpl_preview, previewHint: t.tpl_preview_hint };
  const sub = (key: string, label: string) => (
    <Link
      href={key === "rules" ? "/settings/automation" : `/settings/automation?a=${key}`}
      aria-current={view === key ? "page" : undefined}
      className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${view === key ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <SettingsTabs ctx={ctx} t={t} current="automation" />
      <PageHeader title={t.auto_title} sub={t.auto_intro} />
      <nav aria-label={t.auto_title} className="no-print mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {sub("rules", t.auto_rules)}
        {sub("messages", t.tpl_title)}
        {isOwner ? sub("contract", t.ct_template) : null}
      </nav>

      {view === "rules" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <Section title={`${t.auto_yours} (${rules.length})`}>
                {rules.length === 0 ? (
                  <Empty>{t.auto_none}</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {rules.map((r) => (
                      <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          {/* the rule reads as a sentence: when → what */}
                          <p className={`min-w-0 flex-1 text-sm ${r.active ? "" : "text-muted"}`}>
                            <span className="font-bold">{whenText(r.trigger, r.offset_days)}</span> <span className="text-muted" aria-hidden>{arrow}</span> {doText(r)}
                            {r.property_id ? null : <span className="ms-2 text-xs text-muted">· {t.auto_all_props}</span>}
                          </p>
                          <ActionForm action={toggleRule}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                            <SubmitButton className={`switch ${r.active ? "switch-on" : ""}`}><span className="sr-only">{r.active ? t.auto_pause : t.auto_resume}</span></SubmitButton>
                          </ActionForm>
                        </div>
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          <EditDetails label={t.edit} className="flex-1">
                            <ActionForm action={updateRule} className="space-y-3">
                              <input type="hidden" name="id" value={r.id} />
                              <RuleForm {...formProps} labels={formLabels} initial={{ trigger: r.trigger, offset: r.offset_days, action: r.action, template: r.template_key, hkKind: r.hk_kind }} />
                              <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                            </ActionForm>
                          </EditDetails>
                          <ActionForm action={deleteRule}>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton className="btn-ghost btn-sm text-danger" confirm={`${t.delete}: ${whenText(r.trigger, r.offset_days)}`}><Trash2 className="size-3.5" /><span className="sr-only">{t.delete}</span></SubmitButton>
                          </ActionForm>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              {ready.length ? (
                <Section
                  title={t.auto_ready}
                  actions={
                    rules.length === 0 ? (
                      <ActionForm action={addSuggestedRules}>
                        <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Sparkles className="size-4 shrink-0" />{t.auto_suggested}</SubmitButton>
                      </ActionForm>
                    ) : undefined
                  }
                >
                  <p className="mb-1 text-sm text-muted">{t.auto_ready_hint}</p>
                  <ul className="divide-y divide-line">
                    {ready.map((x) => (
                      <li key={x.key} className="flex items-center gap-3 py-3 last:pb-0">
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-bold">{t[x.name]}</div>
                          <div className="text-muted">{whenText(x.trigger, x.offset_days)} {arrow} {doText(x)}</div>
                        </div>
                        <ActionForm action={addSuggestedRule}>
                          <input type="hidden" name="key" value={x.key} />
                          <SubmitButton className="btn-ghost btn-sm">{t.auto_enable}</SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}
            </div>
            <div className="lg:col-span-2">
              <Section title={t.auto_add}>
                <ActionForm action={addRule} resetOnSuccess className="space-y-4">
                  <RuleForm {...formProps} labels={{ ...formLabels, allProps: t.auto_all_props }} />
                  <SubmitButton className="btn-primary w-full">{t.add}</SubmitButton>
                </ActionForm>
              </Section>
            </div>
          </div>
          <details className="card mt-4">
            <summary className="cursor-pointer text-sm font-semibold">{t.auto_advanced}</summary>
            <p className="mt-3 text-sm text-muted">{t.auto_hint}</p>
            <ActionForm action={runAutomationNow} className="mt-3">
              <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Zap className="size-4 shrink-0" />{t.auto_run_now}</SubmitButton>
            </ActionForm>
          </details>
        </>
      ) : null}

      {view === "messages" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-2 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
              {templates.map((x) => (
                <li key={x.key} className="shrink-0">
                  <Link
                    href={`/settings/automation?a=messages&k=${x.key}`}
                    scroll={false}
                    aria-current={current?.key === x.key ? "page" : undefined}
                    className={`block whitespace-nowrap rounded-2xl px-3 py-2.5 text-sm font-semibold ${current?.key === x.key ? "bg-brand-soft text-brand" : "text-ink hover:bg-surface-2"}`}
                  >
                    {x.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/settings/automation?a=messages&k=new" scroll={false} className={`mt-2 w-full ${picked === "new" ? "btn-primary" : "btn-ghost"}`}><Plus className="size-4 shrink-0" />{t.tpl_add}</Link>
          </div>
          <div className="lg:col-span-2">
            {current ? (
              <Section title={current.name}>
                <ActionForm action={saveTemplate} className="space-y-3">
                  <TemplateEditor key={current.key} tplKey={current.key} name={current.name} bodyAr={current.body_ar} bodyEn={current.body_en} placeholders={placeholders} labels={editorLabels} />
                  <SubmitButton className="btn-primary">{t.save}</SubmitButton>
                </ActionForm>
                {current.edited ? (
                  <ActionForm action={resetTemplate} className="mt-2">
                    <input type="hidden" name="key" value={current.key} />
                    <SubmitButton className="btn-ghost btn-sm text-muted" confirm={current.custom ? t.delete : t.tpl_reset}>{current.custom ? t.delete : t.tpl_reset}</SubmitButton>
                  </ActionForm>
                ) : null}
              </Section>
            ) : (
              <Section title={t.tpl_add}>
                <ActionForm action={saveTemplate} resetOnSuccess className="space-y-3">
                  {/* the code a rule refers to is made here; the user only names the message */}
                  <TemplateEditor key="new" tplKey={`custom_${Date.now().toString(36)}`} name="" askName bodyAr="" bodyEn="" placeholders={placeholders} labels={editorLabels} />
                  <SubmitButton className="btn-primary">{t.add}</SubmitButton>
                </ActionForm>
              </Section>
            )}
          </div>
        </div>
      ) : null}

      {view === "contract" ? (
        <section className="card">
          <h2 className="h2 mb-1">{t.ct_template}</h2>
          <p className="mb-3 text-xs text-muted">
            {t.ct_template_hint} <span dir="ltr" className="font-mono">{CONTRACT_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</span>
          </p>
          <ActionForm action={saveContractTemplate} className="space-y-2">
            <textarea name="template" defaultValue={(tenant?.contract_template as string | null) || DEFAULT_CONTRACT} rows={18} dir="rtl" className="input text-sm leading-6" />
            <SubmitButton className="btn-primary">{t.save}</SubmitButton>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
