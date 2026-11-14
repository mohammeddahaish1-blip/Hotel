import { SettingsTabs } from "../SettingsTabs";
import { requireFeature } from "@/lib/plan";
import { Sparkles, Trash2, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { isRtl, type DictKey } from "@/lib/i18n/dict";
import { loadTemplates, PLACEHOLDERS } from "@/lib/messages";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT } from "@/lib/contracts";
import { saveContractTemplate } from "@/app/actions/contracts";
import {
  addRule, addSuggestedRules, deleteRule, resetTemplate, runAutomationNow, saveTemplate, toggleRule, updateRule,
} from "@/app/actions/messages";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, EditDetails, Empty, Field, PageHeader, Section } from "@/components/ui";

const TRIGGERS = ["booking_confirmed", "before_arrival", "after_checkin", "after_checkout", "rent_overdue", "contract_ending"] as const;
const ACTIONS = ["whatsapp", "hk_task", "notify"] as const;
const HK = ["stayover", "weekly", "deep", "inspection", "checkout"] as const;

type Rule = { id: string; name: string; trigger: string; offset_days: number; action: string; template_key: string | null; hk_kind: string | null; active: boolean; property_id: string | null };

/** Owner/manager: "when this happens, do that" rules, and the wording of every guest message. */
export default async function AutomationPage() {
  const ctx = await requireArea("settings");
  await requireFeature(ctx, "automation");
  if (!hasRole(ctx, ["manager"])) redirect("/settings");
  const { t, lang } = await getDict();
  const [{ data }, templates, { data: tenant }] = await Promise.all([
    ctx.supabase.from("automation_rules").select("*").eq("tenant_id", ctx.tenantId).order("created_at"),
    loadTemplates(ctx, lang),
    ctx.supabase.from("tenants").select("contract_template").eq("id", ctx.tenantId).single(),
  ]);
  const rules = (data ?? []) as Rule[];
  const tplName = new Map(templates.map((x) => [x.key, x.name]));
  const describe = (r: Rule) =>
    `${t[`auto_tr_${r.trigger}` as DictKey].replace("{n}", String(r.offset_days))} ${isRtl(lang) ? "←" : "→"} ${
      r.action === "whatsapp" ? `${t.auto_ac_whatsapp}: ${tplName.get(r.template_key ?? "") ?? r.template_key}` : r.action === "hk_task" ? `${t.auto_ac_hk_task}: ${t[`hk_kind_${r.hk_kind ?? "stayover"}` as DictKey]}` : t.auto_ac_notify
    }`;

  const ruleFields = (r?: Rule) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={t.name} className="sm:col-span-2"><input name="name" defaultValue={r?.name ?? ""} required className="input" /></Field>
      <Field label={t.auto_when}>
        <select name="trigger" defaultValue={r?.trigger ?? "before_arrival"} className="input">
          {TRIGGERS.map((x) => <option key={x} value={x}>{t[`auto_tr_${x}` as DictKey].replace("{n}", "N")}</option>)}
        </select>
      </Field>
      <Field label={t.auto_days}><input name="offset" type="number" min={0} max={90} defaultValue={r?.offset_days ?? 1} className="input" /></Field>
      <Field label={t.auto_do}>
        <select name="action" defaultValue={r?.action ?? "whatsapp"} className="input">
          {ACTIONS.map((x) => <option key={x} value={x}>{t[`auto_ac_${x}` as DictKey]}</option>)}
        </select>
      </Field>
      <Field label={t.auto_template}>
        <select name="template" defaultValue={r?.template_key ?? "pre_arrival"} className="input">
          {templates.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
      </Field>
      <Field label={t.auto_hk_kind}>
        <select name="hk_kind" defaultValue={r?.hk_kind ?? "stayover"} className="input">
          {HK.map((x) => <option key={x} value={x}>{t[`hk_kind_${x}` as DictKey]}</option>)}
        </select>
      </Field>
    </div>
  );

  return (
    <>
      <SettingsTabs ctx={ctx} t={t} current="automation" />
      <PageHeader
        title={t.auto_title}
        sub={t.auto_hint}
        actions={
          <ActionForm action={runAutomationNow}>
            <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Zap className="size-4 shrink-0" />{t.auto_run_now}</SubmitButton>
          </ActionForm>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`${t.auto_rules} (${rules.length})`}>
          {rules.length === 0 ? (
            <div className="space-y-3">
              <Empty>{t.auto_none}</Empty>
              <ActionForm action={addSuggestedRules}>
                <SubmitButton className="btn-primary inline-flex items-center gap-2"><Sparkles className="size-4 shrink-0" />{t.auto_suggested}</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <ul className="space-y-2">
              {rules.map((r) => (
                <li key={r.id} className={`rounded-xl border border-line p-3 ${r.active ? "" : "opacity-60"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-semibold">{r.name}</span>
                    {r.property_id ? null : <Badge tone="gray">{t.auto_all_props}</Badge>}
                    <Badge tone={r.active ? "ok" : "gray"}>{r.active ? t.active : t.auto_paused}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{describe(r)}</p>
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <ActionForm action={toggleRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                      <SubmitButton className="btn-ghost btn-sm">{r.active ? t.auto_pause : t.auto_resume}</SubmitButton>
                    </ActionForm>
                    <EditDetails label={t.edit} className="flex-1">
                      <ActionForm action={updateRule} className="space-y-2">
                        <input type="hidden" name="id" value={r.id} />
                        {ruleFields(r)}
                        <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                      </ActionForm>
                    </EditDetails>
                    <ActionForm action={deleteRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.delete}><Trash2 className="size-3.5" /></SubmitButton>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addRule} resetOnSuccess className="mt-4 space-y-2 border-t border-line pt-4">
            <div className="h2">{t.auto_add}</div>
            {ruleFields()}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="all" defaultChecked /> {t.auto_all_props}</label>
            <SubmitButton className="btn-primary">{t.add}</SubmitButton>
          </ActionForm>
        </Section>

        <Section title={t.tpl_title}>
          <p className="mb-3 text-xs text-muted">
            {t.tpl_hint} <span dir="ltr" className="font-mono">{PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</span>
          </p>
          <div className="space-y-2">
            {templates.map((x) => (
              <EditDetails key={x.key} label={x.name}>
                <ActionForm action={saveTemplate} className="space-y-2">
                  <input type="hidden" name="key" value={x.key} />
                  <input type="hidden" name="name" value={x.name} />
                  <Field label="العربية"><textarea name="body_ar" defaultValue={x.body_ar} rows={4} dir="rtl" className="input text-sm" /></Field>
                  <Field label="English"><textarea name="body_en" defaultValue={x.body_en} rows={4} dir="ltr" className="input text-sm" /></Field>
                  <div className="flex gap-2">
                    <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                  </div>
                </ActionForm>
                {x.edited ? (
                  <ActionForm action={resetTemplate} className="mt-2">
                    <input type="hidden" name="key" value={x.key} />
                    <SubmitButton className="btn-ghost btn-sm text-muted">{x.custom ? t.delete : t.tpl_reset}</SubmitButton>
                  </ActionForm>
                ) : null}
              </EditDetails>
            ))}
          </div>
          <ActionForm action={saveTemplate} resetOnSuccess className="mt-4 space-y-2 border-t border-line pt-4">
            <div className="h2">{t.tpl_add}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t.name}><input name="name" required className="input" /></Field>
              <Field label={t.tpl_key}><input name="key" required pattern="[a-z0-9_]{2,40}" dir="ltr" placeholder="welcome_gift" className="input" /></Field>
            </div>
            <Field label="العربية"><textarea name="body_ar" required rows={3} dir="rtl" className="input text-sm" /></Field>
            <Field label="English"><textarea name="body_en" rows={3} dir="ltr" className="input text-sm" /></Field>
            <SubmitButton className="btn-primary">{t.add}</SubmitButton>
          </ActionForm>
        </Section>

        {ctx.role === "owner" ? (
          <section className="card lg:col-span-2">
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
      </div>
    </>
  );
}
