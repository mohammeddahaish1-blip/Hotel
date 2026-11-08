import Link from "next/link";
import { requireAdmin, STATUS_AR, STATUS_TONE } from "@/lib/admin";
import { gregorian, omr } from "@/lib/format";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";

type Row = {
  id: string; name: string; created_at: string; owner_name: string | null; owner_email: string | null;
  properties: number; units: number; staff: number; bookings_30d: number; last_activity: string | null;
  plan_code: string | null; plan_name: string | null; status: string | null; trial_ends_at: string | null;
  current_period_end: string | null; price: number | null; last_paid_on: string | null; notes: string | null;
};

/** Every hotel company on Nuzul: plan, subscription state, paid until, usage. */
export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const sb = await requireAdmin();
  const sp = await searchParams;
  const filter = typeof sp.s === "string" ? sp.s : "";
  const { data, error } = await sb.rpc("admin_overview");
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Row[];
  const rows = filter ? all.filter((r) => r.status === filter) : all;
  const today = new Date().toISOString().slice(0, 10);
  const daysTo = (d: string | null) => (d ? Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000) : null);
  const mrr = all.filter((r) => r.status === "active").reduce((x, r) => x + (r.price ?? 0), 0);
  const count = (s: string) => all.filter((r) => r.status === s).length;
  const overdue = all.filter((r) => r.status === "past_due" || r.status === "suspended" || (r.status === "active" && (daysTo(r.current_period_end) ?? 1) < 0)).length;
  const chip = (s: string, label: string, n: number) => (
    <Link key={s} href={s ? `/admin?s=${s}` : "/admin"} className={`btn-sm shrink-0 ${filter === s ? "btn-primary" : "btn-ghost"}`}>{label} <span className="num opacity-70">{n}</span></Link>
  );

  return (
    <>
      <PageHeader title="الشركات المشتركة" sub="كل فندق أو شركة شقق تستخدم نُزُل: الباقة، حالة الاشتراك، والدفع الشهري." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="الشركات" value={all.length} />
        <Stat label="اشتراك فعّال" value={count("active")} tone="ok" />
        <Stat label="فترة تجريبية" value={count("trial")} tone="info" />
        <Stat label="متأخر أو موقوف" value={overdue} tone={overdue ? "danger" : undefined} />
        <Stat label="الدخل الشهري المتوقع" value={omr(mrr, "ar")} hint={`${all.reduce((x, r) => x + Number(r.units), 0)} وحدة إجمالاً`} />
      </div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {chip("", "الكل", all.length)}
        {Object.keys(STATUS_AR).map((s) => chip(s, STATUS_AR[s], count(s)))}
      </div>
      {rows.length === 0 ? <Empty>لا توجد شركات.</Empty> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const left = r.status === "trial" ? daysTo(r.trial_ends_at) : daysTo(r.current_period_end);
            return (
              <li key={r.id}>
                <Link href={`/admin/${r.id}`} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:border-brand">
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="truncate font-bold">{r.name}</div>
                    <div className="truncate text-xs text-muted" dir="auto">{r.owner_name ?? "—"} · <span dir="ltr">{r.owner_email ?? ""}</span></div>
                  </div>
                  <div className="text-xs text-muted"><span className="num font-semibold text-ink">{r.properties}</span> عقار · <span className="num font-semibold text-ink">{r.units}</span> وحدة · <span className="num font-semibold text-ink">{r.staff}</span> موظف · <span className="num font-semibold text-ink">{r.bookings_30d}</span> حجز/30 يوم</div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{r.plan_name ?? "بدون باقة"}</Badge>
                    {r.status ? <Badge tone={STATUS_TONE[r.status] ?? "gray"}>{STATUS_AR[r.status] ?? r.status}</Badge> : null}
                  </div>
                  <div className="w-36 text-xs">
                    <div className="text-muted">{r.status === "trial" ? "التجربة حتى" : "مدفوع حتى"}</div>
                    <div className={`font-semibold ${left !== null && left < 0 ? "text-danger" : left !== null && left <= 7 ? "text-warn" : ""}`}>
                      {gregorian(r.status === "trial" ? r.trial_ends_at : r.current_period_end, "ar")}
                    </div>
                  </div>
                  <div className="w-28 text-xs">
                    <div className="text-muted">الاشتراك</div>
                    <div className="num font-semibold">{r.price != null ? omr(r.price, "ar") : "—"}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
