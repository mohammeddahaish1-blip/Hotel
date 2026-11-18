import Link from "next/link";
import { headers } from "next/headers";
import { Mail, MessageCircle, Search } from "lucide-react";
import { daysTo, monthlyBaisa, requireAdmin, STATUS_AR, STATUS_TONE, type AdminRow } from "@/lib/admin";
import { amount } from "@/lib/currency";
import { Money } from "@/components/CurrencySign";
import { gregorian, omr } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FilterSelect } from "@/components/FilterSelect";
import { Badge, Empty, Field, PageHeader } from "@/components/ui";
import { adminAddProspect, adminApplyProspect, adminDropProspect } from "@/app/actions/admin";

type Prospect = { id: string; company: string; email: string; phone: string | null; plan_code: string; trial_days: number; notes: string | null };
const SORTS: [string, string][] = [["new", "الأحدث"], ["name", "الاسم"], ["end", "الأقرب انتهاءً"], ["price", "الأعلى اشتراكاً"], ["quiet", "الأقل نشاطاً"]];

/** Every hotel company on Nuzul: searchable, sortable, with a new expected company one press away. */
export default async function AdminCompanies({ searchParams }: PageProps<"/admin/companies">) {
  const sb = await requireAdmin();
  const sp = await searchParams;
  const filter = typeof sp.s === "string" ? sp.s : "";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const sort = typeof sp.o === "string" && SORTS.some(([k]) => k === sp.o) ? sp.o : "new";
  const [{ data, error }, { data: pros }, { data: plans }, h] = await Promise.all([
    sb.rpc("admin_overview"),
    sb.from("admin_prospects").select("id, company, email, phone, plan_code, trial_days, notes").is("tenant_id", null).order("created_at", { ascending: false }),
    sb.from("plans").select("code, name_ar, monthly_price, max_units").eq("active", true).order("sort"),
    headers(),
  ]);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as AdminRow[];
  const prospects = (pros ?? []) as Prospect[];
  const signup = `https://${h.get("host") ?? "nuzul-hotel.vercel.app"}/login?mode=signup`;
  const end = (r: AdminRow) => (r.status === "trial" ? r.trial_ends_at : r.current_period_end);
  const needle = q.toLowerCase();
  const rows = all
    .filter((r) => !filter || r.status === filter)
    .filter((r) => !needle || `${r.name} ${r.owner_name ?? ""} ${r.owner_email ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name, "ar")
      : sort === "end" ? (end(a) ?? "9999").localeCompare(end(b) ?? "9999")
      : sort === "price" ? monthlyBaisa(b) - monthlyBaisa(a)
      : sort === "quiet" ? (a.last_activity ?? "").localeCompare(b.last_activity ?? "")
      : b.created_at.localeCompare(a.created_at));
  const mrr = all.filter((r) => r.status === "active").reduce((x, r) => x + (r.price ?? 0), 0);
  const count = (s: string) => all.filter((r) => r.status === s).length;
  const href = (o: { s?: string; q?: string; o?: string }) => {
    const u = new URLSearchParams();
    const v = { s: filter, q, o: sort, ...o };
    if (v.s) u.set("s", v.s);
    if (v.q) u.set("q", v.q);
    if (v.o && v.o !== "new") u.set("o", v.o);
    const str = u.toString();
    return str ? `/admin/companies?${str}` : "/admin/companies";
  };
  const chip = (s: string, label: string, n: number) => (
    <Link key={s} href={href({ s })} aria-current={filter === s ? "true" : undefined} className={`btn-sm shrink-0 ${filter === s ? "btn-primary" : "btn-ghost"}`}>{label} <span className="num opacity-70">{n}</span></Link>
  );
  const limit = (r: AdminRow) => (plans ?? []).find((p) => p.code === r.plan_code)?.max_units ?? null;
  const planName = (c: string) => (plans ?? []).find((p) => p.code === c)?.name_ar ?? c;

  return (
    <>
      <PageHeader title="الشركات" sub={`${all.length} شركة · ${count("active")} فعّالة`} />
      <section className="card mb-4">
        <details open={prospects.length > 0}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="btn-primary btn-sm">+ شركة جديدة</span>
            <span className="text-sm text-muted">سجّل شركة متوقعة وباقتها، وأرسل لمالكها رابط التسجيل.{prospects.length ? ` بانتظار التسجيل: ${prospects.length}` : ""}</span>
          </summary>
          {prospects.length ? (
            <ul className="mt-3 divide-y divide-line">
              {prospects.map((p) => {
                const joined = all.find((r) => (r.owner_email ?? "").toLowerCase().split(",").map((e) => e.trim()).includes(p.email));
                const invite = `السلام عليكم، هذا رابط التسجيل في نُزُل لـ«${p.company}»:\n${signup}\nسجّلوا بالبريد ${p.email} وسنفعّل لكم باقة ${planName(p.plan_code)}${p.trial_days ? ` مع تجربة ${p.trial_days} يوماً` : ""}.`;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className="min-w-0 flex-1 basis-48">
                      <b>{p.company}</b>
                      <span className="block text-sm text-muted"><span dir="ltr">{p.email}</span> · {planName(p.plan_code)} · تجربة {p.trial_days} يوم</span>
                    </span>
                    {joined ? (
                      <ActionForm action={adminApplyProspect}>
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="tenant" value={joined.id} />
                        <SubmitButton className="btn-primary btn-sm" confirm={`تطبيق باقة ${planName(p.plan_code)} على «${joined.name}»؟`}>سجّل: طبّق الباقة</SubmitButton>
                      </ActionForm>
                    ) : (
                      <>
                        <Badge tone="gray">لم يسجّل بعد</Badge>
                        <a href={`https://wa.me/${(p.phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(invite)}`} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1.5"><MessageCircle className="size-4 shrink-0" /> أرسل الرابط</a>
                        <a href={`mailto:${p.email}?subject=${encodeURIComponent("رابط التسجيل في نُزُل")}&body=${encodeURIComponent(invite)}`} className="btn-ghost btn-sm inline-flex items-center gap-1.5"><Mail className="size-4 shrink-0" /> بريد</a>
                      </>
                    )}
                    <ActionForm action={adminDropProspect}>
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="company" value={p.company} />
                      <SubmitButton className="btn-ghost btn-sm text-danger" confirm={`حذف «${p.company}» من القائمة؟`}>حذف</SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ActionForm action={adminAddProspect} resetOnSuccess className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="اسم الشركة أو الفندق"><input name="company" required maxLength={120} className="input" /></Field>
            <Field label="بريد المالك (سيسجّل به)"><input name="email" type="email" required dir="ltr" maxLength={200} className="input" /></Field>
            <Field label="جوال المالك (اختياري، بمفتاح الدولة)"><input name="phone" dir="ltr" inputMode="tel" maxLength={30} placeholder="9689xxxxxxx" className="input" /></Field>
            <Field label="الباقة">
              <select name="plan" required className="input">
                {(plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name_ar} — {omr(p.monthly_price, "ar")}</option>)}
              </select>
            </Field>
            <Field label="أيام التجربة"><input name="trial_days" type="number" min={0} max={365} defaultValue={14} className="input" /></Field>
            <Field label="ملاحظات"><input name="notes" maxLength={500} className="input" /></Field>
            <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">الحساب وكلمة المرور ينشئهما المالك بنفسه من رابط التسجيل. بعد تسجيله بنفس البريد يظهر هنا زر تطبيق الباقة.</p>
            <SubmitButton className="btn-primary sm:col-span-2 lg:col-span-3">أضف للقائمة</SubmitButton>
          </ActionForm>
        </details>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form method="get" className="flex min-w-0 flex-1 basis-64 gap-2">
          {filter ? <input type="hidden" name="s" value={filter} /> : null}
          {sort !== "new" ? <input type="hidden" name="o" value={sort} /> : null}
          <input type="search" name="q" defaultValue={q} placeholder="ابحث باسم الشركة أو المالك أو بريده" aria-label="بحث" className="input rounded-full" />
          <button className="btn-ghost shrink-0" aria-label="بحث"><Search className="size-4" /></button>
        </form>
        <form method="get" className="flex items-center gap-2">
          {filter ? <input type="hidden" name="s" value={filter} /> : null}
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <span className="text-sm font-semibold">الترتيب</span>
          <FilterSelect name="o" label="الترتيب" value={sort} options={SORTS} />
        </form>
      </div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {chip("", "الكل", all.length)}
        {Object.keys(STATUS_AR).map((s) => chip(s, STATUS_AR[s], count(s)))}
      </div>
      {rows.length === 0 ? <Empty>لا توجد شركات.</Empty> : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const left = daysTo(end(r));
            return (
              <li key={r.id}>
                <Link href={`/admin/${r.id}`} className="card grid gap-x-4 gap-y-2 p-4 transition hover:shadow-md sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_9rem_7rem] lg:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{r.name}</div>
                    <div className="truncate text-xs text-muted" dir="auto">{r.owner_name ?? "—"} · <span dir="ltr">{r.owner_email ?? ""}</span></div>
                  </div>
                  <div className="text-xs text-muted">
                    <div><span className="num font-semibold text-ink">{r.properties}</span> عقار · <span className="num font-semibold text-ink">{r.units}</span> وحدة · <span className="num font-semibold text-ink">{r.staff}</span> موظف</div>
                    {limit(r) ? (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="الوحدات من حد الباقة" aria-valuemin={0} aria-valuemax={limit(r)!} aria-valuenow={Math.min(Number(r.units), limit(r)!)}>
                        <div className={`h-full rounded-full ${Number(r.units) >= limit(r)! * 0.9 ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.min(100, Math.round((Number(r.units) / limit(r)!) * 100))}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{r.plan_name ?? "بدون باقة"}</Badge>
                    {r.status ? <Badge tone={STATUS_TONE[r.status] ?? "gray"}>{STATUS_AR[r.status] ?? r.status}</Badge> : null}
                  </div>
                  <div className="text-xs">
                    <span className="text-muted">{r.status === "trial" ? "التجربة حتى" : "مدفوع حتى"} </span>
                    <span className={`font-semibold lg:block ${left !== null && left < 0 ? "text-danger" : left !== null && left <= 7 ? "text-warn" : ""}`}>{gregorian(end(r), "ar")}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted">الاشتراك </span>
                    <span className="font-semibold lg:block">{r.price != null ? <Money value={amount(r.price, r.currency ?? "OMR")} cur={r.currency ?? "OMR"} /> : "—"}{r.price != null ? <span className="text-muted"> {r.billing_period === "year" ? "سنوياً" : "شهرياً"}</span> : null}</span>
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
