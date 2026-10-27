import { Check, Lock } from "lucide-react";
import Link from "next/link";
import type { Ctx } from "@/lib/auth";
import type { Dict, DictKey, Lang } from "@/lib/i18n/dict";
import { dateTime, omr } from "@/lib/format";
import { paySalary, cancelSalary } from "@/app/actions/salaries";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Section } from "@/components/ui";

type Payment = { id: string; user_id: string; amount: number; method: string; paid_at: string };

/** Monthly salaries: who is due what, pay with one click (books an expense), undo a mistake. Owner/manager only. */
export async function Salaries({ ctx, month, monthLabel, t, lang }: { ctx: Ctx; month: string; monthLabel: string; t: Dict; lang: Lang }) {
  const monthStart = `${month}-01`;
  const [{ data: members }, { data: profiles }, { data: payments, error }] = await Promise.all([
    ctx.supabase.from("memberships").select("user_id, full_name, job_title, role, active").eq("tenant_id", ctx.tenantId).order("created_at"),
    ctx.supabase.from("staff_profiles").select("user_id, salary").eq("tenant_id", ctx.tenantId),
    ctx.supabase.from("salary_payments").select("id, user_id, amount, method, paid_at").eq("tenant_id", ctx.tenantId).eq("month", monthStart),
  ]);
  if (error) return null; // feature not installed in this database yet
  const salary = new Map((profiles ?? []).map((p) => [p.user_id as string, p.salary as number | null]));
  const paid = new Map(((payments ?? []) as Payment[]).map((p) => [p.user_id, p]));
  const staff = (members ?? []).filter((m) => m.role !== "owner" && (m.active || paid.has(m.user_id)));
  const due = staff.reduce((a, m) => a + (salary.get(m.user_id) ?? 0), 0);
  const paidTotal = ((payments ?? []) as Payment[]).reduce((a, p) => a + p.amount, 0);

  return (
    <Section title={`${t.sal_title} · ${monthLabel}`}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[[t.sal_total, due, ""], [t.sal_paid, paidTotal, "text-ok"], [t.sal_remaining, Math.max(due - paidTotal, 0), due - paidTotal > 0 ? "text-danger" : ""]].map(([l, v, c]) => (
          <div key={l as string} className="rounded-xl bg-surface-2 p-2 text-center">
            <div className="text-xs text-muted">{l}</div>
            <div className={`num text-sm font-bold ${c}`}>{omr(v as number, lang)}</div>
          </div>
        ))}
      </div>
      {staff.length === 0 ? (
        <p className="text-sm text-muted">{t.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t.audit_actor}</th><th>{t.sal_salary}</th><th>{t.status}</th><th></th></tr></thead>
            <tbody>
              {staff.map((m) => {
                const s = salary.get(m.user_id) ?? null;
                const p = paid.get(m.user_id);
                return (
                  <tr key={m.user_id}>
                    <td>
                      <div className="font-semibold">{m.full_name || "—"}</div>
                      <div className="text-xs text-muted">{m.job_title || t[`role_${m.role}` as DictKey]}</div>
                    </td>
                    <td className="num whitespace-nowrap">{s != null ? omr(s, lang) : <Link href="/settings" className="text-xs text-brand">{t.sal_not_set}</Link>}</td>
                    <td className="text-xs">
                      {p ? (
                        <Badge tone="ok"><Check className="size-3.5 shrink-0" /> {t.sal_paid_on} {dateTime(p.paid_at, ctx.property.timezone, lang)} · {t[`pm_${p.method}` as DictKey]}</Badge>
                      ) : (
                        <Badge tone="warn">{t.sal_unpaid}</Badge>
                      )}
                    </td>
                    <td>
                      {p ? (
                        <ActionForm action={cancelSalary}>
                          <input type="hidden" name="id" value={p.id} />
                          <SubmitButton className="btn-ghost btn-sm" confirm={t.sal_undo_confirm}>{t.sal_undo}</SubmitButton>
                        </ActionForm>
                      ) : (
                        <ActionForm action={paySalary} className="flex flex-wrap items-center gap-1.5">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <input type="hidden" name="month" value={monthStart} />
                          <input name="amount" defaultValue={s != null ? (s / 1000).toFixed(3) : ""} required inputMode="decimal" aria-label={t.amount} className="input w-28 py-1.5" />
                          <select name="method" defaultValue="transfer" aria-label={t.method} className="input w-auto py-1.5">
                            {["transfer", "cash", "card"].map((x) => <option key={x} value={x}>{t[`pm_${x}` as DictKey]}</option>)}
                          </select>
                          <SubmitButton className="btn-primary btn-sm" confirm={`${t.sal_pay}: ${m.full_name}?`}>{t.sal_pay}</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Lock className="size-3.5 shrink-0" /> {t.sal_hint}</p>
    </Section>
  );
}
