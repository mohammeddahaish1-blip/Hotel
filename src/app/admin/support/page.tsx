import Link from "next/link";
import { LogIn } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader, Section, type Tone } from "@/components/ui";
import { adminCompleteRequest, adminRequestAccess, adminStartSession } from "@/app/actions/support";

type Req = {
  id: string; tenant_id: string; tenant_name: string; kind: "maintenance" | "change"; title: string; details: string | null;
  status: string; scheduled_for: string | null; access_hours: number | null; access_from: string | null; access_until: string | null;
  access_live: boolean; sessions: number; report: string | null; decision_note: string | null; created_at: string;
};
const ST: Record<string, [string, Tone]> = {
  open: ["جديد — بدون إذن دخول", "info"], awaiting_hotel: ["بانتظار موافقة الفندق", "warn"], approved: ["الدخول مسموح", "ok"],
  rejected: ["رفضه الفندق", "gray"], done: ["منجز", "ok"], cancelled: ["ألغاه الفندق", "gray"],
};
const when = (d: string | null) => dateTime(d, "Asia/Muscat", "ar");

/** The team's queue: hotels' change requests and scheduled maintenance, with entry only under the hotel's grant. */
export default async function AdminSupport() {
  const sb = await requireAdmin();
  const { data } = await sb.rpc("admin_support_list");
  const rows = (data ?? []) as Req[];
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader title="طلبات الدعم والصيانة" sub="لا يمكن الدخول إلى نظام أي فندق إلا بإذن منه ولمدة محددة. كل دخول وخروج وكل تعديل يراه صاحب الفندق." />
      <Section title={`الطلبات (${rows.length})`}>
        {rows.length === 0 ? <Empty>لا توجد طلبات. لجدولة صيانة دورية افتح صفحة الشركة من «الشركات».</Empty> : (
          <ul>
            {rows.map((r) => {
              const [label, tone]: [string, Tone] = r.status === "approved" && !r.access_live
                ? (r.access_from && r.access_from > now ? ["مسموح من موعد الزيارة", "info"] : ["انتهت مدة الدخول", "gray"])
                : ST[r.status] ?? [r.status, "gray"];
              return (
                <li key={r.id} className="border-b border-line py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.title}</span>
                    <Badge tone="gray">{r.kind === "maintenance" ? "صيانة دورية" : "طلب تعديل"}</Badge>
                    <Badge tone={tone}>{label}</Badge>
                    <Link href={`/admin/${r.tenant_id}`} className="ms-auto text-xs text-brand">{r.tenant_name}</Link>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {when(r.created_at)}{r.scheduled_for ? ` · الموعد ${when(r.scheduled_for)}` : ""}
                    {r.access_from && r.access_until ? ` · الدخول ${when(r.access_from)} ← ${when(r.access_until)}` : ""}
                    {r.sessions ? ` · ${r.sessions} جلسة` : ""}
                  </div>
                  {r.details ? <p className="mt-2 whitespace-pre-line text-sm">{r.details}</p> : null}
                  {r.decision_note ? <p className="mt-1 text-xs text-muted">ملاحظة الفندق: {r.decision_note}</p> : null}
                  {r.report ? <p className="mt-2 whitespace-pre-line rounded-xl bg-ok-soft px-3 py-2 text-sm">{r.report}</p> : null}

                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {r.access_live ? (
                      <ActionForm action={adminStartSession}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton className="btn-primary btn-sm"><LogIn className="size-4 shrink-0" aria-hidden /> دخول نظام الفندق</SubmitButton>
                      </ActionForm>
                    ) : null}
                    {r.status === "open" ? (
                      <ActionForm action={adminRequestAccess} className="flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={r.id} />
                        <select name="hours" defaultValue="4" aria-label="مدة الدخول" className="input w-auto py-2">
                          {[1, 2, 4, 8, 24, 48, 72].map((h) => <option key={h} value={h}>{h} ساعة</option>)}
                        </select>
                        <input name="note" placeholder="لماذا نحتاج الدخول؟" aria-label="سبب طلب الدخول" maxLength={300} className="input min-w-0 py-2" />
                        <SubmitButton className="btn-ghost btn-sm">طلب إذن الدخول</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                  {["open", "awaiting_hotel", "approved"].includes(r.status) ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-brand">إنهاء الطلب وكتابة التقرير للفندق</summary>
                      <ActionForm action={adminCompleteRequest} className="mt-2 space-y-2">
                        <input type="hidden" name="id" value={r.id} />
                        <textarea name="report" required minLength={3} rows={3} maxLength={4000} placeholder="ماذا فعلنا؟ ماذا وجدنا؟ هل يحتاج الفندق لشيء؟" aria-label="التقرير" className="input" />
                        <SubmitButton className="btn-primary btn-sm" confirm="إنهاء الطلب؟ سيُغلق الدخول المرتبط به.">إنهاء وإرسال التقرير</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
