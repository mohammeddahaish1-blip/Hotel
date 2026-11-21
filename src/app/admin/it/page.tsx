import Link from "next/link";
import { can, portalMe, requireAdmin } from "@/lib/admin";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { itSaveOps } from "@/app/actions/portal";

type Stats = { db_bytes: number; files_bytes: number; files: number; tenants: number; active_today: number; active_week: number };
type Ops = { maintenance_on: boolean; maintenance_msg: string | null; maint_from: string | null; maint_to: string | null; updated_at: string };
type Req = { id: string; tenant_name: string; title: string; status: string; created_at: string; kind: string };

const PEND = <span className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs font-bold text-muted">◌ بانتظار الربط</span>;
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} ج.ب` : `${Math.max(0.1, b / 1024 ** 2).toFixed(1)} م.ب`);
/** Muscat wall time for a datetime-local field. */
const local = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 4 * 3_600_000).toISOString().slice(0, 16) : "");
// free-plan quotas of today's database provider; shown as a guide only
const DB_QUOTA = 500 * 1024 ** 2, FILE_QUOTA = 1024 ** 3;

/** Keeping the platform stable: health measured from here, maintenance mode, technical tickets, data providers. */
export default async function ItPage() {
  const sb = await requireAdmin("it");
  const { me } = await portalMe();
  const edit = can(me, "it", "edit");
  const t0 = performance.now();
  await sb.from("platform_ops").select("id").eq("id", 1).maybeSingle(); // one round trip, to measure the database's speed from the app
  const latency = Math.round(performance.now() - t0);
  const [{ data: st }, { data: op }, { data: sup }] = await Promise.all([
    sb.rpc("admin_platform_stats"),
    sb.from("platform_ops").select("maintenance_on, maintenance_msg, maint_from, maint_to, updated_at").eq("id", 1).maybeSingle(),
    can(me, "support") ? sb.rpc("admin_support_list") : Promise.resolve({ data: [] }),
  ]);
  const s = (st ?? { db_bytes: 0, files_bytes: 0, files: 0, tenants: 0, active_today: 0, active_week: 0 }) as Stats;
  const ops = (op ?? { maintenance_on: false, maintenance_msg: null, maint_from: null, maint_to: null, updated_at: "" }) as Ops;
  const tickets = ((sup ?? []) as Req[]).filter((r) => ["open", "awaiting_hotel", "approved"].includes(r.status)).slice(0, 6);
  const now = Date.now();
  const scheduled = ops.maint_from && Date.parse(ops.maint_from) > now;
  const live = ops.maintenance_on && (!ops.maint_from || Date.parse(ops.maint_from) <= now) && (!ops.maint_to || Date.parse(ops.maint_to) > now);

  const kpis: [string, React.ReactNode, string][] = [
    ["حالة المنصة", live ? <span key="m" className="text-warn">● صيانة</span> : <span key="o" className="text-ok">● تعمل</span>, live ? "رسالة الصيانة ظاهرة للفنادق" : "قاعدة البيانات ترد"],
    ["سرعة قاعدة البيانات", <span key="l" className={`num ${latency > 400 ? "text-warn" : ""}`}>{latency} مللي ثانية</span>, "قيست الآن من الموقع"],
    ["آخر تحديث للموقع", PEND, "من مزوّد الاستضافة"],
    ["أخطاء آخر 24 ساعة", PEND, "من مزوّد الاستضافة"],
  ];
  const providers: [string, string][] = [["الاستضافة", "Vercel حالياً · قابل للتغيير"], ["قاعدة البيانات", "Supabase حالياً · قابل للتغيير"], ["البريد", "لرسائل الدعوات والتنبيهات"]];

  return (
    <>
      <PageHeader title="التقنية" sub="استقرار المنصة وعملياتها" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([l, v, h]) => (
          <div key={l} className="card p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className="mt-1 text-xl font-bold">{v}</div><div className="mt-0.5 text-xs text-muted">{h}</div></div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          {can(me, "support") ? (
            <section className="card">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><h2 className="h2">تذاكر الدعم الفني</h2><Link href="/admin/support" className="btn-ghost btn-sm">كل الطلبات</Link></div>
              {tickets.length ? (
                <ul className="divide-y divide-line">
                  {tickets.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1"><b>{r.title}</b><span className="block text-xs text-muted">{r.tenant_name} · {dateTime(r.created_at, "Asia/Muscat", "ar")}</span></span>
                      <Badge tone={r.status === "open" ? "warn" : r.status === "approved" ? "ok" : "info"}>{r.status === "open" ? "جديد" : r.status === "approved" ? "الدخول مسموح" : "بانتظار الفندق"}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">لا تذاكر مفتوحة.</p>}
            </section>
          ) : null}

          <section className="card">
            <div className="mb-1 flex items-center justify-between gap-2"><h2 className="h2">التحديثات والأخطاء</h2>{PEND}</div>
            <p className="text-sm text-muted">آخر نسخ الموقع، مدة بنائها، ومن نشرها، وأخطاء التشغيل، تظهر هنا لما تربط مزوّد الاستضافة.</p>
          </section>

          <section className="card">
            <h2 className="h2 mb-1">مصادر البيانات</h2>
            <p className="mb-1 text-sm text-muted">كل مزوّد مربوط من مكان واحد. لو غيّرته، الصفحات تبقى زي ما هي.</p>
            <ul className="divide-y divide-line">
              {providers.map(([a, b]) => (
                <li key={a} className="flex flex-wrap items-center gap-3 py-2.5"><span className="min-w-0 flex-1"><b>{a}</b><span className="block text-xs text-muted">{b}</span></span>{PEND}</li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="h2">وضع الصيانة</h2>
              {live ? <Badge tone="warn">مشغّل الآن</Badge> : scheduled && ops.maintenance_on ? <Badge tone="info">مجدول</Badge> : <Badge tone="gray">متوقف</Badge>}
            </div>
            <p className="mb-3 mt-1 text-sm text-muted">لما يشتغل، تظهر الرسالة أعلى نظام كل الفنادق. الفنادق تقدر تكمل شغلها، فاختر وقتاً هادئاً.</p>
            {edit ? (
              <ActionForm action={itSaveOps} className="space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3 py-2.5 text-sm font-semibold">تشغيل وضع الصيانة<input type="checkbox" name="on" defaultChecked={ops.maintenance_on} className="size-5 accent-[#0d6b5f]" /></label>
                <label className="block"><span className="mb-1 block text-sm font-semibold">الرسالة</span><textarea name="msg" rows={2} defaultValue={ops.maintenance_msg ?? "نحدّث النظام، نرجع خلال 15 دقيقة."} className="input" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">من (توقيت مسقط)</span><input type="datetime-local" name="from" defaultValue={local(ops.maint_from)} className="input" /></label>
                  <label className="block"><span className="mb-1 block text-xs font-semibold text-muted">إلى</span><input type="datetime-local" name="to" defaultValue={local(ops.maint_to)} className="input" /></label>
                </div>
                <p className="text-xs text-muted">بدون أوقات = تظهر الرسالة فوراً لين توقفها.</p>
                <SubmitButton className="btn-primary w-full">حفظ</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm">{ops.maintenance_msg ?? "—"}</p>}
          </section>

          <section className="card">
            <h2 className="h2 mb-1">استخدام المنصة</h2>
            <ul className="divide-y divide-line text-sm">
              <li className="flex justify-between py-2.5"><span>فنادق نشطة اليوم</span><b className="num">{s.active_today} من {s.tenants}</b></li>
              <li className="flex justify-between py-2.5"><span>نشطة هذا الأسبوع</span><b className="num">{s.active_week}</b></li>
              <li className="py-2.5"><div className="flex justify-between"><span>حجم قاعدة البيانات</span><b className="num">{mb(s.db_bytes)} <span className="font-normal text-muted">من 500 م.ب</span></b></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (s.db_bytes / DB_QUOTA) * 100)}%` }} /></div></li>
              <li className="py-2.5"><div className="flex justify-between"><span>الملفات المرفوعة ({s.files})</span><b className="num">{mb(s.files_bytes)} <span className="font-normal text-muted">من 1 ج.ب</span></b></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (s.files_bytes / FILE_QUOTA) * 100)}%` }} /></div></li>
            </ul>
            <p className="mt-1 text-xs text-muted">الحدود حسب الخطة المجانية الحالية لمزوّد قاعدة البيانات.</p>
          </section>
        </div>
      </div>
    </>
  );
}
