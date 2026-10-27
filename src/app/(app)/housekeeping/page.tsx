import { Check, X } from "lucide-react";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { todayIn } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, EditDetails, Empty, PageHeader, Section } from "@/components/ui";
import { addHkTask, setHkStatus, updateHkTask } from "@/app/actions/ops";

type Task = { id: string; unit_id: string; kind: string; status: string; priority: number; due_date: string; notes: string | null; units: { number: string } | null };

// FR-40: list ordered by arrivals; "Ready" returns the unit to availability.
export default async function HousekeepingPage() {
  const ctx = await requireArea("housekeeping");
  const { t } = await getDict();
  const today = todayIn(ctx.property.timezone);
  const [{ data: tasks }, { data: units }, { data: board }] = await Promise.all([
    ctx.supabase
      .from("hk_tasks")
      .select("id, unit_id, kind, status, priority, due_date, notes, units(number)")
      .eq("property_id", ctx.property.id)
      .in("status", ["pending", "in_progress"])
      .lte("due_date", today)
      .order("priority")
      .order("created_at"),
    ctx.supabase.from("units").select("id, number").eq("property_id", ctx.property.id).eq("active", true).order("number"),
    ctx.supabase.rpc("unit_board", { p_property: ctx.property.id }),
  ]);
  // Units with an arrival today go first, whatever the stored priority.
  const arriving = new Set(
    ((board ?? []) as { unit_id: string; next_arrival: string | null }[]).filter((b) => b.next_arrival === today).map((b) => b.unit_id),
  );
  const list = ((tasks ?? []) as unknown as Task[]).sort(
    (a, b) => Number(arriving.has(b.unit_id)) - Number(arriving.has(a.unit_id)) || a.priority - b.priority,
  );

  const canManage = hasRole(ctx, ["manager", "reception"]);
  return (
    <>
      <PageHeader title={t.hk_title} />
      {list.length === 0 ? (
        <Empty>{t.hk_empty}</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((task) => (
            <div key={task.id} className={`card ${arriving.has(task.unit_id) ? "border-danger/40" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="num text-2xl font-bold">{task.units?.number}</span>
                <Badge tone={task.status === "in_progress" ? "info" : "warn"}>{task.status === "in_progress" ? t.hk_in_progress : t.hk_pending}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted">{t[`hk_kind_${task.kind}` as DictKey]}</div>
              {arriving.has(task.unit_id) ? <div className="mt-1 text-sm font-semibold text-danger">{t.hk_urgent}</div> : null}
              {task.notes ? <div className="mt-1 text-sm">{task.notes}</div> : null}
              <div className="mt-3 flex gap-2">
                {task.status === "pending" ? (
                  <ActionForm action={setHkStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="in_progress" />
                    <SubmitButton className="btn-ghost">{t.hk_start}</SubmitButton>
                  </ActionForm>
                ) : null}
                <ActionForm action={setHkStatus} className="flex-1">
                  <input type="hidden" name="id" value={task.id} />
                  <input type="hidden" name="status" value="done" />
                  <SubmitButton className="btn-primary w-full"><Check className="inline size-4" /> {t.hk_done}</SubmitButton>
                </ActionForm>
              </div>
              {canManage ? (
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <EditDetails label={t.edit} className="flex-1">
                    <ActionForm action={updateHkTask} className="grid gap-2 sm:grid-cols-2">
                      <input type="hidden" name="id" value={task.id} />
                      <select name="kind" defaultValue={task.kind} aria-label={t.type} className="input py-2">
                        {["stayover", "weekly", "deep", "inspection", "checkout"].map((k) => <option key={k} value={k}>{t[`hk_kind_${k}` as DictKey]}</option>)}
                      </select>
                      <select name="priority" defaultValue={task.priority} aria-label={t.priority} className="input py-2">
                        {[1, 2, 3].map((p) => <option key={p} value={p}>{t[`pr_${p}` as DictKey]}</option>)}
                      </select>
                      <input type="date" name="date" defaultValue={task.due_date} aria-label={t.date} className="input py-2" />
                      <input name="notes" defaultValue={task.notes ?? ""} placeholder={t.notes} className="input py-2" />
                      <SubmitButton className="btn-primary btn-sm sm:col-span-2">{t.save}</SubmitButton>
                    </ActionForm>
                  </EditDetails>
                  <ActionForm action={setHkStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="cancelled" />
                    <SubmitButton className="btn-ghost btn-sm inline-flex items-center gap-1 text-danger" confirm={t.confirm_cancel}><X className="size-3.5 shrink-0" />{t.cancel}</SubmitButton>
                  </ActionForm>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canManage ? (
        <div className="mt-6">
          <Section title={t.hk_add}>
            <ActionForm action={addHkTask} resetOnSuccess className="grid gap-2 sm:grid-cols-5">
              <select name="unit" required className="input">
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
              </select>
              <select name="kind" className="input">
                {["stayover", "weekly", "deep", "inspection", "checkout"].map((k) => <option key={k} value={k}>{t[`hk_kind_${k}` as DictKey]}</option>)}
              </select>
              <select name="priority" defaultValue="2" className="input">
                {[1, 2, 3].map((p) => <option key={p} value={p}>{t[`pr_${p}` as DictKey]}</option>)}
              </select>
              <input type="date" name="date" defaultValue={today} className="input" />
              <SubmitButton>{t.add}</SubmitButton>
            </ActionForm>
          </Section>
        </div>
      ) : null}
    </>
  );
}
