import Link from "next/link";
import { Camera, TriangleAlert } from "lucide-react";
import type { Ctx } from "@/lib/auth";
import type { Dict, Lang } from "@/lib/i18n/dict";
import { addDays, gregorian, omr, plainOmr, todayIn } from "@/lib/format";
import { loadShopBooks, missingPhotoDays, sumBook, type ShopRow } from "@/lib/shop-books";
import { receiptReaderEnabled } from "@/lib/receipt-reader";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ReceiptInput } from "@/components/FinanceInputs";
import { Badge, Empty, Field, Section, Stat, type Tone } from "@/components/ui";
import { fixShopReceipt, saveShopWorker, uploadShopReceipt, voidShopReceipt } from "@/app/actions/shops";

type Receipt = { id: string; kind: string; amount: number | null; vendor: string | null; photo_path: string; read_status: string; uploaded_by: string | null; created_at: string };
type Worker = {
  id: string; full_name: string; job_title: string | null; phone: string | null; nationality: string | null; salary: number;
  iqama_no: string | null; iqama_expiry: string | null; joined_on: string | null; active: boolean; notes: string | null;
};
const STATUS_TONE: Record<string, Tone> = { read: "ok", manual: "gray", pending: "info", failed: "danger" };

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};

/**
 * The shop's books, for the owner, managers and the shop's cashier: the red box for days without invoice
 * photos, the invoice camera, the day's photos, the month day by day (owner and managers) and the workers.
 */
