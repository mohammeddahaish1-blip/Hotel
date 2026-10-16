import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dictionaries } from "@/lib/i18n/dict";
import { dateTime, gregorian, omr, whatsappLink } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PrintButton } from "@/components/PrintButton";
import { issueCreditNote } from "@/app/actions/ops";

type Snap = {
  currency: string;
  issue_date: string;
  seller: { name_ar: string; name_en: string | null; address: string | null; phone: string | null; vat_no: string | null; license_no: string | null };
  buyer: { name: string; name_ar: string | null; nationality: string | null; doc_number: string | null; phone: string | null };
  stay: { code: string; from: string; to: string; unit: string } | null;
  lines: { id: string; kind: string; description: string; amount: number }[];
  tax_lines: { code: string; name_ar: string; name_en: string; rate_bp: number; base: number; amount: number }[];
};

// FR-30: immutable, sequentially numbered, Arabic + English. CR-07: snapshot is UBL-mappable.
export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const ctx = await requireArea("reservations");
  const { t, lang } = await getDict();
  const { id } = await params;
  const { data: inv } = await ctx.supabase.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const { data: credits } = await ctx.supabase.from("credit_notes").select("*").eq("invoice_id", id).order("number");
  const { data: folio } = await ctx.supabase.from("folios").select("reservation_id").eq("id", inv.folio_id).single();
  const s = inv.snapshot as Snap;
  const ar = dictionaries.ar;
  const en = dictionaries.en;
  const both = inv.language === "bilingual";
  const L = (k: keyof typeof ar) => (both ? `${ar[k]} / ${en[k]}` : inv.language === "en" ? en[k] : ar[k]);
  const docLang = inv.language === "en" ? "en" : "ar";
  const number = `${inv.series}-${String(inv.number).padStart(6, "0")}`;
  const canCredit = hasRole(ctx, ["manager", "accountant"]);
  const shareText =
    docLang === "en"
      ? `Tax invoice ${number} from ${s.seller.name_en ?? s.seller.name_ar}\nTotal: ${omr(inv.total, "en")}`
      : `فاتورة ضريبية ${number} من ${s.seller.name_ar}\nالإجمالي: ${omr(inv.total, "ar")}`;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        {folio?.reservation_id ? <Link href={`/reservations/${folio.reservation_id}`} className="btn-ghost">{t.back}</Link> : null}
        <PrintButton label={t.print} />
        {s.buyer.phone ? (
          <a className="btn-ghost" target="_blank" rel="noreferrer" href={whatsappLink(s.buyer.phone, shareText)}>{t.share_invoice}</a>
        ) : null}
      </div>

      <article className="card mx-auto max-w-3xl p-6" dir={docLang === "en" ? "ltr" : "rtl"}>
        <header className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-lg font-bold">{s.seller.name_ar}</div>
            {s.seller.name_en ? <div className="text-sm">{s.seller.name_en}</div> : null}
            <div className="mt-1 text-xs text-muted">{s.seller.address}</div>
            <div className="text-xs text-muted" dir="ltr">{s.seller.phone}</div>
            {s.seller.vat_no ? <div className="text-xs">{L("vat_no")}: {s.seller.vat_no}</div> : null}
            {s.seller.license_no ? <div className="text-xs">{L("set_license")}: {s.seller.license_no}</div> : null}
          </div>
          <div className="text-end">
            <div className="text-xl font-bold text-brand">{L("invoice")}</div>
            <div className="num mt-1 text-sm">{L("invoice_no")}: <b>{number}</b></div>
            <div className="text-sm">{L("date")}: {gregorian(s.issue_date, docLang)}</div>
            <div className="text-xs text-muted">{dateTime(inv.issued_at, ctx.property.timezone, docLang)}</div>
          </div>
        </header>

        <section className="grid gap-4 border-b border-line py-4 text-sm sm:grid-cols-2">
          <div>
            <div className="label">{L("buyer")}</div>
            <div className="font-semibold">{s.buyer.name}</div>
            {s.buyer.name_ar ? <div>{s.buyer.name_ar}</div> : null}
            <div className="text-xs text-muted">{s.buyer.nationality} {s.buyer.doc_number ? `· ${s.buyer.doc_number}` : ""}</div>
          </div>
          {s.stay ? (
            <div>
              <div className="label">{L("res_details")}</div>
              <div>{s.stay.code} · {L("unit")} {s.stay.unit}</div>
              <div className="text-xs text-muted">{gregorian(s.stay.from, docLang)} → {gregorian(s.stay.to, docLang)}</div>
            </div>
          ) : null}
        </section>

        <table className="table mt-2">
          <thead><tr><th>{L("date")}</th><th>{L("description")}</th><th className="text-end">{L("amount")}</th></tr></thead>
          <tbody>
            {s.lines.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{gregorian((l as unknown as { date: string }).date, docLang)}</td>
                <td>{l.description}</td>
                <td className="num text-end">{omr(l.amount, docLang)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ms-auto mt-4 max-w-sm space-y-1.5 text-sm">
          <div className="flex justify-between"><dt>{L("subtotal")}</dt><dd className="num">{omr(inv.subtotal, docLang)}</dd></div>
          {s.tax_lines.map((x) => (
            <div key={x.code} className="flex justify-between text-muted">
              <dt>{both ? `${x.name_ar} / ${x.name_en}` : docLang === "en" ? x.name_en : x.name_ar} ({x.rate_bp / 100}%)</dt>
              <dd className="num">{omr(x.amount, docLang)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>{L("total")}</dt><dd className="num">{omr(inv.total, docLang)}</dd></div>
        </dl>

        {credits?.length ? (
          <section className="mt-6 border-t border-line pt-4 text-sm">
            <div className="mb-2 font-bold">{L("credit_note")}</div>
            {credits.map((c) => (
              <div key={c.id} className="flex justify-between">
                <span>{c.series}-{String(c.number).padStart(6, "0")} · {c.reason}</span>
                <span className="num">-{omr(c.total, docLang)}</span>
              </div>
            ))}
          </section>
        ) : null}

        <footer className="mt-6 text-center text-xs text-muted">
          {lang === "ar" ? "مستند صادر إلكترونياً ولا يقبل التعديل. التصحيح بإشعار دائن فقط." : "Electronically issued; cannot be altered. Corrections by credit note only."}
        </footer>
      </article>

      {canCredit && inv.subtotal > (credits ?? []).reduce((a, c) => a + c.subtotal, 0) ? (
        <div className="no-print card mx-auto mt-4 max-w-3xl">
          <h2 className="h2 mb-3">{t.issue_credit_note}</h2>
          <ActionForm action={issueCreditNote} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="invoice" value={inv.id} />
            <input name="amount" required inputMode="decimal" placeholder={`${t.subtotal} (OMR)`} className="input" />
            <input name="reason" required placeholder={t.reason} className="input sm:col-span-2" />
            <SubmitButton className="btn-danger" confirm={t.issue_credit_note}>{t.issue_credit_note}</SubmitButton>
          </ActionForm>
        </div>
      ) : null}
    </>
  );
}
