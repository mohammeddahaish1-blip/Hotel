import Link from "next/link";
import { ACTION_AR, requireAdmin, type AdminRow } from "@/lib/admin";
import { dateTime } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

type Entry = { id: number; actor_email: string | null; action: string; tenant_id: string | null; detail: string | null; at: string };

/** What the team itself did in this portal: plans, subscriptions, payments, suspensions. */
export default async function AdminLog() {
  const sb = await requireAdmin("log");
  const [{ data: all }, { data, error }] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.from("admin_log").select("id, actor_email, action, tenant_id, detail, at").order("at", { ascending: false }).limit(300),
  ]);
  if (error) throw new Error(error.message);
  const name = new Map(((all ?? []) as AdminRow[]).map((r) => [r.id, r.name]));
  const rows = (data ?? []) as Entry[];

  return (
    <>
      <PageHeader title="سجل البوابة" sub="من غيّر ماذا في هذه البوابة. يبدأ من تاريخ تفعيله، ولا يمكن تعديله أو حذفه. دخول الفريق إلى أنظمة الفنادق مسجّل في «الدعم والصيانة»." />
      <section className="card">
        {rows.length === 0 ? <Empty>لا توجد عمليات مسجّلة بعد.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="py-2.5 text-sm">
                <div>
                  <b>{ACTION_AR[e.action] ?? e.action}</b>
                  {e.tenant_id ? <> · <Link href={`/admin/${e.tenant_id}`} className="font-semibold text-brand hover:underline">{name.get(e.tenant_id) ?? "شركة"}</Link></> : null}
                  {e.detail ? <span className="text-muted"> · {e.detail}</span> : null}
                </div>
                <div className="text-xs text-muted"><span dir="ltr">{e.actor_email ?? "—"}</span> · {dateTime(e.at, "Asia/Muscat", "ar")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
