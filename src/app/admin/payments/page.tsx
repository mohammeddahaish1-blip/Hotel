import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin, todayIso, type AdminRow } from "@/lib/admin";
import { gregorian, omr } from "@/lib/format";
import { Badge, Empty, PageHeader } from "@/components/ui";

type Pay = { id: string; tenant_id: string; amount: number; months: number; paid_on: string; method: string | null; reference: string | null; voided_at: string | null };
const METHOD: Record<string, string> = { transfer: "تحويل بنكي", cash: "نقد", card: "بطاقة", cheque: "شيك" };
const shift = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** Subscription income month by month: who paid, how much, and which active companies did not. */
export default async function AdminPayments({ searchParams }: PageProps<"/admin/payments">) {
  const sb = await requireAdmin();
  const sp = await searchParams;
  const thisMonth = todayIso().slice(0, 7);
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : thisMonth;
  const [{ data: all }, { data: pays, error }] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.from("subscription_payments").select("id, tenant_id, amount, months, paid_on, method, reference, voided_at")
      .gte("paid_on", `${month}-01`).lt("paid_on", `${shift(month, 1)}-01`).order("paid_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  const companies = (all ?? []) as AdminRow[];
  const name = new Map(companies.map((r) => [r.id, r.name]));
  const rows = ((pays ?? []) as Pay[]).filter((p) => name.has(p.tenant_id));
  const live = rows.filter((p) => !p.voided_at);
  const total = live.reduce((a, p) => a + Number(p.amount), 0);
  const paid = new Set(live.map((p) => p.tenant_id));
  // active companies with nothing recorded this month (only meaningful for the current month)
  const unpaid = month === thisMonth ? companies.filter((r) => (r.status === "active" || r.status === "past_due") && !paid.has(r.id) && (r.current_period_end ?? "") < `${shift(month, 1)}-01`) : [];
  const title = new Intl.DateTimeFormat("ar-OM-u-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="دفعات الاشتراكات"
        sub="كل ما سُجّل من دفعات في الشهر المختار."
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={`/admin/payments?m=${shift(month, -1)}`} className="btn-ghost btn-sm" aria-label="الشهر السابق"><ChevronRight className="size-4" /></Link>
            <span className="px-2 font-bold">{title}</span>
            {month < thisMonth ? <Link href={`/admin/payments?m=${shift(month, 1)}`} className="btn-ghost btn-sm" aria-label="الشهر التالي"><ChevronLeft className="size-4" /></Link> : null}
          </div>
        }
      />
      <section className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-brand p-5 text-brand-ink">
        <div><div className="font-semibold opacity-90">دخل الاشتراكات في {title}</div><div className="text-sm opacity-85">{live.length} دفعة من {paid.size} شركة</div></div>
        <div className="num text-3xl font-bold">{omr(total, "ar")}</div>
      </section>

      {unpaid.length ? (
        <section className="card mb-4">
          <h2 className="h2 mb-2">لم يدفعوا هذا الشهر <span className="num text-warn">({unpaid.length})</span></h2>
          <ul className="divide-y divide-line">
            {unpaid.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-semibold">{r.name}<span className="block text-xs font-normal text-muted">مدفوع حتى {gregorian(r.current_period_end, "ar")}</span></span>
                <span className="num">{r.price != null ? omr(r.price, "ar") : "—"}</span>
                <Link href={`/admin/${r.id}?tab=pay`} className="btn-primary btn-sm">سجّل دفعة</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <h2 className="h2 mb-2">الدفعات ({rows.length})</h2>
        {rows.length === 0 ? <Empty>لا توجد دفعات في هذا الشهر.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm ${p.voided_at ? "text-muted" : ""}`}>
                <span className="min-w-0 flex-1 basis-44">
                  <Link href={`/admin/${p.tenant_id}?tab=pay`} className="font-semibold hover:text-brand">{name.get(p.tenant_id)}</Link>
                  <span className="block text-xs text-muted">{gregorian(p.paid_on, "ar")} · {p.months} شهر · {METHOD[p.method ?? ""] ?? p.method ?? "—"}{p.reference ? ` · ${p.reference}` : ""}</span>
                </span>
                {p.voided_at ? <Badge tone="danger">ملغاة</Badge> : null}
                <span className={`num font-bold ${p.voided_at ? "line-through" : ""}`}>{omr(p.amount, "ar")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