export async function ShopBooks({ ctx, shop, day, admin, t, lang, names }: {
  ctx: Ctx; shop: ShopRow; day: string; admin: boolean; t: Dict; lang: Lang; names: Map<string, string>;
}) {
  const tz = ctx.property.timezone;
  const today = todayIn(tz);
  const month = monthStart(day);
  const ai = receiptReaderEnabled();
  const money = (v: number) => omr(v, lang);
  const [missing, { data: rec }, { data: wk }, books] = await Promise.all([
    missingPhotoDays(ctx, [shop]),
    ctx.supabase.from("shop_receipts").select("id, kind, amount, vendor, photo_path, read_status, uploaded_by, created_at")
      .eq("shop_id", shop.id).eq("business_date", day).is("voided_at", null).order("created_at"),
    ctx.supabase.from("shop_workers").select("*").eq("shop_id", shop.id).order("active", { ascending: false }).order("full_name"),
    admin ? loadShopBooks(ctx, [shop.id], month, nextMonth(month)) : Promise.resolve(new Map()),
  ]);
  const receipts = (rec ?? []) as Receipt[];
  const workers = (wk ?? []) as Worker[];
  const missed = missing.get(shop.id) ?? [];
  const { data: signed } = receipts.length
    ? await ctx.supabase.storage.from("shop-receipts").createSignedUrls(receipts.map((r) => r.photo_path), 600)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const kindLabel = (k: string) => t[`bk_k_${k}` as keyof Dict];
  const salaries = workers.filter((w) => w.active).reduce((a, w) => a + Number(w.salary), 0);
  const monthBook = books.get(shop.id) as Map<string, { income: number; till: number; costs: number; photos: number }> | undefined;
  const monthSum = sumBook(monthBook);
  const days: string[] = [];
  for (let d = month; d < nextMonth(month) && d <= today; d = addDays(d, 1)) days.push(d);

  const cardState = (exp: string | null) => {
    if (!exp) return null;
    const n = Math.round((Date.parse(exp) - Date.parse(today)) / 86_400_000);
    return n < 0 ? { tone: "danger" as Tone, label: t.wk_expired } : n <= 30 ? { tone: "warn" as Tone, label: t.wk_days.replace("{n}", String(n)) } : { tone: "ok" as Tone, label: t.wk_ok };
  };

  return (
    <div className="mb-4 space-y-4">
      {missed.length ? (
        <div role="alert" className="rounded-2xl border-2 border-danger bg-danger-soft p-4 text-danger">
          <div className="flex items-start gap-2 font-bold">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            {t.bk_missing_box.replace("{d}", missed.map((d) => gregorian(d, lang)).join("، "))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {missed.map((d) => (
              <Link key={d} href={`/shops/${shop.id}?d=${d}#upload`} className="btn-danger btn-sm">{gregorian(d, lang)}</Link>
            ))}
          </div>
        </div>
      ) : shop.daily_photos && day === today && receipts.length === 0 ? (
        <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-sm font-semibold text-warn">{t.bk_today_pending}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t.bk_upload}>
          <div id="upload" />
          <ActionForm action={uploadShopReceipt} resetOnSuccess className="space-y-3">
            <input type="hidden" name="shop" value={shop.id} />
            <Field label={t.bk_kind}>
              <select name="kind" defaultValue="sales" className="input">
                {["sales", "purchase", "expense"].map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </Field>
            <Field label={t.bk_day_for}><input type="date" name="day" defaultValue={day} max={today} className="input" /></Field>
            <ReceiptInput name="photo" label={t.bk_photo} ready={t.bk_photo_ready} accept="image/*,application/pdf" />
            <Field label={ai ? t.bk_amount_ai : t.bk_amount}>
              <input name="amount" inputMode="decimal" dir="ltr" placeholder="0.000" required={!ai} className="input" />
            </Field>
            <SubmitButton className="btn-primary w-full"><Camera className="size-4 shrink-0" aria-hidden /> {t.bk_upload_btn}</SubmitButton>
          </ActionForm>
        </Section>

        <div className="lg:col-span-2">
          <Section title={`${t.bk_receipts} · ${gregorian(day, lang)}`}>
            {receipts.length === 0 ? <Empty>{t.bk_none}</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Badge tone={r.kind === "sales" ? "ok" : "warn"}>{kindLabel(r.kind)}</Badge>
                      <span className="num font-bold">{r.amount != null ? money(r.amount) : "—"}</span>
                      <Badge tone={STATUS_TONE[r.read_status] ?? "gray"}>{t[`bk_st_${r.read_status}` as keyof Dict]}</Badge>
                      {r.vendor ? <span className="text-xs text-muted">{r.vendor}</span> : null}
                      {urlOf.get(r.photo_path) ? <a href={urlOf.get(r.photo_path) ?? undefined} target="_blank" rel="noreferrer" className="ms-auto text-xs text-brand">{t.bk_view}</a> : null}
                    </div>
                    <div className="text-xs text-muted">{names.get(r.uploaded_by ?? "") ?? "—"}</div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-brand">{t.bk_fix}</summary>
                      <ActionForm action={fixShopReceipt} className="mt-1.5 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="shop" value={shop.id} />
                        <select name="kind" defaultValue={r.kind} aria-label={t.bk_kind} className="input w-auto py-1.5">
                          {["sales", "purchase", "expense"].map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                        </select>
                        <input name="amount" required inputMode="decimal" dir="ltr" defaultValue={r.amount != null ? plainOmr(r.amount) : ""} aria-label={t.bk_amount} className="input w-28 py-1.5" />
                        <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={voidShopReceipt} className="mt-1.5 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="shop" value={shop.id} />
                        <input name="reason" required minLength={2} maxLength={300} placeholder={t.shp_void_reason} aria-label={t.shp_void_reason} className="input min-w-0 flex-1 py-1.5" />
                        <SubmitButton className="btn-danger btn-sm">{t.shp_void}</SubmitButton>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {admin ? (
        <Section title={`${t.bk_daily} · ${new Intl.DateTimeFormat(lang === "ar" ? "ar-OM-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }).format(new Date(`${month}T00:00:00`))}`}>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t.bk_income} value={<span className="num">{money(monthSum.income)}</span>} hint={`${t.bk_till}: ${money(monthSum.till)}`} />
            <Stat label={t.bk_costs} value={<span className="num">{money(monthSum.costs)}</span>} />
            <Stat label={t.bk_salaries} value={<span className="num">{money(salaries)}</span>} />
            <Stat label={t.bk_net} value={<span className="num">{money(monthSum.income - monthSum.costs - salaries)}</span>} tone={monthSum.income - monthSum.costs - salaries >= 0 ? "ok" : "danger"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 text-start font-normal">{t.date}</th>
                  <th className="py-1.5 text-start font-normal">{t.bk_income}</th>
                  <th className="py-1.5 text-start font-normal">{t.bk_costs}</th>
                  <th className="py-1.5 text-start font-normal">{t.bk_net}</th>
                </tr>
              </thead>
              <tbody>
                {days.slice().reverse().map((d) => {
                  const b = monthBook?.get(d);
                  const miss = missed.includes(d);
                  return (
                    <tr key={d} className={`border-b border-line last:border-0 ${miss ? "bg-danger-soft text-danger" : ""}`}>
                      <td className="py-1.5"><Link href={`/shops/${shop.id}?d=${d}`} className="hover:text-brand">{gregorian(d, lang)}</Link>{miss ? " ⚠" : ""}</td>
                      <td className="num py-1.5">{money(b?.income ?? 0)}</td>
                      <td className="num py-1.5">{money(b?.costs ?? 0)}</td>
                      <td className="num py-1.5 font-semibold">{money((b?.income ?? 0) - (b?.costs ?? 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section title={`${t.wk_title} (${workers.filter((w) => w.active).length})`}>
        {workers.length === 0 ? <Empty>{t.wk_none}</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {workers.map((w) => {
              const st = cardState(w.iqama_expiry);
              return (
                <li key={w.id} className={`py-2.5 ${w.active ? "" : "text-muted"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{w.full_name}</span>
                    {w.job_title ? <span className="text-xs text-muted">{w.job_title}</span> : null}
                    <span className="num text-xs">{money(w.salary)}</span>
                    {st ? <Badge tone={st.tone}>{t.wk_iqama_expiry}: {gregorian(w.iqama_expiry, lang)} · {st.label}</Badge> : null}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-brand">{t.edit}</summary>
                    <WorkerForm shop={shop.id} w={w} t={t} />
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">{t.wk_total_salaries}: <span className="num font-semibold">{money(salaries)}</span></p>
        <details className="mt-3 border-t border-line pt-3">
          <summary className="btn-primary btn-sm inline-flex cursor-pointer list-none">{t.wk_add}</summary>
          <WorkerForm shop={shop.id} t={t} />
        </details>
      </Section>
    </div>
  );
}

function WorkerForm({ shop, w, t }: { shop: string; w?: Worker; t: Dict }) {
  return (
    <ActionForm action={saveShopWorker} resetOnSuccess={!w} className="mt-2 grid gap-2 sm:grid-cols-3">
      <input type="hidden" name="shop" value={shop} />
      {w ? <input type="hidden" name="id" value={w.id} /> : null}
      <Field label={t.wk_name}><input name="full_name" required maxLength={120} defaultValue={w?.full_name ?? ""} className="input" /></Field>
      <Field label={t.wk_job}><input name="job_title" maxLength={60} defaultValue={w?.job_title ?? ""} className="input" /></Field>
      <Field label={t.phone}><input name="phone" dir="ltr" inputMode="tel" maxLength={30} defaultValue={w?.phone ?? ""} className="input" /></Field>
      <Field label={t.wk_nationality}><input name="nationality" maxLength={40} defaultValue={w?.nationality ?? ""} className="input" /></Field>
      <Field label={t.wk_salary}><input name="salary" inputMode="decimal" dir="ltr" placeholder="0.000" defaultValue={w ? plainOmr(w.salary) : ""} className="input" /></Field>
      <Field label={t.wk_iqama}><input name="iqama_no" dir="ltr" maxLength={40} defaultValue={w?.iqama_no ?? ""} className="input" /></Field>
      <Field label={t.wk_iqama_expiry}><input name="iqama_expiry" type="date" defaultValue={w?.iqama_expiry ?? ""} className="input" /></Field>
      <Field label={t.wk_joined}><input name="joined_on" type="date" defaultValue={w?.joined_on ?? ""} className="input" /></Field>
      {w ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={w.active} /> {t.wk_active}</label> : null}
      <SubmitButton className="btn-primary sm:col-span-3">{t.save}</SubmitButton>
    </ActionForm>
  );
}
