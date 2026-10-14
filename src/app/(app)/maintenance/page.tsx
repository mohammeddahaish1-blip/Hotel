import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";
import { createTicket, updateTicket } from "@/app/actions/ops";

type Ticket = {
  id: string; title: string; description: string | null; priority: number; blocks_availability: boolean;
  status: string; created_at: string; closed_at: string | null; units: { number: string } | null;
};

// FR-43: a ticket that blocks occupancy removes the unit from availability until closed.
export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  const ctx = await requireArea("maintenance");
  const { t, lang } = await getDict();
  const showClosed = (await searchParams).closed === "1";
  let q = ctx.supabase
    .from("maintenance_tickets")
    .select("id, title, description, priority, blocks_availability, status, created_at, closed_at, units(number)")
    .eq("property_id", ctx.property.id)
    .order("priority")
    .order("created_at", { ascending: false })
    .limit(100);
  q = showClosed ? q.eq("status", "closed") : q.neq("status", "closed");
  const [{ data: tickets }, { data: units }] = await Promise.all([
    q,
    ctx.supabase.from("units").select("id, number").eq("property_id", ctx.property.id).eq("active", true).order("number"),
  ]);
  const list = (tickets ?? []) as unknown as Ticket[];

  return (
    <>
      <PageHeader
        title={t.mt_title}
        actions={<a href={showClosed ? "/maintenance" : "/maintenance?closed=1"} className="btn-ghost btn-sm">{showClosed ? t.mt_open : t.mt_closed}</a>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {list.length === 0 ? (
            <Empty>{t.none}</Empty>
          ) : (
            list.map((m) => (
              <div key={m.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">
                    <span className="num">{m.units?.number}</span> · {m.title}
                  </div>
                  <div className="flex gap-1">
                    <Badge tone={m.priority === 1 ? "danger" : m.priority === 2 ? "warn" : "gray"}>{t[`pr_${m.priority}` as DictKey]}</Badge>
                    {m.blocks_availability ? <Badge tone="danger">{t.st_maintenance}</Badge> : null}
                    <Badge tone={m.status === "closed" ? "ok" : m.status === "in_progress" ? "info" : "warn"}>{t[`mt_${m.status}` as DictKey]}</Badge>
                  </div>
                </div>
                {m.description ? <p className="mt-1 text-sm text-muted">{m.description}</p> : null}
                <div className="mt-1 text-xs text-muted">{dateTime(m.created_at, ctx.property.timezone, lang)}</div>
                {m.status !== "closed" ? (
                  <div className="mt-3 flex gap-2">
                    {m.status === "open" ? (
                      <ActionForm action={updateTicket}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="status" value="in_progress" />
                        <SubmitButton className="btn-ghost btn-sm">{t.mt_start}</SubmitButton>
                      </ActionForm>
                    ) : null}
                    <ActionForm action={updateTicket}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="status" value="closed" />
                      <SubmitButton className="btn-primary btn-sm">{t.mt_close}</SubmitButton>
                    </ActionForm>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        <Section title={t.mt_new}>
          <ActionForm action={createTicket} resetOnSuccess className="space-y-3">
            <Field label={t.unit}>
              <select name="unit" required className="input">
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}
              </select>
            </Field>
            <Field label={t.mt_issue}><input name="title" required className="input" /></Field>
            <Field label={t.description}><textarea name="description" rows={3} className="input" /></Field>
            <Field label={t.priority}>
              <select name="priority" defaultValue="2" className="input">
                {[1, 2, 3].map((p) => <option key={p} value={p}>{t[`pr_${p}` as DictKey]}</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="blocks" className="mt-1" /> {t.mt_blocks}
            </label>
            <SubmitButton className="btn-primary w-full">{t.mt_new}</SubmitButton>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
