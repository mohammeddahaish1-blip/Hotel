import Link from "next/link";
import { Check, ImageOff, RotateCcw, X } from "lucide-react";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { intlLocale, type DictKey } from "@/lib/i18n/dict";
import { todayIn, zonedStart } from "@/lib/format";
import { signedUrls } from "@/lib/storage";
import { ReceiptInput } from "@/components/FinanceInputs";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, EditDetails, Empty, PageHeader, Section } from "@/components/ui";
import { addHkTask, finishHkTask, reopenHkTask, setHkStatus, updateHkTask } from "@/app/actions/ops";

type Done = { id: string; kind: string; started_at: string | null; finished_at: string; finished_by: string | null; photo_path: string | null; units: { number: string } | null };
type Task = { id: string; unit_id: string; kind: string; status: string; priority: number; due_date: string; notes: string | null; units: { number: string } | null };

// FR-40: list ordered by arrivals; "Ready" returns the unit to availability.
export default async function HousekeepingPage({ searchParams }: PageProps<"/housekeeping">) {
  const ctx = await requireArea("housekeeping");
  const { t, lang } = await getDict();
  const today = todayIn(ctx.property.timezone);
  const [{ data: tasks }, { data: units }, { data: board }, { data: doneRows }] = await Promise.all([
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
    // finished today: start and finish times, and the photo taken when the unit was marked ready
    ctx.supabase
      .from("hk_tasks")
      .select("id, kind, started_at, finished_at, finished_by, photo_path, units(number)")
      .eq("property_id", ctx.property.id)
      .eq("status", "done")
      .gte("finished_at", zonedStart(today, ctx.property.timezone))
      .order("finished_at", { ascending: false })
      .limit(100),
  ]);
  const done = (doneRows ?? []) as unknown as Done[];
  // the photo is for the owner and managers; other roles see the times only
  const seesPhotos = hasRole(ctx, ["manager"]);
  const photos = seesPhotos ? await signedUrls(ctx, "hk-photos", done.map((d) => d.photo_path)) : new Map<string, string>();
  // who pressed "Ready": names come from the hotel's staff list
  const cleanerIds = [...new Set(done.map((d) => d.finished_by).filter((x): x is string => !!x))];
  const { data: staff } = cleanerIds.length
    ? await ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId).in("user_id", cleanerIds)
    : { data: [] };
  const cleaner = new Map(((staff ?? []) as { user_id: string; full_name: string }[]).map((m) => [m.user_id, m.full_name]));
  const clock = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(intlLocale(lang), { timeStyle: "short", timeZone: ctx.property.timezone }).format(new Date(iso)) : "—";
  const now = Date.now();
  // Units with an arrival today go first, whatever the stored priority.
  const arriving = new Set(
    ((board ?? []) as { unit_id: string; next_arrival: string | null }[]).filter((b) => b.next_arrival === today).map((b) => b.unit_id),
  );
  const list = ((tasks ?? []) as unknown as Task[]).sort(
    (a, b) => Number(arriving.has(b.unit_id)) - Number(arriving.has(a.unit_id)) || a.priority - b.priority,
  );

  const canManage = hasRole(ctx, ["manager", "reception"]);
  // filter chips: all, urgent (arrival today), being cleaned, waiting
  const sp = await searchParams;
  const f = typeof sp.f === "string" ? sp.f : "all";
  const urgent = list.filter((x) => arriving.has(x.unit_id));
  const doing = list.filter((x) => x.status === "in_progress");
  const waiting = list.filter((x) => x.status !== "in_progress");
  const shown = f === "urgent" ? urgent : f === "doing" ? doing : f === "waiting" ? waiting : list;
  const chips = [
    ["all", t.fb_all, list.length],
    ["urgent", t.pr_1, urgent.length],
    ["doing", t.hk_in_progress, doing.length],
    ["waiting", t.hk_pending, waiting.length],
  ] as const;
  return (
    <>
      <PageHeader title={t.hk_title} />
      {list.length === 0 ? (
        <Empty>{t.hk_empty}</Empty>
      ) : (
        <>
        <div className="mb-4 flex flex-wrap gap-2">
          {chips.map(([k, label, n]) => (
            <Link key={k} href={k === "all" ? "/housekeeping" : `/housekeeping?f=${k}`} className={`btn-sm ${f === k ? "btn-primary" : "btn-ghost"}`}>
              {label} <span className="num opacity-80">{n}</span>
            </Link>
          ))}
        </div>
        {shown.length === 0 ? <Empty>{t.none}</Empty> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((task) => (
            <div key={task.id} className={`card ${arriving.has(task.unit_id) ? "border-danger/50 bg-danger-soft" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="num text-2xl font-bold">{task.units?.number}</span>
                <Badge tone={task.status === "in_progress" ? "info" : "warn"}>{task.status === "in_progress" ? t.hk_in_progress : t.hk_pending}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted">{t[`hk_kind_${task.kind}` as DictKey]}</div>
              {arriving.has(task.unit_id) ? <div className="mt-1 text-sm font-semibold text-danger">{t.hk_urgent}</div> : null}
              {task.notes ? <div className="mt-1 text-sm">{task.notes}</div> : null}
              <div className="mt-3 flex items-end gap-2">
                {task.status === "pending" ? (
                  <ActionForm action={setHkStatus}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="status" value="in_progress" />
                    <SubmitButton className="btn-ghost">{t.hk_start}</SubmitButton>
                  </ActionForm>
                ) : null}
                <ActionForm action={finishHkTask} className="min-w-0 flex-1 space-y-2">
                  <input type="hidden" name="id" value={task.id} />
                  <ReceiptInput name="photo" label={t.hk_photo} ready={t.hk_photo_ready} accept="image/*" required={!canManage} />
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
        </>
      )}

      {done.length ? (
        <div className="mt-6">
          <Section title={`${t.hk_done_today} (${done.length})`}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {done.map((d) => {
                const url = d.photo_path ? photos.get(d.photo_path) : undefined;
                const mins = d.started_at ? Math.max(0, Math.round((Date.parse(d.finished_at) - Date.parse(d.started_at)) / 60000)) : null;
                return (
                  <li key={d.id} className="flex gap-3 rounded-2xl bg-surface-2 p-3">
                    {seesPhotos ? (
                      url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="shrink-0" title={t.hk_photo}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={t.hk_photo} loading="lazy" className="size-24 rounded-xl object-cover" />
                        </a>
                      ) : (
                        <span className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-line text-center text-xs text-muted">
                          <span><ImageOff className="mx-auto mb-1 size-5" aria-hidden />{t.hk_no_photo}</span>
                        </span>
                      )
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="num text-xl font-bold">{d.units?.number}</span>
                        <Badge tone="ok"><Check className="size-3.5 shrink-0" />{t.hk_done}</Badge>
                      </div>
                      <div className="text-xs text-muted">{t[`hk_kind_${d.kind}` as DictKey]}</div>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {d.finished_by && cleaner.get(d.finished_by) ? <><dt className="text-muted">{t.hk_by}</dt><dd dir="auto" className="truncate font-semibold">{cleaner.get(d.finished_by)}</dd></> : null}
                        <dt className="text-muted">{t.hk_started}</dt><dd className="num font-semibold">{clock(d.started_at)}</dd>
                        <dt className="text-muted">{t.hk_finished}</dt><dd className="num font-semibold">{clock(d.finished_at)}{mins !== null ? <span className="font-normal text-muted"> · {t.hk_minutes.replace("{n}", String(mins))}</span> : null}</dd>
                      </dl>
                      {now - Date.parse(d.finished_at) < 30 * 60000 ? (
                        <ActionForm action={reopenHkTask} className="mt-2">
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton className="btn-ghost btn-sm"><RotateCcw className="size-3.5 shrink-0" />{t.hk_undo}</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      ) : null}

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
